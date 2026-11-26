import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { PNG } from 'pngjs'

const code = 'A-261111-001042'
const boardRoutes = ['/dashboard/mine', '/investigate/alerts?view=cards']
const ledgerRoute = '/investigate/ledger?transaction=T-261111-00000001'
const desktop = { width: 1440, height: 960 }
const mobile = { width: 390, height: 844 }

async function fixturePage(browser, { viewport, theme, touch = false }) {
  const page = await browser.newPage({ viewport, colorScheme: theme, reducedMotion: 'no-preference',
    timezoneId: 'Asia/Seoul', isMobile: touch, hasTouch: touch })
  page.setDefaultTimeout(10000)
  await page.addInitScript(({ theme }) => {
    sessionStorage.setItem('aml-live-layout-signed-in', 'true')
    sessionStorage.setItem('aml-live-layout-signed-in-actor', 'demo-admin')
    if (!localStorage.getItem('aml-live-layout-appearance')) {
      localStorage.setItem('aml-live-layout-appearance', JSON.stringify({ theme, reduceMotion: false }))
    }
  }, { theme })
  return page
}

async function openSample(page, origin, path) {
  const url = new URL(path, origin)
  url.searchParams.set('data', 'sample')
  await page.goto(url.href, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => document.fonts.ready)
}

async function setGlass(page, glass) {
  await page.getByRole('button', { name: '설정', exact: true }).click()
  const toggle = page.getByRole('switch', { name: '리퀴드 글래스', exact: true })
  if ((await toggle.getAttribute('aria-checked')) !== String(glass)) await toggle.click()
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('html').getAttribute('data-glassmorphism'), String(glass))
}

async function readCard(card) {
  return card.evaluate(async card => {
    const surface = getComputedStyle(card)
    // Resolving the color starts any pending CSS transition before reading alpha.
    void surface.backgroundColor
    await Promise.all(card.getAnimations().map(animation => animation.finished.catch(() => {})))
    const wrapper = card.closest('.magic-bento__card')
    const wrapperStyle = getComputedStyle(wrapper)
    const filterId = surface.backdropFilter.match(/#([^"')]+)/)?.[1]
    const filter = filterId && document.getElementById(filterId)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')
    context.fillStyle = surface.backgroundColor
    context.fillRect(0, 0, 1, 1)
    return {
      alpha: context.getImageData(0, 0, 1, 1).data[3],
      filter: surface.backdropFilter,
      refracts: Boolean(filter?.querySelector('feDisplacementMap')),
      tilted: card.hasAttribute('data-card-tilted'),
      hover: card.matches(':hover'),
      hoverCapable: matchMedia('(any-hover: hover)').matches,
      glow: Number(getComputedStyle(card.querySelector('.edge-light')).opacity),
      wrapperPaint: [wrapperStyle.backgroundColor, wrapperStyle.backgroundImage,
        wrapperStyle.boxShadow, wrapperStyle.backdropFilter],
      decoration: Array.from(wrapper.querySelectorAll(':scope > :is(.magic-bento__rim, .magic-bento__border)'),
        element => getComputedStyle(element).display),
      overflow: [card, wrapper, card.closest('.case-progress-lane')].map(element => getComputedStyle(element).overflow),
      shell: Array.from(document.querySelectorAll('.app-header, .app-footer'), element => {
        const style = getComputedStyle(element)
        return [style.backgroundColor, style.backgroundImage, style.backdropFilter]
      }),
    }
  })
}

async function checkBoards(browser, origin, { viewport, theme, touch }, inject) {
  const page = await fixturePage(browser, { viewport, theme, touch })
  try {
    for (const route of boardRoutes) {
      await openSample(page, origin, route)
      const card = page.getByRole('region', { name: '처리 완료', exact: true }).getByRole('article', { name: code })
      await card.waitFor()
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme)
      if (inject) await page.addStyleTag({ content: 'html[data-glassmorphism="false"] .magic-bento__rim { display: block !important; }' })
      for (const glass of [false, true]) {
        await setGlass(page, glass)
        await card.scrollIntoViewIfNeeded()
        if (!touch) await page.mouse.move(1, 1)
        if (glass) await page.waitForFunction(selector =>
          getComputedStyle(document.querySelector(selector)).backdropFilter.startsWith('url('),
        `.case-progress-lane[aria-label="처리 완료"] article[aria-label="${code}"]`)
        for (const hover of touch ? [false] : [false, true]) {
          if (hover) await card.hover({ position: { x: 8, y: 45 } })
          const label = `${viewport.width}×${viewport.height} ${theme} ${route} glass=${glass} hover=${hover}`
          const state = await readCard(card)
          assert.equal(state.hoverCapable, !touch, label)
          if (!touch) assert.equal(state.hover, hover, label)
          assert.equal(state.tilted, hover, label)
          assert.equal(state.glow > 0, glass && hover, label)
          assert.equal(state.refracts, glass, label)
          if (glass) assert.ok(state.alpha > 0 && state.alpha < 255, label)
          else {
            assert.equal(state.alpha, 255, label)
            assert.equal(state.filter, 'none', label)
          }
          assert.deepEqual(state.wrapperPaint, ['rgba(0, 0, 0, 0)', 'none', 'none', 'none'], label)
          assert.ok(state.decoration.length && state.decoration.every(display => display === 'none'), `${label}: wrapper rim is visible`)
          assert.deepEqual(state.overflow, ['visible', 'visible', 'visible'], label)
          assert.deepEqual(state.shell, Array.from({ length: 2 }, () => ['rgba(0, 0, 0, 0)', 'none', 'none']), label)
          console.log(`PASS ${label}`)
        }
      }
    }
  } finally {
    await page.close()
  }
}

async function checkLedgerGlow(browser, origin, inject) {
  const page = await fixturePage(browser, { viewport: desktop, theme: 'dark' })
  try {
    await openSample(page, origin, ledgerRoute)
    if (inject) await page.addStyleTag({ content: '[data-card-interactive] { --card-glow-clip-top: -8px !important; }' })
    for (const [label, selector] of [
      ['transaction', '.ledger-transactions [data-card-interactive][aria-selected="true"]'],
      ['related case', '.ledger-related article[data-card-interactive]'],
    ]) {
      const firstCard = page.locator(selector).first()
      await firstCard.scrollIntoViewIfNeeded()
      const list = firstCard.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " record-card-scroll ")][1]')
      const cards = list.locator('[data-card-interactive]')
      const bottomCardIndex = await list.evaluate(scroller => {
        scroller.scrollTop = 0
        const bottom = scroller.getBoundingClientRect().top + scroller.clientTop + scroller.clientHeight
        const maxScroll = scroller.scrollHeight - scroller.clientHeight
        return [...scroller.querySelectorAll('[data-card-interactive]')].findIndex(card => {
          const distance = card.getBoundingClientRect().bottom - bottom + 2
          return distance > 0 && distance < maxScroll
        })
      })
      assert.ok(bottomCardIndex >= 0, `ledger ${label}: expected a card that can scroll to the lower edge`)
      for (const [side, requestedClearance] of [['top', null], ['top', 8], ['top', 2], ['bottom', 2]]) {
        const card = side === 'bottom' ? cards.nth(bottomCardIndex) : firstCard
        await page.mouse.move(1, 1)
        const placement = await card.evaluate(async (card, { side, requestedClearance }) => {
          // The previous hover can still be tilting this card back to its idle geometry.
          void getComputedStyle(card).transform
          await Promise.all(card.getAnimations().map(animation => animation.finished.catch(() => {})))
          const scroller = card.closest('.record-card-scroll')
          scroller.scrollTop = 0
          const top = Math.ceil(scroller.getBoundingClientRect().top + scroller.clientTop)
          const bottom = top + scroller.clientHeight
          if (requestedClearance !== null) {
            const bounds = card.getBoundingClientRect()
            scroller.scrollTop = side === 'top' ? bounds.top - top - requestedClearance
              : bounds.bottom - bottom + requestedClearance
          }
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          const bounds = card.getBoundingClientRect()
          return { top, bottom, clearance: side === 'top' ? bounds.top - top : bottom - bounds.bottom }
        }, { side, requestedClearance })
        const description = `ledger ${label} at ${side} with ${placement.clearance.toFixed(1)}px clearance`
        assert.ok(requestedClearance === null ? placement.clearance >= 14
          : placement.clearance >= 0 && Math.abs(placement.clearance - requestedClearance) <= 2, description)
        const box = await card.boundingBox()
        // A real pointer at this position must leave the scroll offset intact.
        await page.mouse.move(box.x + box.width / 2, side === 'top' ? box.y + 6 : box.y + box.height - 6)
        const light = card.locator('.edge-light')
        const glow = await light.evaluate(async element => {
          const style = getComputedStyle(element)
          for (let frame = 0; frame < 120 && Number(style.opacity) <= 0.5; frame++) await new Promise(requestAnimationFrame)
          return Number(style.opacity)
        })
        assert.ok(glow > 0.5, `${description}: hover glow must be active`)
        await card.evaluate(async card => {
          const glow = card.querySelector('.edge-light')
          await Promise.all([...card.getAnimations(), ...glow.getAnimations()].map(animation =>
            animation.finished.catch(() => {})))
        })
        const height = Math.ceil(placement.clearance) + 16
        const clip = { x: Math.floor(box.x + box.width / 2) - 16,
          y: side === 'top' ? placement.top : placement.bottom - height, width: 32, height }
        const lit = PNG.sync.read(await page.screenshot({ clip }))
        await light.evaluate(element => { element.style.visibility = 'hidden' })
        const unlit = PNG.sync.read(await page.screenshot({ clip }))
        await light.evaluate(element => { element.style.removeProperty('visibility') })
        let boundary = 0
        let peak = 0
        for (let index = 0; index < lit.data.length; index += 4) {
          const delta = Math.max(...[0, 1, 2].map(channel => Math.abs(lit.data[index + channel] - unlit.data[index + channel])))
          const y = Math.floor(index / (clip.width * 4))
          if (side === 'top' ? y < 2 : y >= height - 2) boundary = Math.max(boundary, delta)
          peak = Math.max(peak, delta)
        }
        assert.ok(boundary <= 3, `${description}: glow is cut off at the scroll edge (${boundary})`)
        if (requestedClearance !== 2) assert.ok(peak > 10, `${description}: expected visible glow near the card`)
        console.log(`PASS ${description}`)
      }
    }
  } finally {
    await page.close()
  }
}

export async function checkRecordCardMaterial(browser, origin, { inject } = {}) {
  if (inject !== 'ledger') {
    await checkBoards(browser, origin, { viewport: desktop, theme: 'light' }, inject === 'wrapper')
    await checkBoards(browser, origin, { viewport: desktop, theme: 'dark' })
    await checkBoards(browser, origin, { viewport: mobile, theme: 'dark', touch: true })
  }
  await checkLedgerGlow(browser, origin, inject === 'ledger')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const browser = await chromium.launch({ channel: 'chrome' })
  try {
    await checkRecordCardMaterial(browser, process.argv[2] ?? 'http://127.0.0.1:5173')
  } finally {
    await browser.close()
  }
}
