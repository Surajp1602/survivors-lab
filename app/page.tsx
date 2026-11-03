'use client'

import dynamic from 'next/dynamic'
import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, Check, Copy, FlaskConical, Link2, Play, ShieldAlert, Skull, Sparkles, X } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { parse } from 'acorn'
import { simple } from 'acorn-walk'
import { javascript } from '@codemirror/lang-javascript'

const Editor = dynamic(() => import('@uiw/react-codemirror').then((m) => m.default), { ssr: false })

type Specimen = { id: string; name: string; fn: string; tests: string }
const specimens: Specimen[] = [
  { id: '01', name: 'isAdult', fn: 'function isAdult(age) {\n  return age >= 18;\n}', tests: "test('adult', () => expect(isAdult(30)).toBe(true));\ntest('minor', () => expect(isAdult(5)).toBe(false));" },
  { id: '02', name: 'isLeapYear', fn: 'function isLeapYear(y) {\n  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;\n}', tests: "test('leap year', () => expect(isLeapYear(2024)).toBe(true));\ntest('common year', () => expect(isLeapYear(2023)).toBe(false));" },
  { id: '03', name: 'applyDiscount', fn: 'function applyDiscount(price, pct) {\n  if (pct > 100) throw new Error(\"bad pct\");\n  return price - (price * pct) / 100;\n}', tests: "test('discount', () => expect(applyDiscount(200, 10)).toBe(180));\ntest('invalid pct', () => expect(() => applyDiscount(200, 150)).toThrow());" },
]

type Mutant = { id: number; operator: string; line: number; before: string; after: string; hint: string; source: string }
const operatorHints: Record<string, string> = { 'relational boundary': 'Add a test at exactly the boundary value.', arithmetic: 'Test the operation with a value that makes the result change.', equality: 'Test both equal and unequal values explicitly.', logical: 'Add a case where only one side of the condition is true.', 'boolean literal': 'Test the opposite boolean branch.', 'numeric literal': 'Test the exact threshold and its neighbor.', 'negated condition': 'Test the condition in both directions.', 'string literal': 'Assert the exact error or output string.' }

function createMutants(source: string): Mutant[] {
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

function runTests(fnSource: string, testsSource: string): { ok: boolean; message?: string } {
  try {
    const fn = new Function(`${fnSource}\nreturn {${((fnSource.match(/function\s+(\w+)/) || [])[1] || '')}}`)()
    const test = (name: string, cb: () => void) => { try { cb() } catch (e: any) { throw new Error(`${name}: ${e.message}`) } }
    const deep = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b)
    const expect = (value: any) => ({ toBe: (x: any) => { if (value !== x) throw new Error(`expected ${String(x)}, received ${String(value)}`) }, toEqual: (x: any) => { if (!deep(value, x)) throw new Error('values are not equal') }, toThrow: () => { if (typeof value !== 'function') throw new Error('expected a function'); let threw = false; try { value() } catch { threw = true } if (!threw) throw new Error('expected function to throw') }, toBeTruthy: () => { if (!value) throw new Error('expected truthy value') }, toBeFalsy: () => { if (value) throw new Error('expected falsy value') } })
    new Function(...Object.keys(fn), 'test', 'expect', testsSource)(...Object.values(fn), test, expect)
    return { ok: true }
  } catch (e: any) { return { ok: false, message: e.message || 'Unknown failure' } }
}

export default function Page() {
  const [specimen, setSpecimen] = useState(specimens[0]); const [fn, setFn] = useState(specimens[0].fn); const [tests, setTests] = useState(specimens[0].tests)
  const [mutants, setMutants] = useState<Mutant[]>([]); const [killed, setKilled] = useState<number[]>([]); const [running, setRunning] = useState(false); const [error, setError] = useState(''); const [copied, setCopied] = useState(''); const [selected, setSelected] = useState<number | null>(null)
  const score = mutants.length ? Math.round((killed.length / mutants.length) * 100) : 0; const survivors = mutants.filter((m) => !killed.includes(m.id))
  useEffect(() => { const hash = location.hash.slice(1); if (hash) try { const d = JSON.parse(decodeURIComponent(atob(hash))); setFn(d.fn); setTests(d.tests) } catch {} }, [])
  const run = async () => { setError(''); const original = runTests(fn, tests); if (!original.ok) { setError(`Your tests fail on the original code — fix them before hunting mutants. ${original.message}`); return } const next = createMutants(fn); setMutants(next); setKilled([]); setRunning(true); for (const m of next) { await new Promise((r) => setTimeout(r, 110)); const result = runTests(m.source, tests); if (!result.ok) setKilled((old) => [...old, m.id]) } setRunning(false) }
  useEffect(() => { run() }, [])
  useEffect(() => { const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run() }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) })
  useEffect(() => { setFn(specimen.fn); setTests(specimen.tests); setMutants([]); setKilled([]); setError('') }, [specimen])
  const copyLink = async () => { const hash = btoa(JSON.stringify({ fn, tests })); await navigator.clipboard.writeText(`${location.origin}${location.pathname}#${encodeURIComponent(hash)}`); setCopied('link'); setTimeout(() => setCopied(''), 1600) }
  const copyReport = async () => { const text = `# Survivors report — ${specimen.name}\n\nMutation score: ${score}%\n\n${survivors.map((m) => `- ${m.operator}, line ${m.line}: ${m.before} → ${m.after}\n  ${m.hint}`).join('\n')}`; await navigator.clipboard.writeText(text); setCopied('report'); setTimeout(() => setCopied(''), 1600) }
  const meta = [['Function', specimen.name], ['Tests', tests.split('\n').filter(Boolean).length], ['Mutants', mutants.length || '—'], ['Killed', killed.length || '—'], ['Survivors', mutants.length ? survivors.length : '—']]
  return <><a className="skip" href="#lab">Skip to content</a><header className="masthead"><a className="wordmark" href="#top">SURVIVORS<span>.</span></a><nav><a href="#lab">Lab</a><a href="#guide">Field Guide</a><a href="#about">About</a></nav><a className="button button-small" href="#lab">Run the lab <ArrowUpRight size={15}/></a></header>
    <main id="top"><section className="hero page-grid"><div className="hero-copy"><p className="eyebrow">Mutation testing / browser lab</p><h1>Your tests passed.<br/><em>Here&apos;s what they let live.</em></h1><p className="lede">Code coverage tells you what ran. Mutation testing tells you whether your tests would notice if it were wrong.</p></div><div className="hero-mark" aria-hidden="true"><FlaskConical size={56} strokeWidth={1}/><span>LAB<br/>01—03</span></div></section>
      <section className="metadata page-grid" aria-label="Specimen metadata">{meta.map(([label, value]) => <div className="meta-cell" key={label}><span className="field-label">{label}</span><strong>{value}</strong></div>)}</section>
      <section className="marquee" aria-label="Mutation operators"><div>{'>= → >'}　{'&& → ||'}　{'true → false'}　{'n → n + 1'}　{'=== → !=='}　{'∅ → ""'}　</div></section>
      <section className="lab section-shell" id="lab"><div className="section-heading"><div><p className="eyebrow">No. 01 / Workbench</p><h2>Run the lab.</h2></div><p className="section-note">Write the code. Write the test.<br/>We&apos;ll introduce the wrongness.</p></div><div className="specimen-picker"><span className="field-label">Specimen</span>{specimens.map((s) => <button key={s.id} className={specimen.id === s.id ? 'active' : ''} onClick={() => setSpecimen(s)}><span>{s.id}</span>{s.name}</button>)}</div><div className="editors"><div className="editor-wrap"><div className="editor-label"><span>Function</span><span>JavaScript</span></div><Editor value={fn} onChange={setFn} extensions={[javascript()]} theme="dark" basicSetup={{ lineNumbers: true }} /></div><div className="editor-wrap"><div className="editor-label"><span>Tests</span><span>test / expect</span></div><Editor value={tests} onChange={setTests} extensions={[javascript()]} theme="dark" basicSetup={{ lineNumbers: true }} /></div></div><div className="run-row"><button className="button" onClick={run} disabled={running}><Play size={16} fill="currentColor"/>{running ? 'Running mutants…' : 'Run mutants'}<kbd>⌘ ↵</kbd></button><span className="run-note">Runs locally. Nothing leaves this browser.</span></div>{error && <div className="error" role="alert"><ShieldAlert size={18}/>{error}</div>}{mutants.length > 0 && <div className="results"><div className="progress-line"><span>{running ? 'Testing specimens…' : 'Run complete'}</span><span>{killed.length} / {mutants.length} killed</span></div><div className="mutant-grid" aria-label="Mutant results">{mutants.map((m) => <div key={m.id} className={`mutant-cell ${killed.includes(m.id) ? 'killed' : !running ? 'survived' : ''}`} title={`${m.operator}, line ${m.line}`}>{killed.includes(m.id) ? <Check size={14}/> : !running ? <X size={14}/> : <span/>}</div>)}</div><div className="score"><span className="field-label">Mutation score</span><strong>{score}<small>%</small></strong><span>{score === 100 ? 'No survivors. Your tests are doing their job.' : 'The survivors are the gaps.'}</span></div></div>}</section>
      <section className="report section-shell" id="report"><div className="section-heading"><div><p className="eyebrow">No. 02 / Findings</p><h2>Survivors report.</h2></div><div className="report-actions"><button className="text-button" onClick={copyLink}><Link2 size={15}/>{copied === 'link' ? 'Copied' : 'Copy link'}</button><button className="text-button" onClick={copyReport}><Copy size={15}/>{copied === 'report' ? 'Copied' : 'Copy report'}</button></div></div>{survivors.length === 0 ? <div className="empty"><Sparkles size={20}/><p>{mutants.length ? 'All mutants killed. Excellent work.' : 'Run the lab to reveal what survived.'}</p></div> : <div className="survivor-list">{survivors.map((m) => <motion.button layout key={m.id} className={`survivor-card ${selected === m.id ? 'selected' : ''}`} onClick={() => setSelected(m.id)}><div className="card-top"><span className="catalogue-no">MUT-{String(m.id + 1).padStart(2, '0')}</span><span className="survived-label"><Skull size={14}/> SURVIVED</span></div><div className="card-main"><div><h3>{m.operator}</h3><p>Line {m.line} · {m.hint}</p></div><div className="diff"><span>{m.before}</span><b>→</b><strong>{m.after}</strong></div></div></motion.button>)}</div>}</section>
      <section className="guide section-shell" id="guide"><div className="section-heading"><div><p className="eyebrow">No. 03 / Reference</p><h2>Field guide.</h2></div><p className="section-note">Small changes. Meaningful pressure.<br/>The complete catalogue of operators.</p></div><div className="guide-grid">{[['relational boundary','age > 18','age >= 18','Off-by-one conditions.'],['arithmetic','price + tax','price - tax','Incorrect calculations.'],['equality','value === 0','value !== 0','Unexpected equality.'],['logical','a && b','a || b','Missing branches.'],['boolean literal','return true','return false','Inverted defaults.'],['numeric literal','limit = 3','limit = 4','Wrong constants.'],['negated condition','if (valid)','if (!(valid))','Reversed control flow.'],['string literal','"bad pct"','""','Unasserted messages.']].map((g, i) => <article className="guide-card" key={g[0]}><span className="catalogue-no">0{i + 1}</span><h3>{g[0]}</h3><div className="guide-diff"><code>{g[1]}</code><span>→</span><code>{g[2]}</code></div><p>{g[3]}</p></article>)}</div></section>
      <section className="about section-shell page-grid" id="about"><div><p className="eyebrow">About the project</p><h2>A small instrument<br/><em>for serious tests.</em></h2></div><div className="about-copy"><p>Made by <strong>Suraj Pawar</strong>, a software engineer in Pune. At Handshake AI I author agentic coding benchmarks and build mutation-testing gates that check whether a benchmark&apos;s tests actually catch broken solutions.</p><p>Survivors is a small public version of that idea.</p><div className="links"><a href="https://github.com/Surajp1602">GitHub <ArrowUpRight size={14}/></a><a href="#about">LinkedIn <ArrowUpRight size={14}/></a></div></div></section>
    </main><footer><span>SURVIVORS<span className="red">.</span></span><span>Runs entirely in your browser. No code is uploaded.</span><span className="footer-links"><a href="https://github.com/Surajp1602" target="_blank" rel="noreferrer">GitHub</a><a href="https://www.linkedin.com/in/surajpawar0216" target="_blank" rel="noreferrer">LinkedIn</a><span>© 2026 Suraj Pawar</span></span></footer></>
}
