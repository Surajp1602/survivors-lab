// Rendered accessibility check: builds and serves the site, then runs axe on key states at phone and
// desktop widths in light and dark themes. Fails on colour-contrast and accessible-name violations.
//
// Uses the installed Chrome when present; otherwise Playwright's Chromium (`pnpm exec playwright install chromium`).
// Pass --no-build to reuse an existing `.next` build.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import AxeBuilder from '@axe-core/playwright'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
const next = fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url))
const port = Number(process.env.A11Y_PORT ?? 3210)
const base = `http://localhost:${port}`

/** Rules whose failure fails the run: contrast, plus every rule about an element's accessible name. */
const failing = new Set([
  'color-contrast',
  'aria-command-name', 'aria-dialog-name', 'aria-input-field-name', 'aria-meter-name', 'aria-progressbar-name',
  'aria-toggle-field-name', 'aria-tooltip-name', 'aria-treeitem-name', 'aria-prohibited-attr',
  'button-name', 'document-title', 'frame-title', 'image-alt', 'input-button-name', 'input-image-alt',
  'label', 'link-name', 'object-alt', 'role-img-alt', 'select-name', 'summary-name', 'svg-img-alt', 'area-alt',
])

const run = (args, opts = {}) => spawn(process.execPath, [next, ...args], { cwd: root, stdio: opts.stdio ?? 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } })
const exited = (child) => new Promise((resolve, reject) => child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`next exited with ${code}`)))))

async function serve() {
  if (!process.argv.includes('--no-build')) await exited(run(['build']))
  const server = run(['start', '-p', String(port)], { stdio: 'ignore' })
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base)).ok) return server } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  server.kill()
  throw new Error('server did not start')
}

const share = (state) => {
  let bin = ''
  new TextEncoder().encode(JSON.stringify(state)).forEach((b) => { bin += String.fromCharCode(b) })
  return encodeURIComponent(btoa(bin))
}
const syntaxError = share({ fn: 'function isAdult(age) {\n  return age >= ;\n}', tests: "test('adult', () => expect(isAdult(30)).toBe(true));", scope: 'whole', before: '', manual: { add: [], remove: [] }, equivalent: [] })

async function settle(page) {
  await page.waitForFunction(() => document.querySelector('.error') || /Run complete/.test(document.querySelector('.progress-line')?.textContent ?? '') || document.querySelector('.score-empty'), null, { timeout: 15000 })
  await page.evaluate(() => document.fonts.ready)
}

async function wholeFunctionRun(page) {
  await page.goto(base)
  await settle(page)
  await page.getByRole('button', { name: /A small PR/ }).click()
  await page.getByRole('radio', { name: 'Whole function' }).click()
  await page.locator('.run-row .button').click()
  await settle(page)
}

const states = [
  { name: 'initial page', go: async (page) => { await page.goto(base); await settle(page) } },
  { name: 'preset 04, Whole function', go: wholeFunctionRun },
  { name: 'syntax error', go: async (page) => { await page.goto(`${base}/#${syntaxError}`); await page.locator('.error').waitFor(); await page.evaluate(() => document.fonts.ready) } },
  {
    name: 'survivors report',
    include: '#report',
    // Exercise every card variant: a killed card with "Also killed", a survivor, and the equivalent list.
    go: async (page) => {
      await wholeFunctionRun(page)
      const card = (title) => page.locator('.survivor-card', { has: page.locator('h3', { hasText: title }) })
      await card('relational boundary').getByRole('button', { name: /Add killing test/ }).click()
      await page.waitForFunction(() => document.querySelector('.survivor-card.is-killed'), null, { timeout: 15000 })
      await settle(page)
      await card('negated condition').or(card('numeric literal')).first().getByRole('button', { name: /Mark as equivalent/ }).click()
      await page.locator('.equivalent-list').waitFor()
    },
  },
]

const viewports = [{ width: 390, height: 844 }, { width: 1440, height: 900 }]
const schemes = ['light', 'dark']

async function launch() {
  try { return await chromium.launch({ channel: process.env.A11Y_CHANNEL ?? 'chrome' }) } catch { return chromium.launch() }
}

const server = await serve()
const browser = await launch()
let failures = 0
try {
  for (const viewport of viewports) {
    for (const colorScheme of schemes) {
      const context = await browser.newContext({ viewport, colorScheme, reducedMotion: 'reduce' })
      for (const state of states) {
        const page = await context.newPage()
        await state.go(page)
        let builder = new AxeBuilder({ page })
        if (state.include) builder = builder.include(state.include)
        const { violations } = await builder.analyze()
        const label = `${viewport.width}px ${colorScheme.padEnd(5)} ${state.name}`
        const bad = violations.filter((v) => failing.has(v.id))
        const other = violations.filter((v) => !failing.has(v.id))
        console.log(`${bad.length ? 'FAIL' : 'ok  '} ${label}${other.length ? `  (warnings: ${other.map((v) => v.id).join(', ')})` : ''}`)
        for (const v of bad) {
          failures++
          console.log(`  ${v.id}: ${v.help}`)
          for (const node of v.nodes.slice(0, 6)) console.log(`    ${node.target.join(' ')}  ${node.failureSummary?.split('\n').slice(1).join(' ').trim() ?? ''}`)
          if (v.nodes.length > 6) console.log(`    …and ${v.nodes.length - 6} more`)
        }
        await page.close()
      }
      await context.close()
    }
  }
} finally {
  await browser.close()
  server.kill()
}
if (failures) {
  console.error(`\n${failures} failing violation(s).`)
  process.exit(1)
}
console.log('\nNo colour-contrast or accessible-name violations.')
