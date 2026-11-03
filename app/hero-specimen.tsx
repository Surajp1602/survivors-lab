'use client'

import { useEffect, useState } from 'react'
import { Check, Circle } from 'lucide-react'
import { createMutants } from '@/lib/engine'
import { heroDemo } from '@/lib/presets'
import { useReducedMotion } from './motion-prefs'

const mutants = createMutants(heroDemo.specimen.fn)
const STEP_MS = 280
const HOLD_STEPS = 12

/** Totals for the hero's metadata grid, from the same specimen the mini-grid plays. */
export const heroTotals = {
  name: heroDemo.specimen.name,
  tests: heroDemo.specimen.tests.split('\n').filter(Boolean).length,
  mutants: mutants.length,
  killed: heroDemo.survived.filter((alive) => !alive).length,
  survivors: heroDemo.survived.filter(Boolean).length,
}

/** The hero specimen's mutant cells filling in, in the results grid's cell styles. Reduced motion shows the final state. */
export function HeroSpecimen() {
  const reduced = useReducedMotion()
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (reduced) return
    const timer = setInterval(() => setStep((s) => (s + 1) % (mutants.length + HOLD_STEPS + 1)), STEP_MS)
    return () => clearInterval(timer)
  }, [reduced])
  const filled = reduced ? mutants.length : Math.min(step, mutants.length)
  const survivedSoFar = heroDemo.survived.slice(0, filled).filter(Boolean).length
  return (
    <figure className="hero-specimen" aria-label={`Specimen ${heroDemo.specimen.id}, ${heroDemo.specimen.name}: ${heroTotals.mutants} mutants, ${heroTotals.survivors} survive the tests`}>
      <figcaption className="field-label">Specimen {heroDemo.specimen.id} · {heroDemo.specimen.name}</figcaption>
      <div className="hero-grid" aria-hidden="true">
        {mutants.map((m, i) => {
          const done = i < filled
          const alive = heroDemo.survived[i]
          return <span key={m.key} className={`mutant-cell ${done ? (alive ? 'survived' : 'killed') : ''}`}>{done && (alive ? <Circle size={9} fill="currentColor"/> : <Check size={12}/>)}</span>
        })}
      </div>
      <p className="hero-tally" aria-hidden="true">{filled} / {mutants.length} tested · {survivedSoFar} survived</p>
    </figure>
  )
}
