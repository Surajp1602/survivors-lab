import type { Mutant, Score } from './engine'

export type PrCommentInput = {
  name: string
  /** null when the run was scoped to changed lines but none of them hold mutable code. */
  tally: Score | null
  scope: { mode: 'whole' } | { mode: 'changed'; lines: number[]; kept: number; total: number }
  survivors: Mutant[]
}

/** GitHub-flavoured markdown for a pull request comment: score and scope, then each survivor as a diff. */
export function buildPrComment({ name, tally, scope, survivors }: PrCommentInput): string {
  const scopeText = scope.mode === 'whole' ? 'Whole function' : `Changed lines (${scope.lines.join(', ') || 'none'}) · ${scope.kept} of ${scope.total} mutants`
  const out = [`### Survivors mutation report · ${name}`, '']
  if (!tally) {
    out.push(`**Scope:** ${scopeText}`, '', 'No mutable code on the changed lines.')
    return out.join('\n')
  }
  const equivalent = tally.equivalent ? `, ${tally.equivalent} marked equivalent` : ''
  out.push(`**Mutation score:** ${tally.score}% (${tally.killed} of ${tally.counted} killed${equivalent}) · **Scope:** ${scopeText}`, '')
  if (!survivors.length) {
    out.push('No survivors.')
    return out.join('\n')
  }
  out.push(`#### ${survivors.length} survivor${survivors.length === 1 ? '' : 's'}`)
  for (const m of survivors) {
    out.push('', `**Line ${m.line}** · ${m.operator} — ${m.hint}`, '```diff', ...m.diff.removed.map((l) => `-${l}`), ...m.diff.added.map((l) => `+${l}`), '```')
  }
  return out.join('\n')
}
