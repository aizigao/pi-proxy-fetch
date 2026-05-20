# @aizigao/pi-proxy-fetch

English: [`README.md`](./README.md)

一个用于 Pi 的扩展包，按 hostname 规则将 `globalThis.fetch` 路由为直连、代理或“直连失败后走代理”的回退模式。

本项目 fork 自 [`haokanjiang/pi-proxy`](https://github.com/haokanjiang/pi-proxy)，并在此基础上调整为保留当前本地路由行为与现有打包结构。

这个包保留了当前本地实现的核心路由模型：
- 配置文件位于 `~/.pi/agent/proxy.json`
- 每次请求都会重新读取规则
- 支持通配符 hostname 匹配
- 代理请求通过 `undici` 的 `ProxyAgent` 发出
- `fallback` 模式会在直连失败后通过代理重试
- 提供 `/proxy` 命令用于开关、查看统计、重载配置和显示规则

## 功能说明

`@aizigao/pi-proxy-fetch` 会在 Pi 会话内 monkey-patch `globalThis.fetch`。

每次请求会执行以下流程：
1. 读取 `~/.pi/agent/proxy.json`
2. 根据请求 hostname 匹配规则
3. 选择以下三种动作之一：
   - `direct`：使用原始 fetch
   - `proxy`：通过 `ProxyAgent` 发起请求
   - `fallback`：先直连，若发生网络失败则通过代理重试

这是一个网络层的 fetch 路由器，不是搜索工具，也不会改变非 fetch 的 HTTP 客户端行为。

## 特性

- Pi 扩展包结构
- 基于规则的 host 匹配
- 支持 `direct`、`proxy`、`fallback` 三种动作
- 会话级 fetch patch，并在会话结束时恢复
- 提供交互式 `/proxy` 命令
- 统计直连、代理和回退请求次数
- 配置驱动的启用/禁用开关，且支持持久化写回配置

## 环境要求

- Node.js 20+
- 已安装 Pi coding agent
- 存在 Pi agent 配置目录 `~/.pi/agent`

## 仓库信息

- GitHub: https://github.com/aizigao/pi-proxy-fetch
- Issues: https://github.com/aizigao/pi-proxy-fetch/issues
- npm 包名：`@aizigao/pi-proxy-fetch`

## 安装

### 通过 Pi 安装

```bash
pi install npm:@aizigao/pi-proxy-fetch
```

## 配置

创建 `~/.pi/agent/proxy.json`：

```json
{
  "enabled": true,
  "proxy": "http://127.0.0.1:7890",
  "mode": "direct",
  "rules": [
    {
      "match": "api.openai.com,api.anthropic.com",
      "action": "direct",
      "comment": "AI API 流量保持直连"
    },
    {
      "match": "*.google.com,*.github.com",
      "action": "proxy",
      "comment": "指定域名始终走代理"
    },
    {
      "match": "*",
      "action": "fallback",
      "comment": "默认先直连，失败后走代理"
    }
  ]
}
```

### 配置字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `enabled` | `boolean` | 全局开关。可通过 `/proxy` 切换并持久化写回。 |
| `proxy` | `string` | 传给 `undici` `ProxyAgent` 的代理地址。 |
| `mode` | `direct \| proxy \| fallback` | 没有命中任何规则时的默认动作。 |
| `rules` | `ProxyRule[]` | 按顺序匹配的规则列表。先命中先生效。 |

### 规则格式

```json
{
  "match": "*.example.com,api.example.com",
  "action": "proxy",
  "comment": "可选备注"
}
```

- `match` 支持逗号分隔的多个模式
- `*` 表示匹配所有主机名
- 不包含 `*` 的模式要求精确匹配
- 包含 `*` 的模式按通配符处理

示例：
- `api.openai.com`
- `*.google.com`
- `github.*`
- `*`

## 命令

在 Pi 中执行：

```text
/proxy
```

菜单项包括：
- `Turn ON` / `Turn OFF`
- `Show stats`
- `Reload config`
- `Show rules`

## 行为说明

### direct / proxy / fallback 的区别

- `direct`：使用未被 patch 的原始 fetch
- `proxy`：使用 `undiciFetch(..., { dispatcher: new ProxyAgent(...) })`
- `fallback`：先直连，若失败且不是 abort/timeout 类错误，则通过代理重试

### 哪些请求不会被拦截

这个 patch 只影响扩展加载之后、走 patched `globalThis.fetch` 的代码。

它**不会**自动拦截：
- 在 patch 之前就缓存了旧 `fetch` 的代码
- 直接导入 `undici.fetch` 的代码
- 其他 HTTP 客户端

## 开发

```bash
npm install
npm run check
npm run lint
```

## 脚本

| 命令 | 说明 |
| --- | --- |
| `npm run check` | 运行 TypeScript 类型检查 |
| `npm run lint` | 运行 ESLint |
| `npm run lint:fix` | 自动修复可修复的 ESLint 问题 |

## 发布

发布前建议先确认：

```bash
npm run check
npm run lint
```

然后执行：

```bash
npm publish
```

这个包已配置为 public scoped package。

## 项目结构

```text
.
├── index.ts         # Pi 扩展入口
├── eslint.config.js # ESLint flat config
├── tsconfig.json    # TypeScript 配置
└── package.json     # npm 与 Pi 包元数据
```

## 设计取舍

这个包有意保留当前本地实现的行为，而不是完全照搬上游 `pi-proxy`：

- 配置路径保持为 `~/.pi/agent/proxy.json`
- 配置按请求重新读取，而不是常驻内存缓存
- 通配符匹配通过 regex 转换实现
- `fallback` 会对更宽泛的非 abort 错误进行代理重试
- 代理请求显式使用 `undici.fetch`


## License

MIT
