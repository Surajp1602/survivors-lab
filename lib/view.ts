import type { Mutant, RunConfig, Score } from './engine'

/**
 * What the results area may show. After an error, nothing from an earlier run (`hidden`). After the
 * editors change, the old results stay visible but marked as out of date (`stale`).
 */
export type ResultsState = 'empty' | 'hidden' | 'stale' | 'fresh'

export function resultsState(o: { hasResults: boolean; error: boolean; ranWith: RunConfig | null; current: RunConfig }): ResultsState {
  if (o.error) return 'hidden'
  if (!o.hasResults || !o.ranWith) return 'empty'
  const r = o.ranWith
  const c = o.current
  const beforeMatters = r.scope === 'changed' || c.scope === 'changed'
  const same = r.fn === c.fn && r.tests === c.tests && r.scope === c.scope && (!beforeMatters || (r.before === c.before && JSON.stringify(r.manual) === JSON.stringify(c.manual)))
  return same ? 'fresh' : 'stale'
}

export const staleNote = 'Results are from an earlier version — run again'

/** Grid header, counted the same way as the score: equivalent mutants are out of both sides. */
export const progressLabel = (t: Score) => `${t.killed} / ${t.counted} killed${t.equivalent ? ` · ${t.equivalent} equivalent` : ''}`

export const catalogueNo = (m: Mutant) => `MUT-${String(m.id + 1).padStart(2, '0')}`

/**
 * Mutants that were alive before a generated test was added and are killed now, other than the one the
 * test was written for.
 */
export function alsoKilled(previousSurvivors: string[], clickedKey: string, mutants: Mutant[], killed: number[]): Mutant[] {
  return mutants.filter((m) => m.key !== clickedKey && previousSurvivors.includes(m.key) && killed.includes(m.id))
}

/**
 * Split a mutant's whole-line diff into text before, inside and after the changed token, for the
 * original line and the mutant line. Whitespace at the edges of the mutated range stays unhighlighted.
 */
export function diffParts(m: Mutant): { removed: [string, string, string]; added: [string, string, string] } {
  const removed = m.diff.removed.join('\n')
  const added = m.diff.added.join('\n')
  const { start, removedEnd, addedEnd } = m.diff
  const split = (text: string, from: number, to: number): [string, string, string] => {
    let a = from
    let b = to
    while (a < b && /\s/.test(text[a])) a++
    while (b > a && /\s/.test(text[b - 1])) b--
    return [text.slice(0, a), text.slice(a, b), text.slice(b)]
  }
  return { removed: split(removed, start, removedEnd), added: split(added, start, addedEnd) }
}
