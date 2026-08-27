import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'vue' || specifier === 'vitepress') {
      return {
        shortCircuit: true,
        url: 'mock:' + specifier,
      }
    }
    return nextResolve(specifier, context)
  },

  load(url, context, nextLoad) {
    if (url === 'mock:vue') {
      return {
        format: 'module',
        shortCircuit: true,
        source: `
          export function nextTick(fn) {
            if (globalThis.__nextTickOverride) {
              return globalThis.__nextTickOverride(fn);
            }
            return Promise.resolve().then(fn);
          }
          export function onMounted(fn) {
            globalThis.__onMountedHooks?.push(fn);
          }
          export function onUnmounted(fn) {
            globalThis.__onUnmountedHooks?.push(fn);
          }
          export function watch(source, fn) {
            globalThis.__watchHooks?.push({ source, fn });
          }
        `,
      }
    }
    if (url === 'mock:vitepress') {
      return {
        format: 'module',
        shortCircuit: true,
        source: `
          export function getScrollOffset() {
            return globalThis.__getScrollOffset ? globalThis.__getScrollOffset() : 0;
          }
          export function onContentUpdated(fn) {
            globalThis.__onContentUpdatedHooks?.push(fn);
          }
          export function useData() {
            return globalThis.__useData ? globalThis.__useData() : { hash: { value: '' } };
          }
        `,
      }
    }
    return nextLoad(url, context)
  },
})

const { useStableHashScroll } = await import('../docs/.vitepress/theme/hashScroll.ts')

// Helper setup for mock DOM environment
function setupMockEnv() {
  const elements = new Map()
  const eventListeners = new Map()
  const timeouts = new Map()
  let timeoutIdCounter = 1

  globalThis.__onMountedHooks = []
  globalThis.__onUnmountedHooks = []
  globalThis.__onContentUpdatedHooks = []
  globalThis.__watchHooks = []
  globalThis.__getScrollOffset = () => 0
  globalThis.__useData = () => ({ hash: { value: '#section' } })

  let observedElements = []
  let resizeObserverCallback = null
  let resizeObserverDisconnected = false

  class MockResizeObserver {
    constructor(cb) {
      resizeObserverCallback = cb
      this.observe = (el) => {
        observedElements.push(el)
      }
      this.disconnect = () => {
        resizeObserverDisconnected = true
        observedElements = []
      }
    }
  }

  const windowMock = {
    location: { hash: '#section' },
    scrollY: 100,
    scrollToCalls: [],
    ResizeObserver: MockResizeObserver,
    scrollTo(opts) {
      this.scrollToCalls.push(opts)
    },
    getComputedStyle(el) {
      return {
        paddingTop: el._paddingTop || '0px',
      }
    },
    setTimeout(fn, delay) {
      const id = timeoutIdCounter++
      timeouts.set(id, { fn, delay })
      return id
    },
    clearTimeout(id) {
      timeouts.delete(id)
    },
    addEventListener(type, listener, options) {
      if (!eventListeners.has(type)) {
        eventListeners.set(type, new Set())
      }
      eventListeners.get(type).add(listener)
    },
    removeEventListener(type, listener) {
      if (eventListeners.has(type)) {
        eventListeners.get(type).delete(listener)
      }
    },
    dispatchEvent(type) {
      if (eventListeners.has(type)) {
        for (const listener of Array.from(eventListeners.get(type))) {
          listener({ type })
        }
      }
    },
  }

  const documentMock = {
    body: { _name: 'body' },
    getElementById(id) {
      return elements.get(id) || null
    },
    querySelector(selector) {
      return elements.get(selector) || null
    },
  }

  globalThis.window = windowMock
  globalThis.document = documentMock
  globalThis.ResizeObserver = MockResizeObserver

  return {
    windowMock,
    documentMock,
    elements,
    eventListeners,
    timeouts,
    getObservedElements: () => observedElements,
    triggerResizeObserver: () => resizeObserverCallback && resizeObserverCallback(),
    isResizeObserverDisconnected: () => resizeObserverDisconnected,
    runTimeouts() {
      const pending = Array.from(timeouts.entries()).sort((a, b) => a[1].delay - b[1].delay)
      for (const [id, item] of pending) {
        if (timeouts.has(id)) {
          timeouts.delete(id)
          item.fn()
        }
      }
    },
    teardown() {
      delete globalThis.window
      delete globalThis.document
      delete globalThis.ResizeObserver
      delete globalThis.__onMountedHooks
      delete globalThis.__onUnmountedHooks
      delete globalThis.__onContentUpdatedHooks
      delete globalThis.__watchHooks
      delete globalThis.__getScrollOffset
      delete globalThis.__useData
    },
  }
}

test('useStableHashScroll registers lifecycle hooks on initialization', () => {
  const env = setupMockEnv()
  try {
    useStableHashScroll()
    assert.equal(globalThis.__onMountedHooks.length, 1)
    assert.equal(globalThis.__onContentUpdatedHooks.length, 1)
    assert.equal(globalThis.__watchHooks.length, 1)
    assert.equal(globalThis.__onUnmountedHooks.length, 1)
  } finally {
    env.teardown()
  }
})

test('scheduleAfterRender schedules scrolling on nextTick via hooks', async () => {
  const env = setupMockEnv()
  try {
    const targetElement = {
      _paddingTop: '20px',
      getBoundingClientRect: () => ({ top: 150 }),
    }
    env.elements.set('section', targetElement)

    useStableHashScroll()

    // Trigger mounted hook
    const mountedHook = globalThis.__onMountedHooks[0]
    mountedHook()

    // Wait for nextTick promise resolution
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Timeouts should now be scheduled
    assert.ok(env.timeouts.size > 0)

    // Run pending timeouts
    env.runTimeouts()

    // Verify scrollTo was called with calculated scroll position:
    // window.scrollY (100) + target.top (150) - getScrollOffset (0) + targetPadding (20) = 270
    assert.ok(env.windowMock.scrollToCalls.length > 0)
    assert.deepEqual(env.windowMock.scrollToCalls[0], { left: 0, top: 270, behavior: 'auto' })
  } finally {
    env.teardown()
  }
})

test('scheduleStableHashScroll exits early if window is undefined or hash is missing', () => {
  const env = setupMockEnv()
  try {
    useStableHashScroll()
    const mountedHook = globalThis.__onMountedHooks[0]

    // Case 1: missing hash (empty string)
    env.windowMock.location.hash = ''
    mountedHook()
    assert.equal(env.timeouts.size, 0)

    // Case 2: window undefined
    delete globalThis.window
    mountedHook()
    assert.equal(env.timeouts.size, 0)
  } finally {
    env.teardown()
  }
})

test('scrollToHashTarget correctly handles scroll offset and negative top clamp', async () => {
  const env = setupMockEnv()
  try {
    globalThis.__getScrollOffset = () => 50
    const targetElement = {
      _paddingTop: '10px',
      getBoundingClientRect: () => ({ top: -200 }),
    }
    env.elements.set('section', targetElement)

    useStableHashScroll()
    globalThis.__onMountedHooks[0]()
    await new Promise((resolve) => setTimeout(resolve, 10))

    env.runTimeouts()

    // Calculated top: 100 + (-200) - 50 + 10 = -140 -> clamped to 0
    assert.ok(env.windowMock.scrollToCalls.length > 0)
    assert.deepEqual(env.windowMock.scrollToCalls[0], { left: 0, top: 0, behavior: 'auto' })
  } finally {
    env.teardown()
  }
})

test('scrollToHashTarget handles invalid URI percent-encoding gracefully', async () => {
  const env = setupMockEnv()
  try {
    env.windowMock.location.hash = '#%FF' // Invalid decodeURIComponent
    useStableHashScroll()
    globalThis.__onMountedHooks[0]()
    await new Promise((resolve) => setTimeout(resolve, 10))

    env.runTimeouts()
    assert.equal(env.windowMock.scrollToCalls.length, 0)
  } finally {
    env.teardown()
  }
})

test('ResizeObserver is setup for .VPDoc or body and triggers scroll', async () => {
  const env = setupMockEnv()
  try {
    const vpDocElement = { _name: 'VPDoc' }
    env.elements.set('.VPDoc', vpDocElement)

    const targetElement = {
      getBoundingClientRect: () => ({ top: 50 }),
    }
    env.elements.set('section', targetElement)

    useStableHashScroll()
    globalThis.__onMountedHooks[0]()
    await new Promise((resolve) => setTimeout(resolve, 10))

    assert.deepEqual(env.getObservedElements(), [vpDocElement])

    // Trigger ResizeObserver callback
    env.triggerResizeObserver()
    assert.ok(env.windowMock.scrollToCalls.length > 0)
  } finally {
    env.teardown()
  }
})

test('User interaction cancels pending timeouts and disconnects ResizeObserver', async () => {
  const env = setupMockEnv()
  try {
    const targetElement = {
      getBoundingClientRect: () => ({ top: 50 }),
    }
    env.elements.set('section', targetElement)

    useStableHashScroll()
    globalThis.__onMountedHooks[0]()
    await new Promise((resolve) => setTimeout(resolve, 10))

    assert.ok(env.timeouts.size > 0)

    // Dispatch keydown event to cancel
    env.windowMock.dispatchEvent('keydown')

    // Settle timeout (last timeout in schedule) should be cleared or canceled
    const scrollCallsBefore = env.windowMock.scrollToCalls.length
    env.runTimeouts()
    const scrollCallsAfter = env.windowMock.scrollToCalls.length

    assert.equal(scrollCallsAfter, scrollCallsBefore, 'No scroll calls after cleanup')
    assert.ok(env.isResizeObserverDisconnected())
  } finally {
    env.teardown()
  }
})

test('onUnmounted hook cleans up current run', async () => {
  const env = setupMockEnv()
  try {
    const targetElement = {
      getBoundingClientRect: () => ({ top: 50 }),
    }
    env.elements.set('section', targetElement)

    useStableHashScroll()
    globalThis.__onMountedHooks[0]()
    await new Promise((resolve) => setTimeout(resolve, 10))

    assert.ok(env.timeouts.size > 0)

    // Call unmounted hook
    globalThis.__onUnmountedHooks[0]()

    const scrollCallsBefore = env.windowMock.scrollToCalls.length
    env.runTimeouts()
    const scrollCallsAfter = env.windowMock.scrollToCalls.length

    assert.equal(scrollCallsAfter, scrollCallsBefore, 'No scroll calls after unmounted cleanup')
    assert.ok(env.isResizeObserverDisconnected())
  } finally {
    env.teardown()
  }
})

test('scheduleStableHashScroll cancels previous run when called again', async () => {
  const env = setupMockEnv()
  try {
    const targetElement = {
      getBoundingClientRect: () => ({ top: 50 }),
    }
    env.elements.set('section', targetElement)

    useStableHashScroll()
    const mountedHook = globalThis.__onMountedHooks[0]

    mountedHook()
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(env.isResizeObserverDisconnected(), false)

    // Call mountedHook again (simulating second schedule call)
    mountedHook()
    await new Promise((resolve) => setTimeout(resolve, 10))

    assert.equal(env.isResizeObserverDisconnected(), true)
  } finally {
    env.teardown()
  }
})
