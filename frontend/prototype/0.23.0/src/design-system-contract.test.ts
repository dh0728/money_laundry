import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
const source = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')
const files = readdirSync(new URL('.', import.meta.url), { recursive: true }).filter((file): file is string => typeof file === 'string' && /\.(tsx?|css)$/.test(file) && !/\.test\./.test(file))
const withoutTokens = css.replace(/(?:^|\n)(?::root|\.dark)\s*\{[^}]*\}/g, block => block.replace(/--[\w-]+\s*:[^;]+;/g, ''))
const rawColor = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lch|lab)\(\s*[\d.$]|\b(?:text|bg|border|fill|stroke|ring|shadow)-(?:white|black|(?:red|blue|gray|zinc|slate|neutral|stone|green|amber|yellow|rose|emerald|orange|lime|teal|cyan|sky|indigo|violet|purple|fuchsia|pink)-\d+)\b|["'](?:white|black|red|green|blue|gray|grey|yellow|orange|purple|pink)["']|[:,]\s*(?:white|black|red|green|blue|gray|grey|yellow|orange|purple|pink)\s*(?:!important\s*)?[;,)\]]/i

describe('design-system contract', () => {
  it('declares semantic type, motion, interaction, and radar tokens', () => {
    for (const token of [
      '--text-display-size', '--text-title-size', '--text-body-size', '--text-caption-size', '--text-micro-size',
      '--motion-instant', '--motion-fast', '--motion-normal', '--motion-morph', '--ease-standard', '--ease-emphasized',
      '--interactive-edge-glow', '--radar-core-hot', '--radar-core-deep', '--radar-bezel-light', '--radar-bezel-mid', '--radar-bezel-dark', '--radar-disc',
    ]) expect(css).toContain(token)
  })

  it('keeps every production color primitive in theme token definitions', () => {
    const violations = files.flatMap(file => {
      let content = file === 'index.css' ? withoutTokens : source(file)
      // Recharts emits these literal stroke attributes. Matching them overrides
      // third-party defaults with semantic colors; it does not paint a primitive.
      if (file === 'components/ui/chart.tsx') content = content.replace(/\[stroke='#(?:ccc|fff)'\]/g, '')
      return content.split('\n').flatMap((line, index) => rawColor.test(line) ? [`${file}:${index + 1}: ${line.trim()}`] : [])
    })
    expect(violations).toEqual([])
  })

  it('connects typography roles to real product consumers', () => {
    for (const role of ['display', 'title', 'body', 'caption']) {
      expect(withoutTokens).toMatch(new RegExp(`\\.type-${role}\\s*\\{[^}]*font-size:\\s*var\\(--text-${role}-size\\)`))
      expect(files.filter(file => file.endsWith('.tsx')).some(file => source(file).includes(`type-${role}`))).toBe(true)
    }
    expect(source('shared.tsx')).toContain('type-title')
    expect(source('shared.tsx')).toContain('type-caption')
  })

  it('connects instant, fast, normal and emphasized motion to product styles', () => {
    for (const token of ['--motion-instant', '--motion-fast', '--motion-normal', '--ease-emphasized']) expect(withoutTokens).toContain(`var(${token})`)
    expect(withoutTokens).toMatch(/\.rdr-morph\s*\{[^}]*var\(--ease-emphasized\)/)
    expect(withoutTokens).toMatch(/\[data-animate=false\][^{]*\{[^}]*var\(--motion-instant\)/)
    expect(source('Agent.tsx')).not.toMatch(/transition:\s*['"]|duration-\d+/)
    expect(withoutTokens).not.toMatch(/(?:transition|animation)(?:-duration|-timing-function)?:[^;}]*\b\d*\.?\d+(?:ms|s)\b/)
    expect(files.filter(file => file.endsWith('.tsx') && /(?<![-\w])(?:duration-\d+|ease-(?:linear|in|out|in-out))\b/.test(source(file)))).toEqual([])
  })

  it('uses named motion tokens for product indicators', () => {
    expect(css).toMatch(/\.tab-indicator[^}]*var\(--motion-morph\)/s)
    expect(css).toMatch(/\.sidebar-indicator[^}]*var\(--motion-morph\)/s)
  })
})
