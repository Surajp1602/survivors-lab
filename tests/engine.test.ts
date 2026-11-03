import { describe, expect, it } from 'vitest'
import { noManual, runEngine, type RunConfig } from '@/lib/engine'
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
