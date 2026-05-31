/**
 * 飞书消息通知器配置选项
 */
export interface FeishuNotifierOptions {
	/** 飞书 webhook 地址（必填） */
	webhookUrl: string;
	/** 日志实例，需实现 info/warn/error 方法 */
	logger?: {
		info: (message: string, ...args: any[]) => void;
		warn: (message: string, ...args: any[]) => void;
		error: (message: string, ...args: any[]) => void;
	};
	/** 每秒最大请求数（最大 5） */
	rateLimitPerSecond?: number;
	/** 每分钟最大请求数（最大 60） */
	rateLimitPerMinute?: number;
	/** 消息队列最大长度（最大 200） */
	maxQueueSize?: number;
	/** 单条消息最大字节数（最大 20KB） */
	maxMessageSize?: number;
	/** 是否跳过整点半点发送 */
	skipPeakTime?: boolean;
	/** 发送失败重试间隔，毫秒（1000-60000） */
	retryInterval?: number;
	/** 应用名称，用于消息前缀 */
	appName?: string;
}

/**
 * 飞书消息通知器
 * 支持频率控制、消息队列、失败重试
 */
export declare class FeishuNotifier {
	/** 配置项的最大值限制 */
	static readonly LIMITS: {
		readonly RATE_LIMIT_PER_SECOND_MAX: 5;
		readonly RATE_LIMIT_PER_MINUTE_MAX: 60;
		readonly MAX_QUEUE_SIZE_MAX: 200;
		readonly MAX_MESSAGE_SIZE_MAX: number;
		readonly RETRY_INTERVAL_MIN: 1000;
		readonly RETRY_INTERVAL_MAX: 60000;
	};

	/**
	 * 构造函数
	 * @param options - 配置选项
	 */
	constructor(options: FeishuNotifierOptions);

	/**
	 * 检查当前是否是整点或半点
	 * @returns 是否是峰值时间
	 */
	isPeakTime(): boolean;

	/**
	 * 检查是否可以发送消息（频率控制 + 峰值时间）
	 * @returns 是否可以发送
	 */
	canSendMessage(): boolean;

	/**
	 * 发送消息到飞书
	 * @param message - 消息内容
	 * @param level - 消息级别 ('info' | 'warning')
	 * @returns Promise
	 */
	send(message: string, level?: "info" | "warning"): Promise<void>;

	/**
	 * 发送通知消息（快捷方法）
	 * @param message - 消息内容
	 * @returns Promise
	 */
	notify(message: string): Promise<void>;

	/**
	 * 发送警告消息（快捷方法）
	 * @param message - 消息内容
	 * @returns Promise
	 */
	warn(message: string): Promise<void>;

	/**
	 * 销毁实例，清理资源
	 */
	destroy(): void;
}

export default FeishuNotifier;
