import { parse } from 'acorn'
import { transform } from 'sucrase'

/** Runnable JavaScript plus the top-level names the tests can call. */
export type Prepared = { code: string; names: string[] }

/** Replace a range with spaces, keeping newlines, so offsets and line numbers still match the editor. */
const blank = (code: string, from: number, to: number) => code.slice(0, from) + code.slice(from, to).replace(/[^\n]/g, ' ') + code.slice(to)

/**
 * Strip TypeScript types with sucrase (which preserves line numbers), then blank out `import` lines and
 * `export` keywords so the result runs as a plain script. Throws on syntax errors.
 */
export function prepare(source: string): Prepared {
  const stripped = transform(source, { transforms: ['typescript'], disableESTransforms: true, keepUnusedImports: true }).code
  const ast: any = parse(stripped, { ecmaVersion: 'latest', sourceType: 'module' })
  let code = stripped
  const names: string[] = []
  for (const node of ast.body) {
    let decl = node
    if (node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration' || (node.type === 'ExportNamedDeclaration' && !node.declaration)) { code = blank(code, node.start, node.end); continue }
    if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration') {
      decl = node.declaration
      if (!decl.id) throw new Error('Give the default export a name so the tests can call it.')
      code = blank(code, node.start, decl.start)
    }
    if ((decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') && decl.id) names.push(decl.id.name)
    else if (decl.type === 'VariableDeclaration') for (const d of decl.declarations) if (d.id.type === 'Identifier') names.push(d.id.name)
  }
  return { code, names }
}
