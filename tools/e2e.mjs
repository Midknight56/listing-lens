// Listing Lens end to end play through. Run through the shared browser lock.
//   node tools/e2e.mjs [base url]
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { chromium } from 'playwright'

// Optional: --token-file <file with WARM_TOKEN=...> sends the operator header, so test runs skip the per visitor
// caps (the daily totals still apply). The token is never printed.
function operatorHeaders() {
  const at = process.argv.indexOf('--token-file')
  if (at < 0) return {}
  const rows = readFileSync(process.argv[at + 1], 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)
  const line = rows.find((row) => row.startsWith('WARM_TOKEN=')) ?? rows[0]
  return { 'X-Warm-Token': line.replace(/^WARM_TOKEN=/, '').trim().replace(/^"|"$/g, '') }
}

const BASE = (process.argv.slice(2).find((arg) => arg.startsWith('http')) ?? 'http://127.0.0.1:8787').replace(/\/$/, '')
const results = []

function otherPlaywrightRuns() {
  return execSync('tasklist /FO CSV /NH', { encoding: 'utf8' }).split('\n').filter((line) => /chrome-headless-shell|playwright/i.test(line)).length
}
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` | ${detail}` : ''}`)
}
async function calmError(page) {
  await page.locator('#error-box:not([hidden])').waitFor({ timeout: 15000 })
  return (await page.locator('#error-box').innerText()).replace(/\s+/g, ' ').trim()
}
async function startPreset(page, presetName = 'East Nashville') {
  const preset = page.locator('.preset-card').filter({ hasText: presetName }).first()
  await preset.waitFor({ timeout: 15000 })
  // One tap on an example starts its brief; no second button.
  await preset.click()
}
async function clearRoom(page) {
  // Each removal redraws the chips, so always take the first one again.
  const chips = page.locator('#room-chips button')
  for (let left = await chips.count(); left > 0; left--) await chips.first().click()
}

async function main() {
  const busy = otherPlaywrightRuns()
  if (busy) { console.log(`HELD: ${busy} headless browser processes of another run are alive`); process.exit(3) }
  mkdirSync('out', { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'], extraHTTPHeaders: operatorHeaders() })
  const page = await context.newPage()
  const errors = []
  const stageBodies = []
  const stageStreams = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/stage') {
      try { stageBodies.push(request.postDataJSON()) } catch { /* the page result reports malformed requests */ }
    }
  })
  page.on('response', (response) => {
    const request = response.request()
    if (request.method() === 'POST' && new URL(response.url()).pathname === '/api/stage') {
      stageStreams.push(response.text().then((body) => body.split('\n').filter(Boolean).map((line) => JSON.parse(line))).catch(() => []))
    }
  })
  try {
    await page.goto(BASE + '/')
    await page.locator('.preset-card').first().waitFor({ timeout: 15000 })
    const presetCount = await page.locator('.preset-card').count()
    check('empty page loads the six API presets', presetCount === 6 && await page.locator('.preset-card').evaluateAll((cards) => cards.every((card) => Boolean(card.dataset.presetId))))

    await startPreset(page)
    check('run log opens while the brief is running', await page.locator('#run-log').evaluate((node) => node.open))
    await page.locator('#listing-paragraph').waitFor({ timeout: 120000 })
    const relax = await page.locator('.run-notice').innerText().catch(() => '')
    check('East Nashville shows the location fallback', /East Nashville.*Nashville/i.test(relax), relax)
    const verdicts = await page.locator('.verdict').count()
    check('audit has at least three verdicts', verdicts >= 3, `${verdicts} verdicts`)
    const sectionCount = await page.locator('.result-section').count()
    check('all four result sections show', sectionCount === 4, `${sectionCount} sections`)
    const templateWritten = await page.getByText('Written by template', { exact: true }).count() > 0
    check('template mode badge is clear when the brief uses a template', !templateWritten || /Plain text mode/i.test(await page.locator('#mode-badge').innerText()))

    const originalParagraph = await page.locator('#listing-paragraph').innerText()
    // The flip is the lens switch inside the brief; the old action row button stays hidden.
    await page.locator('[data-lens-switch]').first().click()
    await page.locator('#lens-diff:not([hidden])').waitFor({ timeout: 120000 })
    check('lens flip shows the difference', await page.locator('#lens-diff').getByText('Lens difference').count() > 0)
    const firstStage = stageBodies.at(-2), flippedStage = stageBodies.at(-1)
    check('preset flip replays the preset with its other lens', Boolean(firstStage?.preset) && flippedStage?.preset === firstStage?.preset && flippedStage?.lens?.label !== firstStage?.lens?.label)
    const copyButton = page.locator('[data-copy-paragraph]')
    await copyButton.click()
    const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '')
    check('paragraph copies to the clipboard', copied === (await page.locator('#listing-paragraph').innerText()) || await copyButton.innerText() === 'Copied')
    check('paragraph exists before and after the lens flip', originalParagraph.length > 0 && (await page.locator('#listing-paragraph').innerText()).length > 0)

    await page.locator('#share-button').click()
    const shareUrl = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '')
    const sharePage = await context.newPage()
    await sharePage.goto(shareUrl || `${BASE}/s/no-such-brief`)
    await sharePage.locator('#listing-paragraph, #error-box:not([hidden])').first().waitFor({ timeout: 30000 })
    check('share link opens the same brief', Boolean(shareUrl) && (await sharePage.locator('#listing-paragraph').innerText().catch(() => '')) === (await page.locator('#listing-paragraph').innerText()))
    await sharePage.close()

    await page.locator('[data-tab="plain"]').click()
    await page.getByText('Asking the same model with no Qloo').waitFor({ timeout: 15000 }).catch(() => {})
    // When the day's writing allowance is spent the tab says so calmly instead; the detail says which case ran.
    await page.waitForFunction(() => {
      const text = document.querySelector('#plain-content')?.textContent || ''
      return document.querySelector('#plain-content li') || /spent for today|not available/i.test(text)
    }, null, { timeout: 120000 })
    const plainText = await page.locator('#plain-content').innerText()
    const picks = /Brands/.test(plainText) && /Places/.test(plainText)
    check('Qloo off renders plain picks, or says calmly that writing is spent', picks || /spent for today/i.test(plainText), picks ? 'picks shown' : plainText.slice(0, 80))

    // Bad path: an unknown city remains calm and does not damage the page.
    await page.goto(BASE + '/')
    await page.locator('#city').fill('Qwxzv')
    await page.locator('#neighbourhood').fill('')
    await page.locator('.anchor').first().fill('Kinfolk')
    await page.locator('#stage-form button[type="submit"]').click()
    const unknownError = await calmError(page)
    check('a city with no match gives a calm error', unknownError.length > 0 && unknownError.length < 240, unknownError)

    // Bad path: the empty room still returns a complete brief and a no rows note.
    await page.goto(BASE + '/')
    await page.locator('.preset-card').filter({ hasText: 'East Nashville' }).first().click()
    await page.locator('#listing-paragraph').waitFor({ timeout: 120000 })
    await clearRoom(page)
    await page.locator('#stage-form button[type="submit"]').click()
    await page.locator('#listing-paragraph').waitFor({ timeout: 120000 })
    check('an empty room returns a brief with no audit rows', await page.locator('.verdict').count() === 0 && await page.locator('.audit-section').getByText('No brands to audit in this room.').count() === 1)

    // Bad path: the input guard refuses before a run starts.
    await page.goto(BASE + '/')
    await page.locator('.preset-card').filter({ hasText: 'East Nashville' }).first().click()
    await page.locator('#listing-paragraph').waitFor({ timeout: 120000 })
    await page.locator('.anchor').first().fill('perfect for families')
    await page.locator('#stage-form button[type="submit"]').click()
    const bannedError = await calmError(page)
    const bannedEvents = await stageStreams.at(-1)
    check('a banned love is refused before a run', bannedError.length > 0 && !bannedEvents.some((event) => ['run', 'plan', 'call'].includes(event.t)), bannedError)

    await page.goto(`${BASE}/s/no-such-brief-ever`)
    const missing = await calmError(page)
    check('an unknown share link says it was not found', /could not be found|not found|expired/i.test(missing), missing)
    check('no browser script errors', errors.length === 0, errors.join(' | '))
  } catch (error) {
    check('the run reached its end', false, String(error).split('\n')[0])
    await page.screenshot({ path: 'out/e2e-failure.png', fullPage: true }).catch(() => {})
  } finally {
    await context.close()
    await browser.close()
  }
  const failed = results.filter((result) => !result.ok).length
  console.log(failed ? `${failed} FAILED` : 'ALL PASS')
  process.exit(failed ? 1 : 0)
}

main()
