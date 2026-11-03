import type { Manual, Scope } from './engine'

export type ShareState = { fn: string; tests: string; scope: Scope; before: string; manual: Manual }

export const encodeShare = (data: ShareState) => { let bin = ''; new TextEncoder().encode(JSON.stringify(data)).forEach((b) => { bin += String.fromCharCode(b) }); return encodeURIComponent(btoa(bin)) }

export function decodeShare(hash: string): ShareState | null {
  try {
    const d = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(decodeURIComponent(hash)), (c) => c.charCodeAt(0))))
    if (typeof d.fn !== 'string' || typeof d.tests !== 'string') return null
    const ints = (v: unknown) => (Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n) && n > 0) : [])
    return { fn: d.fn, tests: d.tests, scope: d.scope === 'changed' ? 'changed' : 'whole', before: typeof d.before === 'string' ? d.before : '', manual: { add: ints(d.manual?.add), remove: ints(d.manual?.remove) } }
  } catch { return null }
}
