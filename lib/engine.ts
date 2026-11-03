import { parse } from 'acorn'
import { ancestor, simple } from 'acorn-walk'
import { diffLines } from 'diff'
import type { Operator } from './catalogue'
import type { Runner, SuiteOutcome } from './runner'
import { prepare } from './source'

export type Scope = 'whole' | 'changed'
export type Manual = { add: number[]; remove: number[] }
/**
 * What a killing-test generator needs to know about a mutant: a boundary comparison between a parameter and
 * a constant, or a literal that a `return` statement hands back (the span is that statement's argument).
 */
export type MutantTarget = { kind: 'boundary'; fn: string; param: number; value: number } | { kind: 'return'; start: number; end: number }
/** `key` is stable across runs of the same code (line, column, replacement), unlike the per-run `id`. */
export type Mutant = { id: number; key: string; operator: Operator; line: number; before: string; after: string; hint: string; source: string; target?: MutantTarget; diff: { removed: string[]; added: string[] } }
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

export const operatorHints: Record<Operator, string> = { 'relational boundary': 'Add a test at exactly the boundary value.', arithmetic: 'Test the operation with a value that makes the result change.', equality: 'Test both equal and unequal values explicitly.', logical: 'Add a case where only one side of the condition is true.', 'boolean literal': 'Test the opposite boolean branch.', 'numeric literal': 'Test the exact threshold and its neighbour.', 'negated condition': 'Test the condition in both directions.', 'string literal': 'Assert the exact error or output string.' }

const comparisonOps = ['<', '>', '<=', '>=', '===', '!==', '==', '!=']
const isFunctionNode = (n: any) => ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(n.type)
/** Value of a numeric literal, or of `-literal`. */
const numberOf = (n: any): number | undefined => n?.type === 'Literal' && typeof n.value === 'number' ? n.value : n?.type === 'UnaryExpression' && n.operator === '-' ? (numberOf(n.argument) === undefined ? undefined : -numberOf(n.argument)!) : undefined

/**
 * A numeric literal compared against (`total >= 500`) is a threshold; one that is returned or assigned
 * (`return 90`) is an exact value, where a loose range assertion can't see an off-by-one.
 */
/** The node that consumes a literal's value, looking through `-90` and `cond ? 90 : 40`. */
function consumerOf(node: any, ancestors: any[]): { parent: any; child: any } {
  let i = ancestors.length - 2
  let child = node
  while (i >= 0 && ((ancestors[i].type === 'UnaryExpression' && ancestors[i].operator === '-') || (ancestors[i].type === 'ConditionalExpression' && ancestors[i].test !== child))) { child = ancestors[i]; i-- }
  return { parent: ancestors[i], child }
}

/** Name the tests would call a function by: its declaration name, or the variable it is assigned to. */
function functionName(fnNode: any, ancestors: any[]): string | undefined {
  if (fnNode.id?.name) return fnNode.id.name
  const holder = ancestors[ancestors.indexOf(fnNode) - 1]
  return holder?.type === 'VariableDeclarator' && holder.id.type === 'Identifier' ? holder.id.name : undefined
}

function boundaryTarget(node: any, ancestors: any[]): MutantTarget | undefined {
  const constantOnRight = numberOf(node.right) !== undefined
  const value = constantOnRight ? numberOf(node.right) : numberOf(node.left)
  const operand = constantOnRight ? node.left : node.right
  if (value === undefined || operand.type !== 'Identifier') return undefined
  const fnNode = [...ancestors].reverse().find(isFunctionNode)
  const fn = fnNode && functionName(fnNode, ancestors)
  const param = fnNode ? fnNode.params.findIndex((p: any) => (p.type === 'AssignmentPattern' ? p.left : p).name === operand.name) : -1
  return fn && param >= 0 ? { kind: 'boundary', fn, param, value } : undefined
}

function numericHint(node: any, ancestors: any[]): string {
  const threshold = 'Test the exact threshold and its neighbour.'
  const direct = ancestors[ancestors.length - 2]
  if (direct?.type === 'BinaryExpression' && comparisonOps.includes(direct.operator)) return threshold
  const { parent, child } = consumerOf(node, ancestors)
  const consumed = (parent?.type === 'ReturnStatement' && parent.argument === child) || (parent?.type === 'AssignmentExpression' && parent.right === child) || (parent?.type === 'VariableDeclarator' && parent.init === child) || (parent?.type === 'ArrowFunctionExpression' && parent.body === child)
  if (!consumed) return threshold
  const sign = ancestors[ancestors.length - 2]?.type === 'UnaryExpression' ? -1 : 1
  const value = sign * node.value
  const mutated = sign * (node.value + 1)
  // The realistic weak assertion only separates this value from a sibling return, e.g. `> 40` for `return 90` next to `return 40`.
  const fnNode = [...ancestors].reverse().find(isFunctionNode)
  const siblings: number[] = []
  if (fnNode) simple(fnNode.body, { ReturnStatement(r: any) { const v = numberOf(r.argument); if (v !== undefined && v < value) siblings.push(v) } } as any)
  const lower = siblings.length ? Math.max(...siblings) : value - 1
  return `Assert the exact value; a range check like > ${lower} can't tell ${value} from ${mutated}.`
}

/** Mutants of `input` (JavaScript or TypeScript). Each mutant's `source` is runnable JavaScript. */
export function createMutants(input: string): Mutant[] {
  const found: Mutant[] = []
  let ast: any
  let source: string
  try { source = prepare(input).code; ast = parse(source, { ecmaVersion: 'latest', locations: true }) } catch { return [] }
  const add = (node: any, operator: Operator, after: string, hint = operatorHints[operator], target?: MutantTarget) => {
    const column = node.start - source.lastIndexOf('\n', node.start - 1) - 1
    const line = node.loc.start.line
    // Whole source lines around the mutation, before and after, for diff output.
    const lineStart = source.lastIndexOf('\n', node.start - 1) + 1
    const nextBreak = source.indexOf('\n', node.end)
    const lineEnd = nextBreak === -1 ? source.length : nextBreak
    const diff = { removed: source.slice(lineStart, lineEnd).split('\n'), added: (source.slice(lineStart, node.start) + after + source.slice(node.end, lineEnd)).split('\n') }
    found.push({ id: found.length, key: `${line}:${column}:${after}`, operator, line, before: source.slice(node.start, node.end), after, hint, source: source.slice(0, node.start) + after + source.slice(node.end), target, diff })
  }
  const returned = (node: any, ancestors: any[]): MutantTarget | undefined => {
    const { parent, child } = consumerOf(node, ancestors)
    return parent?.type === 'ReturnStatement' && parent.argument === child ? { kind: 'return', start: child.start, end: child.end } : undefined
  }
  /**
   * Swap the operator of a binary or logical expression. The mutated range runs from the end of the left operand
   * to the start of the right one, so it can include a closing parenthesis, as in `(a && b) || c`; only the
   * operator token inside it is replaced.
   */
  const swapOperator = (node: any, swaps: Record<string, string>, operator: Operator, target?: MutantTarget) => {
    const swap = swaps[node.operator]
    if (!swap) return
    const at = source.indexOf(node.operator, node.left.end)
    const after = source.slice(node.left.end, at) + swap + source.slice(at + node.operator.length, node.right.start)
    add({ ...node, start: node.left.end, end: node.right.start, loc: node.loc }, operator, after, undefined, target)
  }
  const relational = ['<', '>', '<=', '>=']
  ancestor(ast as any, {
    BinaryExpression(node: any, _: unknown, ancestors: any[]) {
      const swaps: Record<string, string> = { '+': '-', '-': '+', '*': '/', '/': '*', '<': '<=', '<=': '<', '>': '>=', '>=': '>', '===': '!==', '!==': '===', '==': '!=', '!=': '==' }
      const isRelational = relational.includes(node.operator)
      swapOperator(node, swaps, isRelational ? 'relational boundary' : ['===', '!==', '==', '!='].includes(node.operator) ? 'equality' : 'arithmetic', isRelational ? boundaryTarget(node, ancestors) : undefined)
    },
    LogicalExpression(node: any) { swapOperator(node, { '&&': '||', '||': '&&' }, 'logical') },
    Literal(node: any, _: unknown, ancestors: any[]) { if (typeof node.value === 'boolean') add(node, 'boolean literal', String(!node.value), undefined, returned(node, ancestors)); else if (typeof node.value === 'number') add(node, 'numeric literal', String(node.value + 1), numericHint(node, ancestors), returned(node, ancestors)); else if (typeof node.value === 'string') add(node, 'string literal', '""') },
    IfStatement(node: any) { const test = source.slice(node.test.start, node.test.end); add({ ...node.test, end: node.test.end, start: node.test.start, loc: node.test.loc }, 'negated condition', `!(${test})`) },
  } as any)
  return found
}

export const infiniteLoopMessage = "Your code doesn't finish on its own; check for an infinite loop"

/** Run the tests against the code in a worker. Syntax errors are reported without reaching a worker. */
export async function runTests(runner: Runner, fnSource: string, testsSource: string): Promise<SuiteOutcome> {
  let fn: ReturnType<typeof prepare>
  let testsCode: string
  try { fn = prepare(fnSource); testsCode = prepare(testsSource).code } catch (e: any) { return { ok: false, count: 0, message: e.message || 'Unknown failure' } }
  return runner.suite(fn.code, fn.names, testsCode)
}

export type RunPlan = { mutants: Mutant[]; lines: number[]; total: number; names: string[]; testsCode: string }

/** Mutants for one run, scoped and re-numbered. Only the mutation sites are scoped; every mutant still faces the full test suite. */
export function planRun(cfg: RunConfig): RunPlan {
  const all = createMutants(cfg.fn)
  let names: string[] = []
  let testsCode = ''
  try { names = prepare(cfg.fn).names; testsCode = prepare(cfg.tests).code } catch { /* runTests reports syntax errors before a plan is used */ }
  const lines = cfg.scope === 'changed' ? scopedLines(cfg.before, cfg.fn, cfg.manual) : []
  const inScope = cfg.scope === 'changed' ? all.filter((m) => lines.includes(m.line)) : all
  return { mutants: inScope.map((m, i) => ({ ...m, id: i })), lines, total: all.length, names, testsCode }
}

export type MutantOutcome = { killed: boolean; timedOut: boolean; cancelled: boolean }

/** A mutant that fails the suite, or doesn't finish within the timeout, is killed. */
export async function testMutant(runner: Runner, m: Mutant, plan: RunPlan): Promise<MutantOutcome> {
  const r = await runner.suite(m.source, plan.names, plan.testsCode)
  return { killed: !r.ok && !r.cancelled, timedOut: !!r.timedOut, cancelled: !!r.cancelled }
}

export type EngineResult = { error?: string; plan: RunPlan; killed: number[]; timedOut: number[] }

/** Whole run: check the original passes, then test every in-scope mutant across the runner's workers. */
export async function runEngine(runner: Runner, cfg: RunConfig): Promise<EngineResult> {
  const empty: RunPlan = { mutants: [], lines: [], total: 0, names: [], testsCode: '' }
  const original = await runTests(runner, cfg.fn, cfg.tests)
  if (original.timedOut) return { error: infiniteLoopMessage, plan: empty, killed: [], timedOut: [] }
  if (!original.ok) return { error: original.message, plan: empty, killed: [], timedOut: [] }
  const plan = planRun(cfg)
  const outcomes = await Promise.all(plan.mutants.map((m) => testMutant(runner, m, plan)))
  return { plan, killed: plan.mutants.filter((_, i) => outcomes[i].killed).map((m) => m.id), timedOut: plan.mutants.filter((_, i) => outcomes[i].timedOut).map((m) => m.id) }
}

export type Score = { score: number; counted: number; killed: number; equivalent: number }

/** Mutation score with mutants marked equivalent (by key) left out of both sides of the ratio. */
export function scoreOf(mutants: Mutant[], killed: number[], equivalent: string[]): Score {
  const marked = new Set(equivalent)
  const counted = mutants.filter((m) => !marked.has(m.key))
  const dead = counted.filter((m) => killed.includes(m.id)).length
  return { score: counted.length ? Math.round((dead / counted.length) * 100) : mutants.length ? 100 : 0, counted: counted.length, killed: dead, equivalent: mutants.length - counted.length }
}
