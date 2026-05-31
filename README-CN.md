# @aizigao/pi-proxy-fetch

English: [`README.md`](./README.md)

一个用于 Pi 的扩展包。它会在 Pi 会话内 patch `globalThis.fetch`，并按 SwitchyOmega 风格的 `switchRules` 将请求路由到不同代理 profile。

## 功能

支持：

- **多 profile**：定义多个代理服务器（如 Clash、Whistle）
- **autoSwitch**：按规则匹配请求并路由到目标 profile
- **内置目标**：`direct`（直连）、`system`（读取环境变量 `HTTP_PROXY` / `HTTPS_PROXY`）
- **远程规则列表**：`ruleListURL` 下载到本地文件后参与匹配
- **证书配置**：`proxy_server` 可选 `caCertPath`，适配 Whistle 等自签证书代理
- **菜单操作**：切换 profile、查看 stats、查看 rules、刷新 rule list、重载配置

## 环境要求

- Node.js 20+
- 已安装 Pi coding agent

## 安装

```bash
pi install npm:@aizigao/pi-proxy-fetch
```

## 配置

推荐创建全局配置：`~/.pi/proxy.json`
也支持项目配置：`.pi/proxy.json`


```json
{
  "$schema": "https://raw.githubusercontent.com/aizigao/pi-proxy-fetch/master/schema.json",
  "enabled": true,
  "profileName": "auto switch",
  "profileConfig": [
    {
      "name": "my clash",
      "type": "proxy_server",
      "server": "socks5://127.0.0.1:7890"
    },
    {
      "name": "whistle",
      "type": "proxy_server",
      "server": "http://127.0.0.1:8899",
      "caCertPath": "~/.WhistleAppData/.whistle/certs/root.crt"
    },
    {
      "name": "auto switch",
      "type": "autoSwitch",
      "ruleListURL": "https://raw.githubusercontent.com/gfwlist/gfwlist/master/gfwlist.txt",
      "switchRules": [
        {
          "note": "my direct list",
          "conditions": [
            { "type": "host", "pattern": "api.openai.com" }
            { "type": "host", "pattern": "api.anthropic.com" }
          ],
          "profileName": "direct"
        },
        {
          "note": "host via Clash",
          "conditions": [
            { "type": "host", "pattern": "*.github.com" },
            { "type": "url", "pattern": "*://*.google.com/*" }
          ],
          "profileName": "my clash"
        }
      ]
    }
  ]
}
```

## 配置路径优先级

1. `./.pi/proxy.json`（项目本地，优先）
2. `~/.pi/proxy.json`（全局）
3. 旧 `~/.pi/agent/proxy.json`（首次运行时自动迁移）

## 字段说明

### 顶层字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `enabled` | `boolean` | 总开关。为 `false` 时直接绕过所有代理逻辑 |
| `profileName` | `string` | 当前激活的 profile 名。保留值：`direct`、`system` |
| `profileConfig` | `Profile[]` | profile 列表 |

### `proxy_server` 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | `string` | profile 名称 |
| `type` | `"proxy_server"` | 固定值 |
| `server` | `string` | 代理地址，如 `socks5://127.0.0.1:7890` |
| `caCertPath` | `string?` | 可选 CA 证书路径。适合 Whistle 等自签证书代理 |

### `autoSwitch` 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | `string` | profile 名称 |
| `type` | `"autoSwitch"` | 固定值 |
| `ruleListURL` | `string?` | 远程规则列表地址 |
| `switchRules` | `SwitchRule[]` | 本地规则 |

### `SwitchRule` 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `note` | `string?` | 备注 |
| `conditions` | `Condition[]?` | 条件列表，**AND 逻辑**；空则视为始终命中 |
| `profileName` | `string` | 目标 profile。也可用 `direct` / `system` |

### `Condition` 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `type` | `host` / `url` / `regex` / `disabled` | 条件类型 |
| `pattern` | `string?` | 匹配内容 |

### 条件类型说明

| `type` | 匹配目标 | 说明 |
|---|---|---|
| `host` | 请求 hostname | 支持 `*` / `?`；`*.example.com` 同时匹配 `example.com` 和子域名；`**.example.com` 只匹配子域名 |
| `url` | 完整 URL | 支持 `*` / `?`；没有 `*.` 的特殊语义 |
| `regex` | 完整 URL | JavaScript 正则表达式 |
| `disabled` | - | 永不命中 |

> 未命中任何规则时默认直连，不需要显式写 catch-all 规则。

## ruleListURL 行为

- `ruleListURL` 指向的内容会下载到**配置同目录**
- 文件名格式：

```text
proxy-rulelist-file--{profile_name_safe}.txt
```

例如：

```text
./.pi/proxy-rulelist-file--auto_switch.txt
```

- `session_start` 时：如果本地文件已存在，就直接加载
- 如果本地文件不存在，会自动下载一次
- 也可以在 `/proxy` 菜单里手动执行 **Refresh rule list files**
- 下载得到的远程规则只在**运行期**合并到内存，不会写回你的原始 `switchRules`
- 切换 profile、reload、菜单操作都不会直接改你的原始规则内容

## 命令

在 Pi 中执行：

```text
/proxy            # 打开交互菜单
/proxy stats      # 查看统计
/proxy rules      # 查看当前 autoSwitch 规则
/proxy reload     # 重载配置
/proxy "name"     # 直接切换到某个 profile
```

`/proxy` 交互菜单包含：

- 选择 profile
- Show stats
- Show rules
- Refresh rule list files
- Reload config

## 开发

```bash
npm install
npm run check
npm run lint
npm run schema
```

## License

MIT
