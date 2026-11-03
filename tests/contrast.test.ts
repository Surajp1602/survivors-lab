import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8')

const vars = (block: string) => Object.fromEntries([...block.matchAll(/--([a-z-]+):(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]))
const light = vars(css.match(/:root\{([^}]*)\}/)![1])
const dark = { ...light, ...vars(css.match(/@media\(prefers-color-scheme:dark\)\{:root\{([^}]*)\}/)![1]) }

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Every text token, paired with each background token it is drawn on. */
const pairs: [text: string, background: string][] = [
  ['ink', 'paper'], ['muted', 'paper'], ['body', 'paper'], ['accent-text', 'paper'], ['added', 'paper'],
  ['ink', 'surface-alt'], ['muted', 'surface-alt'], ['body', 'surface-alt'], ['accent-text', 'surface-alt'], ['added', 'surface-alt'],
  ['paper', 'ink'],
  ['on-accent', 'accent-strong'], ['on-accent', 'accent-strong-hover'],
  ['editor-text', 'editor-bg'], ['editor-strong', 'editor-bg'], ['editor-text', 'editor-error'], ['editor-strong', 'editor-error'],
  ['added', 'diff-orig-bg'], ['accent-text', 'diff-mut-bg'],
  // Editor syntax colours (app/editor-theme.ts) on every editor surface.
  ...['syn-text', 'syn-keyword', 'syn-string', 'syn-number', 'syn-function', 'syn-type', 'syn-comment', 'syn-operator', 'syn-invalid', 'editor-text', 'editor-strong']
    .flatMap((text) => ['editor-bg', 'editor-active', 'editor-error'].map((bg): [string, string] => [text, bg])),
]

describe('colour contrast (WCAG AA, 4.5:1)', () => {
  for (const [theme, tokens] of [['light', light], ['dark', dark]] as const) {
    it.each(pairs)(`${theme}: --%s on --%s`, (text, background) => {
      expect(tokens[text], `--${text} is defined`).toMatch(/^#/)
      expect(tokens[background], `--${background} is defined`).toMatch(/^#/)
      expect(ratio(tokens[text], tokens[background])).toBeGreaterThanOrEqual(4.5)
    })
  }

  it('sets every text colour through a token covered above', () => {
    const covered = new Set(pairs.map(([text]) => text))
    for (const [, value] of css.matchAll(/(?<![-\w])color:([^;}]+)/g)) {
      if (['inherit', 'currentColor', 'transparent'].includes(value.trim())) continue
      const token = value.match(/^var\(--([a-z-]+)\)$/)?.[1]
      expect(token, `color:${value} uses a token`).toBeDefined()
      expect(covered.has(token!), `--${token} has a contrast check`).toBe(true)
    }
  })

  it('sets every background through a token', () => {
    for (const [, value] of css.matchAll(/background(?:-color)?:([^;}]+)/g)) {
      expect(value.trim() === 'transparent' || /^var\(--[a-z-]+\)$/.test(value.trim()), `background:${value}`).toBe(true)
    }
  })
})
