'use client'

import dynamic from 'next/dynamic'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowUpRight, Check, Circle, Clock, Copy, Equal, GitPullRequest, FlaskConical, Link2, Play, ShieldAlert, Skull, Sparkles, Undo2 } from 'lucide-react'
import { motion, MotionConfig } from 'motion/react'
import { javascript } from '@codemirror/lang-javascript'
import { Decoration, EditorView, lineNumbers, gutter, GutterMarker, type BlockInfo, type Extension } from '@uiw/react-codemirror'
import { CountUp } from './count-up'
import { editorTheme } from './editor-theme'
import { HeroSpecimen, heroTotals } from './hero-specimen'
import { createBrowserRunner } from '@/lib/browser-runner'
import { fieldGuide, marquee } from '@/lib/catalogue'
import type { SyntaxProblem } from '@/lib/diagnostics'
import { changedLines, checkOriginal, noManual, planRun, scopedLines, scoreOf, testMutant, type Manual, type Mutant, type RunConfig, type Scope } from '@/lib/engine'
import { alsoKilled, catalogueNo, diffParts, progressLabel, resultsState, staleNote } from '@/lib/view'
import type { Runner } from '@/lib/runner'
import { clientPlatform, shortcutLabel } from '@/lib/platform'
import { heroDemo, specimens, type Specimen } from '@/lib/presets'
import { generateKillingTest } from '@/lib/killing'
import { buildPrComment } from '@/lib/report'
import { decodeShare, encodeShare } from '@/lib/share'

const Editor = dynamic(() => import('@uiw/react-codemirror').then((m) => m.default), { ssr: false })

class ScopeBar extends GutterMarker { toDOM() { const el = document.createElement('span'); el.className = 'scope-bar'; return el } }
const scopeBar = new ScopeBar()
const noSubscribe = () => () => {}
const named = (label: string) => EditorView.contentAttributes.of({ 'aria-label': `${label} editor` })
/** Highlight the line a syntax error points at. */
const errorLine = (line: number | null): Extension[] => line === null ? [] : [EditorView.decorations.of((view) => Decoration.set([Decoration.line({ class: 'cm-error-line' }).range(view.state.doc.line(Math.min(line, view.state.doc.lines)).from)]))]
/** Original line over mutant line, common indentation removed, changed token marked. */
function LineDiff({ m }: { m: Mutant }) {
  const { removed, added } = diffParts(m)
  const indent = Math.min(...[removed[0], added[0]].map((s) => s.length - s.trimStart().length))
  const row = (sign: '-' | '+', [pre, mid, post]: [string, string, string], kind: string) =>
    <code className={kind}><span className="sign" aria-hidden="true">{sign}</span>{pre.slice(indent)}<mark>{mid}</mark>{post}</code>
  return <pre className="line-diff" aria-label={`Line ${m.line}: “${removed.join('').trim()}” becomes “${added.join('').trim()}”`}>{row('-', removed, 'orig')}{row('+', added, 'mut')}</pre>
}
type RunScope ={ mode: Scope; before: string; manual: Manual; lines: number[]; totalLines: number; kept: number; total: number }

export default function Page() {
  const [specimen, setSpecimen] = useState(specimens[0]); const [fn, setFn] = useState(specimens[0].fn); const [tests, setTests] = useState(specimens[0].tests)
  const [scope, setScope] = useState<Scope>('whole'); const [before, setBefore] = useState(''); const [manual, setManual] = useState<Manual>(noManual)
  const [mutants, setMutants] = useState<Mutant[]>([]); const [killed, setKilled] = useState<number[]>([]); const [running, setRunning] = useState(false); const [error, setError] = useState(''); const [copied, setCopied] = useState(''); const [selected, setSelected] = useState<number | null>(null)
  const [runScope, setRunScope] = useState<RunScope | null>(null); const runToken = useRef(0)
  const [lastRun, setLastRun] = useState<RunConfig | null>(null); const [generated, setGenerated] = useState<string[]>([]); const [notes, setNotes] = useState<Record<string, string>>({})
  const [equivalent, setEquivalent] = useState<string[]>([])
  const [timedOut, setTimedOut] = useState<number[]>([]); const [generating, setGenerating] = useState<string | null>(null); const runnerRef = useRef<Runner | null>(null)
  const [problem, setProblem] = useState<SyntaxProblem | null>(null)
  // Survivors each generated test was written against, keyed by the mutant it targeted.
  const [killedBy, setKilledBy] = useState<Record<string, string[]>>({})
  const tally = scoreOf(mutants, killed, equivalent); const score = tally.score
  const results = resultsState({ hasResults: !!runScope, error: !!error, ranWith: lastRun, current: { fn, tests, scope, before, manual } })
  const stale = results === 'stale'
  const isEquivalent = (m: Mutant) => equivalent.includes(m.key)
  const survivors = mutants.filter((m) => !killed.includes(m.id) && !isEquivalent(m)); const marked = mutants.filter(isEquivalent)
  const totalLines = fn.split('\n').length
  const shortcut = useSyncExternalStore(noSubscribe, () => shortcutLabel(clientPlatform()), () => 'Ctrl ↵')
  const diffSet = useMemo(() => changedLines(before, fn), [before, fn])
  const scoped = useMemo(() => scopedLines(before, fn, manual), [before, fn, manual])
  const noScopedMutants = runScope?.mode === 'changed' && runScope.kept === 0

  // All test execution happens in the worker pool, so a mutant that never finishes can't freeze the page.
  const getRunner = () => (runnerRef.current ??= createBrowserRunner())
  useEffect(() => () => { runnerRef.current?.dispose(); runnerRef.current = null }, [])

  const clearResults = () => { setMutants([]); setKilled([]); setTimedOut([]); setRunScope(null); setLastRun(null) }
  const run = async (cfg: RunConfig = { fn, tests, scope, before, manual }) => {
    const token = ++runToken.current
    const runner = getRunner()
    runner.cancelPending()
    setError(''); setProblem(null); setSelected(null); setRunning(true)
    const original = await checkOriginal(runner, cfg.fn, cfg.tests)
    if (token !== runToken.current || (!original.ok && original.kind === 'cancelled')) return
    // Never leave an earlier run's results on screen under an error.
    if (!original.ok) { setRunning(false); clearResults(); setError(original.message); setProblem(original.kind === 'syntax' ? original.problem : null); return }
    setLastRun(cfg)
    const plan = planRun(cfg)
    const { mutants: next, lines, total } = plan
    setRunScope({ mode: cfg.scope, before: cfg.before, manual: cfg.manual, lines, totalLines: cfg.fn.split('\n').length, kept: next.length, total })
    setMutants(next); setKilled([]); setTimedOut([])
    await Promise.all(next.map(async (m) => {
      const r = await testMutant(runner, m, plan)
      if (token !== runToken.current) return
      if (r.killed) setKilled((old) => [...old, m.id])
      if (r.timedOut) setTimedOut((old) => [...old, m.id])
    }))
    if (token === runToken.current) setRunning(false)
  }
  useEffect(() => {
    const shared = location.hash.length > 1 ? decodeShare(location.hash.slice(1)) : null
    // Mount-only restore from the URL hash, which isn't available during SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (shared) { setFn(shared.fn); setTests(shared.tests); setScope(shared.scope); setBefore(shared.before); setManual(shared.manual); setEquivalent(shared.equivalent); run(shared) } else run()
  }, [])
  useEffect(() => { const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run() }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) })
  const selectSpecimen = (s: Specimen) => { runToken.current++; runnerRef.current?.cancelPending(); setTimedOut([]); setRunning(false); setSpecimen(s); setFn(s.fn); setTests(s.tests); setBefore(s.before ?? ''); setScope(s.scope ?? 'whole'); setManual(noManual); setMutants([]); setKilled([]); setRunScope(null); setError(''); setLastRun(null); setGenerated([]); setNotes({}); setEquivalent([]); setProblem(null); setKilledBy({}) }

  // In Changed lines mode, clicking a line number adds that line to the scope or removes it by hand.
  const scopeExtensions = useMemo<Extension[]>(() => {
    if (scope !== 'changed') return []
    const inScope = new Set(scoped)
    const toggle = (view: EditorView, block: BlockInfo) => {
      const n = view.state.doc.lineAt(block.from).number
      const without = (xs: number[]) => xs.filter((x) => x !== n)
      setManual((m) => inScope.has(n)
        ? { add: without(m.add), remove: diffSet.has(n) ? [...without(m.remove), n] : without(m.remove) }
        : { add: diffSet.has(n) ? without(m.add) : [...without(m.add), n], remove: without(m.remove) })
      return true
    }
    return [
      lineNumbers({ domEventHandlers: { mousedown: toggle } }),
      gutter({ class: 'cm-scope-gutter', lineMarker: (view, block) => (inScope.has(view.state.doc.lineAt(block.from).number) ? scopeBar : null), initialSpacer: () => scopeBar, domEventHandlers: { mousedown: toggle } }),
    ]
  }, [scope, scoped, diffSet])
  const fnErrorLine = problem?.editor === 'Function' ? problem.line : null
  const testsErrorLine = problem?.editor === 'Tests' ? problem.line : null
  const fnExtensions = useMemo(() => [javascript({ typescript: true }), EditorView.lineWrapping, named('Function'), ...scopeExtensions, ...errorLine(fnErrorLine)], [scopeExtensions, fnErrorLine])
  const testsExtensions = useMemo(() => [javascript({ typescript: true }), EditorView.lineWrapping, named('Tests'), ...errorLine(testsErrorLine)], [testsErrorLine])
  const beforeExtensions = useMemo(() => [javascript({ typescript: true }), EditorView.lineWrapping, named('Before (base version)')], [])

  // Write a test that kills this mutant, insert it only if it passes on the original and fails on the mutant, then rerun.
  const addKillingTest = async (m: Mutant) => {
    if (!lastRun || running || generating) return
    const note = (text: string) => setNotes((n) => ({ ...n, [m.key]: text }))
    if (lastRun.fn !== fn || lastRun.tests !== tests) return note('The code changed since this run. Run mutants again first.')
    setGenerating(m.key)
    const result = await generateKillingTest(getRunner(), lastRun.fn, lastRun.tests, m)
    setGenerating(null)
    if (!result.ok) return note(result.reason)
    setNotes((n) => Object.fromEntries(Object.entries(n).filter(([k]) => k !== m.key)))
    setKilledBy((k) => ({ ...k, [m.key]: survivors.map((x) => x.key) }))
    setGenerated((g) => [...g, m.key]); setTests(result.tests); run({ ...lastRun, tests: result.tests })
  }
  // Survivors, plus survivors that a generated test has since killed, so their cards visibly flip.
  const cards = mutants.filter((m) => !isEquivalent(m) && (!killed.includes(m.id) || generated.includes(m.key)))
  const toggleEquivalent = (m: Mutant) => setEquivalent((e) => (e.includes(m.key) ? e.filter((k) => k !== m.key) : [...e, m.key]))
  const scopeSummary = (r: RunScope) => `Mutating ${r.lines.length} of ${r.totalLines} lines · ${r.kept} of ${r.total} mutants`
  const copyLink = async () => { await navigator.clipboard.writeText(`${location.origin}${location.pathname}#${encodeShare({ fn, tests, scope, before, manual, equivalent })}`); setCopied('link'); setTimeout(() => setCopied(''), 1600) }
  const copyReport = async () => {
    const r = runScope
    const scopeText = !r || r.mode === 'whole' ? 'Scope: Whole function' : [
      'Scope: Changed lines',
      scopeSummary(r),
      `Scoped lines: ${r.lines.length ? r.lines.join(', ') : 'none'}`,
      `Manual selection: ${[...r.manual.add.map((n) => `+${n}`), ...r.manual.remove.map((n) => `-${n}`)].join(', ') || 'none'}`,
      r.before.trim() ? `Before:\n\`\`\`js\n${r.before}\n\`\`\`` : 'Before: (none, lines selected by hand)',
    ].join('\n')
    const scoreText = noScopedMutants ? 'No mutable code on the changed lines.' : `Mutation score${r?.mode === 'changed' ? ' (changed lines only)' : ''}: ${score}%${tally.equivalent ? ` (${tally.equivalent} marked equivalent)` : ''}`
    const text = `# Survivors report — ${specimen.name}\n\n${scopeText}\n\n${scoreText}\n\n${survivors.map((m) => `- ${m.operator}, line ${m.line}: ${m.before} → ${m.after}\n  ${m.hint}`).join('\n')}${marked.length ? `\n\nMarked equivalent:\n${marked.map((m) => `- ${m.operator}, line ${m.line}: ${m.before} → ${m.after}`).join('\n')}` : ''}`
    await navigator.clipboard.writeText(text); setCopied('report'); setTimeout(() => setCopied(''), 1600)
  }
  const copyPrComment = async () => {
    const r = runScope
    const text = buildPrComment({ name: specimen.name, tally: noScopedMutants ? null : tally, scope: !r || r.mode === 'whole' ? { mode: 'whole' } : { mode: 'changed', lines: r.lines, kept: r.kept, total: r.total }, survivors })
    await navigator.clipboard.writeText(text); setCopied('pr'); setTimeout(() => setCopied(''), 1600)
  }
  // The hero describes its own specimen (see HeroSpecimen); the lab below opens on Specimen 01.
  const meta = [['Function', heroTotals.name], ['Tests', heroTotals.tests], ['Mutants', heroTotals.mutants], ['Killed', heroTotals.killed], ['Survivors', heroTotals.survivors]]
  const changed = scope === 'changed'
  // reducedMotion="user": no layout animation for viewers who ask for reduced motion.
  return <MotionConfig reducedMotion="user"><a className="skip" href="#lab">Skip to content</a><header className="masthead"><a className="wordmark" href="#top">SURVIVORS<span>.</span></a><nav><a href="#lab">Lab</a><a href="#guide">Field Guide</a><a href="#about">About</a></nav><a className="button button-small" href="#lab">Run the lab <ArrowUpRight size={15}/></a></header>
    <main id="top"><section className="hero page-grid"><div className="hero-copy"><p className="eyebrow">Mutation testing / browser lab</p><h1>Your tests passed.{' '}<br/><em>Here&apos;s what they{' '}<br/>let live.</em></h1><p className="lede">Code coverage tells you what ran. Mutation testing tells you whether your tests would notice if it were wrong.</p></div><div className="hero-mark"><HeroSpecimen/></div></section>
      <section className="metadata page-grid" aria-label={`Sample run: Specimen ${heroDemo.specimen.id} at a glance`}><p className="sample-run field-label">Sample run · Specimen {heroDemo.specimen.id}</p>{meta.map(([label, value]) => <div className="meta-cell" key={label}><span className="field-label">{label}</span><strong>{value}</strong></div>)}</section>
      <section className="marquee" aria-label="Mutation operators"><div>{marquee.map((m) => `${m.label}　`).join('')}</div></section>
      <section className="lab section-shell" id="lab"><div className="section-heading"><div><p className="eyebrow">No. 01 / Workbench</p><h2>Run the lab.</h2></div><p className="section-note">Write the code. Write the test.{' '}<br/>We&apos;ll introduce the wrongness.</p></div>
        <div className="specimen-picker"><span className="field-label">Specimen</span>{specimens.map((s) => <button key={s.id} className={specimen.id === s.id ? 'active' : ''} onClick={() => selectSpecimen(s)}><span>{s.id}</span>{s.name}</button>)}</div>
        <div className="scope-switch" role="radiogroup" aria-label="Mutation scope"><span className="field-label">Scope</span>
          {([['whole', 'Whole function'], ['changed', 'Changed lines']] as const).map(([value, label]) => <button key={value} role="radio" aria-checked={scope === value} className={scope === value ? 'active' : ''} onClick={() => setScope(value)}>{label}</button>)}
          {changed && <span className="scope-hint">{scoped.length} of {totalLines} lines in scope · click line numbers to add or remove</span>}
        </div>
        <div className={`editors ${changed ? 'with-before' : ''}`}>
          {changed && <div className="editor-wrap"><div className="editor-label"><span>Before</span><span>Optional · base version</span></div><Editor value={before} onChange={setBefore} extensions={beforeExtensions} theme={editorTheme} basicSetup={{ lineNumbers: true }} placeholder="Paste the pre-PR version, or click line numbers in the Function editor to scope by hand." /></div>}
          <div className={`editor-wrap ${changed ? 'scoping' : ''}`}><div className="editor-label"><span>Function</span><span>{changed ? 'After · JS / TS' : 'JS / TS'}</span></div><Editor value={fn} onChange={setFn} extensions={fnExtensions} theme={editorTheme} basicSetup={{ lineNumbers: !changed }} /></div>
          <div className="editor-wrap tests-wrap"><div className="editor-label"><span>Tests</span><span>describe / it / expect</span></div><Editor value={tests} onChange={setTests} extensions={testsExtensions} theme={editorTheme} basicSetup={{ lineNumbers: true }} /></div>
        </div>
        <div className="run-row"><button className="button" onClick={() => run()} disabled={running}><Play size={16} fill="currentColor"/>{running ? 'Running mutants…' : 'Run mutants'}<kbd>{shortcut}</kbd></button><span className="run-note">Runs locally. Nothing leaves this browser.</span></div>
        {error && <div className="error" role="alert"><ShieldAlert size={18}/>{error}</div>}
        {(results === 'fresh' || stale) && (mutants.length > 0 || noScopedMutants) && runScope && <div className={`results ${stale ? 'is-stale' : ''}`}>
          {stale && <p className="stale-note" role="status">{staleNote}</p>}
          {runScope.mode === 'changed' && <p className="scope-summary">{scopeSummary(runScope)}</p>}
          {noScopedMutants ? <div className="score score-empty"><span className="field-label">Mutation score · changed lines only</span><p>No mutable code on the changed lines.</p></div> : <>
            <div className="progress-line"><span>{running ? 'Testing specimens…' : 'Run complete'}</span><span>{progressLabel(tally)}</span></div><div className="mutant-grid" role="list" aria-label="Mutant results">{mutants.map((m) => { const state = timedOut.includes(m.id) ? 'Killed (timeout)' : killed.includes(m.id) ? 'Killed' : isEquivalent(m) ? 'Equivalent' : !running ? 'Survived' : 'Pending'; const label = `${state}: ${m.operator}, line ${m.line}`; return <div key={m.id} role="listitem" aria-label={label} title={label} className={`mutant-cell ${state === 'Killed (timeout)' ? 'killed timeout' : state.toLowerCase()}`}>{state === 'Killed (timeout)' ? <Clock size={13} aria-hidden="true"/> : state === 'Killed' ? <Check size={14} aria-hidden="true"/> : state === 'Survived' ? <Circle size={10} fill="currentColor" aria-hidden="true"/> : state === 'Equivalent' ? <Equal size={12} aria-hidden="true"/> : null}</div> })}</div>
            <div className="grid-legend" aria-hidden="true"><span><i className="legend-swatch killed"><Check size={10}/></i>Killed</span><span><i className="legend-swatch killed"><Clock size={9}/></i>Killed (timeout)</span><span><i className="legend-swatch survived"><Circle size={7} fill="currentColor"/></i>Survived</span><span><i className="legend-swatch equivalent"><Equal size={9}/></i>Equivalent</span><span><i className="legend-swatch"/>Pending</span></div>
            <div className="score"><span className="field-label">Mutation score{runScope.mode === 'changed' ? ' · changed lines only' : ''}</span><strong className="score-value"><span className="sr-only">{score}%</span><CountUp value={score}/><small aria-hidden="true">%</small></strong><div className="score-meta">{tally.equivalent > 0 && <em>({tally.equivalent} marked equivalent)</em>}<span>{score === 100 ? 'No survivors. Your tests are doing their job.' : 'The survivors are the gaps.'}</span></div></div>
          </>}
        </div>}
      </section>
      <section className="report section-shell" id="report"><div className="section-heading"><div><p className="eyebrow">No. 02 / Findings</p><h2>Survivors report.</h2></div><div className="report-actions"><button className="text-button" onClick={copyLink}><Link2 size={15}/>{copied === 'link' ? 'Copied' : 'Copy link'}</button><button className="text-button" onClick={copyReport}><Copy size={15}/>{copied === 'report' ? 'Copied' : 'Copy report'}</button><button className="text-button" onClick={copyPrComment}><GitPullRequest size={15}/>{copied === 'pr' ? 'Copied' : 'Copy as PR comment'}</button></div></div>{stale && cards.length + marked.length > 0 && <p className="stale-note" role="status">{staleNote}</p>}<div className={stale ? 'is-stale' : undefined}>{cards.length === 0 ? <div className="empty"><Sparkles size={20}/><p>{error ? 'Fix the error above, then run again.' : noScopedMutants ? 'No mutable code on the changed lines.' : mutants.length ? 'All mutants killed. Excellent work.' : 'Run the lab to reveal what survived.'}</p></div> : <div className="survivor-list">{cards.map((m) => { const dead = killed.includes(m.id); return <motion.article layout key={m.key} className={`survivor-card ${selected === m.id ? 'selected' : ''} ${dead ? 'is-killed' : ''}`} onClick={() => setSelected(m.id)}>
          <div className="card-top"><span className="catalogue-no">{catalogueNo(m)}</span>{dead ? <span className="killed-label"><Check size={14}/> KILLED</span> : <span className="survived-label"><Skull size={14}/> SURVIVED</span>}</div>
          <div className="card-main"><h3>{m.operator}</h3><p>Line {m.line} · {m.hint}</p></div>
          <LineDiff m={m}/>
          <div className="card-actions">{dead ? <span className="card-note">Killed by the generated test.</span> : <button className="text-button" disabled={running || stale || !!generating} onClick={(e) => { e.stopPropagation(); addKillingTest(m) }}><FlaskConical size={13}/>{generating === m.key ? 'Writing test…' : 'Add killing test'}</button>}{!dead && <button className="text-button" onClick={(e) => { e.stopPropagation(); toggleEquivalent(m) }}><Equal size={13}/>Mark as equivalent</button>}</div>
          {dead && !running && killedBy[m.key] && (() => { const others = alsoKilled(killedBy[m.key], m.key, mutants, killed); return others.length > 0 && <p className="card-note">Also killed: {others.map(catalogueNo).join(', ')}</p> })()}
          {notes[m.key] && <p className="card-note" role="status">{notes[m.key]}</p>}
        </motion.article> })}</div>}
        {marked.length > 0 && <div className="equivalent-list"><p className="field-label">Marked equivalent · excluded from the score</p><ul>{marked.map((m) => <li key={m.key}><span className="catalogue-no">{catalogueNo(m)}</span><span>{m.operator}, line {m.line}</span><code>{m.before.trim()} → {m.after.trim()}</code><button className="text-button" onClick={() => toggleEquivalent(m)}><Undo2 size={13}/>Unmark</button></li>)}</ul></div>}</div></section>
      <section className="guide section-shell" id="guide"><div className="section-heading"><div><p className="eyebrow">No. 03 / Reference</p><h2>Field guide.</h2></div><p className="section-note">Small changes. Meaningful pressure.{' '}<br/>The complete catalogue of operators.</p></div><div className="guide-grid">{fieldGuide.map((g, i) => <article className="guide-card" key={g.operator}><span className="catalogue-no">0{i + 1}</span><h3>{g.operator}</h3><div className="guide-diff"><code>{g.before}</code><span>→</span><code>{g.after}</code></div><p>{g.note}</p></article>)}</div><p className="guide-note">Scope runs to changed lines in review; run the whole function when you&apos;re auditing a test suite.</p></section>
      <section className="about section-shell page-grid" id="about"><div><p className="eyebrow">About the project</p><h2>A small instrument{' '}<br/><em>for serious tests.</em></h2></div><div className="about-copy"><p>Made by <strong>Suraj Pawar</strong>, a software engineer in Pune. At Handshake AI I author agentic coding benchmarks and build mutation-testing gates that check whether a benchmark&apos;s tests actually catch broken solutions.</p><p>Survivors is a small public version of that idea.</p><div className="links"><a href="https://github.com/Surajp1602" target="_blank" rel="noreferrer">GitHub <ArrowUpRight size={14}/></a><a href="https://www.linkedin.com/in/surajpawar0216" target="_blank" rel="noreferrer">LinkedIn <ArrowUpRight size={14}/></a></div></div></section>
    </main><footer><span>SURVIVORS<span className="red">.</span></span><span>Runs entirely in your browser. No code is uploaded.</span><span className="footer-links"><a href="https://github.com/Surajp1602" target="_blank" rel="noreferrer">GitHub</a><a href="https://www.linkedin.com/in/surajpawar0216" target="_blank" rel="noreferrer">LinkedIn</a><span>© 2026 Suraj Pawar</span></span></footer></MotionConfig>
}
