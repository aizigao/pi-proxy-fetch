# @aizigao/pi-proxy-fetch


[![npm version](https://img.shields.io/npm/v/%40aizigao%2Fpi-proxy-fetch)](https://www.npmjs.com/package/@aizigao/pi-proxy-fetch)

English: [`README.md`](https://github.com/aizigao/pi-proxy-fetch/blob/master/README.md)

一个用于 Pi 的扩展包。它会在 Pi 会话内 patch `globalThis.fetch`，并按 SwitchyOmega 风格的 `switchRules` 将请求路由到不同代理 profile。

![README cover](https://raw.githubusercontent.com/aizigao/pi-proxy-fetch/master/assets/readme-cover.png)

## 功能

支持：

- **多 profile**：定义多个代理服务器（如 Clash、Whistle）
- **autoSwitch**：按规则匹配请求并路由到目标 profile
- **内置目标**：`direct`（直连）、`system`（读取环境变量 `http_proxy` / `HTTP_PROXY`）
- **远程规则列表**：`ruleListURL` 下载到本地文件后参与匹配
- **证书配置**：`proxy_server` 可选 `caCertPath`，适配 Whistle 等自签证书代理
- **菜单操作**：切换 profile、查看 stats、刷新 rule list、重载配置

## 环境要求

- Node.js 20+
- 已安装 Pi coding agent

## 安装

```bash
pi install npm:@aizigao/pi-proxy-fetch
```

## 配置

推荐创建项目本地配置：`./.pi/proxy.json`

也支持全局配置：`~/.pi/agent/proxy.json`

如果项目和全局配置都不存在，会自动在 `~/.pi/agent/proxy.json` 生成默认配置。

```json
{
  "$schema": "https://raw.githubusercontent.com/aizigao/pi-proxy-fetch/master/schema.json",
  "version": 1,
  "enabled": true,
  "profileName": "auto-switch",
  "profileConfig": [
    {
      "name": "my_clash",
      "type": "proxy_server",
      "server": "http://127.0.0.1:7890"
    },
    {
      "name": "auto-switch",
      "type": "autoSwitch",
      "ruleListURL": "https://raw.githubusercontent.com/gfwlist/gfwlist/master/gfwlist.txt",
      "switchRules": [
        {
          "note": "AI APIs",
          "conditions": [
            {
              "type": "host",
              "pattern": "api.openai.com"
            },
            {
              "type": "host",
              "pattern": "api.anthropic.com"
            },
            {
              "type": "host",
              "pattern": "generativelanguage.googleapis.com"
            }
          ],
          "profileName": "direct"
        },
        {
          "note": "Force proxy",
          "conditions": [
            { "type": "host", "pattern": "*.brave.com" },
            { "type": "host", "pattern": "opencode.ai" },
            { "type": "host", "pattern": "*.github.com" }
          ],
          "profileName": "my_clash"
        }
      ]
    }
  ]
}

```

## 配置路径优先级

1. `./.pi/proxy.json`（项目本地，优先）
2. `~/.pi/agent/proxy.json`（全局）

> 只有带 `version: 1` 的配置会被识别为新格式；否则当前文件会被备份为 `proxy.bak.json`，并生成默认配置。

## 字段说明

### 顶层字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `version` | `1` | 新格式版本号，当前固定为 `1` |
| `enabled` | `boolean` | 总开关。为 `false` 时直接绕过所有代理逻辑 |
| `profileName` | `string` | 当前激活的 profile 名。保留值：`direct`、`system`；自定义名称必须匹配 `^[A-Za-z_-]+$` |
| `profileConfig` | `Profile[]` | profile 列表 |

### `proxy_server` 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | `string` | profile 名称，必须匹配 `^[A-Za-z_-]+$` |
| `type` | `"proxy_server"` | 固定值 |
| `server` | `string` | 必填代理地址，如 `socks5://127.0.0.1:7890` |
| `caCertPath` | `string?` | 可选 CA 证书路径。适合 Whistle 等自签证书代理 |

### `autoSwitch` 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | `string` | profile 名称，必须匹配 `^[A-Za-z_-]+$` |
| `type` | `"autoSwitch"` | 固定值 |
| `ruleListURL` | `string?` | 远程规则列表地址 |
| `switchRules` | `SwitchRule[]` | 本地规则 |

### `SwitchRule` 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `note` | `string?` | 备注 |
| `conditions` | `Condition[]?` | 条件列表，**OR 逻辑**；空则视为始终命中 |
| `profileName` | `string` | 目标 profile。也可用 `direct` / `system`；自定义名称必须匹配 `^[A-Za-z_-]+$` |

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

`ruleListURL` 主要适合中国用户接入 **gfwlist / AutoProxy** 这类现成规则集。

典型场景：

- 你有一套自己的本地规则：例如 OpenAI / Anthropic 直连、公司内网直连
- 同时又希望把大量“需要代理的网站列表”直接复用现成规则，而不是手写几千条
- 这时可以把远程规则挂在 `autoSwitch` profile 上，通过 `ruleListURL` 下载并参与匹配

例如：

```json
{
  "name": "auto-switch",
  "type": "autoSwitch",
  "ruleListURL": "https://raw.githubusercontent.com/gfwlist/gfwlist/master/gfwlist.txt",
  "switchRules": [
    {
      "note": "OpenAI direct",
      "conditions": [
        { "type": "host", "pattern": "api.openai.com" }
      ],
      "profileName": "direct"
    },
    {
      "note": "Anthropic direct",
      "conditions": [
        { "type": "host", "pattern": "api.anthropic.com" }
      ],
      "profileName": "direct"
    }
  ]
}
```

上面的含义是：

1. **本地 `switchRules` 优先**：你自己写的规则先匹配
2. 如果本地规则没命中，再继续使用 `ruleListURL` 下载下来的规则
3. 如果远程规则也没命中，默认直连

### 下载后保存在哪里

项目配置的 `ruleListURL` 内容会下载到**项目配置同目录**。
全局配置的 `ruleListURL` 内容会下载到 `~/.pi/agent`。

文件名格式：

```text
proxy-rulelist-file--{profile_name_safe}.txt
```

例如：

```text
./.pi/proxy-rulelist-file--auto_switch.txt
~/.pi/agent/proxy-rulelist-file--auto_switch.txt
```

### 下载内容是什么格式

如果你用的是 gfwlist：

- 源文件通常是 **base64 编码**
- 程序会自动解码
- 保存成可读文本到本地 `proxy-rulelist-file--*.txt`
- 然后再把其中的 AutoProxy 规则解析成运行期 `switchRules`

### 什么时候会下载

- `session_start` 时：如果本地文件已存在，就直接加载
- 如果本地文件不存在，会自动下载一次
- 也可以在 `/proxy` 菜单里手动执行 **Refresh rule list files**

### 重要说明

- 下载得到的远程规则只在**运行期**合并到内存，不会写回你的原始 `switchRules`
- 切换 profile、reload、菜单操作都不会直接改你的原始规则内容
- 所以你可以放心把 `ruleListURL` 当成“远程规则源”，而把 `switchRules` 当成“你自己维护的本地规则”

## 命令

在 Pi 中执行：

```text
/proxy            # 打开交互菜单
/proxy stats      # 查看统计
/proxy reload     # 重载配置
/proxy name       # 直接切换到某个 profile
```

`/proxy` 交互菜单包含：

- 选择 profile
- Enable/Disable proxy
- Show stats
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
