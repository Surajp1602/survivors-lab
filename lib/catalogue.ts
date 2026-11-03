/** Every mutation operator the engine implements. The page's Field Guide and marquee are built from this module. */
export const OPERATORS = ['relational boundary', 'arithmetic', 'equality', 'logical', 'boolean literal', 'numeric literal', 'negated condition', 'string literal'] as const
export type Operator = (typeof OPERATORS)[number]

/** Field Guide cards. `before` is real code; the catalogue test checks the engine turns it into `after`. */
export const fieldGuide: { operator: Operator; before: string; after: string; note: string }[] = [
  { operator: 'relational boundary', before: 'age > 18', after: 'age >= 18', note: 'Off-by-one conditions.' },
  { operator: 'arithmetic', before: 'price + tax', after: 'price - tax', note: 'Incorrect calculations.' },
  { operator: 'equality', before: 'value === 0', after: 'value !== 0', note: 'Unexpected equality.' },
  { operator: 'logical', before: 'a && b', after: 'a || b', note: 'Missing branches.' },
  { operator: 'boolean literal', before: 'return true', after: 'return false', note: 'Inverted defaults.' },
  { operator: 'numeric literal', before: 'limit = 3', after: 'limit = 4', note: 'Wrong constants.' },
  { operator: 'negated condition', before: 'if (valid)', after: 'if (!(valid))', note: 'Reversed control flow.' },
  { operator: 'string literal', before: '"bad pct"', after: '""', note: 'Unasserted messages.' },
]

/** Marquee strip: one short example per operator. */
export const marquee: { operator: Operator; label: string }[] = [
  { operator: 'relational boundary', label: '>= → >' },
  { operator: 'logical', label: '&& → ||' },
  { operator: 'boolean literal', label: 'true → false' },
  { operator: 'numeric literal', label: 'n → n + 1' },
  { operator: 'equality', label: '=== → !==' },
  { operator: 'arithmetic', label: '+ → -' },
  { operator: 'negated condition', label: 'if (x) → if (!(x))' },
  { operator: 'string literal', label: '"…" → ""' },
]
