import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { EditorView, type Extension } from '@uiw/react-codemirror'

/**
 * Editor chrome and syntax colours, all from CSS tokens in globals.css. The background and gutter use the
 * frame's surface (--editor-bg), so there's no separate inner panel, and every syntax colour is checked for
 * contrast against the editor surface, active line and error line (tests/contrast.test.ts, test:a11y).
 */
const chrome = EditorView.theme({
  '&': { backgroundColor: 'var(--editor-bg)', color: 'var(--syn-text)' },
  '.cm-content': { caretColor: 'var(--editor-strong)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--editor-strong)' },
  '.cm-gutters': { backgroundColor: 'var(--editor-bg)', color: 'var(--editor-text)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--editor-active)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--editor-active)', color: 'var(--editor-strong)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'var(--editor-selection)' },
  '.cm-placeholder': { color: 'var(--editor-text)' },
  '.cm-foldPlaceholder': { backgroundColor: 'transparent', border: 'none', color: 'var(--editor-text)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--editor-selection)', color: 'var(--syn-text)', outline: 'none' },
  '.cm-tooltip': { backgroundColor: 'var(--editor-bg)', color: 'var(--syn-text)', border: '1px solid var(--editor-text)' },
}, { dark: true })

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier], color: 'var(--syn-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syn-number)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--syn-function)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--syn-type)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.operator, t.punctuation, t.bracket, t.separator], color: 'var(--syn-operator)' },
  { tag: [t.variableName, t.propertyName, t.definition(t.variableName)], color: 'var(--syn-text)' },
  { tag: t.invalid, color: 'var(--syn-invalid)' },
])

export const editorTheme: Extension = [chrome, syntaxHighlighting(highlight)]
