// 디자인 규칙(aml/*) CSS 검사. 규칙 목록은 scripts/design-rules.mjs, 구현은 scripts/design-lint-plugin.mjs.
// 기본 검사에서 위반을 표시하고, pnpm lint:design은 규칙별 상한도 확인한다.
import { designStylelintRules, stylelintPlugins } from './scripts/design-lint-plugin.mjs'

export default {
  // CSS 검사는 디자인 규칙뿐이다. 주석으로 끌 수 없게 disable 주석을 무시한다.
  ignoreDisables: true,
  plugins: stylelintPlugins,
  rules: designStylelintRules,
}
