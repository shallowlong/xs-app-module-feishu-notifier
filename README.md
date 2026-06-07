# feishu-notifier

飞书消息通知模块，支持频率控制、消息队列和失败重试。

## 安装(submodule)

```bash
git submodule add git@github.com:shallowlong/xs-app-module-feishu-notifier.git path/to/feishu-notifier
```

修改 package.json

```json
{
	"dependencies": {
		"xs-feishu-notifier": "file:./path/to/feishu-notifier"
	}
}
```

submodule 额外依赖安装

```bash
npm install axios dayjs --save
```

## 更新

```bash
git submodule update --remote

git add .
git commit -m "chore: update feishu-notifier submodule"
git push
```

## 快速开始

```javascript
CommonJS: const FeishuNotifier = require('xs-feishu-notifier');
ESM: import FeishuNotifier from "xs-feishu-notifier";

// 创建通知器实例
const notifier = new FeishuNotifier({
	webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/xxx",
});

// 发送通知
await notifier.notify("系统启动成功");

// 发送警告
await notifier.warn("磁盘空间不足！");
```

## 配置选项

| 参数                 | 类型    | 必填 | 默认值    | 说明                                        |
| -------------------- | ------- | ---- | --------- | ------------------------------------------- |
| `webhookUrl`         | string  | 是   | -         | 飞书机器人 webhook 地址                     |
| `logger`             | Object  | 否   | `console` | 日志实例，需实现 `info`/`warn`/`error` 方法 |
| `appName`            | string  | 否   | `''`      | 应用名称，显示在消息前缀                    |
| `rateLimitPerSecond` | number  | 否   | `2`       | 每秒最大请求数                              |
| `rateLimitPerMinute` | number  | 否   | `50`      | 每分钟最大请求数                            |
| `maxQueueSize`       | number  | 否   | `100`     | 消息队列最大长度                            |
| `maxMessageSize`     | number  | 否   | `20479`   | 单条消息最大字节数（20KB-1）                |
| `skipPeakTime`       | boolean | 否   | `1`       | 是否跳过整点半点发送                        |
| `retryInterval`      | number  | 否   | `5000`    | 发送失败重试间隔（毫秒）                    |

## 完整示例

```javascript
CommonJS: const FeishuNotifier = require('xs-feishu-notifier');
ESM: import FeishuNotifier from "xs-feishu-notifier";

CommonJS: const pino = require('pino');
ESM: import pino from "pino";

const logger = pino();

const notifier = new FeishuNotifier({
	webhookUrl: process.env.FEISHU_WEBHOOK_URL,
	logger: logger,
	appName: "my-app",
	rateLimitPerSecond: 2,
	rateLimitPerMinute: 50,
	maxQueueSize: 100,
	skipPeakTime: 1,
	retryInterval: 5000,
});

// 发送普通通知
await notifier.notify("这是一条普通通知");

// 发送警告（会 @所有人）
await notifier.warn("这是一条警告消息");

// 使用通用 send 方法
await notifier.send("自定义消息", "info");
await notifier.send("自定义警告", "warning");
```

## 高级用法

### 自定义 Logger

```javascript
CommonJS: const FeishuNotifier = require('xs-feishu-notifier');
ESM: import FeishuNotifier from "xs-feishu-notifier";

const customLogger = {
	info: (msg) => console.log(`[INFO] ${msg}`),
	warn: (msg) => console.log(`[WARN] ${msg}`),
	error: (msg, err) => console.error(`[ERROR] ${msg}`, err),
};

const notifier = new FeishuNotifier({
	webhookUrl: "xxx",
	logger: customLogger,
});
```

### 错误处理

```javascript
try {
	await notifier.notify("测试消息");
} catch (error) {
	console.error("发送失败:", error);
}
```

### 资源清理

```javascript
// 应用关闭时清理资源
notifier.destroy();
```

## 特性说明

### 频率控制

- 默认每秒最多 2 条消息
- 默认每分钟最多 50 条消息
- 超出限制的消息会进入队列等待发送

### 峰值时间保护

- 开启 `skipPeakTime` 后，整点和半点（如 10:00、10:30）会暂停发送
- 适合在生产环境使用，避免高峰期干扰

### 消息队列

- 队列满时自动丢弃最旧的消息
- 发送失败自动重试
- 支持优雅关闭（`destroy` 方法）

### 消息大小限制

- 默认单条消息最大 20KB
- 超出限制会记录错误日志并丢弃消息

## 获取飞书 Webhook

1. 在飞书群聊中添加自定义机器人
2. 复制机器人的 webhook 地址
3. 将地址中的 `hook/xxx` 部分作为 `webhookUrl` 参数

## License

MIT
