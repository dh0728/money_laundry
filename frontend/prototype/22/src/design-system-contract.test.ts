import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
const source = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')

describe('design-system contract', () => {
  it('declares semantic type, motion, interaction, and radar tokens', () => {
    for (const token of [
      '--text-display-size', '--text-title-size', '--text-body-size', '--text-caption-size', '--text-micro-size',
      '--motion-instant', '--motion-fast', '--motion-normal', '--motion-morph', '--ease-standard', '--ease-emphasized',
      '--interactive-edge-glow', '--radar-core-hot', '--radar-core-deep', '--radar-bezel-light', '--radar-bezel-mid', '--radar-bezel-dark', '--radar-disc',
    ]) expect(css).toContain(token)
  })

  it('keeps raw hex colors out of app-owned TSX', () => {
    for (const file of ['Agent.tsx', 'App.tsx', 'Dashboard.tsx', 'Detail.tsx', 'FlowDetail.tsx', 'Graph.tsx', 'Lists.tsx', 'LoginNetwork.tsx', 'shared.tsx', 'TransactionsV22.tsx', 'UtilityPages.tsx']) {
      expect(source(file), file).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    }
  })

  it('uses named motion tokens for product indicators', () => {
    expect(css).toMatch(/\.tab-indicator[^}]*var\(--motion-morph\)/s)
    expect(css).toMatch(/\.sidebar-indicator[^}]*var\(--motion-morph\)/s)
  })
})
