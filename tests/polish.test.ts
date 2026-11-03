import { afterAll, describe, expect, it } from 'vitest'
import { describeSyntaxProblem, findSyntaxError } from '@/lib/diagnostics'
import { checkOriginal, noManual, planRun, runEngine, scoreOf, testFailurePrefix, type RunConfig } from '@/lib/engine'
import { generateKillingTest, quoteStyle } from '@/lib/killing'
import { specimens } from '@/lib/presets'
import { alsoKilled, catalogueNo, diffParts, progressLabel, resultsState } from '@/lib/view'
import { createNodeRunner } from './node-runner'

const runner = createNodeRunner()
afterAll(() => runner.dispose())

const s04 = specimens.find((s) => s.id === '04')!
const whole = (fn: string, tests: string): RunConfig => ({ fn, tests, scope: 'whole', before: '', manual: noManual })

describe('2. syntax errors', () => {
  it('reports a Function parse error with line and column', async () => {
    const fn = 'function f(a) {\n  return a +;\n}'
    expect(findSyntaxError(fn, 'Function')).toEqual({ editor: 'Function', line: 2, column: 13, message: 'Unexpected token' })
    const check = await checkOriginal(runner, fn, "test('t', () => expect(f(1)).toBe(1))")
    expect(check).toMatchObject({ ok: false, kind: 'syntax', message: 'Syntax error in Function, line 2, column 13: Unexpected token' })
  })

  it('reports a Tests parse error at the real position, not where the call began', async () => {
    const tests = "test('t', () => {\n  expect(f(1)).toBe(1\n})"
    const check = await checkOriginal(runner, 'function f(a) {\n  return a;\n}', tests)
    expect(check).toMatchObject({ ok: false, kind: 'syntax', problem: { editor: 'Tests', line: 3, column: 1 } })
    expect(check.ok === false && check.message).toMatch(/^Syntax error in Tests, line 3, column 1: /)
  })

  it('locates errors in TypeScript sources', () => {
    const p = findSyntaxError('function f(a: number): number {\n  if (a >) return 1;\n  return 0;\n}', 'Function')
    expect(p && describeSyntaxProblem(p)).toBe('Syntax error in Function, line 2, column 10: Unexpected token')
  })

  it('keeps "Your tests fail" for tests that run and fail', async () => {
    const check = await checkOriginal(runner, s04.fn, "test('wrong', () => expect(shippingFee(100)).toBe(41))")
    expect(check).toMatchObject({ ok: false, kind: 'failure' })
    expect(check.ok === false && check.message.startsWith(testFailurePrefix)).toBe(true)
    expect(await checkOriginal(runner, s04.fn, s04.tests)).toEqual({ ok: true })
  })
})

describe('3. stale results', () => {
  const ran = whole(s04.fn, s04.tests)

  it('hides earlier results when the run errors', () => {
    expect(resultsState({ hasResults: true, error: true, ranWith: ran, current: ran })).toBe('hidden')
  })

  it('marks results stale when either editor changes, fresh when unchanged', () => {
    expect(resultsState({ hasResults: true, error: false, ranWith: ran, current: ran })).toBe('fresh')
    expect(resultsState({ hasResults: true, error: false, ranWith: ran, current: { ...ran, fn: `${ran.fn}\n` } })).toBe('stale')
    expect(resultsState({ hasResults: true, error: false, ranWith: ran, current: { ...ran, tests: `${ran.tests} ` } })).toBe('stale')
    expect(resultsState({ hasResults: true, error: false, ranWith: ran, current: { ...ran, scope: 'changed' } })).toBe('stale')
  })

  it('ignores the Before editor unless Changed lines is in use', () => {
    expect(resultsState({ hasResults: true, error: false, ranWith: ran, current: { ...ran, before: 'x' } })).toBe('fresh')
    const changed: RunConfig = { ...ran, scope: 'changed', before: s04.before! }
    expect(resultsState({ hasResults: true, error: false, ranWith: changed, current: { ...changed, before: 'x' } })).toBe('stale')
  })

  it('is empty before any run', () => {
    expect(resultsState({ hasResults: false, error: false, ranWith: null, current: ran })).toBe('empty')
  })
})

describe('4. grid header matches the score', () => {
  it('counts like the score and names equivalents', async () => {
    const r = await runEngine(runner, whole(s04.fn, s04.tests))
    const boundary = r.plan.mutants.find((m) => m.operator === 'relational boundary')!
    const tally = scoreOf(r.plan.mutants, r.killed, [boundary.key])
    expect(progressLabel(tally)).toBe('4 / 6 killed · 1 equivalent')
    expect(tally.score).toBe(67)
    expect(progressLabel(scoreOf(r.plan.mutants, r.killed, []))).toBe('4 / 7 killed')
  })
})

describe('5. a generated test that kills several mutants', () => {
  it('lists the other mutants it killed', async () => {
    const first = await runEngine(runner, whole(s04.fn, s04.tests))
    const previous = first.plan.mutants.filter((m) => !first.killed.includes(m.id)).map((m) => m.key)
    const boundary = first.plan.mutants.find((m) => m.operator === 'relational boundary')!
    const generated = await generateKillingTest(runner, s04.fn, s04.tests, boundary)
    if (!generated.ok) throw new Error('expected a generated test')
    const rerun = await runEngine(runner, whole(s04.fn, generated.tests))
    const others = alsoKilled(previous, boundary.key, rerun.plan.mutants, rerun.killed)
    expect(others.map((m) => [catalogueNo(m), m.before, m.after])).toEqual([['MUT-01', '500', '501']])
  })
})

describe('6. generated tests follow the quote style', () => {
  const boundaryOf = (fn: string) => planRun(whole(fn, '')).mutants.find((m) => m.operator === 'relational boundary')!

  it('detects the dominant quote', () => {
    expect(quoteStyle("test('a', () => expect(f('x')).toBe(1))")).toBe("'")
    expect(quoteStyle('test("a", () => expect(f("x")).toBe(1))')).toBe('"')
    expect(quoteStyle('test(`a`, () => expect(f(1)).toBe(1))')).toBe("'")
  })

  it('writes double-quoted tests for double-quoted suites and single-quoted ones otherwise', async () => {
    const fn = 'function label(n) {\n  if (n >= 10) return "big";\n  return "small";\n}'
    const double = 'test("small", () => expect(label(1)).toBe("small"));'
    const single = "test('small', () => expect(label(1)).toBe('small'));"
    expect(await generateKillingTest(runner, fn, double, boundaryOf(fn))).toMatchObject({ ok: true, test: 'test("label at the 10 boundary", () => expect(label(10)).toBe("big"));' })
    expect(await generateKillingTest(runner, fn, single, boundaryOf(fn))).toMatchObject({ ok: true, test: "test('label at the 10 boundary', () => expect(label(10)).toBe('big'));" })
  })

  it('uses the quote style inside toEqual objects too', async () => {
    const fn = "function pick(n) {\n  if (n > 2) return { size: 'L' };\n  return { size: 'S' };\n}"
    const tests = "test('small', () => expect(pick(1)).toEqual({ size: 'S' }));"
    expect(await generateKillingTest(runner, fn, tests, boundaryOf(fn))).toMatchObject({ ok: true, test: "test('pick at the 2 boundary', () => expect(pick(2)).toEqual({ size: 'S' }));" })
  })
})

describe('7. whole-line diff', () => {
  it('highlights only the changed token', () => {
    const m = planRun(whole(s04.fn, s04.tests)).mutants.find((x) => x.operator === 'relational boundary')!
    expect(diffParts(m)).toEqual({ removed: ['  if (total ', '>=', ' 500) return 0;'], added: ['  if (total ', '>', ' 500) return 0;'] })
  })
})

describe('11. hero specimen', () => {
  it('plays the real outcome of Specimen 02: 11 mutants, 4 survivors', async () => {
    const { heroDemo, specimens: all } = await import('@/lib/presets')
    expect(heroDemo.specimen.id).toBe('02')
    expect(all[0].id).toBe('01')
    const r = await runEngine(runner, whole(heroDemo.specimen.fn, heroDemo.specimen.tests))
    expect(r.plan.mutants.map((m) => !r.killed.includes(m.id))).toEqual(heroDemo.survived)
    expect(heroDemo.survived.filter(Boolean)).toHaveLength(4)
  })
})
