/* A small, synchronous subset of the Jest/Vitest API: describe, it/test, beforeEach and expect. */

export type SuiteResult = { ok: boolean; message?: string; count: number }
type Check = { pass: boolean; message: string; negated: string }
type Hook = () => unknown
type Block = { name: string; hooks: Hook[]; parent?: Block }

export function format(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'function') return `[Function${value.name ? ` ${value.name}` : ''}]`
  if (Object.is(value, -0)) return '-0'
  if (value === null || typeof value !== 'object') return String(value)
  try { return JSON.stringify(value) } catch { return String(value) }
}

/** Jest-style deep equality. `strict` also compares undefined properties, sparseness and prototypes. */
export function equals(a: unknown, b: unknown, strict = false): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (strict && Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
  if (a instanceof RegExp || b instanceof RegExp) return String(a) === String(b)
  if (a instanceof Map || b instanceof Map) return a instanceof Map && b instanceof Map && a.size === b.size && [...a].every(([k, v]) => b.has(k) && equals(v, b.get(k), strict))
  if (a instanceof Set || b instanceof Set) return a instanceof Set && b instanceof Set && a.size === b.size && [...a].every((v) => [...b].some((w) => equals(v, w, strict)))
  const x = a as Record<string, unknown>
  const y = b as Record<string, unknown>
  if (Array.isArray(x) && Array.isArray(y)) {
    if (x.length !== y.length) return false
    for (let i = 0; i < x.length; i++) {
      if (strict && (i in x) !== (i in y)) return false
      if (!equals(x[i], y[i], strict)) return false
    }
    return true
  }
  const keys = (o: Record<string, unknown>) => Object.keys(o).filter((k) => strict || o[k] !== undefined)
  const kx = keys(x)
  const ky = keys(y)
  return kx.length === ky.length && kx.every((k) => Object.prototype.hasOwnProperty.call(y, k) && equals(x[k], y[k], strict))
}

const errorMessage = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String((e as Error).message) : String(e))
const assertNumber = (v: unknown, name: string) => { if (typeof v !== 'number' && typeof v !== 'bigint') throw new TypeError(`${name} expects a number, received ${format(v)}`) }

const matchers: Record<string, (actual: unknown, ...args: unknown[]) => Check> = {
  toBe: (a, e) => ({ pass: Object.is(a, e), message: `expected ${format(e)}, received ${format(a)}`, negated: `expected value not to be ${format(e)}` }),
  toEqual: (a, e) => ({ pass: equals(a, e), message: `expected ${format(e)}, received ${format(a)}`, negated: `expected value not to equal ${format(e)}` }),
  toStrictEqual: (a, e) => ({ pass: equals(a, e, true), message: `expected strictly ${format(e)}, received ${format(a)}`, negated: `expected value not to strictly equal ${format(e)}` }),
  toBeGreaterThan: (a, e) => { assertNumber(a, 'toBeGreaterThan'); assertNumber(e, 'toBeGreaterThan'); return { pass: (a as number) > (e as number), message: `expected ${format(a)} to be greater than ${format(e)}`, negated: `expected ${format(a)} not to be greater than ${format(e)}` } },
  toBeLessThan: (a, e) => { assertNumber(a, 'toBeLessThan'); assertNumber(e, 'toBeLessThan'); return { pass: (a as number) < (e as number), message: `expected ${format(a)} to be less than ${format(e)}`, negated: `expected ${format(a)} not to be less than ${format(e)}` } },
  toContain: (a, e) => {
    let pass: boolean
    if (typeof a === 'string') pass = a.includes(String(e))
    else if (a != null && typeof (a as Iterable<unknown>)[Symbol.iterator] === 'function') pass = [...(a as Iterable<unknown>)].includes(e)
    else throw new TypeError(`toContain expects a string or an array, received ${format(a)}`)
    return { pass, message: `expected ${format(a)} to contain ${format(e)}`, negated: `expected ${format(a)} not to contain ${format(e)}` }
  },
  toThrow: (a, expected) => {
    if (typeof a !== 'function') throw new TypeError('toThrow expects a function, e.g. expect(() => fn()).toThrow()')
    let threw = false
    let error: unknown
    try { a() } catch (e) { threw = true; error = e }
    let pass = threw
    if (threw && expected !== undefined) {
      const msg = errorMessage(error)
      if (typeof expected === 'string') pass = msg.includes(expected)
      else if (expected instanceof RegExp) pass = expected.test(msg)
      else if (typeof expected === 'function') pass = error instanceof expected
      else if (expected && typeof expected === 'object' && 'message' in expected) pass = msg === errorMessage(expected)
    }
    const what = expected === undefined ? '' : ` ${expected instanceof RegExp || typeof expected === 'string' ? format(String(expected)) : format(expected)}`
    return { pass, message: threw ? `expected function to throw${what}, but it threw ${format(errorMessage(error))}` : 'expected function to throw', negated: `expected function not to throw${what}, but it threw ${format(errorMessage(error))}` }
  },
  toBeTruthy: (a) => ({ pass: !!a, message: `expected truthy value, received ${format(a)}`, negated: `expected falsy value, received ${format(a)}` }),
  toBeFalsy: (a) => ({ pass: !a, message: `expected falsy value, received ${format(a)}`, negated: `expected truthy value, received ${format(a)}` }),
  toBeNull: (a) => ({ pass: a === null, message: `expected null, received ${format(a)}`, negated: 'expected value not to be null' }),
  toBeUndefined: (a) => ({ pass: a === undefined, message: `expected undefined, received ${format(a)}`, negated: 'expected value not to be undefined' }),
}

type Matchers = Record<keyof typeof matchers, (...args: unknown[]) => void>

export function expect(actual: unknown): Matchers & { not: Matchers } {
  const bind = (negate: boolean) => Object.fromEntries(Object.entries(matchers).map(([name, check]) => [name, (...args: unknown[]) => {
    const r = check(actual, ...args)
    if (r.pass === negate) throw new Error(negate ? r.negated : r.message)
  }])) as Matchers
  return Object.assign(bind(false), { not: bind(true) })
}

const harnessNames = ['describe', 'it', 'test', 'beforeEach', 'expect']

const settle = (value: unknown) => { if (value && typeof (value as Promise<unknown>).then === 'function') throw new Error('async tests are not supported in the lab') }

/**
 * Evaluate `code`, expose its top-level `names` to the tests, collect describe/it/test/beforeEach
 * registrations, then run each test after its beforeEach hooks (outermost first). Stops at the first failure.
 */
export function runSuite(code: string, names: string[], testsCode: string): SuiteResult {
  try {
    const exposed = names.filter((n) => !harnessNames.includes(n))
    const scope: Record<string, unknown> = new Function(`${code}\nreturn { ${exposed.join(', ')} }`)()
    const root: Block = { name: '', hooks: [] }
    let current = root
    const cases: { name: string; body: Hook; block: Block }[] = []
    const describe = (name: unknown, body: () => void) => { const block: Block = { name: String(name), hooks: [], parent: current }; current = block; try { body() } finally { current = block.parent! } }
    const test = (name: unknown, body: Hook) => { cases.push({ name: String(name), body, block: current }) }
    const beforeEach = (hook: Hook) => { current.hooks.push(hook) }
    new Function(...Object.keys(scope), ...harnessNames, testsCode)(...Object.values(scope), describe, test, test, beforeEach, expect)
    for (const c of cases) {
      const chain: Block[] = []
      for (let b: Block | undefined = c.block; b; b = b.parent) chain.unshift(b)
      try {
        for (const b of chain) for (const hook of b.hooks) settle(hook())
        settle(c.body())
      } catch (e) {
        return { ok: false, count: cases.length, message: `${[...chain.map((b) => b.name).filter(Boolean), c.name].join(' › ')}: ${errorMessage(e)}` }
      }
    }
    return { ok: true, count: cases.length }
  } catch (e) {
    return { ok: false, count: 0, message: errorMessage(e) || 'Unknown failure' }
  }
}
