'use client'

import dynamic from 'next/dynamic'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowUpRight, Check, Circle, Copy, FlaskConical, Link2, Play, ShieldAlert, Skull, Sparkles } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { javascript } from '@codemirror/lang-javascript'
import { lineNumbers, gutter, GutterMarker, type EditorView, type BlockInfo, type Extension } from '@uiw/react-codemirror'
import { changedLines, isKilled, noManual, planRun, runTests, scopedLines, type Manual, type Mutant, type RunConfig, type Scope } from '@/lib/engine'
import { clientPlatform, shortcutLabel } from '@/lib/platform'
import { specimens, type Specimen } from '@/lib/presets'
import { decodeShare, encodeShare } from '@/lib/share'

const Editor = dynamic(() => import('@uiw/react-codemirror').then((m) => m.default), { ssr: false })

class ScopeBar extends GutterMarker { toDOM() { const el = document.createElement('span'); el.className = 'scope-bar'; return el } }
const scopeBar = new ScopeBar()
const noSubscribe = () => () => {}
type RunScope = { mode: Scope; before: string; manual: Manual; lines: number[]; totalLines: number; kept: number; total: number }

export default function Page() {
  const [specimen, setSpecimen] = useState(specimens[0]); const [fn, setFn] = useState(specimens[0].fn); const [tests, setTests] = useState(specimens[0].tests)
  const [scope, setScope] = useState<Scope>('whole'); const [before, setBefore] = useState(''); const [manual, setManual] = useState<Manual>(noManual)
  const [mutants, setMutants] = useState<Mutant[]>([]); const [killed, setKilled] = useState<number[]>([]); const [running, setRunning] = useState(false); const [error, setError] = useState(''); const [copied, setCopied] = useState(''); const [selected, setSelected] = useState<number | null>(null)
  const [runScope, setRunScope] = useState<RunScope | null>(null); const runToken = useRef(0)
  const score = mutants.length ? Math.round((killed.length / mutants.length) * 100) : 0; const survivors = mutants.filter((m) => !killed.includes(m.id))
  const totalLines = fn.split('\n').length
  const shortcut = useSyncExternalStore(noSubscribe, () => shortcutLabel(clientPlatform()), () => 'Ctrl ↵')
  const diffSet = useMemo(() => changedLines(before, fn), [before, fn])
  const scoped = useMemo(() => scopedLines(before, fn, manual), [before, fn, manual])
  const noScopedMutants = runScope?.mode === 'changed' && runScope.kept === 0

  const run = async (cfg: RunConfig = { fn, tests, scope, before, manual }) => {
    const token = ++runToken.current
    setError(''); setSelected(null)
    const original = runTests(cfg.fn, cfg.tests)
    if (!original.ok) { setRunning(false); setError(`Your tests fail on the original code — fix them before hunting mutants. ${original.message}`); return }
    const plan = planRun(cfg)
    const { mutants: next, lines, total } = plan
    setRunScope({ mode: cfg.scope, before: cfg.before, manual: cfg.manual, lines, totalLines: cfg.fn.split('\n').length, kept: next.length, total })
    setMutants(next); setKilled([]); setRunning(true)
    for (const m of next) {
      await new Promise((r) => setTimeout(r, 110))
      if (token !== runToken.current) return
      if (isKilled(m, plan)) setKilled((old) => [...old, m.id])
    }
    setRunning(false)
  }
  useEffect(() => {
    const shared = location.hash.length > 1 ? decodeShare(location.hash.slice(1)) : null
    // Mount-only restore from the URL hash, which isn't available during SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (shared) { setFn(shared.fn); setTests(shared.tests); setScope(shared.scope); setBefore(shared.before); setManual(shared.manual); run(shared) } else run()
  }, [])
  useEffect(() => { const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run() }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) })
  const selectSpecimen = (s: Specimen) => { runToken.current++; setRunning(false); setSpecimen(s); setFn(s.fn); setTests(s.tests); setBefore(s.before ?? ''); setScope(s.scope ?? 'whole'); setManual(noManual); setMutants([]); setKilled([]); setRunScope(null); setError('') }

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
  const fnExtensions = useMemo(() => [javascript({ typescript: true }), ...scopeExtensions], [scopeExtensions])
  const jsExtensions = useMemo(() => [javascript({ typescript: true })], [])

  const scopeSummary = (r: RunScope) => `Mutating ${r.lines.length} of ${r.totalLines} lines · ${r.kept} of ${r.total} mutants`
  const copyLink = async () => { await navigator.clipboard.writeText(`${location.origin}${location.pathname}#${encodeShare({ fn, tests, scope, before, manual })}`); setCopied('link'); setTimeout(() => setCopied(''), 1600) }
  const copyReport = async () => {
    const r = runScope
    const scopeText = !r || r.mode === 'whole' ? 'Scope: Whole function' : [
      'Scope: Changed lines',
      scopeSummary(r),
      `Scoped lines: ${r.lines.length ? r.lines.join(', ') : 'none'}`,
      `Manual selection: ${[...r.manual.add.map((n) => `+${n}`), ...r.manual.remove.map((n) => `-${n}`)].join(', ') || 'none'}`,
      r.before.trim() ? `Before:\n\`\`\`js\n${r.before}\n\`\`\`` : 'Before: (none, lines selected by hand)',
    ].join('\n')
    const scoreText = noScopedMutants ? 'No mutable code on the changed lines.' : `Mutation score${r?.mode === 'changed' ? ' (changed lines only)' : ''}: ${score}%`
    const text = `# Survivors report — ${specimen.name}\n\n${scopeText}\n\n${scoreText}\n\n${survivors.map((m) => `- ${m.operator}, line ${m.line}: ${m.before} → ${m.after}\n  ${m.hint}`).join('\n')}`
    await navigator.clipboard.writeText(text); setCopied('report'); setTimeout(() => setCopied(''), 1600)
  }
  const meta = [['Function', specimen.name], ['Tests', tests.split('\n').filter(Boolean).length], ['Mutants', runScope ? mutants.length : '—'], ['Killed', runScope ? killed.length : '—'], ['Survivors', runScope ? survivors.length : '—']]
  const changed = scope === 'changed'
  return <><a className="skip" href="#lab">Skip to content</a><header className="masthead"><a className="wordmark" href="#top">SURVIVORS<span>.</span></a><nav><a href="#lab">Lab</a><a href="#guide">Field Guide</a><a href="#about">About</a></nav><a className="button button-small" href="#lab">Run the lab <ArrowUpRight size={15}/></a></header>
    <main id="top"><section className="hero page-grid"><div className="hero-copy"><p className="eyebrow">Mutation testing / browser lab</p><h1>Your tests passed.<br/><em>Here&apos;s what they let live.</em></h1><p className="lede">Code coverage tells you what ran. Mutation testing tells you whether your tests would notice if it were wrong.</p></div><div className="hero-mark" aria-hidden="true"><FlaskConical size={56} strokeWidth={1}/><span>LAB<br/>01—04</span></div></section>
      <section className="metadata page-grid" aria-label="Specimen metadata">{meta.map(([label, value]) => <div className="meta-cell" key={label}><span className="field-label">{label}</span><strong>{value}</strong></div>)}</section>
      <section className="marquee" aria-label="Mutation operators"><div>{'>= → >'}　{'&& → ||'}　{'true → false'}　{'n → n + 1'}　{'=== → !=='}　{'∅ → ""'}　</div></section>
      <section className="lab section-shell" id="lab"><div className="section-heading"><div><p className="eyebrow">No. 01 / Workbench</p><h2>Run the lab.</h2></div><p className="section-note">Write the code. Write the test.<br/>We&apos;ll introduce the wrongness.</p></div>
        <div className="specimen-picker"><span className="field-label">Specimen</span>{specimens.map((s) => <button key={s.id} className={specimen.id === s.id ? 'active' : ''} onClick={() => selectSpecimen(s)}><span>{s.id}</span>{s.name}</button>)}</div>
        <div className="scope-switch" role="radiogroup" aria-label="Mutation scope"><span className="field-label">Scope</span>
          {([['whole', 'Whole function'], ['changed', 'Changed lines']] as const).map(([value, label]) => <button key={value} role="radio" aria-checked={scope === value} className={scope === value ? 'active' : ''} onClick={() => setScope(value)}>{label}</button>)}
          {changed && <span className="scope-hint">{scoped.length} of {totalLines} lines in scope · click line numbers to add or remove</span>}
        </div>
        <div className={`editors ${changed ? 'with-before' : ''}`}>
          {changed && <div className="editor-wrap"><div className="editor-label"><span>Before</span><span>Optional · base version</span></div><Editor value={before} onChange={setBefore} extensions={jsExtensions} theme="dark" basicSetup={{ lineNumbers: true }} placeholder="Paste the pre-PR version, or click line numbers in the Function editor to scope by hand." /></div>}
          <div className={`editor-wrap ${changed ? 'scoping' : ''}`}><div className="editor-label"><span>Function</span><span>{changed ? 'After · JS / TS' : 'JS / TS'}</span></div><Editor value={fn} onChange={setFn} extensions={fnExtensions} theme="dark" basicSetup={{ lineNumbers: !changed }} /></div>
          <div className="editor-wrap tests-wrap"><div className="editor-label"><span>Tests</span><span>describe / it / expect</span></div><Editor value={tests} onChange={setTests} extensions={jsExtensions} theme="dark" basicSetup={{ lineNumbers: true }} /></div>
        </div>
        <div className="run-row"><button className="button" onClick={() => run()} disabled={running}><Play size={16} fill="currentColor"/>{running ? 'Running mutants…' : 'Run mutants'}<kbd>{shortcut}</kbd></button><span className="run-note">Runs locally. Nothing leaves this browser.</span></div>
        {error && <div className="error" role="alert"><ShieldAlert size={18}/>{error}</div>}
        {(mutants.length > 0 || noScopedMutants) && runScope && <div className="results">
          {runScope.mode === 'changed' && <p className="scope-summary">{scopeSummary(runScope)}</p>}
          {noScopedMutants ? <div className="score score-empty"><span className="field-label">Mutation score · changed lines only</span><p>No mutable code on the changed lines.</p></div> : <>
            <div className="progress-line"><span>{running ? 'Testing specimens…' : 'Run complete'}</span><span>{killed.length} / {mutants.length} killed</span></div><div className="mutant-grid" role="list" aria-label="Mutant results">{mutants.map((m) => { const state = killed.includes(m.id) ? 'Killed' : !running ? 'Survived' : 'Pending'; const label = `${state}: ${m.operator}, line ${m.line}`; return <div key={m.id} role="listitem" aria-label={label} title={label} className={`mutant-cell ${state === 'Killed' ? 'killed' : state === 'Survived' ? 'survived' : ''}`}>{state === 'Killed' ? <Check size={14} aria-hidden="true"/> : state === 'Survived' ? <Circle size={10} fill="currentColor" aria-hidden="true"/> : null}</div> })}</div>
            <div className="grid-legend" aria-hidden="true"><span><i className="legend-swatch killed"><Check size={10}/></i>Killed</span><span><i className="legend-swatch survived"><Circle size={7} fill="currentColor"/></i>Survived</span><span><i className="legend-swatch"/>Pending</span></div>
            <div className="score"><span className="field-label">Mutation score{runScope.mode === 'changed' ? ' · changed lines only' : ''}</span><strong>{score}<small>%</small></strong><span>{score === 100 ? 'No survivors. Your tests are doing their job.' : 'The survivors are the gaps.'}</span></div>
          </>}
        </div>}
      </section>
      <section className="report section-shell" id="report"><div className="section-heading"><div><p className="eyebrow">No. 02 / Findings</p><h2>Survivors report.</h2></div><div className="report-actions"><button className="text-button" onClick={copyLink}><Link2 size={15}/>{copied === 'link' ? 'Copied' : 'Copy link'}</button><button className="text-button" onClick={copyReport}><Copy size={15}/>{copied === 'report' ? 'Copied' : 'Copy report'}</button></div></div>{survivors.length === 0 ? <div className="empty"><Sparkles size={20}/><p>{noScopedMutants ? 'No mutable code on the changed lines.' : mutants.length ? 'All mutants killed. Excellent work.' : 'Run the lab to reveal what survived.'}</p></div> : <div className="survivor-list">{survivors.map((m) => <motion.button layout key={m.id} className={`survivor-card ${selected === m.id ? 'selected' : ''}`} onClick={() => setSelected(m.id)}><div className="card-top"><span className="catalogue-no">MUT-{String(m.id + 1).padStart(2, '0')}</span><span className="survived-label"><Skull size={14}/> SURVIVED</span></div><div className="card-main"><div><h3>{m.operator}</h3><p>Line {m.line} · {m.hint}</p></div><div className="diff"><span>{m.before}</span><b>→</b><strong>{m.after}</strong></div></div></motion.button>)}</div>}</section>
      <section className="guide section-shell" id="guide"><div className="section-heading"><div><p className="eyebrow">No. 03 / Reference</p><h2>Field guide.</h2></div><p className="section-note">Small changes. Meaningful pressure.<br/>The complete catalogue of operators.</p></div><div className="guide-grid">{[['relational boundary','age > 18','age >= 18','Off-by-one conditions.'],['arithmetic','price + tax','price - tax','Incorrect calculations.'],['equality','value === 0','value !== 0','Unexpected equality.'],['logical','a && b','a || b','Missing branches.'],['boolean literal','return true','return false','Inverted defaults.'],['numeric literal','limit = 3','limit = 4','Wrong constants.'],['negated condition','if (valid)','if (!(valid))','Reversed control flow.'],['string literal','"bad pct"','""','Unasserted messages.']].map((g, i) => <article className="guide-card" key={g[0]}><span className="catalogue-no">0{i + 1}</span><h3>{g[0]}</h3><div className="guide-diff"><code>{g[1]}</code><span>→</span><code>{g[2]}</code></div><p>{g[3]}</p></article>)}</div><p className="guide-note">Scope runs to changed lines in review; run the whole function when you&apos;re auditing a test suite.</p></section>
      <section className="about section-shell page-grid" id="about"><div><p className="eyebrow">About the project</p><h2>A small instrument<br/><em>for serious tests.</em></h2></div><div className="about-copy"><p>Made by <strong>Suraj Pawar</strong>, a software engineer in Pune. At Handshake AI I author agentic coding benchmarks and build mutation-testing gates that check whether a benchmark&apos;s tests actually catch broken solutions.</p><p>Survivors is a small public version of that idea.</p><div className="links"><a href="https://github.com/Surajp1602" target="_blank" rel="noreferrer">GitHub <ArrowUpRight size={14}/></a><a href="https://www.linkedin.com/in/surajpawar0216" target="_blank" rel="noreferrer">LinkedIn <ArrowUpRight size={14}/></a></div></div></section>
    </main><footer><span>SURVIVORS<span className="red">.</span></span><span>Runs entirely in your browser. No code is uploaded.</span><span className="footer-links"><a href="https://github.com/Surajp1602" target="_blank" rel="noreferrer">GitHub</a><a href="https://www.linkedin.com/in/surajpawar0216" target="_blank" rel="noreferrer">LinkedIn</a><span>© 2026 Suraj Pawar</span></span></footer></>
}
