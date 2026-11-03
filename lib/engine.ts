import { parse } from 'acorn'
import { simple } from 'acorn-walk'
import { diffLines } from 'diff'

export type Scope = 'whole' | 'changed'
export type Manual = { add: number[]; remove: number[] }
export type Mutant = { id: number; operator: string; line: number; before: string; after: string; hint: string; source: string }
export type RunConfig = { fn: string; tests: string; scope: Scope; before: string; manual: Manual }

export const noManual: Manual = { add: [], remove: [] }

/** 1-based line numbers of `after` that were added or modified relative to `before`. Empty before = no diff scope. */
export function changedLines(before: string, after: string): Set<number> {
  const out = new Set<number>()
  if (!before.trim()) return out
  let line = 1
  for (const part of diffLines(before, after)) {
    if (part.removed) continue
    const count = part.count ?? part.value.split('\n').length - (part.value.endsWith('\n') ? 1 : 0)
    if (part.added) for (let i = 0; i < count; i++) out.add(line + i)
    line += count
  }
  return out
}

export function scopedLines(before: string, after: string, manual: Manual): number[] {
  const total = after.split('\n').length
  const set = changedLines(before, after)
  manual.add.forEach((n) => set.add(n)); manual.remove.forEach((n) => set.delete(n))
  return [...set].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b)
}

export const operatorHints: Record<string, string> = { 'relational boundary': 'Add a test at exactly the boundary value.', arithmetic: 'Test the operation with a value that makes the result change.', equality: 'Test both equal and unequal values explicitly.', logical: 'Add a case where only one side of the condition is true.', 'boolean literal': 'Test the opposite boolean branch.', 'numeric literal': 'Test the exact threshold and its neighbor.', 'negated condition': 'Test the condition in both directions.', 'string literal': 'Assert the exact error or output string.' }

export function createMutants(source: string): Mutant[] {
  const found: Mutant[] = []
  let ast: any
  try { ast = parse(source, { ecmaVersion: 'latest', locations: true }) } catch { return [] }
  const add = (node: any, operator: string, after: string) => { const before = source.slice(node.start, node.end); found.push({ id: found.length, operator, line: node.loc.start.line, before, after, hint: operatorHints[operator], source: source.slice(0, node.start) + after + source.slice(node.end) }) }
  simple(ast as any, {
    BinaryExpression(node: any) {
      const swaps: Record<string, string> = { '+': '-', '-': '+', '*': '/', '/': '*', '<': '<=', '<=': '<', '>': '>=', '>=': '>', '===': '!==', '!==': '===', '==': '!=', '!=': '==', '&&': '||', '||': '&&' }
      if (swaps[node.operator]) add({ ...node, start: node.left.end, end: node.right.start, loc: node.loc }, ['<','>','<=','>='].includes(node.operator) ? 'relational boundary' : ['&&','||'].includes(node.operator) ? 'logical' : ['===','!==','==','!='].includes(node.operator) ? 'equality' : 'arithmetic', ` ${swaps[node.operator]} `)
    },
    Literal(node: any) { if (typeof node.value === 'boolean') add(node, 'boolean literal', String(!node.value)); else if (typeof node.value === 'number') add(node, 'numeric literal', String(node.value + 1)); else if (typeof node.value === 'string') add(node, 'string literal', '""') },
    IfStatement(node: any) { const test = source.slice(node.test.start, node.test.end); add({ ...node.test, end: node.test.end, start: node.test.start, loc: node.test.loc }, 'negated condition', `!(${test})`) },
  } as any)
  return found
}

export function runTests(fnSource: string, testsSource: string): { ok: boolean; message?: string } {
  try {
    const fn = new Function(`${fnSource}\nreturn {${((fnSource.match(/function\s+(\w+)/) || [])[1] || '')}}`)()
    const test = (name: string, cb: () => void) => { try { cb() } catch (e: any) { throw new Error(`${name}: ${e.message}`) } }
    const deep = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b)
    const expect = (value: any) => ({ toBe: (x: any) => { if (value !== x) throw new Error(`expected ${String(x)}, received ${String(value)}`) }, toEqual: (x: any) => { if (!deep(value, x)) throw new Error('values are not equal') }, toThrow: () => { if (typeof value !== 'function') throw new Error('expected a function'); let threw = false; try { value() } catch { threw = true } if (!threw) throw new Error('expected function to throw') }, toBeTruthy: () => { if (!value) throw new Error('expected truthy value') }, toBeFalsy: () => { if (value) throw new Error('expected falsy value') } })
    new Function(...Object.keys(fn), 'test', 'expect', testsSource)(...Object.values(fn), test, expect)
    return { ok: true }
  } catch (e: any) { return { ok: false, message: e.message || 'Unknown failure' } }
}

export type RunPlan = { mutants: Mutant[]; lines: number[]; total: number }

/** Mutants for one run, scoped and re-numbered. Only the mutation sites are scoped; every mutant still faces the full test suite. */
export function planRun(cfg: RunConfig): RunPlan {
  const all = createMutants(cfg.fn)
  const lines = cfg.scope === 'changed' ? scopedLines(cfg.before, cfg.fn, cfg.manual) : []
  const inScope = cfg.scope === 'changed' ? all.filter((m) => lines.includes(m.line)) : all
  return { mutants: inScope.map((m, i) => ({ ...m, id: i })), lines, total: all.length }
}

export const isKilled = (m: Mutant, tests: string) => !runTests(m.source, tests).ok

export type EngineResult = { error?: string; plan: RunPlan; killed: number[] }

/** Synchronous whole run: check the original passes, then test every in-scope mutant. */
export function runEngine(cfg: RunConfig): EngineResult {
  const original = runTests(cfg.fn, cfg.tests)
  if (!original.ok) return { error: original.message, plan: { mutants: [], lines: [], total: 0 }, killed: [] }
  const plan = planRun(cfg)
  return { plan, killed: plan.mutants.filter((m) => isKilled(m, cfg.tests)).map((m) => m.id) }
}
