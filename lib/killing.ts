import { parse, tokenizer } from 'acorn'
import { simple } from 'acorn-walk'
import { runTests, type Mutant } from './engine'
import { equals } from './harness'
import type { Runner } from './runner'
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

export type Quote = "'" | '"'

/** The quote most string literals in the tests already use; single quotes when there are none or it's a tie. */
export function quoteStyle(testsSource: string): Quote {
  let single = 0
  let double = 0
  try {
    for (const token of tokenizer(testsSource, { ecmaVersion: 'latest' })) {
      if (token.type.label !== 'string') continue
      if (testsSource[token.start] === "'") single++
      else double++
    }
  } catch {
    // TypeScript syntax the tokenizer rejects: fall back to counting quote characters.
    single = (testsSource.match(/'/g) ?? []).length
    double = (testsSource.match(/"/g) ?? []).length
  }
  return double > single ? '"' : "'"
}

export function quoteString(s: string, q: Quote): string {
  const json = JSON.stringify(s)
  return q === '"' ? json : `'${json.slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'")}'`
}

/** Source literal for a primitive, or undefined when it has none. */
function literal(v: unknown, q: Quote): string | undefined {
  if (typeof v === 'number') return Object.is(v, -0) ? '-0' : String(v)
  if (typeof v === 'string') return quoteString(v, q)
  if (typeof v === 'bigint') return `${v}n`
  if (typeof v === 'boolean' || v === null || v === undefined) return String(v)
  return undefined
}

/** JavaScript source for a JSON-safe value, using the tests' quote style for strings and keys. */
function source(v: unknown, q: Quote): string {
  if (Array.isArray(v)) return `[${v.map((x) => source(x, q)).join(', ')}]`
  if (v && typeof v === 'object') {
    const entries = Object.entries(v).map(([k, x]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : quoteString(k, q)}: ${source(x, q)}`)
    return entries.length ? `{ ${entries.join(', ')} }` : '{}'
  }
  return literal(v, q)!
}

function assertion(v: unknown, exactOnly: boolean, q: Quote): string | undefined {
  const lit = literal(v, q)
  if (lit !== undefined) return `toBe(${lit})`
  if (exactOnly || typeof v !== 'object') return undefined
  try {
    const json = JSON.stringify(v)
    return json !== undefined && equals(JSON.parse(json), v) ? `toEqual(${source(JSON.parse(json), q)})` : undefined
  } catch { return undefined }
}

/** Inputs and expected values. Every call is evaluated in the runner's workers, so a hanging call times out. */
async function candidates(runner: Runner, fn: Prepared, testsCode: string, mutant: Mutant): Promise<Candidate[]> {
  const target = mutant.target!
  const sites = callSites(testsCode, fn.names)
  const out: Candidate[] = []
  if (target.kind === 'boundary') {
    // Call at exactly K, borrowing the other arguments from an existing call when there is one.
    const k = literal(target.value, "'")!
    for (const base of [...sites.filter((s) => s.callee === target.fn).map((s) => s.args), []]) {
      const args = [...base]
      while (args.length <= target.param) args.push('undefined')
      args[target.param] = k
      const call = `${target.fn}(${args.join(', ')})`
      if (out.some((c) => c.call === call)) continue
      const r = await runner.evaluate(fn.code, call)
      if (!r.throws && !r.uncloneable) out.push({ call, value: r.value, title: `${target.fn} at the ${k} boundary` })
    }
  } else {
    // Reuse the inputs of an existing call that reaches this return statement.
    const probe = `${fn.code.slice(0, target.start)}(__survivorsReach(), ${fn.code.slice(target.start, target.end)})${fn.code.slice(target.end)}`
    for (const site of sites) {
      const call = `${site.callee}(${site.args.join(', ')})`
      if (out.some((c) => c.call === call)) continue
      const r = await runner.evaluate(probe, call)
      if (r.reached && !r.throws && !r.uncloneable) out.push({ call, value: r.value, title: `${site.callee} returns exactly ${literal(r.value, '"') ?? 'the original value'}` })
    }
  }
  return out
}

/**
 * Deterministically write one test that kills `mutant`: a boundary mutant on constant K is called at exactly K,
 * a returned numeric or boolean literal is asserted exactly with toBe using the inputs of a test that reaches it.
 * A test is only returned if it passes on the original code and fails on the mutant.
 */
export async function generateKillingTest(runner: Runner, fnSource: string, testsSource: string, mutant: Mutant): Promise<Generated> {
  const fail: Generated = { ok: false, reason: cannotGenerate }
  if (!mutant.target) return fail
  let fn: Prepared
  let testsCode: string
  try { fn = prepare(fnSource); testsCode = prepare(testsSource).code } catch { return fail }
  const quote = quoteStyle(testsSource)
  for (const c of await candidates(runner, fn, testsCode, mutant)) {
    const matcher = assertion(c.value, mutant.target.kind === 'return', quote)
    if (!matcher) continue
    const test = `test(${quoteString(c.title, quote)}, () => expect(${c.call}).${matcher});`
    const tests = `${testsSource.replace(/\s+$/, '')}\n${test}`
    const onOriginal = await runTests(runner, fnSource, tests)
    if (!onOriginal.ok) continue
    const onMutant = await runner.suite(mutant.source, fn.names, prepare(tests).code)
    if (onMutant.ok || onMutant.cancelled) continue
    return { ok: true, test, tests }
  }
  return fail
}
