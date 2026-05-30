# Spec: pi-proxy-fetch v0.2.0 Refactor — SwitchyOmega-style Rules

## Objective

将 `pi-proxy-fetch` 的代理路由规则引擎从简单的 hostname 匹配升级为对标 SwitchyOmega 的完整多 profile + switchRules 模型。

**目标用户**：通过 Pi 使用代理访问外网的开发者，需要精细化的按域名/URL 规则路由流量到不同代理。

**核心变更**：
1. 配置文件从 `~/.pi/agent/proxy.json` 迁移到 `~/.pi/proxy.jsonc`（JSONC，支持注释）。同时兼容 `~/.pi/proxy.json`（标准 JSON），`proxy.jsonc` 优先。
2. 引入多 profile 模型：可定义多个代理服务器，通过 `profile_name` 切换当前激活的 profile
3. 规则模型升级为 `switchRules[].conditions[]`（多 condition AND 逻辑），每条规则指定目标 profile
4. Condition 类型：HostWildcard / UrlWildcard / UrlRegex / Disabled（对标 SwitchyOmega）
5. `autoSwitch` profile：通过 switchRules 按规则匹配，自动选择目标 profile
6. 首次运行时自动迁移旧 `proxy.json` → `proxy.jsonc`

## Tech Stack

- **Runtime**: Node.js 20+, TypeScript
- **HTTP proxy**: `undici` `ProxyAgent`
- **JSONC parsing**: `jsonc-parser` (Microsoft) 或手写轻量 strip-comments
- **Extension API**: `@earendil-works/pi-coding-agent`

## proxy.jsonc Schema

配置路径优先级：`~/.pi/proxy.jsonc` > `~/.pi/proxy.json` > 自动迁移旧 `~/.pi/agent/proxy.json`。

### 完整示例

```jsonc
{
  // 全局开关
  "enabled": true,

  // 当前激活的 profile 名称
  "profile_name": "auto switch",

  // Profile 列表
  "profileConfig": [
    // 自定义代理：Clash
    {
      "name": "my clash",
      "type": "proxy_server",
      "server": "socks5://127.0.0.1:7890"
    },
    // 自定义代理：Whistle
    {
      "name": "whistle",
      "type": "proxy_server",
      "server": "http://127.0.0.1:8899"
    },
    // 自动切换 profile
    {
      "name": "auto switch",
      "type": "autoSwitch",
      "switchRules": [
        {
          "conditions": [
            {
              "conditionType": "HostWildcardCondition",
              "pattern": "*.local"
            }
          ],
          "profileName": "direct"
        },
        {
          "conditions": [
            {
              "conditionType": "UrlWildcardCondition",
              "pattern": "*://*.google.com/*"
            }
          ],
          "profileName": "my clash"
        },
        {
          "conditions": [
            {
              "conditionType": "HostWildcardCondition",
              "pattern": "*"
            }
          ],
          "profileName": "my clash"
        }
      ]
    }
  ]
}
```

### 顶层字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `enabled` | `boolean` | 全局开关 |
| `profile_name` | `string` | 当前激活的 profile 名称。为 `"auto switch"` 类型时走 switchRules 规则匹配 |
| `profileConfig` | `Profile[]` | Profile 列表 |

### Profile 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | `string` | Profile 唯一标识 |
| `type` | `"proxy_server"` \| `"autoSwitch"` | Profile 类型 |
| `server` | `string?` | （proxy_server 类型）代理地址，如 `socks5://127.0.0.1:7890`。内置 profile 省略此字段 |
| `ruleListURL` | `string?` | （autoSwitch 类型，可选）远程规则列表 URL |
| `switchRules` | `SwitchRule[]?` | （autoSwitch 类型）本地规则列表 |

### 内置 Profile（代码内部处理，不出现在配置文件中）

switchRules 中 `profileName` 可使用以下保留名：

| profileName | 行为 |
|---|---|
| `direct` | 直连，不走代理 |
| `system` | 读取系统代理设置（`HTTP_PROXY` / `HTTPS_PROXY` 环境变量） |
| 其他 | 在 `profileConfig` 中查找对应的 `proxy_server`，取其 `server` 字段 |

### SwitchRule 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `note` | `string?` | 可选备注 |
| `conditions` | `Condition[]?` | 条件列表（AND 逻辑）。空数组或缺省 = 无条件匹配 |
| `profileName` | `string` | 命中后使用的目标 profile 名称

### Condition 类型

| conditionType | 匹配目标 | 通配符说明 |
|---|---|---|
| `HostWildcardCondition` | 请求 hostname（小写） | `*` 匹配任意字符，`?` 匹配单个字符。前缀 `*.` 有特殊语义：`*.example.com` 匹配 `www.example.com` 和 `example.com` 本身。双星 `**.` 只匹配子域名。 |
| `UrlWildcardCondition` | 完整 URL | 通配符规则同上，但无 `*.` 特殊前缀语义。案例：`*://*.google.com/*` |
| `UrlRegexCondition` | 完整 URL | JavaScript 正则表达式。案例：`^https://www\\.example\\.(net\|org)/` |
| `DisabledCondition` | — | 永远不匹配，用于临时禁用某条规则 |

### Host wildcard `*.` 特殊语义（对标 SwitchyOmega）

| pattern | 匹配 example.com | 匹配 www.example.com | 匹配 sub.www.example.com |
|---|---|---|---|
| `example.com` | yes | no | no |
| `*.example.com` | yes | yes | no |
| `**.example.com` | no | yes | yes |
| `*` | yes | yes | yes |

## Commands

| 命令 | 说明 |
|---|---|
| `pi install npm:@aizigao/pi-proxy-fetch` | 安装 |
| `npm run check` | TypeScript 类型检查 |
| `npm run lint` | ESLint |
| `npm run lint:fix` | ESLint 自动修复 |

### /proxy 命令

```
/proxy              → 交互菜单
/proxy <profile>    → 切换激活的 profile（如 /proxy "my clash"）
/proxy stats        → 显示统计
/proxy rules        → 显示当前 autoSwitch profile 的 switchRules
/proxy reload       → 重新加载配置
```

**交互菜单项**（在现有基础上扩展）：
- 列出所有 profile，高亮当前激活的——选择后切换并写回 `profile_name`
- `Show stats`（保留）
- `Show rules`（调整为显示 autoSwitch 的 switchRules）
- `Reload config`（保留）

## Project Structure

```
pi-proxy-fetch/
├── index.ts              # Pi extension 入口：fetch patch、命令注册
├── lib/
│   ├── config.ts         # 配置读取、JSONC 解析、旧格式迁移
│   ├── conditions.ts     # Condition 匹配引擎
│   ├── router.ts         # 规则路由：switchRules 遍历、profile 解析
│   └── stats.ts          # 统计计数器
├── SPEC.md               # 本文件
├── package.json
├── tsconfig.json
├── eslint.config.js
├── README.md
└── README-CN.md
```

## Code Style

```typescript
// ---- Type definitions (lib/config.ts) ----

type ProfileType = "proxy_server" | "autoSwitch";

type ConditionType =
  | "HostWildcardCondition"
  | "UrlWildcardCondition"
  | "UrlRegexCondition"
  | "DisabledCondition";

interface SwitchCondition {
  conditionType: ConditionType;
  pattern?: string;
}

interface SwitchRule {
  note?: string;
  conditions?: SwitchCondition[];
  profileName: string;
}

interface Profile {
  name: string;
  type: ProfileType;
  server?: string;
  ruleListURL?: string;
  switchRules?: SwitchRule[];
}

interface ProxyConfig {
  enabled: boolean;
  profile_name: string;
  profileConfig: Profile[];
}

// ---- Config read with cache (lib/config.ts) ----
// 模块级缓存，extension load / session_start / reload 时刷新

let cachedConfig: ProxyConfig | null = null;

function loadConfig(): ProxyConfig | null {
  // 1. 尝试读 ~/.pi/proxy.jsonc（优先）
  // 2. fallback ~/.pi/proxy.json
  // 3. 如果不存在，尝试迁移 ~/.pi/agent/proxy.json
  // 3. JSONC 解析（strip comments）
  // 4. 校验 schema（必填字段、类型检查）
  // 5. 通过 profile_name 找到当前激活的 profile
  return cachedConfig;
}

function resolveProfile(config: ProxyConfig): Profile | undefined {
  return config.profileConfig.find(p => p.name === config.profile_name);
}

function resolveProxyServer(config: ProxyConfig, profileName: string): string | undefined {
  // 解析最终使用的代理地址：
  //   direct → undefined（直连）
  //   system → process.env.HTTP_PROXY || process.env.HTTPS_PROXY
  //   其他   → 在 profileConfig 中查找 proxy_server，取其 server 字段
  if (profileName === "direct") return undefined;
  if (profileName === "system") {
    const envProxy = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
    return envProxy ?? undefined;
  }
  const profile = config.profileConfig.find(
    p => p.name === profileName && p.type === "proxy_server"
  );
  return profile?.server;
}
```

**约定**：
- 函数优先用 `function` 声明（非箭头）
- Type imports 使用 `import type`
- 无 `any` 类型
- 错误处理用 try/catch + 统一 error message 格式

## Testing Strategy

暂不引入测试框架（当前项目无测试依赖）。通过以下方式验证：

1. **类型检查**：`npm run check` 零错误
2. **手动集成测试**：在 Pi 会话中实际切换模式、发起请求、观察路由行为
3. **配置文件校验**：准备多个 proxy.jsonc 变体（合法/非法），确认 loadConfig 行为正确

如需引入自动化测试，使用 `vitest`，测试文件放在 `lib/__tests__/`。

## Boundaries

**Always do:**
- `npm run check` 通过后再提交
- 配置文件读写使用同步 API（extension 加载时执行）
- fetch patch 热路径零 IO（读内存缓存）
- 规则匹配 hostname 统一转小写

**Ask first:**
- 添加新 npm 依赖（jsonc-parser 等）
- 修改 proxy.jsonc schema 结构
- 添加新的 condition 类型

**Never do:**
- 在 fetch 热路径读文件或做同步阻塞操作
- 修改 `undici` 或 `@earendil-works/pi-coding-agent` 的类型定义
- 静默吞掉配置解析错误（至少 log warning）

## Implementation Phases

### Phase 1: 配置层 (`lib/config.ts`)
- JSONC 解析（strip `//` 和 `/* */` 注释）
- `~/.pi/proxy.jsonc` / `~/.pi/proxy.json` 读取 + schema 校验
- 旧 `~/.pi/agent/proxy.json` → `proxy.jsonc` 自动迁移
- 模块级缓存 + `loadConfig()`/`reloadConfig()`

### Phase 2: 条件匹配引擎 (`lib/conditions.ts`)
- HostWildcard 匹配（含 `*.` / `**.` 特殊语义）
- UrlWildcard 匹配
- UrlRegex 匹配
- Disabled 条件（永远 false）
- AND 组合：所有 conditions 满足才算命中

### Phase 3: profile 解析与路由层 (`lib/router.ts`)
- `resolveProfile`：根据 `profile_name` 找到当前激活 profile
- `resolveProxyServer`：解析 profile 对应的实际代理地址
- autoSwitch profile：switchRules 顺序匹配，命中后路由到目标 profile
- proxy_server profile：所有请求直接走该代理
- fetch patch：根据解析结果选择 raw fetch / undici Fetch + ProxyAgent

### Phase 4: 命令与迁移 (`index.ts`)
- 现有 `/proxy` 交互菜单增加 profile 列表和切换选项
- 新增 `/proxy <profile>` 子命令快速切换
- `/proxy rules` 调整为显示 autoSwitch 的 switchRules
- 旧格式自动迁移逻辑
- System Proxy 环境变量读取
- README 更新

### Phase 5: 配置校验与错误处理
- JSONC 解析错误时 fallback 到最后已知有效配置
- schema 校验（必填字段、类型检查、profileName 目标是否存在）
- 旧格式迁移幂等性（不重复覆盖已有 proxy.jsonc）

## Open Questions

1. **PAC 脚本支持**：与 `ruleListURL`（远程规则列表）不同，PAC 是 JavaScript 脚本（`FindProxyForURL`），可执行任意逻辑。后续增强，本版不做。
2. **ruleListURL 远程规则**：本版预留字段，不实现远程拉取和解析。仅支持本地 `switchRules`。
3. **stats 持久化**：目前 stats 只在内存中，会话结束后清零。暂不持久化。
