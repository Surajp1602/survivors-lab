import type { Scope } from './engine'

export type Specimen = { id: string; name: string; fn: string; tests: string; before?: string; scope?: Scope }

export const specimens: Specimen[] = [
  { id: '01', name: 'isAdult', fn: 'function isAdult(age) {\n  return age >= 18;\n}', tests: "test('adult', () => expect(isAdult(30)).toBe(true));\ntest('minor', () => expect(isAdult(5)).toBe(false));" },
  { id: '02', name: 'isLeapYear', fn: 'function isLeapYear(y) {\n  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;\n}', tests: "test('leap year', () => expect(isLeapYear(2024)).toBe(true));\ntest('common year', () => expect(isLeapYear(2023)).toBe(false));" },
  { id: '03', name: 'applyDiscount', fn: 'function applyDiscount(price, pct) {\n  if (pct > 100) throw new Error("bad pct");\n  return price - (price * pct) / 100;\n}', tests: "test('discount', () => expect(applyDiscount(200, 10)).toBe(180));\ntest('invalid pct', () => expect(() => applyDiscount(200, 150)).toThrow());" },
  { id: '04', name: 'A small PR', scope: 'changed', before: 'function shippingFee(total) {\n  if (total >= 500) return 0;\n  return 40;\n}', fn: 'function shippingFee(total, express) {\n  if (total >= 500) return 0;\n  if (express) return 90;\n  return 40;\n}', tests: "test('free over 500', () => expect(shippingFee(600)).toBe(0));\ntest('standard fee', () => expect(shippingFee(100)).toBe(40));\ntest('express costs more', () => expect(shippingFee(100, true) > 40).toBeTruthy());" },
]

/** What the hero animation plays: Specimen 01's mutants and how they end up. A unit test checks this against a real run. */
export const heroDemo = { specimen: specimens[0], survived: [true, true] }
