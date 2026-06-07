import axios from "axios";
import dayjs from "dayjs";

/**
 * 飞书消息通知器
 * 支持频率控制、消息队列、失败重试
 */
class FeishuNotifier {
	/**
	 * 配置项的最大值限制
	 */
	static LIMITS = {
		RATE_LIMIT_PER_SECOND_DEFAULT: 2,
		RATE_LIMIT_PER_SECOND_MAX: 5,
		RATE_LIMIT_PER_MINUTE_DEFAULT: 30,
		RATE_LIMIT_PER_MINUTE_MAX: 60,
		MAX_QUEUE_SIZE_DEFAULT: 100,
		MAX_QUEUE_SIZE_MAX: 200,
		MAX_MESSAGE_SIZE_MAX: 20 * 1024 - 1, // 20KB
		RETRY_INTERVAL_MIN: 1000,
		RETRY_INTERVAL_MAX: 60000,
	};

	/**
	 * 构造函数
	 * @param {Object} options - 配置选项
	 * @param {string} options.webhookUrl - 飞书 webhook 地址（必填）
	 * @param {Object} [options.logger] - 日志实例，需实现 info/warn/error 方法
	 * @param {number} [options.rateLimitPerSecond=2] - 每秒最大请求数（最大 5）
	 * @param {number} [options.rateLimitPerMinute=50] - 每分钟最大请求数（最大 60）
	 * @param {number} [options.maxQueueSize=100] - 消息队列最大长度（最大 200）
	 * @param {boolean} [options.skipPeakTime=1] - 是否跳过整点半点发送（1: 是, 0: 否）
	 * @param {number} [options.retryInterval=5000] - 发送失败重试间隔，毫秒（1000-60000）
	 * @param {string} [options.appName=''] - 应用名称，用于消息前缀
	 */
	constructor(options) {
		// 参数校验
		if (!options?.webhookUrl) {
			throw new Error("FeishuNotifier: webhookUrl 是必填参数");
		}

		this.webhookUrl = options.webhookUrl;
		this.logger = options.logger || console;
		this.appName = options.appName || "";

		// 频率控制配置（带最大值限制）
		this.rateLimitPerSecond = this._clamp(
			options.rateLimitPerSecond,
			FeishuNotifier.LIMITS.RATE_LIMIT_PER_SECOND_DEFAULT,
			FeishuNotifier.LIMITS.RATE_LIMIT_PER_SECOND_MAX,
			"rateLimitPerSecond",
		);
		this.rateLimitPerMinute = this._clamp(
			options.rateLimitPerMinute,
			FeishuNotifier.LIMITS.RATE_LIMIT_PER_MINUTE_DEFAULT,
			FeishuNotifier.LIMITS.RATE_LIMIT_PER_MINUTE_MAX,
			"rateLimitPerMinute",
		);

		// 队列配置（带最大值限制）
		this.maxQueueSize = this._clamp(
			options.maxQueueSize,
			FeishuNotifier.LIMITS.MAX_QUEUE_SIZE_DEFAULT,
			FeishuNotifier.LIMITS.MAX_QUEUE_SIZE_MAX,
			"maxQueueSize",
		);
		this.maxMessageSize = FeishuNotifier.LIMITS.MAX_MESSAGE_SIZE_MAX;

		// 发送策略
		this.skipPeakTime = options.skipPeakTime === 1;
		this.retryInterval = this._clamp(
			options.retryInterval,
			FeishuNotifier.LIMITS.RETRY_INTERVAL_MIN,
			FeishuNotifier.LIMITS.RETRY_INTERVAL_MAX,
			"retryInterval",
		);

		// 内部状态
		this.messageQueue = [];
		this.isSending = false;
		this.processTimeoutRef = null;
		this.requestTimestamps = [];

		// 记录最终配置
		this.logger.info("[FeishuNotifier] 初始化完成，配置:", {
			webhookUrl: this.webhookUrl ? "已配置" : "未配置",
			rateLimitPerSecond: this.rateLimitPerSecond,
			rateLimitPerMinute: this.rateLimitPerMinute,
			maxQueueSize: this.maxQueueSize,
			maxMessageSize: this.maxMessageSize,
			skipPeakTime: this.skipPeakTime,
			retryInterval: this.retryInterval,
			appName: this.appName,
		});
	}

	/**
	 * 将数值限制在指定范围内
	 * @private
	 * @param {number} value - 输入值
	 * @param {number} min - 最小值
	 * @param {number} max - 最大值
	 * @param {string} name - 配置项名称（用于日志）
	 * @returns {number} 限制后的值
	 */
	_clamp(value, min, max, name) {
		const num = Number(value);
		if (Number.isNaN(num)) {
			this.logger.warn(
				`[FeishuNotifier] ${name} 配置无效，使用默认值 ${min}`,
			);
			return min;
		}
		if (num < min) {
			this.logger.warn(
				`[FeishuNotifier] ${name} (${num}) 小于最小值 ${min}，已调整为 ${min}`,
			);
			return min;
		}
		if (num > max) {
			this.logger.warn(
				`[FeishuNotifier] ${name} (${num}) 超过最大值 ${max}，已调整为 ${max}`,
			);
			return max;
		}
		return num;
	}

	/**
	 * 检查当前是否是整点或半点
	 * @returns {boolean} 是否是峰值时间
	 */
	isPeakTime() {
		const minutes = dayjs().minute();
		return minutes === 0 || minutes === 30;
	}

	/**
	 * 检查是否可以发送消息（频率控制 + 峰值时间）
	 * @returns {boolean} 是否可以发送
	 */
	canSendMessage() {
		if (this.skipPeakTime && this.isPeakTime()) {
			return false;
		}

		const now = Date.now();

		// 清理1分钟前的记录
		this.requestTimestamps = this.requestTimestamps.filter(
			(ts) => now - ts < 60 * 1000,
		);

		// 检查每分钟限制
		if (this.requestTimestamps.length >= this.rateLimitPerMinute) {
			return false;
		}

		// 检查每秒限制
		const lastSecondRequests = this.requestTimestamps.filter(
			(ts) => now - ts < 1000,
		);
		if (lastSecondRequests.length >= this.rateLimitPerSecond) {
			return false;
		}

		return true;
	}

	/**
	 * 记录请求时间戳
	 * @private
	 */
	recordRequestTimestamp() {
		this.requestTimestamps.push(Date.now());
	}

	/**
	 * 构建飞书消息格式
	 * @param {string} message - 消息内容
	 * @param {string} [level='info'] - 消息级别 ('info' | 'warning')
	 * @returns {Object} 飞书消息对象
	 */
	buildMessage(message, level = "info") {
		const appPrefix = this.appName ? `【${this.appName}】` : "";
		const levelPrefix =
			level === "warning"
				? '<at user_id="all">所有人</at>【警告】⚠️'
				: "【通知】📢";

		return {
			msg_type: "text",
			content: {
				text: `${appPrefix}${levelPrefix} ${message}`,
			},
		};
	}

	/**
	 * 发送消息到飞书
	 * @param {string} message - 消息内容
	 * @param {string} [level='info'] - 消息级别
	 * @returns {Promise<void>}
	 */
	async send(message, level = "info") {
		const fullMessage = this.buildMessage(message, level);
		const messageSize = Buffer.byteLength(
			JSON.stringify(fullMessage),
			"utf8",
		);

		// 检查消息大小
		if (messageSize > this.maxMessageSize) {
			this.logger.error(
				`[FeishuNotifier] 消息大小超过限制: ${messageSize} bytes, 最大限制: ${this.maxMessageSize} bytes`,
			);
			return;
		}

		// 队列大小保护
		if (this.messageQueue.length >= this.maxQueueSize) {
			this.logger.warn(
				`[FeishuNotifier] 消息队列已满(${this.maxQueueSize})，丢弃旧消息`,
			);
			this.messageQueue.shift();
		}

		this.messageQueue.push(fullMessage);
		await this.processQueue();
	}

	/**
	 * 发送通知消息（快捷方法）
	 * @param {string} message - 消息内容
	 * @returns {Promise<void>}
	 */
	async notify(message) {
		return this.send(message, "info");
	}

	/**
	 * 发送警告消息（快捷方法）
	 * @param {string} message - 消息内容
	 * @returns {Promise<void>}
	 */
	async warn(message) {
		return this.send(message, "warning");
	}

	/**
	 * 处理消息队列
	 * @private
	 */
	async processQueue() {
		if (this.isSending || this.messageQueue.length === 0) {
			return;
		}

		this.isSending = true;

		while (this.messageQueue.length > 0 && this.canSendMessage()) {
			const message = this.messageQueue.shift();

			try {
				await this.sendRequest(message);
				this.recordRequestTimestamp();
			} catch (error) {
				this.logger.error("[FeishuNotifier] 发送消息失败", error);
				// 发送失败，重新放回队列开头
				this.messageQueue.unshift(message);
				break;
			}
		}

		this.isSending = false;

		// 清理之前的定时器
		if (this.processTimeoutRef) {
			clearTimeout(this.processTimeoutRef);
			this.processTimeoutRef = null;
		}

		// 如果队列还有消息，延迟重试
		if (this.messageQueue.length > 0) {
			this.processTimeoutRef = setTimeout(
				() => this.processQueue(),
				this.retryInterval,
			);
		}
	}

	/**
	 * 发送 HTTP 请求
	 * @private
	 * @param {Object} message - 消息对象
	 * @returns {Promise<void>}
	 */
	async sendRequest(message) {
		await axios.post(this.webhookUrl, message, {
			headers: {
				"Content-Type": "application/json",
			},
			timeout: 30000, // 30秒超时
		});
	}

	/**
	 * 销毁实例，清理资源
	 */
	destroy() {
		if (this.processTimeoutRef) {
			clearTimeout(this.processTimeoutRef);
			this.processTimeoutRef = null;
		}
		this.messageQueue = [];
	}
}

export default FeishuNotifier;
export { FeishuNotifier };
