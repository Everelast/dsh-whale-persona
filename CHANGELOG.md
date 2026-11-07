# 更新记录

本文件记录 dsh-whale-persona 的版本变更，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## 0.4.1 - 2026-11-07

- 会话级开关正常工作：HTTP 路由以 `ServerResponse` 发送并结束响应，全部分支覆盖 200/400/405/500。
- 切换会话时按会话 id 重建开关组件，旧请求取消，取消结果不再落地。
- 新增 `verify/` 回归测试与 `npm test`。
- 补齐 `locale/zh.json`、`locale/en.json`、`icon.svg`。

## 0.4.0 - 2026-11-07

- 开关改为会话级：每个会话单独决定是否启用人设，未显式设置的会话跟随全局默认。
- 新增 `lib/sessions.mjs`，会话级覆盖存于 `$DSH_HOME/whale-persona-sessions.json`。
- 新增 `/whale-persona/api/sessions` 路由，供输入栏开关读写会话状态。
- 人设提示词段始终注册，每次组装按会话输出正文或空串。
- 输入栏胶囊支持右键清除本会话设置、回到全局默认。
- peer 版本范围改为 `>=4.0.4 <5.0.0-0` / `>=0.2.0-rc.2 <0.3.0-0`。

## 0.3.0 - 2026-10-03

- 新增设置页「鲸鱼人设」，可直接编辑人设正文，支持保存、恢复默认、字数统计与未保存提示。
- 新增 volatile 配置字段 `persona`，默认值为内置人设；清空与恢复默认等价。
- 客户端文案走 locale 字典（`zh` / `en`）。
- 人设正文改为纯文本注入（`interpolate: false`），不做变量替换。
- 关闭自动生成的插件配置表单，改由本插件设置页负责编辑。
- 默认人设为 0.1.0 的 `【PERSONA_LOAD】` 标签组原文。

## 0.2.0 - 2026-10-03

适配 DeepSeek Harness 0.2.0-rc.2。0.1.0 依赖的 `settings` 命名空间 API 在新版已移除，旧版无法加载。

- 开关承载方式改为插件自己的 volatile `Config.enabled`。
- 浏览器侧读写通道改为 `ctx.configForms.get(namespace)`。
- Host 侧依赖改为 `@deepseek-ai/schemastery`（`.volatile()` 为该包扩展）。
- `inject` 声明：Host 侧 `['systemPrompt']`，客户端 `['slots', 'configForms', 'locale']`。
- 人设段位置改为 `getSectionOrder('DEPLOYMENT_PERSONA_PREFIX') + 1`。
- 新增 `peerDependencies` 与 `dsh.client.immediately` / `dsh.client.inject` 声明。
- 按钮使用 `role="switch"`、`aria-checked` 与 `--dsw-*` 主题变量。

## 0.1.0 - 2026-08-18

- 首个公开版本：默认开启的鲸鱼娘全局人设，输入栏开关，关闭后各 preset 恢复各自默认人设。
- 人设提示词段使用独立段名 `whale:persona`。
