# @aizigao/pi-proxy-fetch

English: [`README.md`](./README.md)

一个用于 Pi 的扩展包，用 SwitchyOmega 风格的 `switchRules` 将 `globalThis.fetch` 路由到不同的代理 profile。

## 功能

`@aizigao/pi-proxy-fetch` 会在 Pi 会话内 monkey-patch `globalThis.fetch`。支持：

- **多 profile**：定义多个代理服务器（Clash、Whistle 等），一键切换
- **自动切换**：基于规则的智能路由，支持 Host wildcard / URL wildcard / URL regex 条件
- **内置 profile**：`direct`（直连）和 `system`（读取 `HTTP_PROXY` / `HTTPS_PROXY` 环境变量）
- 会话级 fetch patch，结束时自动恢复
- `/proxy` 命令：切换 profile、查看统计、查看规则

## 环境要求

- Node.js 20+
- 已安装 Pi coding agent

## 安装

```bash
pi install npm:@aizigao/pi-proxy-fetch
```

## 配置

创建 `~/.pi/proxy.jsonc`（JSON 含注释，也支持标准 `~/.pi/proxy.json`）：

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/aizigao/pi-proxy-fetch/master/schema.json",
  "enabled": true,
  "profile_name": "auto switch",
  "profileConfig": [
    {
      "name": "my clash",
      "type": "proxy_server",
      "server": "socks5://127.0.0.1:7890"
    },
    {
      "name": "auto switch",
      "type": "autoSwitch",
      "switchRules": [
        {
          "note": "局域网直连",
          "conditions": [
            { "conditionType": "HostWildcardCondition", "pattern": "*.local" }
          ],
          "profileName": "direct"
        },
        {
          "note": "AI API 直连",
          "conditions": [
            { "conditionType": "HostWildcardCondition", "pattern": "api.openai.com" }
          ],
          "profileName": "direct"
        },
        {
          "note": "Google 走代理",
          "conditions": [
            { "conditionType": "UrlWildcardCondition", "pattern": "*://*.google.com/*" }
          ],
          "profileName": "my clash"
        },
        {
          "conditions": [
            { "conditionType": "HostWildcardCondition", "pattern": "*" }
          ],
          "profileName": "my clash"
        }
      ]
    }
  ]
}
```

### 配置路径优先级

1. `~/.pi/proxy.jsonc`（JSONC，支持注释）
2. `~/.pi/proxy.json`（标准 JSON）
3. 旧 `~/.pi/agent/proxy.json` → 首次运行时自动迁移到 `proxy.jsonc`

### Schema

添加 `"$schema"` 可在 VS Code 中获得自动补全和校验：

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/aizigao/pi-proxy-fetch/master/schema.json",
  // ...
}
```

本地生成：`npm run schema` → `schema.json`。

### 顶层字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `enabled` | `boolean` | 全局开关 |
| `profile_name` | `string` | 激活的 profile。保留名：`direct`、`system`。其他值必须在 `profileConfig` 中存在 |
| `profileConfig` | `Profile[]` | Profile 列表 |

### Profile 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | `string` | Profile 唯一标识 |
| `type` | `"proxy_server"` / `"autoSwitch"` | Profile 类型 |
| `server` | `string?` | 代理地址（`proxy_server` 类型） |
| `ruleListURL` | `string?` | 远程规则列表 URL（`autoSwitch` 类型，预留） |
| `switchRules` | `SwitchRule[]?` | 规则列表（`autoSwitch` 类型） |

### SwitchRule 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `note` | `string?` | 可选备注 |
| `conditions` | `Condition[]?` | 条件列表（AND 逻辑）。空 = 无条件匹配 |
| `profileName` | `string` | 目标 profile。保留名：`direct`、`system` |

### Condition 类型

| conditionType | 匹配目标 | 说明 |
|---|---|---|
| `HostWildcardCondition` | 请求 hostname | `*` / `?` 通配符。`*.example.com` 同时匹配 `example.com` 和子域名。`**.example.com` 只匹配子域名 |
| `UrlWildcardCondition` | 完整请求 URL | `*` / `?` 通配符。无 `*.` 特殊语义 |
| `UrlRegexCondition` | 完整请求 URL | JavaScript 正则表达式 |
| `DisabledCondition` | — | 永远不匹配（临时禁用规则） |

## 命令

在 Pi 中执行：

```text
/proxy                 # 交互菜单
/proxy "my clash"      # 切换到指定 profile
/proxy stats           # 显示请求统计
/proxy rules           # 显示 autoSwitch 规则
/proxy reload          # 重新加载配置
```

## 开发

```bash
npm install
npm run check          # TypeScript
npm run lint           # ESLint
npm run lint:fix       # ESLint 自动修复
npm run schema         # 生成 JSON Schema
```

## 项目结构

```text
.
├── index.ts              # Pi 扩展入口
├── lib/
│   ├── config.ts         # 配置读取、JSONC 解析、旧格式迁移、schema 校验
│   ├── conditions.ts     # 条件匹配引擎
│   ├── router.ts         # Profile 解析和请求路由
│   └── stats.ts          # 请求计数器
├── scripts/
│   └── generate-schema.js  # JSON Schema 生成器
├── schema.json           # 生成的 JSON Schema
├── spec/
│   └── SPEC.md           # 规格文档
├── package.json
├── tsconfig.json
├── eslint.config.js
├── README.md
└── README-CN.md
```

## License

MIT
