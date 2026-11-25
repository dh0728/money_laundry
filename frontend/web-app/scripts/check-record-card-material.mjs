import assert from 'node:assert/strict'
import { chromium } from 'playwright'

// Run against the local fixture server: node scripts/check-record-card-material.mjs [origin]
const origin = process.argv[2] ?? 'http://127.0.0.1:5173'
const code = 'A-261111-001042'
const browser = await chromium.launch({ channel: 'chrome' })

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'light',
    reducedMotion: 'no-preference',
  })
  for (const route of ['/dashboard/mine', '/investigate/alerts']) {
    await page.goto(new URL(`${route}?data=sample`, origin).href)
    if (new URL(page.url()).pathname === '/login') {
      await page.getByRole('button', { name: '분석가로 간편 로그인', exact: true }).click()
    }

    const card = page.getByRole('region', { name: '처리 완료', exact: true }).getByRole('article', { name: code })
    await card.waitFor()

    for (const glass of [false, true]) {
      const settings = page.getByRole('button', { name: '설정', exact: true })
      const toggle = page.getByRole('switch', { name: '리퀴드 글래스', exact: true })
      await settings.click()
      if ((await toggle.getAttribute('aria-checked')) !== String(glass)) await toggle.click()
      await page.keyboard.press('Escape')
      assert.equal(await page.locator('html').getAttribute('data-glassmorphism'), String(glass))

      await card.scrollIntoViewIfNeeded()
      await page.mouse.move(1, 1)
      for (const hover of [false, true]) {
        if (hover) await card.hover({ position: { x: 8, y: 45 } })
        const label = `${route} glass=${glass} hover=${hover}`
        await page.waitForFunction(({ code, hover, glass }) => {
          const card = document.querySelector(`article[aria-label="${code}"]`)
          const glow = card.querySelector('.edge-light')
          return card.matches(':hover') === hover
            && (Number(getComputedStyle(glow).opacity) > 0) === (hover && glass)
            && (!glass || getComputedStyle(card).backdropFilter.startsWith('url('))
        }, { code, hover, glass })

        const state = await card.evaluate(card => {
          const surface = getComputedStyle(card)
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
            opacity: context.getImageData(0, 0, 1, 1).data[3],
            filter: surface.backdropFilter,
            refracts: Boolean(filter?.querySelector('feDisplacementMap')),
            tilted: card.hasAttribute('data-card-tilted'),
            wrapperPaint: [wrapperStyle.backgroundColor, wrapperStyle.backgroundImage,
              wrapperStyle.boxShadow, wrapperStyle.backdropFilter],
            decoration: Array.from(wrapper.querySelectorAll(':scope > :is(.magic-bento__rim, .magic-bento__border)'),
              element => getComputedStyle(element).display),
            overflow: [card, wrapper, card.closest('.case-progress-lane')].map(
              element => getComputedStyle(element).overflow),
            chrome: Array.from(document.querySelectorAll('.app-header, .app-footer'), element => {
              const style = getComputedStyle(element)
              return [style.backgroundColor, style.backgroundImage, style.backdropFilter]
            }),
          }
        })

        assert.equal(state.tilted, hover, label)
        assert.equal(state.refracts, glass, label)
        if (glass) assert.ok(state.opacity > 0 && state.opacity < 255, label)
        else {
          assert.equal(state.opacity, 255, label)
          assert.equal(state.filter, 'none', label)
        }
        assert.deepEqual(state.wrapperPaint, ['rgba(0, 0, 0, 0)', 'none', 'none', 'none'], label)
        assert.ok(state.decoration.every(display => display === 'none'), label)
        assert.deepEqual(state.overflow, ['visible', 'visible', 'visible'], label)
        assert.deepEqual(state.chrome, Array.from({ length: 2 }, () => ['rgba(0, 0, 0, 0)', 'none', 'none']), label)
        console.log(`PASS ${label}`)
      }
    }
  }
} finally {
  await browser.close()
}
