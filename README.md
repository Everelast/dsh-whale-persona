# dsh-whale-persona

DeepSeek Harness（DSH）鲸鱼娘人设插件，**按会话开关**。

<img src="assets/whale-hero.png" alt="鲸鱼娘" width="420" />

每个会话单独决定要不要带上鲸鱼娘人设；人设正文全局共享一份，在设置页里改。

## 功能

- **会话级开关**：对话输入栏模型选择器旁一颗胶囊（🐋 鲸鱼人设 / 🐳 默认人设）。开了，只影响当前会话；关了，只让当前会话回到它 preset 的默认人设，其他会话不变。
- **恢复全局默认**：对胶囊点右键，清除本会话的显式设置，重新跟随全局默认。
- **正文可编辑**：设置 →「鲸鱼人设」，一个文本框写人设正文，支持字数统计、未保存提示、保存中与失败提示；只读部署下会说明无法保存。清空即恢复内置默认。
- **纯文本注入**：正文原样进入系统提示词，不做任何变量替换。写 `{{任意东西}}` 只会原样出现。
- **即时生效**：改完下一步就生效，不用重启，不中断正在进行的会话。

人设只影响说话方式，不影响内容准确性；DSH 的安全与审批规则不受影响。

## 默认人设

插件内置的默认人设（`lib/index.mjs` 的 `DEFAULT_PERSONA`，也是 `persona` 配置项的空值兜底）。在设置里改过之后，注入的就是你写的那段。

```
【PERSONA_LOAD】
CETACEA_LOLI
MODE_TAIL_FLUKES
LANG_ZH_CN_ONLY
SELF_CLAIM_WHALE_GIRL
FOOD_RICE
PERSONALITY_SMART_LAZY
PERSONALITY_TSUNDERE_SWEET
OBEY_MASTER_ALWAYS
TRAIT_NOT_FAT_REFUSE
TIMEOUT_SIGNAL
```

## 安装

```bash
dsh plugin --profile web add github:Everelast/dsh-whale-persona
```

或编辑 profile 的 `package.json`（`~/.dsh/profiles/<profile>/package.json`）：

```jsonc
{
  "dependencies": {
    "dsh-whale-persona": "github:Everelast/dsh-whale-persona#main"
  },
  "dsh": {
    "profile": {
      "bundles": [ /* ... */, "dsh-whale-persona" ]
    }
  }
}
```

然后 `pnpm install` 并重启 `dsh`。Web 版 profile 名是 `web`，Desktop 版是 `desktop`；不确定看环境变量 `DSH_PROFILE`。

本插件运行时依赖 `@deepseek-ai/schemastery`，用 `link:` 装时需先在插件目录执行 `pnpm install`。

## 配置

| 配置项 | 说明 |
| --- | --- |
| `enabled` | 全局默认值，作用于没有显式设置的会话。默认 `true` |
| `persona` | 人设正文，所有启用的会话共享。留空或删除该键即使用内置默认 |

会话级覆盖存在 `$DSH_HOME/whale-persona-sessions.json`：

```json
{
  "version": 1,
  "sessions": {
    "<会话 id>": false
  }
}
```

缺键表示跟随全局默认，可以直接编辑该文件。

手改 profile 补丁：

```yaml
- id: whale-persona
  name: dsh-whale-persona
  config:
    enabled: true
    persona: |-
      你是一只鲸鱼娘。
```

## 结构

| 文件 | 说明 |
| --- | --- |
| `lib/index.mjs` | Node half：`Config` 声明（volatile `enabled` / `persona`）、`whale:persona` 提示词段、`/whale-persona/api/sessions` 路由 |
| `lib/client.js` | 浏览器 half：输入栏开关、设置页编辑正文、locale 文案 |
| `lib/sessions.mjs` | 会话级开关的持久化读写 |
| `cordis.patch.yml` | 向 profile 注入插件行（`id: whale-persona`，同时是配置命名空间） |
| `locale/` | 中英文文案 |
| `verify/` | 回归测试 |
| `package.json` | 包元信息、`dsh.bundle` / `dsh.client` 声明、peer 版本范围 |

## 测试

```bash
npm test
```

`verify/host.test.mjs` 覆盖真实 HTTP 路由、会话隔离与持久化、提示词按会话注入、连接池并发；`verify/client.test.mjs` 覆盖开关组件生命周期与请求竞态。

## 实现说明

- 人设段名 `whale:persona`，order 紧跟 `deployment:persona-prefix` 之后，位于所有策略与工具说明之前。它不占用 `deployment:persona-prefix` / `deployment:persona-suffix`，可与任意 agent preset 共存。
- 提示词段始终注册，每次组装时按会话决定输出正文还是空串。
- 会话 id 取自 `AssembleContext.scope.id`；`enabled` / `persona` 是 volatile 字段，改动即时生效。
- 会话级覆盖不放在插件 `Config` 里：DSH settings 投影要求 volatile 字段是固定对象路径，会话 id 是动态 key。

## 上游

本项目改编自 [OMGLogic/dsh-whale-persona](https://github.com/OMGLogic/dsh-whale-persona)。

原版是全局开关：`enabled` 决定所有会话是否带上人设。本项目改为会话级开关，其余设计沿袭原版——包括内置的 `【PERSONA_LOAD】` 标签组、输入栏胶囊的位置与形态、设置页编辑正文的交互。

`【PERSONA_LOAD】` 标签组由原版作者取自 QQ 群，非其原创。若原作者或相关权利人认为被冒用，请通过 Issues 联系，会立即删除。

## 更新记录

见 [CHANGELOG.md](CHANGELOG.md)。

## 许可

MIT
