/**
 * 会话级人设开关的持久化存储。
 *
 * 只存「哪些会话关掉了 / 打开了」，不存人设正文（正文仍是全局配置一份）。
 * 文件是可读写的 JSON，放在 `$DSH_HOME/whale-persona-sessions.json`，
 * 用户可以直接手改。所有写操作都是整文件替换，写坏了下一轮读取会降级为
 * 「全部按默认处理」，不会炸会话。
 *
 * 为什么不用插件 `Config`：DSH 的 settings 投影要求 volatile 字段必须是
 * 「固定对象路径」（`volatile fields require a fixed object path`），而会话 id
 * 是动态 key，字典套 volatile 会被清空成 `{}`。所以开关必须自己管文件。
 */
import fs from 'node:fs'
import path from 'node:path'

/** 存储文件默认名，相对 `$DSH_HOME`。 */
const FILE_NAME = 'whale-persona-sessions.json'

/**
 * 解析 DSH 家目录，与宿主 `resolveDshHome()` 的口径一致。
 * 优先 `DSH_HOME`，否则 `~/.dsh`。
 * @returns 绝对路径。
 */
function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return fromEnv
  const home = process.env.USERPROFILE ?? process.env.HOME ?? '.'
  return path.join(home, '.dsh')
}

/**
 * 存储文件的绝对路径；`WHALE_PERSONA_SESSIONS_FILE` 可覆盖（测试与多 profile 用）。
 * @returns 绝对路径。
 */
export function sessionsFile() {
  const override = process.env.WHALE_PERSONA_SESSIONS_FILE
  if (typeof override === 'string' && override.trim().length > 0) return override
  return path.join(dshHome(), FILE_NAME)
}

/**
 * 读整个状态表。
 *
 * 任何异常（文件不存在、JSON 坏、形状不对）都降级为 `{}`：开关是锦上添花，
 * 坏一份状态文件不该让会话发不出请求。
 * @returns `{ [sessionId]: boolean }`，缺键表示「跟随默认」。
 */
export function readState() {
  try {
    const raw = fs.readFileSync(sessionsFile(), 'utf8')
    const parsed = JSON.parse(raw)
    const table = parsed !== null && typeof parsed === 'object' && parsed.sessions !== null && typeof parsed.sessions === 'object' ? parsed.sessions : parsed
    if (table === null || typeof table !== 'object' || Array.isArray(table)) return {}
    const result = {}
    for (const [key, value] of Object.entries(table)) {
      if (typeof key === 'string' && key.length > 0 && typeof value === 'boolean') result[key] = value
    }
    return result
  } catch {
    return {}
  }
}

/**
 * 整表写回。
 * @param sessions - 要持久化的表。
 */
export function writeState(sessions) {
  const file = sessionsFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const body = { version: 1, sessions }
  fs.writeFileSync(file, `${JSON.stringify(body, undefined, 2)}\n`, 'utf8')
}

/**
 * 判断某个会话是否启用人设。
 *
 * 优先级：该会话的显式设置 → 全局默认（`fallback`）。
 * @param sessions - 状态表。
 * @param sessionId - 会话 id，缺省时按全局默认。
 * @param fallback - 全局默认值。
 * @returns 是否启用。
 */
export function isEnabledFor(sessions, sessionId, fallback) {
  if (typeof sessionId === 'string' && Object.hasOwn(sessions, sessionId)) return sessions[sessionId]
  return fallback
}

/**
 * 设置某个会话的开关。
 * @param sessionId - 会话 id。
 * @param enabled - 新值；`undefined` 表示清除该会话的设置、回到全局默认。
 * @returns 写入后的状态表。
 */
export function setFor(sessionId, enabled) {
  const sessions = readState()
  if (enabled === undefined) delete sessions[sessionId]
  else sessions[sessionId] = enabled
  writeState(sessions)
  return sessions
}
