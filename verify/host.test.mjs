import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const ROUTE = '/whale-persona/api/sessions'
const REQUEST_TIMEOUT = 5000

// Exercise the actual Node request/response seam, not a WHATWG Response adapter.
test('host routes, session persistence, prompt isolation and shared HTTP capacity', { timeout: 30000 }, async (t) => {
  const temporaryParent = await realpath(os.tmpdir())
  const createdDirectory = await mkdtemp(path.join(temporaryParent, 'whale-persona-host-test-'))
  const directory = await realpath(createdDirectory)
  const createdIdentity = await stat(directory)
  const originalFile = process.env.WHALE_PERSONA_SESSIONS_FILE
  const stateFile = path.join(directory, 'sessions.json')
  let server
  let agent

  t.after(async () => {
    agent?.destroy()
    if (server?.listening) {
      const closed = new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
      server.closeAllConnections()
      await closed
    }
    if (originalFile === undefined) delete process.env.WHALE_PERSONA_SESSIONS_FILE
    else process.env.WHALE_PERSONA_SESSIONS_FILE = originalFile

    // Never recursively delete a computed path without verifying it is precisely
    // the absolute directory this test created, including filesystem identity.
    assert.ok(path.isAbsolute(directory))
    assert.equal(path.resolve(createdDirectory), directory)
    assert.equal(path.dirname(directory), temporaryParent)
    assert.ok(path.basename(directory).startsWith('whale-persona-host-test-'))
    assert.equal(await realpath(directory), directory)
    const currentIdentity = await stat(directory)
    assert.equal(currentIdentity.dev, createdIdentity.dev)
    assert.equal(currentIdentity.ino, createdIdentity.ino)
    await rm(directory, { recursive: true })
  })
  process.env.WHALE_PERSONA_SESSIONS_FILE = stateFile

  // Missing schemastery is an actionable dependency failure, never a stubbed
  // schema or an installation side effect of running this test.
  const { apply, DEFAULT_PERSONA } = await import('../lib/index.mjs')
  const sessionsURL = new URL('../lib/sessions.mjs', import.meta.url)
  let section
  let route
  let registrationEffects = 0
  const unexpectedErrors = []
  let globalEnabled = true
  let persona = 'Regression persona {{literal}}'
  const config = {
    enabled: { get: () => globalEnabled },
    persona: { get: () => persona },
  }
  apply({
    systemPrompt: {
      getSectionOrder: () => 0,
      section(spec) { assert.equal(section, undefined); section = spec },
    },
    inject(dependencies, callback) {
      if (dependencies.includes('settings')) return
      assert.deepEqual(dependencies, ['webServer'])
      callback({
        effect(effect) { registrationEffects++; return effect() },
        webServer: {
          register(spec) { assert.equal(route, undefined); route = spec; return () => {} },
        },
      })
    },
  }, config)
  assert.equal(registrationEffects, 1)
  assert.equal(route.kind, 'prefix')
  assert.equal(route.path, ROUTE)
  assert.equal(section.name, 'whale:persona')
  assert.equal(section.interpolate, false)
  assert.equal(typeof section.text, 'function')

  server = http.createServer((req, res) => {
    if (new URL(req.url, 'http://localhost').pathname.startsWith(route.path)) {
      Promise.resolve(route.handler(req, res)).then((returned) => {
        assert.equal(returned, undefined, 'Node handler must write/end, not return a Response')
      }).catch((error) => {
        unexpectedErrors.push(error)
        if (!res.headersSent) res.writeHead(500)
        res.end('unexpected handler failure')
      })
    } else {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ordinary route alive')
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  agent = new http.Agent({ keepAlive: true, maxSockets: 6 })
  const port = server.address().port

  function request(url = ROUTE, { method = 'GET', body } = {}) {
    return new Promise((resolve, reject) => {
      // Wall-clock deadline includes time queued behind maxSockets, unlike
      // socket-only timeouts. Destroy also releases queued/active requests.
      const req = http.request({ hostname: '127.0.0.1', port, path: url, method, agent,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
      }, (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('error', fail)
        res.on('aborted', () => fail(new Error('response aborted')))
        res.on('end', () => {
          clearTimeout(deadline)
          resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') })
        })
      })
      const deadline = setTimeout(() => req.destroy(new Error(`${method} ${url} exceeded ${REQUEST_TIMEOUT}ms`)), REQUEST_TIMEOUT)
      function fail(error) { clearTimeout(deadline); reject(error) }
      req.on('error', fail)
      req.end(body)
    })
  }
  async function jsonRequest(url = ROUTE, options) {
    const response = await request(url, options)
    assert.match(response.headers['content-type'], /^application\/json\b/)
    assert.equal(response.headers['cache-control'], 'no-store')
    return { ...response, body: JSON.parse(response.text) }
  }
  const get = (id) => jsonRequest(id === undefined ? ROUTE : `${ROUTE}?sessionId=${encodeURIComponent(id)}`)
  const post = (body) => jsonRequest(ROUTE, { method: 'POST', body: JSON.stringify(body) })
  const prompt = (id) => section.text({ scope: { id } })

  await t.test('GET defaults and prompt use the live global default', async () => {
    for (const id of [undefined, 'A', 'B']) {
      const response = await get(id)
      assert.equal(response.status, 200)
      assert.deepEqual(response.body, { ok: true, enabled: true, explicit: false, fallback: true })
    }
    assert.equal(prompt('A'), persona)
    globalEnabled = false
    assert.deepEqual((await get('A')).body, { ok: true, enabled: false, explicit: false, fallback: false })
    assert.equal(prompt('A'), '')
    globalEnabled = true
  })

  await t.test('POST A false / B true isolates explicit settings and prompt text', async () => {
    const a = await post({ sessionId: 'A', enabled: false })
    assert.equal(a.status, 200)
    assert.deepEqual(a.body, { ok: true, enabled: false, fallback: true })
    const b = await post({ sessionId: 'B', enabled: true })
    assert.equal(b.status, 200)
    assert.deepEqual(b.body, { ok: true, enabled: true, fallback: true })
    assert.deepEqual((await get('A')).body, { ok: true, enabled: false, explicit: true, fallback: true })
    assert.deepEqual((await get('B')).body, { ok: true, enabled: true, explicit: true, fallback: true })
    assert.equal(prompt('A'), '')
    assert.equal(prompt('B'), persona)
    globalEnabled = false
    assert.equal(prompt('A'), '')
    assert.equal(prompt('B'), persona)
    assert.equal(prompt('unconfigured'), '')
    globalEnabled = true
    persona = ''
    assert.equal(prompt('B'), DEFAULT_PERSONA)
    persona = 'Regression persona {{literal}}'
  })

  await t.test('a fresh sessions module reads explicit settings from actual disk', async () => {
    const persisted = JSON.parse(await readFile(stateFile, 'utf8'))
    assert.deepEqual(persisted.sessions, { A: false, B: true })
    const fresh = await import(`${sessionsURL.href}?verify=persisted`)
    assert.equal(fresh.sessionsFile(), stateFile)
    assert.deepEqual(fresh.readState(), { A: false, B: true })
    assert.equal(fresh.isEnabledFor(fresh.readState(), 'A', true), false)
    assert.equal(fresh.isEnabledFor(fresh.readState(), 'B', false), true)
  })

  await t.test('POST null removes explicit state and restores the current default', async () => {
    const reset = await post({ sessionId: 'A', enabled: null })
    assert.equal(reset.status, 200)
    assert.deepEqual(reset.body, { ok: true, enabled: true, fallback: true })
    assert.deepEqual((await get('A')).body, { ok: true, enabled: true, explicit: false, fallback: true })
    assert.equal(prompt('A'), persona)
    globalEnabled = false
    assert.equal((await get('A')).body.enabled, false)
    assert.equal(prompt('A'), '')
    assert.equal(prompt('B'), persona)
    const fresh = await import(`${sessionsURL.href}?verify=reset`)
    assert.deepEqual(fresh.readState(), { B: true })
    globalEnabled = true
  })

  await t.test('bad JSON, missing id and invalid enabled are 400 without mutation', async () => {
    const before = await readFile(stateFile, 'utf8')
    for (const body of ['{', 'null', '[]', '{}', '{"enabled":true}',
      '{"sessionId":"","enabled":false}', '{"sessionId":42,"enabled":true}',
      ...[undefined, 'false', 0, {}, []].map((enabled) => JSON.stringify({ sessionId: 'A', enabled }))]) {
      const response = await jsonRequest(ROUTE, { method: 'POST', body })
      assert.equal(response.status, 400, body)
      assert.equal(response.body.ok, false)
      assert.equal(typeof response.body.error, 'string')
    }
    assert.equal(await readFile(stateFile, 'utf8'), before)
  })

  await t.test('unsupported method is 405', async () => {
    const response = await jsonRequest(ROUTE, { method: 'PUT', body: '{}' })
    assert.equal(response.status, 405)
    assert.deepEqual(response.body, { ok: false, error: 'method not allowed' })
  })

  await t.test('a state path pointing to a directory produces an ended 500 response', async () => {
    process.env.WHALE_PERSONA_SESSIONS_FILE = directory
    try {
      const response = await post({ sessionId: 'A', enabled: false })
      assert.equal(response.status, 500)
      assert.equal(response.body.ok, false)
      assert.match(response.body.error, /EISDIR|directory/i)
    } finally {
      process.env.WHALE_PERSONA_SESSIONS_FILE = stateFile
    }
    assert.equal((await get('B')).body.enabled, true)
  })

  await t.test('36 concurrent persona GETs mixed with ordinary requests do not exhaust six sockets', async () => {
    assert.equal(agent.maxSockets, 6)
    const responses = await Promise.all(Array.from({ length: 48 }, async (_, index) => {
      if (index % 4 === 0) {
        const response = await request('/ordinary')
        assert.equal(response.status, 200)
        assert.equal(response.text, 'ordinary route alive')
        return 'ordinary'
      }
      const response = await get(index % 2 === 0 ? 'A' : 'B')
      assert.equal(response.status, 200)
      assert.equal(response.body.ok, true)
      assert.equal(response.body.enabled, true)
      assert.equal(response.body.explicit, index % 2 !== 0)
      return 'persona'
    }))
    assert.equal(responses.filter((kind) => kind === 'persona').length, 36)
    assert.equal(responses.filter((kind) => kind === 'ordinary').length, 12)
  })
  assert.deepEqual(unexpectedErrors, [])
})
