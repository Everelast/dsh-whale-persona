// dsh-whale-persona · client half（浏览器侧）
// 预构建为 __ModuleLoader__ 可加载的 bundle，注册两处 UI：
//   1. conversation.input.right —— 对话输入栏的紧致人设开关（按会话生效）；
//   2. settings.section        —— 设置里的一页「鲸鱼人设」，用来编辑人设正文。
//
// 两条不同的通道，别混：
//   · 人设**正文**是全局配置，走 `configForms`（getSnapshot 读、set/unset 写）；
//   · **开关**是按会话的，走插件自己的 HTTP 路由 `/whale-persona/api/sessions`。
//     不能用 configForms：DSH 的 settings 投影要求 volatile 字段是固定对象路径，
//     会话 id 是动态 key，字典套 volatile 会被清空成 `{}`（宿主源码
//     dsh-settings 的 `volatile fields require a fixed object path`）。
//
// 会话 id 从插槽 props 拿：`conversation.input.right` 声明为 `scope: "session"`，
// 渲染器会把 `{ sessionId }` 作为 standard props 注进来（dsh-client-ui-session 的
// BUILTIN_SOURCE）。
//
// 文案走 locale 服务：注册 `whale-persona` 命名空间字典，插槽注册时声明 `locale`，
// 渲染器会把 `t` 作为 prop 传进来，并跟随语言切换重渲染。
window.__ModuleLoader__.load({
  id: "dsh-whale-persona",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })
    var React = require("react")

    // 承载配置的 profile entry id，必须与 cordis.patch.yml 中 insert 的 id 完全一致：
    // configForms 以 entry id 为命名空间，改名会让设置页读不到配置。
    const NAMESPACE = "whale-persona"
    // host 侧 Config 的字段名（全局）。
    const PERSONA_FIELD = "persona"
    // 对话输入栏里、模型选择器之前的紧凑控件槽位（session scope）。
    const TOGGLE_SLOT = "conversation.input.right"
    // 设置里的一整页。
    const SECTION_SLOT = "settings.section"
    // 本插件自己的语言字典命名空间。
    const LOCALE_NS = "whale-persona"
    // 会话级开关路由，与 lib/index.mjs 的 ROUTE 保持一致。
    const SESSIONS_ROUTE = "/whale-persona/api/sessions"

    /** 简体中文字典（键集真源）。 */
    const zh = {
      "toggle.on": "鲸鱼人设",
      "toggle.off": "默认人设",
      "toggle.titleOn": "本会话已开启鲸鱼娘人设（点击关闭，仅影响本会话）",
      "toggle.titleOff": "本会话未启用人设（点击开启，仅影响本会话）",
      "toggle.titleLocal": "本会话有单独的设置，与全局默认不同（右键恢复默认）",
      "section.nav": "鲸鱼人设",
      "section.title": "人设正文",
      "section.description": "这段文字会原样注入启用了人设的会话。清空或点「恢复默认」即回到插件内置的默认人设。开启/关闭是每个会话各自的事，用输入栏那颗胶囊。",
      "section.placeholder": "在这里写下你想要的人设……",
      "section.count": "{count} 个字符",
      "section.edited": "有未保存的修改",
      "section.save": "保存",
      "section.saving": "保存中…",
      "section.reset": "恢复默认",
      "section.saved": "已保存",
      "section.failed": "保存失败，请重试",
      "section.readonly": "当前部署的配置是只读的，无法保存。",
      "section.loading": "读取中…",
      "section.globalDefault": "全局默认：{state}",
      "section.on": "开启",
      "section.off": "关闭",
    }

    /** English dictionary; must cover the same key set as `zh`. */
    const en = {
      "toggle.on": "Whale persona",
      "toggle.off": "Default persona",
      "toggle.titleOn": "Whale-girl persona is on for this session (click to turn off — this session only)",
      "toggle.titleOff": "Persona is off for this session (click to turn on — this session only)",
      "toggle.titleLocal": "This session has its own setting, differing from the global default (right-click to restore)",
      "section.nav": "Whale persona",
      "section.title": "Persona text",
      "section.description": "This text is injected verbatim into sessions that have the persona enabled. Clearing it, or pressing Reset, restores the plugin's built-in default persona. Enabling is per session — use the pill in the composer.",
      "section.placeholder": "Write the persona you want here…",
      "section.count": "{count} characters",
      "section.edited": "Unsaved changes",
      "section.save": "Save",
      "section.saving": "Saving…",
      "section.reset": "Reset",
      "section.saved": "Saved",
      "section.failed": "Save failed, please retry",
      "section.readonly": "This deployment's configuration is read-only; changes cannot be saved.",
      "section.loading": "Loading…",
      "section.globalDefault": "Global default: {state}",
      "section.on": "on",
      "section.off": "off",
    }

    /** 读取共享配置表单快照里的值对象；host 还没送过来时返回 undefined。 */
    function readValue(form) {
      const snapshot = form.getSnapshot()
      const value = snapshot === undefined ? undefined : snapshot.value
      return value !== null && typeof value === "object" ? value : undefined
    }

    /** 读人设正文；host 未就绪时给空串。 */
    function readPersona(form) {
      const value = readValue(form)
      return value !== undefined && typeof value.persona === "string" ? value.persona : ""
    }

    /**
     * 读某个会话的开关状态。
     * @param sessionId 会话 id；缺省时只读全局默认。
     * @returns `{ enabled, explicit, fallback }`；请求失败时全部按 undefined 处理。
     */
    async function fetchState(sessionId, signal) {
      const query = sessionId === undefined ? "" : "?sessionId=" + encodeURIComponent(sessionId)
      const response = await fetch(SESSIONS_ROUTE + query, { signal, headers: { accept: "application/json" } })
      if (!response.ok) throw new Error("whale-persona: state request failed " + response.status)
      const body = await response.json()
      if (body === null || typeof body !== "object" || body.ok !== true) throw new Error("whale-persona: bad state body")
      return { enabled: body.enabled === true, explicit: body.explicit === true, fallback: body.fallback === true }
    }

    /**
     * 写某个会话的开关。
     * @param sessionId 会话 id。
     * @param enabled true / false / null（null = 清除、回到全局默认）。
     * @returns 写后的状态。
     */
    async function writeState(sessionId, enabled, signal) {
      const response = await fetch(SESSIONS_ROUTE, {
        signal,
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ sessionId, enabled }),
      })
      if (!response.ok) throw new Error("whale-persona: state write failed " + response.status)
      const body = await response.json()
      if (body === null || typeof body !== "object" || body.ok !== true) throw new Error("whale-persona: bad write body")
      return { enabled: body.enabled === true, fallback: body.fallback === true }
    }

    /** 一个按主题变量着色的朴素按钮。 */
    function buttonStyle(primary, disabled) {
      return {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "5px 14px",
        borderRadius: "var(--dsw-radius-sm, 8px)",
        border: primary ? "1px solid transparent" : "1px solid var(--dsw-alias-border-l4, rgba(128,128,128,0.35))",
        background: primary ? "var(--dsw-static-deepseek-500, #4176e6)" : "transparent",
        color: primary ? "#fff" : "inherit",
        font: "inherit",
        fontSize: "13px",
        lineHeight: "20px",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        whiteSpace: "nowrap",
      }
    }

    function apply(ctx) {
      const form = ctx.configForms.get(NAMESPACE)

      // 字典注册随本插件 fiber 释放；t 由插槽渲染器注入，这里只登记命名空间。
      ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), "whale-persona: dictionaries")

      // ── 1. 输入栏开关（按会话） ──────────────────────────────────────
      // 会话身份就是组件身份：切换时销毁旧状态及请求，不能复用上一会话的开关。
      const Toggle = (props) => React.createElement(SessionToggle, { ...props, key: props.sessionId })
      const SessionToggle = (props) => {
        const { t, sessionId } = props
        // undefined = 还没读到；读不到的这次渲染按「关」显示，但不可点击，避免误写。
        const [state, setState] = React.useState(undefined)
        const [pending, setPending] = React.useState(false)
        const [dirty, setDirty] = React.useState(0)
        const writeController = React.useRef(undefined)

        React.useEffect(() => () => { writeController.current?.abort() }, [])

        React.useEffect(() => {
          const controller = new AbortController()
          setState(undefined)
          if (sessionId !== undefined) fetchState(sessionId, controller.signal).then(
            (next) => { if (!controller.signal.aborted) setState(next) },
            () => { if (!controller.signal.aborted) setState(undefined) },
          )
          return () => { controller.abort() }
        }, [sessionId, dirty])

        const enabled = state !== undefined && state.enabled
        const usable = sessionId !== undefined && state !== undefined && !pending

        const commit = (next) => {
          if (sessionId === undefined) return
          setPending(true)
          // 先乐观更新，失败时回读。
          setState({ enabled: next === null ? undefined : next, explicit: next !== null, fallback: state?.fallback ?? false })
          writeController.current?.abort()
          const controller = new AbortController()
          writeController.current = controller
          writeState(sessionId, next, controller.signal).then(
            (result) => {
              if (controller.signal.aborted) return
              setPending(false)
              setState({ enabled: result.enabled, explicit: next !== null, fallback: result.fallback })
            },
            () => {
              if (controller.signal.aborted) return
              setPending(false)
              setDirty((n) => n + 1)
            },
          )
        }

        const toggle = () => {
          if (!usable) return
          commit(!enabled)
        }

        // 有显式设置时，右键恢复默认——不给主交互加第二个按钮。
        const restore = (event) => {
          event.preventDefault()
          if (!usable || state === undefined || !state.explicit) return
          commit(null)
        }

        const title = state !== undefined && state.explicit
          ? t("toggle.titleLocal")
          : (enabled ? t("toggle.titleOn") : t("toggle.titleOff"))

        return React.createElement(
          "button",
          {
            type: "button",
            role: "switch",
            "aria-checked": enabled,
            onClick: toggle,
            onContextMenu: restore,
            disabled: !usable,
            title,
            style: {
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              padding: "2px 8px",
              borderRadius: "999px",
              border: "1px solid " + (enabled
                ? "var(--dsw-static-neutral-bluish-400, rgba(80,160,255,0.55))"
                : "var(--dsw-alias-border-l4, rgba(128,128,128,0.35))"),
              background: enabled
                ? "var(--dsw-alias-bg-module-platform, rgba(80,160,255,0.16))"
                : "transparent",
              color: "inherit",
              font: "inherit",
              fontSize: "12px",
              lineHeight: "20px",
              cursor: usable ? "pointer" : "default",
              opacity: usable ? 1 : 0.5,
              whiteSpace: "nowrap",
            },
          },
          React.createElement("span", null, enabled ? "🐋" : "🐳"),
          React.createElement("span", null, enabled ? t("toggle.on") : t("toggle.off")),
        )
      }

      ctx.slots.inject(TOGGLE_SLOT, () => ctx.slots.register(
        { name: TOGGLE_SLOT, id: "whale-persona-toggle", order: -100, locale: LOCALE_NS },
        Toggle,
      ))

      // ── 2. 设置页：编辑人设正文（全局） ──────────────────────────────
      const PersonaSection = (props) => {
        const { t } = props
        const [snapshot, setSnapshot] = React.useState(() => form.getSnapshot())
        // draft === null 表示"跟随 host"，即文本框显示 host 当前生效的文本。
        const [draft, setDraft] = React.useState(null)
        const [busy, setBusy] = React.useState(false)
        const [notice, setNotice] = React.useState(null)
        const [globalDefault, setGlobalDefault] = React.useState(undefined)

        React.useEffect(() => form.subscribe(() => setSnapshot(form.getSnapshot())), [])

        React.useEffect(() => {
          const controller = new AbortController()
          fetchState(undefined, controller.signal).then(
            (state) => { if (!controller.signal.aborted) setGlobalDefault(state.fallback) },
            () => { if (!controller.signal.aborted) setGlobalDefault(undefined) },
          )
          return () => { controller.abort() }
        }, [])

        React.useEffect(() => {
          if (notice === null) return undefined
          const timer = setTimeout(() => setNotice(null), 2000)
          return () => clearTimeout(timer)
        }, [notice])

        const status = snapshot === undefined ? "loading" : snapshot.status
        const writable = snapshot !== undefined && snapshot.writable === true
        const stored = readPersona(form)
        const text = draft !== null ? draft : stored
        const dirty = draft !== null && draft !== stored
        const blocked = busy || status === "loading" || !writable

        const settle = (result) => {
          Promise.resolve(result).then((accepted) => {
            setBusy(false)
            if (accepted === false) {
              setNotice(t("section.failed"))
              return
            }
            // 交回 host 显示：保存后文本框总是显示真正生效的文本。
            setDraft(null)
            setNotice(t("section.saved"))
          }, () => {
            setBusy(false)
            setNotice(t("section.failed"))
          })
        }

        const save = () => {
          if (draft === null || blocked) return
          setBusy(true)
          setNotice(null)
          // 清空即恢复默认：写 unset 让 schema 默认值生效，profile 补丁里也不留空串。
          settle(draft.trim().length === 0 ? form.unset(PERSONA_FIELD) : form.set(PERSONA_FIELD, draft))
        }

        const reset = () => {
          if (blocked) return
          setBusy(true)
          setNotice(null)
          settle(form.unset(PERSONA_FIELD))
        }

        return React.createElement(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: "10px" } },
          React.createElement("div", { style: { fontWeight: 600 } }, t("section.title")),
          React.createElement("div", { style: { opacity: 0.7, fontSize: "13px", lineHeight: "20px" } }, t("section.description")),
          globalDefault === undefined
            ? null
            : React.createElement("div", { style: { opacity: 0.6, fontSize: "12px" } },
                t("section.globalDefault").replace("{state}", globalDefault ? t("section.on") : t("section.off"))),
          React.createElement("textarea", {
            value: text,
            placeholder: t("section.placeholder"),
            disabled: blocked,
            onChange: (event) => setDraft(event.target.value),
            spellCheck: false,
            style: {
              minHeight: "220px",
              padding: "10px 12px",
              borderRadius: "var(--dsw-radius-sm, 8px)",
              border: "1px solid var(--dsw-alias-border-l4, rgba(128,128,128,0.35))",
              background: "var(--dsw-alias-bg-module-platform, rgba(127,127,127,0.06))",
              color: "inherit",
              font: "inherit",
              fontSize: "13px",
              lineHeight: "20px",
              resize: "vertical",
            },
          }),
          React.createElement(
            "div",
            { style: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" } },
            React.createElement("span", { style: { opacity: 0.6, fontSize: "12px" } },
              t("section.count").replace("{count}", String(text.length))),
            dirty ? React.createElement("span", { style: { opacity: 0.6, fontSize: "12px" } }, t("section.edited")) : null,
            notice !== null ? React.createElement("span", { style: { opacity: 0.8, fontSize: "12px" } }, notice) : null,
            !writable && status !== "loading"
              ? React.createElement("span", { style: { opacity: 0.6, fontSize: "12px" } }, t("section.readonly"))
              : null,
            React.createElement("span", { style: { flex: 1 } }),
            React.createElement("button", {
              type: "button",
              onClick: reset,
              disabled: blocked,
              style: buttonStyle(false, blocked),
            }, t("section.reset")),
            React.createElement("button", {
              type: "button",
              onClick: save,
              disabled: blocked || !dirty,
              style: buttonStyle(true, blocked || !dirty),
            }, busy ? t("section.saving") : t("section.save")),
          ),
        )
      }

      ctx.slots.inject(SECTION_SLOT, () => ctx.slots.register({
        name: SECTION_SLOT,
        id: "whale-persona",
        order: 100,
        label: () => ctx.locale.bind(LOCALE_NS)("section.nav"),
        locale: LOCALE_NS,
      }, PersonaSection))
    }

    const inject = ["slots", "configForms", "locale"]
    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
