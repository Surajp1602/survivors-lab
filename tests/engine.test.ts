import { describe, expect, it } from 'vitest'
import { createMutants, isKilled, noManual, planRun, runEngine, runTests, scoreOf, type RunConfig } from '@/lib/engine'
import { shortcutLabel } from '@/lib/platform'
import { prepare } from '@/lib/source'
import { cannotGenerate, generateKillingTest } from '@/lib/killing'
import { decodeShare, encodeShare } from '@/lib/share'
import { buildPrComment } from '@/lib/report'
import { specimens } from '@/lib/presets'

const preset = (id: string) => specimens.find((s) => s.id === id)!
const config = (id: string, scope: RunConfig['scope']): RunConfig => {
  const s = preset(id)
  return { fn: s.fn, tests: s.tests, scope, before: s.before ?? '', manual: noManual }
}
const survivorsOf = (r: ReturnType<typeof runEngine>) => r.plan.mutants.filter((m) => !r.killed.includes(m.id))

describe('presets', () => {
  it('01 isAdult: 2 mutants, 0 killed', () => {
    const r = runEngine(config('01', 'whole'))
    expect(r.error).toBeUndefined()
    expect(r.plan.mutants).toHaveLength(2)
    expect(r.killed).toHaveLength(0)
  })

  it('04 changed lines: 2 of 7 mutants in scope, 1 killed, survivor is 90 -> 91 on line 3', () => {
    const r = runEngine(config('04', 'changed'))
    expect(r.plan.total).toBe(7)
    expect(r.plan.mutants).toHaveLength(2)
    expect(r.killed).toHaveLength(1)
    const [survivor, ...rest] = survivorsOf(r)
    expect(rest).toHaveLength(0)
    expect(survivor).toMatchObject({ line: 3, before: '90', after: '91' })
  })

  it('04 whole function: 7 mutants, 4 killed, 3 survivors', () => {
    const r = runEngine(config('04', 'whole'))
    expect(r.plan.mutants).toHaveLength(7)
    expect(r.killed).toHaveLength(4)
    expect(survivorsOf(r)).toHaveLength(3)
  })
})

describe('numeric literal hints', () => {
  const hints = (fn: string) => Object.fromEntries(createMutants(fn).filter((m) => m.operator === 'numeric literal').map((m) => [m.before, m.hint]))

  it('treats a comparison operand as a threshold', () => {
    expect(hints(preset('04').fn)['500']).toBe('Test the exact threshold and its neighbour.')
  })

  it('treats a returned value as an exact value', () => {
    expect(hints(preset('04').fn)['90']).toBe("Assert the exact value; a range check like > 40 can't tell 90 from 91.")
  })

  it('treats an assigned value as an exact value', () => {
    expect(hints('function f() {\n  let limit = 3;\n  return limit;\n}')['3']).toBe("Assert the exact value; a range check like > 2 can't tell 3 from 4.")
  })
})

describe('run shortcut badge', () => {
  it('uses ⌘ on Mac and Ctrl elsewhere', () => {
    expect(shortcutLabel('MacIntel')).toBe('⌘ ↵')
    expect(shortcutLabel('macOS')).toBe('⌘ ↵')
    expect(shortcutLabel('Win32')).toBe('Ctrl ↵')
    expect(shortcutLabel('Linux x86_64')).toBe('Ctrl ↵')
  })
})

describe('test syntax', () => {
  const fn = 'export function clamp(n, lo, hi) {\n  return Math.min(Math.max(n, lo), hi);\n}\nexport function tags(s) {\n  return s.split(",");\n}'

  it('runs a describe/it suite using .not and toBeGreaterThan', () => {
    const tests = [
      "import { describe, it, expect, beforeEach } from 'vitest'",
      'describe("clamp", () => {',
      '  let hi',
      '  beforeEach(() => { hi = 10 })',
      '  it("caps at hi", () => expect(clamp(50, 0, hi)).not.toBeGreaterThan(hi))',
      '  it("keeps values inside", () => expect(clamp(5, 0, hi)).toBeGreaterThan(4))',
      '  it("is not the input when capped", () => expect(clamp(50, 0, hi)).not.toBe(50))',
      '})',
    ].join('\n')
    expect(runTests(fn, tests)).toEqual({ ok: true, count: 3 })
  })

  it('reports the full test name and message on failure', () => {
    const r = runTests(fn, 'describe("clamp", () => { it("caps", () => expect(clamp(50, 0, 10)).toBeGreaterThan(10)) })')
    expect(r.ok).toBe(false)
    expect(r.message).toBe('clamp › caps: expected 10 to be greater than 10')
  })

  it('supports every listed matcher, plain and negated', () => {
    const tests = `
      test('matchers', () => {
        expect(tags('a,b')).toEqual(['a', 'b'])
        expect({ a: 1, b: undefined }).toEqual({ a: 1 })
        expect({ a: 1, b: undefined }).not.toStrictEqual({ a: 1 })
        expect(tags('a,b')).toStrictEqual(['a', 'b'])
        expect(clamp(-5, 0, 10)).toBeLessThan(1)
        expect(tags('a,b')).toContain('b')
        expect('a,b').not.toContain('c')
        expect(() => clamp.call(null, 1, 2, 3, null.x)).toThrow()
        expect(() => { throw new RangeError('bad pct') }).toThrow('bad')
        expect(() => { throw new RangeError('bad pct') }).toThrow(/pct$/)
        expect(() => { throw new RangeError('bad pct') }).toThrow(RangeError)
        expect(() => 1).not.toThrow()
        expect(1).toBeTruthy(); expect(0).toBeFalsy()
        expect(null).toBeNull(); expect(undefined).toBeUndefined(); expect(0).not.toBeNull()
      })`
    expect(runTests(fn, tests)).toEqual({ ok: true, count: 1 })
  })

  it('runs beforeEach hooks outermost first for every test', () => {
    const tests = `
      const log = []
      beforeEach(() => log.push('outer'))
      describe('d', () => {
        beforeEach(() => log.push('inner'))
        it('one', () => expect(log).toEqual(['outer', 'inner']))
        it('two', () => expect(log).toEqual(['outer', 'inner', 'outer', 'inner']))
      })`
    expect(runTests(fn, tests).ok).toBe(true)
  })

  it('parses a TypeScript function and keeps line numbers', () => {
    const ts = 'interface Order {\n  total: number\n}\nexport function fee(order: Order, express?: boolean): number {\n  if (order.total >= 500) return 0;\n  return express ? 90 : 40;\n}'
    const testsTs = 'it("fee", () => {\n  const o: { total: number } = { total: 600 }\n  expect(fee(o)).toBe(0)\n  expect(fee({ total: 1 }, true) as number).toBe(90)\n})'
    expect(prepare(ts).names).toEqual(['fee'])
    expect(runTests(ts, testsTs)).toEqual({ ok: true, count: 1 })
    const boundary = createMutants(ts).find((m) => m.operator === 'relational boundary')
    expect(boundary).toMatchObject({ line: 5, before: ' >= ', after: ' > ' })
  })

  it('leaves every preset unchanged when stripping types', () => {
    for (const s of specimens) {
      expect(prepare(s.fn).code).toBe(s.fn)
      expect(prepare(s.tests).code).toBe(s.tests)
    }
  })
})

describe('add killing test', () => {
  const s = preset('04')
  const mutantOf = (fn: string, tests: string, pick: (m: ReturnType<typeof createMutants>[number]) => boolean) =>
    planRun({ fn, tests, scope: 'whole', before: '', manual: noManual }).mutants.find(pick)!

  it('kills the >= 500 boundary mutant by calling at exactly 500', () => {
    const mutant = mutantOf(s.fn, s.tests, (m) => m.operator === 'relational boundary' && m.before === ' >= ')
    expect(runEngine(config('04', 'whole')).killed).not.toContain(mutant.id)
    const generated = generateKillingTest(s.fn, s.tests, mutant)
    expect(generated).toMatchObject({ ok: true, test: 'test("shippingFee at the 500 boundary", () => expect(shippingFee(500)).toBe(0));' })
    if (!generated.ok) return
    expect(runTests(s.fn, generated.tests).ok).toBe(true)
    const rerun = planRun({ fn: s.fn, tests: generated.tests, scope: 'whole', before: '', manual: noManual })
    expect(isKilled(rerun.mutants.find((m) => m.key === mutant.key)!, rerun)).toBe(true)
  })

  it('kills the returned 90 -> 91 literal with the inputs of the test that reaches it', () => {
    const mutant = mutantOf(s.fn, s.tests, (m) => m.before === '90')
    const generated = generateKillingTest(s.fn, s.tests, mutant)
    expect(generated).toMatchObject({ ok: true, test: 'test("shippingFee returns exactly 90", () => expect(shippingFee(100, true)).toBe(90));' })
  })

  it('refuses when no reliable test exists', () => {
    const fn = 'function f(x) {\n  if (x >= 0) return 1;\n  return 1;\n}'
    const mutant = mutantOf(fn, 'test("t", () => expect(f(5)).toBe(1))', (m) => m.operator === 'relational boundary')
    expect(generateKillingTest(fn, 'test("t", () => expect(f(5)).toBe(1))', mutant)).toEqual({ ok: false, reason: cannotGenerate })
  })
})

describe('equivalent mutants', () => {
  it('leaves marked mutants out of the score', () => {
    const r = runEngine(config('04', 'whole'))
    expect(scoreOf(r.plan.mutants, r.killed, []).score).toBe(57)
    const boundary = survivorsOf(r).find((m) => m.operator === 'relational boundary')!
    expect(scoreOf(r.plan.mutants, r.killed, [boundary.key, 'stale:0:x'])).toEqual({ score: 67, counted: 6, killed: 4, equivalent: 1 })
  })

  it('keeps mutant keys stable across runs and persists marks in the share link', () => {
    const keys = () => runEngine(config('04', 'whole')).plan.mutants.map((m) => m.key)
    expect(keys()).toEqual(keys())
    const state = { fn: 'f', tests: 't', scope: 'whole' as const, before: '', manual: noManual, equivalent: ['2:13: > '] }
    expect(decodeShare(encodeShare(state))).toEqual(state)
  })
})

describe('PR comment', () => {
  it('renders score, scope and each survivor as a diff block', () => {
    const r = runEngine(config('04', 'changed'))
    const comment = buildPrComment({
      name: 'shippingFee',
      tally: scoreOf(r.plan.mutants, r.killed, []),
      scope: { mode: 'changed', lines: r.plan.lines, kept: r.plan.mutants.length, total: r.plan.total },
      survivors: survivorsOf(r),
    })
    expect(comment).toBe([
      '### Survivors mutation report · shippingFee',
      '',
      '**Mutation score:** 50% (1 of 2 killed) · **Scope:** Changed lines (1, 3) · 2 of 7 mutants',
      '',
      '#### 1 survivor',
      '',
      "**Line 3** · numeric literal — Assert the exact value; a range check like > 40 can't tell 90 from 91.",
      '```diff',
      '-  if (express) return 90;',
      '+  if (express) return 91;',
      '```',
    ].join('\n'))
  })
})
