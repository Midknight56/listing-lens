// Check the empty page and an East Nashville brief at phone and tablet widths.
//   node tools/phones.mjs [base url]
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

// Optional: --token-file <file with WARM_TOKEN=...> sends the operator header, so test runs skip the per visitor
// caps (the daily totals still apply). The token is never printed.
// Optional: --lock-only skips the check for other headless browsers; use it only inside the shared browser lock.
function operatorHeaders() {
  const at = process.argv.indexOf('--token-file')
  if (at < 0) return {}
  const rows = readFileSync(process.argv[at + 1], 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)
  const line = rows.find((row) => row.startsWith('WARM_TOKEN=')) ?? rows[0]
  return { 'X-Warm-Token': line.replace(/^WARM_TOKEN=/, '').trim().replace(/^"|"$/g, '') }
}

const BASE = (process.argv.slice(2).find((arg) => arg.startsWith('http')) ?? 'http://127.0.0.1:8787').replace(/\/$/, '')
// Optional: --assets <folder> serves the page files from that folder while the API stays on the host, so a page change
// is measured before it is deployed.
async function localAssets(context) {
  const at = process.argv.indexOf('--assets')
  if (at < 0) return
  const dir = process.argv[at + 1]
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
  await context.route((url) => url.origin === BASE && !/^\/(api|mcp|health)/.test(url.pathname), (route) => {
    const { pathname } = new URL(route.request().url())
    const file = path.join(dir, pathname === '/' || pathname.startsWith('/s/') ? 'index.html' : pathname)
    if (!existsSync(file)) return route.continue()
    return route.fulfill({ status: 200, contentType: types[path.extname(file)] || 'application/octet-stream', body: readFileSync(file) })
  })
}

const WIDTHS = [320, 344, 360, 375, 390, 393, 402, 412, 420, 440, 466, 669, 707, 820, 1280]
const failures = []

function busy() {
  return execSync('tasklist /FO CSV /NH', { encoding: 'utf8' }).split('\n').filter((line) => /chrome-headless-shell|playwright/i.test(line)).length
}
async function measure(page) {
  return page.evaluate(() => {
    const faults = []
    const width = document.documentElement.clientWidth
    if (document.documentElement.scrollWidth > width + 1) faults.push(`sideways scroll: ${document.documentElement.scrollWidth} px in ${width} px`)
    const visible = [...document.querySelectorAll('button')].filter((button) => {
      const rect = button.getBoundingClientRect()
      const style = getComputedStyle(button)
      if (!rect.width || !rect.height || style.visibility === 'hidden' || button.closest('[hidden]')) return false
      if (rect.right <= 0 || rect.left >= innerWidth || rect.bottom <= 0 || rect.top >= innerHeight) return false
      const hit = document.elementFromPoint(Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2)), Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2)))
      return hit && (button === hit || button.contains(hit) || hit.contains(button))
    })
    const boxes = visible.map((button) => {
      const source = button.getBoundingClientRect()
      let left = source.left, right = source.right, top = source.top, bottom = source.bottom
      const scroller = button.closest('.preset-row')
      if (scroller) {
        const clip = scroller.getBoundingClientRect()
        left = Math.max(left, clip.left); right = Math.min(right, clip.right)
        top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom)
      }
      const rect = { left, right, top, bottom, width: right - left, height: bottom - top }
      const style = getComputedStyle(button)
      const name = (button.innerText || button.getAttribute('aria-label') || 'Unnamed button').replace(/\s+/g, ' ').trim().slice(0, 36)
      if (rect.left < 16 - 0.5 || width - rect.right < 16 - 0.5) faults.push(`"${name}" is less than 16 px from the screen edge`)
      if (rect.height < 44 - 0.5) faults.push(`"${name}" is ${Math.round(rect.height)} px tall`)
      if (parseFloat(style.paddingLeft) < 8 || parseFloat(style.paddingRight) < 8 || parseFloat(style.paddingTop) < 8 || parseFloat(style.paddingBottom) < 8) faults.push(`"${name}" has less than 8 px text padding`)
      if (button.scrollWidth > button.clientWidth + 1) faults.push(`"${name}" text overflows its button`)
      return { button, rect, name }
    })
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j]
      const overlapX = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left)
      const overlapY = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top)
      if (overlapX > 0 && overlapY > 0) faults.push(`"${a.name}" overlaps "${b.name}"`)
      else if (overlapY > 0) {
        const gap = Math.max(b.rect.left - a.rect.right, a.rect.left - b.rect.right)
        if (gap < 12 - 0.5) faults.push(`"${a.name}" and "${b.name}" have ${Math.round(gap)} px between them`)
      } else if (overlapX > 0) {
        const gap = Math.max(b.rect.top - a.rect.bottom, a.rect.top - b.rect.bottom)
        if (gap < 12 - 0.5) faults.push(`"${a.name}" and "${b.name}" have ${Math.round(gap)} px between them`)
      }
    }
    return faults
  })
}

async function main() {
  const count = process.argv.includes('--lock-only') ? 0 : busy()
  if (count) { console.log(`HELD: ${count} headless browser processes of another run are alive`); process.exit(3) }
  mkdirSync('out/phones', { recursive: true })
  const browser = await chromium.launch({ headless: true })
  try {
    for (const width of WIDTHS) {
      const context = await browser.newContext({ viewport: { width, height: width > 600 ? 1024 : 800 }, deviceScaleFactor: 2, isMobile: width < 600, hasTouch: width < 600, extraHTTPHeaders: operatorHeaders() })
      await localAssets(context)
      const page = await context.newPage()
      await page.goto(BASE + '/')
      await page.locator('.preset-card').first().waitFor({ timeout: 15000 })
      const emptyFaults = await measure(page)
      await page.screenshot({ path: `out/phones/${width}-empty.png`, fullPage: false })
      for (const fault of emptyFaults) failures.push(`${width} empty: ${fault}`)

      // One real tap, as a visitor would: the example starts its own brief.
      await page.locator('.preset-card').filter({ hasText: 'East Nashville' }).first().click()
      await page.locator('#listing-paragraph').waitFor({ timeout: 120000 })
      const briefFaults = await measure(page)
      await page.screenshot({ path: `out/phones/${width}-east-nashville.png`, fullPage: false })
      for (const fault of briefFaults) failures.push(`${width} East Nashville: ${fault}`)
      console.log(`${width}: empty ${emptyFaults.length ? 'FAIL' : 'PASS'}, East Nashville ${briefFaults.length ? 'FAIL' : 'PASS'}`)
      await context.close()
    }
  } finally { await browser.close() }
  for (const failure of failures) console.log('FAIL ' + failure)
  console.log(failures.length ? `${failures.length} FAULTS` : `ALL PASS at ${WIDTHS.length} widths`)
  process.exit(failures.length ? 1 : 0)
}

main()
