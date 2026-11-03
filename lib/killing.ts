import { parse } from 'acorn'
import { simple } from 'acorn-walk'
import { runTests, type Mutant } from './engine'
import { equals, runSuite } from './harness'
import { prepare, type Prepared } from './source'

export const cannotGenerate = "Couldn't generate a reliable test for this mutant"

export type Generated = { ok: true; test: string; tests: string } | { ok: false; reason: string }
type CallSite = { callee: string; args: string[] }
type Candidate = { call: string; value: unknown; title: string }

/** Calls to the exposed functions in the existing tests, in source order, as argument source text. */
function callSites(testsCode: string, names: string[]): CallSite[] {
  const sites: (CallSite & { at: number })[] = []
  simple(parse(testsCode, { ecmaVersion: 'latest' }) as any, {
    CallExpression(node: any) {
      if (node.callee.type === 'Identifier' && names.includes(node.callee.name)) {
        sites.push({ at: node.start, callee: node.callee.name, args: node.arguments.map((a: { start: number; end: number }) => testsCode.slice(a.start, a.end)) })
      }
    },
  })
  return sites.sort((a, b) => a.at - b.at)
}

/** Evaluate `call` against fresh copies of the functions. `throws` marks an evaluation that failed. */
function evaluate(code: string, call: string, reach?: () => void): { value?: unknown; throws?: true } {
  try { return { value: new Function('__survivorsReach', `${code}\nreturn (${call})`)(reach) } } catch { return { throws: true } }
}

/** Source literal for a primitive, or undefined when it has none. */
function literal(v: unknown): string | undefined {
  if (typeof v === 'number') return Object.is(v, -0) ? '-0' : String(v)
  if (typeof v === 'string') return JSON.stringify(v)
  if (typeof v === 'bigint') return `${v}n`
  if (typeof v === 'boolean' || v === null || v === undefined) return String(v)
  return undefined
}

function assertion(v: unknown, exactOnly: boolean): string | undefined {
  const lit = literal(v)
  if (lit !== undefined) return `toBe(${lit})`
  if (exactOnly || typeof v !== 'object') return undefined
  try {
    const json = JSON.stringify(v)
    return json !== undefined && equals(JSON.parse(json), v) ? `toEqual(${json})` : undefined
  } catch { return undefined }
}

function candidates(fn: Prepared, testsCode: string, mutant: Mutant): Candidate[] {
  const target = mutant.target!
  const sites = callSites(testsCode, fn.names)
  const out: Candidate[] = []
  if (target.kind === 'boundary') {
    // Call at exactly K, borrowing the other arguments from an existing call when there is one.
    const k = literal(target.value)!
    for (const base of [...sites.filter((s) => s.callee === target.fn).map((s) => s.args), []]) {
      const args = [...base]
      while (args.length <= target.param) args.push('undefined')
      args[target.param] = k
      const call = `${target.fn}(${args.join(', ')})`
      const r = evaluate(fn.code, call)
      if (!r.throws && !out.some((c) => c.call === call)) out.push({ call, value: r.value, title: `${target.fn} at the ${k} boundary` })
    }
  } else {
    // Reuse the inputs of an existing call that reaches this return statement.
    const probe = `${fn.code.slice(0, target.start)}(__survivorsReach(), ${fn.code.slice(target.start, target.end)})${fn.code.slice(target.end)}`
    for (const site of sites) {
      let reached = false
      const call = `${site.callee}(${site.args.join(', ')})`
      const r = evaluate(probe, call, () => { reached = true })
      if (reached && !r.throws && !out.some((c) => c.call === call)) out.push({ call, value: r.value, title: `${site.callee} returns exactly ${literal(r.value) ?? 'the original value'}` })
    }
  }
  return out
}

/**
 * Deterministically write one test that kills `mutant`: a boundary mutant on constant K is called at exactly K,
 * a returned numeric or boolean literal is asserted exactly with toBe using the inputs of a test that reaches it.
 * A test is only returned if it passes on the original code and fails on the mutant.
 */
export function generateKillingTest(fnSource: string, testsSource: string, mutant: Mutant): Generated {
  const fail: Generated = { ok: false, reason: cannotGenerate }
  if (!mutant.target) return fail
  let fn: Prepared
  let testsCode: string
  try { fn = prepare(fnSource); testsCode = prepare(testsSource).code } catch { return fail }
  for (const c of candidates(fn, testsCode, mutant)) {
    const matcher = assertion(c.value, mutant.target.kind === 'return')
    if (!matcher) continue
    const test = `test(${JSON.stringify(c.title)}, () => expect(${c.call}).${matcher});`
    const tests = `${testsSource.replace(/\s+$/, '')}\n${test}`
    if (!runTests(fnSource, tests).ok) continue
    if (runSuite(mutant.source, fn.names, prepare(tests).code).ok) continue
    return { ok: true, test, tests }
  }
  return fail
}
