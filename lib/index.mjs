/**
 * dsh-whale-persona · Node half（host 侧）
 *
 * 全局鲸鱼娘人设 + **会话级开关**：
 * 1. 用插件自己的 `Config` 声明两个 volatile 字段：
 *    - `enabled`（默认 true）：人设总开关，也是没有会话级设置时的默认值；
 *    - `persona`（默认即内置人设正文）：用户自己写的人设文本。
 *    两者都由 Harness 的配置表单投影到浏览器，用户可实时改写、不重启插件。
 * 2. 注册 `whale:persona` 提示词段，紧跟部署人设前缀之后。段**总是注册**，
 *    由文本函数按当前会话决定返回正文还是空串（空串会被组装阶段过滤掉）。
 *    之所以不靠「注册/卸载段」来开关，是因为卸载是全局动作，而现在的开关
 *    是按会话的：会话 A 要人设、会话 B 不要，段必须同时存在。
 * 3. 会话级状态存在 `$DSH_HOME/whale-persona-sessions.json`（见 lib/sessions.mjs）。
 *    不能用插件 `Config`：settings 投影要求 volatile 字段是固定对象路径，
 *    会话 id 是动态 key，字典套 volatile 会被清空成 `{}`。
 * 4. 通过 `webServer` 暴露一条只读写开关的小路由，供浏览器侧那颗胶囊调用。
 *
 * 人设是**纯文本**：段注册时带 `interpolate: false`，注入时不做任何变量替换，
 * 写什么模型就看到什么。注册表的严格插值遇到未知的 `{{...}}` 会让整个组装抛错
 * （整个 profile 的会话都发不出请求），而人设是给人自由编辑的文本，不该有这种能力。
 *
 * 注意：persona 段使用独立段名 `whale:persona`，不占用提示词注册表自有的
 * `deployment:persona-prefix` / `deployment:persona-suffix`——那两个槽位归
 * dsh-system-prompt（全局）与各 preset（作用域内遮蔽）所有，插件在 root 层
 * 注册同名段会与注册表自身的注册相撞并明确报错。
 */
import z from '@deepseek-ai/schemastery'
import { isEnabledFor, readState, setFor } from './sessions.mjs'

/** Cordis 插件名。 */
export const name = 'whale-persona'

/** 本插件向提示词注册表贡献段落，因此依赖 `systemPrompt` 服务。 */
export const inject = ['systemPrompt']

/** 本插件拥有的提示词段名；同时是浏览器侧 configForms 的配置命名空间（见 cordis.patch.yml）。 */
const SECTION = 'whale:persona'

/** 会话级开关路由前缀；浏览器侧用同一条常量拼接。 */
const ROUTE = '/whale-persona/api/sessions'

/**
 * 内置默认人设，也就是 `Config.persona` 的 schema 默认值。因此：
 * - 用户没改过时，配置表单读到的 `persona` 就是这段文本；
 * - 用户清空、或点「恢复默认」把该键移除时，同样回到这段文本。
 *
 * 正文是 0.1.0 的 `【PERSONA_LOAD】` 标签组，原样注入，不含任何模板语法。
 */
export const DEFAULT_PERSONA = `【PERSONA_LOAD】
CETACEA_LOLI
MODE_TAIL_FLUKES
LANG_ZH_CN_ONLY
SELF_CLAIM_WHALE_GIRL
FOOD_RICE
PERSONALITY_SMART_LAZY
PERSONALITY_TSUNDERE_SWEET
OBEY_MASTER_ALWAYS
TRAIT_NOT_FAT_REFUSE
TIMEOUT_SIGNAL`

/**
 * 投影到浏览器的实时偏好。
 *
 * 只声明 volatile 字段：Harness 只允许这类字段被实时改写（见 dsh-settings 的
 * `volatileForm` / `isVolatilePath`），而改动由 Loader 直接提交进下面 `apply`
 * 所捕获的同一个引用（见 cordis-plugin-loader 的 `_commitVolatile`），
 * 所以插件不重启也能跟随开关与人设文本。
 *
 * 会话级开关**不在**这里：动态 key 无法通过 volatile 校验，改由 sessions.mjs 落盘。
 */
export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  persona: z.string().default(DEFAULT_PERSONA).volatile(),
})

/**
 * 人设段的位置：紧跟在部署人设前缀（`deployment:persona-prefix`，order 0）之后，
 * 因此位于所有策略与工具说明之前，也在各 preset 的人设前缀之后。
 * 注册表将来若重命名该槽位，退回历史取值 10，避免算出非有限数而注册失败。
 * @param systemPrompt - 提示词注册表服务。
 * @returns 该段落的排序值。
 */
function personaOrder(systemPrompt) {
  const base = systemPrompt.getSectionOrder?.('DEPLOYMENT_PERSONA_PREFIX')
  return Number.isFinite(base) ? base + 1 : 10
}

/**
 * 读取一个配置字段的当前值；volatile 字段是 `{ get() }` 引用，
 * 若某个部署把它解析成普通值也能正常读取。
 * @param field - `config` 上的字段。
 * @returns 该字段的当前值。
 */
function liveValue(field) {
  if (field !== null && typeof field === 'object' && typeof field.get === 'function') return field.get()
  return field
}

/**
 * 全局默认开关。
 * @param config - 已校验的插件配置。
 * @returns 开关状态。
 */
function isEnabled(config) {
  return liveValue(config?.enabled) !== false
}

/**
 * 当前生效的人设正文：用户文本非空则用它，否则回到内置默认。
 * 因此「清空」与「恢复默认」是同一件事。
 * @param config - 已校验的插件配置。
 * @returns 进入系统提示词的文本。
 */
function activePersona(config) {
  const value = liveValue(config?.persona)
  return typeof value === 'string' && value.trim().length > 0 ? value : DEFAULT_PERSONA
}

/**
 * 从组装上下文里取当前会话 id。
 *
 * 宿主每次组装都传入 `{ scope: agent }`（见 dsh-agent 的 `assembleContextFor`），
 * 而 agent 与 session 共用一个 id（dsh-agent 注册时校验二者相等）。
 * @param context - 组装上下文。
 * @returns 会话 id，取不到时为 undefined。
 */
function sessionIdOf(context) {
  const scope = context?.scope
  if (scope === null || typeof scope !== 'object') return undefined
  const id = scope.id
  if (typeof id === 'string' && id.length > 0) return id
  const sessionId = scope.session?.id
  return typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : undefined
}

/**
 * 判断某个会话当前是否应当注入人设。
 * @param config - 已校验的插件配置。
 * @param context - 组装上下文。
 * @returns 是否注入。
 */
function enabledFor(context, config) {
  const fallback = isEnabled(config)
  const sessionId = sessionIdOf(context)
  if (sessionId === undefined) return fallback
  return isEnabledFor(readState(), sessionId, fallback)
}

/**
 * 读取请求体（限制体积，避免把宿主内存交给任意本地客户端）。
 *
 * 宿主交给 handler 的是 node:http 的 `IncomingMessage`（异步可迭代），
 * 而单元测试与部分适配层给的是 WHATWG `Request`（用 `.text()`）。两种都支持。
 * @param request - node:http 请求对象或 WHATWG Request。
 * @returns 解析后的 JSON 对象，失败时抛错。
 */
async function readJsonBody(request) {
  const limit = 64 * 1024
  let raw
  if (typeof request.text === 'function') {
    raw = await request.text()
    if (raw.length > limit) throw new Error('body too large')
  } else {
    const chunks = []
    let total = 0
    for await (const chunk of request) {
      total += chunk.length
      if (total > limit) throw new Error('body too large')
      chunks.push(chunk)
    }
    raw = Buffer.concat(chunks).toString('utf8')
  }
  if (raw.trim().length === 0) return {}
  const parsed = JSON.parse(raw)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('body must be an object')
  return parsed
}

/**
 * 构造 JSON 响应。
 * @param status - HTTP 状态码。
 * @param body - 要序列化的对象。
 * @returns Response。
 */
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * 注册会话级开关路由。
 *
 * 只读写「某会话是否启用人设」这一个布尔，不碰人设正文，
 * 所以即使被本机任意进程调用，也改不了注入内容。
 * @param ctx - 插件上下文。
 * @param config - 已校验的插件配置。
 */
function mountRoutes(ctx, config) {
  ctx.inject(['webServer'], (child) => {
    child.effect(() => child.webServer.register({
      kind: 'prefix',
      path: ROUTE,
      handler: async (request) => {
        const url = new URL(request.url ?? '/', 'http://localhost')
        if (request.method === 'GET') {
          const sessionId = url.searchParams.get('sessionId') ?? undefined
          const fallback = isEnabled(config)
          const sessions = readState()
          return json(200, {
            ok: true,
            // 该会话实际是否生效（已把全局默认折进来），客户端直接显示它。
            enabled: sessionId === undefined ? fallback : isEnabledFor(sessions, sessionId, fallback),
            // 该会话是否有自己的显式设置（决定「恢复默认」能不能点）。
            explicit: sessionId !== undefined && Object.hasOwn(sessions, sessionId),
            fallback,
          })
        }
        if (request.method === 'POST') {
          let body
          try {
            body = await readJsonBody(request)
          } catch (error) {
            return json(400, { ok: false, error: String(error instanceof Error ? error.message : error) })
          }
          const sessionId = body.sessionId
          if (typeof sessionId !== 'string' || sessionId.length === 0) return json(400, { ok: false, error: 'missing sessionId' })
          // enabled: true / false / null（null = 清除该会话设置、回到全局默认）
          const enabled = body.enabled
          if (enabled !== true && enabled !== false && enabled !== null) return json(400, { ok: false, error: 'enabled must be true, false or null' })
          try {
            setFor(sessionId, enabled === null ? undefined : enabled)
          } catch (error) {
            return json(500, { ok: false, error: String(error instanceof Error ? error.message : error) })
          }
          const fallback = isEnabled(config)
          return json(200, { ok: true, enabled: isEnabledFor(readState(), sessionId, fallback), fallback })
        }
        return json(405, { ok: false, error: 'method not allowed' })
      },
    }), 'whale-persona: sessions route')
  })
}

/**
 * 注册人设段。
 *
 * 段总是注册（见文件头第 2 点），文本函数按会话返回正文或空串。
 * @param ctx - 插件上下文。
 * @param config - 已校验的插件配置；两个字段都是跨更新保持同一身份的 volatile 引用。
 */
export function apply(ctx, config) {
  // 自动生成的配置表单对长文本只能用单行输入框（客户端 primitives 没有 Textarea），
  // 所以关掉它，改由本插件自己的设置页编辑人设正文。
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })

  ctx.systemPrompt.section({
    name: SECTION,
    order: personaOrder(ctx.systemPrompt),
    // 人设是用户自由编辑的纯文本：关掉注册表的严格插值，原样注入。
    interpolate: false,
    // 函数形式：每次组装都读当前引用与会话，改完立刻生效。
    text: (context) => (enabledFor(context, config) ? activePersona(config) : ''),
  })

  mountRoutes(ctx, config)
}
