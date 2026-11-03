import { parse } from 'acorn'
import { transform } from 'sucrase'

export type EditorName = 'Function' | 'Tests'
/** A parse error, with a 1-based line and column in the editor's own text. */
export type SyntaxProblem = { editor: EditorName; line: number; column: number; message: string }

type Located = { pos: number; line: number; column: number; message: string }
const clean = (message: string) => message.replace(/\s*\(\d+:\d+\)\s*$/, '')

function located(e: unknown, columnBase: 0 | 1): Located | undefined {
  const err = e as { pos?: number; loc?: { line: number; column: number }; message?: string }
  if (!err?.loc || typeof err.pos !== 'number') return undefined
  return { pos: err.pos, line: err.loc.line, column: err.loc.column + (columnBase === 0 ? 1 : 0), message: clean(String(err.message)) }
}

/**
 * The first syntax error in `source`, or null. Sucrase (which understands TypeScript) and acorn
 * (which reports plain JavaScript errors more precisely) both read the editor text; a parser fails at or
 * after the real mistake, so the one that got further is reported.
 */
export function findSyntaxError(source: string, editor: EditorName): SyntaxProblem | null {
  let viaSucrase: Located | undefined
  let stripped: string | undefined
  try { stripped = transform(source, { transforms: ['typescript'], disableESTransforms: true, keepUnusedImports: true }).code } catch (e) { viaSucrase = located(e, 1) }
  let viaAcorn: Located | undefined
  try { parse(stripped ?? source, { ecmaVersion: 'latest', sourceType: 'module', locations: true }) } catch (e) { viaAcorn = located(e, 0) }
  // Stripped code keeps line numbers but not columns, so an acorn error there is only used when sucrase passed.
  const best = viaSucrase && viaAcorn && stripped === undefined ? (viaAcorn.pos > viaSucrase.pos ? viaAcorn : viaSucrase) : viaSucrase ?? viaAcorn
  return best ? { editor, line: best.line, column: best.column, message: best.message } : null
}

export const describeSyntaxProblem = (p: SyntaxProblem) => `Syntax error in ${p.editor}, line ${p.line}, column ${p.column}: ${p.message}`
