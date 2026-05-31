import axios from "axios";
import dayjs from "dayjs";

/**
 * 飞书消息通知器
 * 支持频率控制、消息队列、失败重试
 */
class FeishuNotifier {
	/**
	 * 构造函数
	 * @param {Object} options - 配置选项
	 * @param {string} options.webhookUrl - 飞书 webhook 地址（必填）
	 * @param {Object} [options.logger] - 日志实例，需实现 info/warn/error 方法
	 * @param {number} [options.rateLimitPerSecond=2] - 每秒最大请求数
	 * @param {number} [options.rateLimitPerMinute=50] - 每分钟最大请求数
	 * @param {number} [options.maxQueueSize=100] - 消息队列最大长度
	 * @param {number} [options.maxMessageSize=20479] - 单条消息最大字节数（默认 20KB-1）
	 * @param {boolean} [options.skipPeakTime=false] - 是否跳过整点半点发送
	 * @param {number} [options.retryInterval=5000] - 发送失败重试间隔（毫秒）
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

		// 频率控制配置
		this.rateLimitPerSecond = options.rateLimitPerSecond ?? 2;
		this.rateLimitPerMinute = options.rateLimitPerMinute ?? 50;

		// 队列配置
		this.maxQueueSize = options.maxQueueSize ?? 100;
		this.maxMessageSize = options.maxMessageSize ?? 20 * 1024 - 1;

		// 发送策略
		this.skipPeakTime = options.skipPeakTime ?? false;
		this.retryInterval = options.retryInterval ?? 5000;

		// 内部状态
		this.messageQueue = [];
		this.isSending = false;
		this.processTimeoutRef = null;
		this.requestTimestamps = [];
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
			timeout: 10000, // 10秒超时
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
