import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

// Hook-level lifecycle harness: no DOM/CSS claims. Fetch deliberately ignores
// abort so stale-result guards are tested independently from browser cancellation.
function fixture() {
  let active
  const requests = []
  const components = new Map()
  const React = {
    createElement(type, props, ...children) { return { type, props: props ?? {}, children } },
    useState(initial) {
      const instance = active, index = instance.index++
      if (!(index in instance.values)) instance.values[index] = typeof initial === 'function' ? initial() : initial
      return [instance.values[index], value => {
        instance.updates++
        instance.values[index] = typeof value === 'function' ? value(instance.values[index]) : value
      }]
    },
    useRef(initial) {
      const index = active.index++
      return active.values[index] ??= { current: initial }
    },
    useEffect(fn, deps) {
      const index = active.index++, previous = active.effects[index]
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) active.queued.push({ index, fn, deps })
    },
  }
  let plugin
  const form = { getSnapshot: () => undefined, subscribe: () => () => {} }
  const ctx = {
    configForms: { get: () => form },
    effect: fn => fn(),
    locale: { register: () => () => {}, bind: () => key => key },
    slots: { inject: (_slot, fn) => fn(), register: (spec, component) => components.set(spec.id, component) },
  }
  vm.runInNewContext(fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load(def) { plugin = def.factory(name => { assert.equal(name, 'react'); return React }) } } },
    AbortController, setTimeout, clearTimeout,
    fetch(url, options) { return new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })) },
  })
  plugin.apply(ctx)
  function mount(component, props) {
    const instance = { values: [], effects: [], updates: 0 }
    instance.render = () => {
      instance.index = 0; instance.queued = []; active = instance
      instance.output = component(props)
      active = undefined
      for (const item of instance.queued) {
        instance.effects[item.index]?.cleanup?.()
        instance.effects[item.index] = { deps: item.deps, cleanup: item.fn() }
      }
      return instance.output
    }
    instance.unmount = () => { for (const effect of instance.effects) effect?.cleanup?.() }
    instance.render()
    return instance
  }
  function toggle(sessionId) {
    const element = components.get('whale-persona-toggle')({ sessionId, t: key => key })
    const instance = mount(element.type, element.props)
    instance.key = element.props.key
    return instance
  }
  return { requests, toggle, section: () => mount(components.get('whale-persona'), { t: key => key }) }
}
async function respond(request, data) {
  request.resolve({ ok: true, json: async () => ({ ok: true, fallback: true, ...data }) })
  await new Promise(resolve => setImmediate(resolve))
}

test('mount issues one GET; rerenders do not poll; teardown aborts and ignores stale GET', async () => {
  const f = fixture(), a = f.toggle('A')
  assert.equal(f.requests.length, 1)
  assert.match(f.requests[0].url, /sessionId=A$/)
  assert.equal(a.output.props.disabled, true)
  a.render(); a.render()
  assert.equal(f.requests.length, 1)
  a.unmount()
  assert.equal(f.requests[0].options.signal.aborted, true)
  const count = a.updates
  await respond(f.requests[0], { enabled: true })
  assert.equal(a.updates, count)
})

test('session identity resets UI; aborted old POST cannot update either session', async () => {
  const f = fixture(), a = f.toggle('A')
  await respond(f.requests[0], { enabled: true })
  a.render().props.onClick()
  const post = f.requests[1]
  assert.deepEqual(JSON.parse(post.options.body), { sessionId: 'A', enabled: false })
  a.render()
  assert.equal(a.output.props.disabled, true)
  a.unmount()
  assert.equal(post.options.signal.aborted, true)
  const b = f.toggle('B')
  assert.notEqual(a.key, b.key)
  assert.equal(b.output.props.disabled, true)
  const oldCount = a.updates, newCount = b.updates
  await respond(post, { enabled: false })
  assert.equal(a.updates, oldCount)
  assert.equal(b.updates, newCount)
  await respond(f.requests[2], { enabled: true })
  assert.equal(b.render().props['aria-checked'], true)
  assert.equal(b.output.props.disabled, false)
  b.unmount()
})

test('right-click clears only explicit session setting, then renders returned fallback', async () => {
  const f = fixture(), a = f.toggle('A')
  await respond(f.requests[0], { enabled: false, explicit: true })
  let prevented = false
  a.render().props.onContextMenu({ preventDefault() { prevented = true } })
  assert.equal(prevented, true)
  assert.deepEqual(JSON.parse(f.requests[1].options.body), { sessionId: 'A', enabled: null })
  await respond(f.requests[1], { enabled: true })
  assert.equal(a.render().props['aria-checked'], true)
  assert.equal(a.output.props.disabled, false)
  a.unmount()
})

test('failed POST rereads server truth once; unknown session makes no request', async () => {
  const f = fixture(), a = f.toggle('A')
  await respond(f.requests[0], { enabled: true })
  a.render().props.onClick()
  f.requests[1].reject(new Error('network failure'))
  await new Promise(resolve => setImmediate(resolve))
  a.render(); a.render()
  assert.equal(f.requests.length, 3)
  assert.equal(f.requests[2].options.method, undefined)
  assert.equal(a.output.props.disabled, true)
  await respond(f.requests[2], { enabled: true })
  assert.equal(a.render().props['aria-checked'], true)
  a.unmount()
  const unknown = f.toggle(undefined)
  assert.equal(f.requests.length, 3)
  assert.equal(unknown.output.props.disabled, true)
  unknown.unmount()
})

test('settings page global-default GET is cancelled on unmount', async () => {
  const f = fixture(), section = f.section()
  assert.equal(f.requests.length, 1)
  section.unmount()
  assert.equal(f.requests[0].options.signal.aborted, true)
  const count = section.updates
  await respond(f.requests[0], { enabled: true })
  assert.equal(section.updates, count)
})
