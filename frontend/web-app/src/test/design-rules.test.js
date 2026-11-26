// 디자인 규칙 트리(scripts/design-rules.mjs) 중 lint로 못 잡는 규칙을 구조로 확인한다.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bannedIconPackage, designRules } from '../../scripts/design-rules.mjs';

const app = resolve(import.meta.dirname, '../..');
const repo = resolve(app, '../..');
const read = path => readFileSync(resolve(app, path), 'utf8');
const json = path => JSON.parse(read(path));

describe('component/table-style', () => {
  const css = read('src/components/ui/table.css');
  const tokens = read('src/styles/tokens.css');
  it('행 가로선이 없다', () => {
    expect(css).toMatch(/border-block-start-width:\s*0/);
    expect(css).toMatch(/border-block-end-width:\s*0/);
  });
  it('열 세로선은 기존 테두리 토큰 30%로 모든 행에 그린다', () => {
    expect(tokens).toMatch(/--table-column-divider-strength:\s*30%;/);
    expect(css).toMatch(/:is\(th, td\):not\(:last-child\)\s*\{\s*border-inline-end:[^;]*var\(--aml-data-grid[^;]*var\(--table-column-divider-strength\)/);
  });
  it('머리글을 1행으로 세어 홀수 행에만 반대색 3%를 얹는다', () => {
    expect(tokens).toMatch(/--table-stripe-strength:\s*3%;/);
    expect(css).toMatch(/--table-stripe-tint:\s*color-mix\(in srgb, light-dark\(var\(--aml-black-100\), var\(--aml-white-100\)\) var\(--table-stripe-strength\), transparent\)/);
    expect(css).toMatch(/thead tr > :is\(th, td\),\s*\[data-slot="table"\] tbody tr:nth-child\(even\) > :is\(th, td\)\s*\{\s*background-image:\s*linear-gradient\(var\(--table-stripe-tint\), var\(--table-stripe-tint\)\)/);
  });
  it('공용 Table이 규격 CSS를 불러온다', () => {
    expect(read('src/components/ui/table.tsx')).toMatch(/import "\.\/table\.css"/);
    expect(read('src/components/ui/table.tsx')).toMatch(/data-slot="table"/);
  });
});

describe('component/table-css', () => {
  it('표 이름과 버튼 크기 이름을 구분한다', async () => {
    const { default: stylelint } = await import('stylelint');
    const { stylelintPlugins } = await import('../../scripts/design-lint-plugin.mjs');
    const code = [
      '.screen-primary[data-button-size="comfortable"]',
      '.stable-control',
      '.report-table tbody > tr',
      '[data-slot="table-cell"]',
      '.caseTableRows',
      '.datatable',
      'td',
    ].map(selector => `${selector} { padding: 0 }`).join('\n');
    const { results } = await stylelint.lint({
      cwd: app,
      code,
      codeFilename: resolve(app, 'src/features/sample.css'),
      config: { plugins: stylelintPlugins, rules: { 'aml/component-table-css': true } },
    });
    expect(results[0].warnings.map(warning => warning.line)).toEqual([3, 4, 5, 6, 7]);
  });
});

describe('font/tokens', () => {
  it('글꼴 토큰은 Pretendard 단독이다', () => {
    const fonts = read('src/styles/fonts.css');
    const families = [...fonts.matchAll(/--aml-font-[\w-]*family[\w-]*:\s*([^;]+);/g)].map(match => match[1].trim());
    expect(families.length).toBeGreaterThan(0);
    for (const family of families) expect(family).toMatch(/^(Pretendard|var\(--aml-font-family\))$/);
  });
  it('public/fonts에는 Pretendard 파일만 있다', () => {
    for (const file of readdirSync(resolve(app, 'public/fonts'))) expect(file).toMatch(/^Pretendard/);
  });
});

describe('contrast-shape/zoom', () => {
  it.each(['index.html', 'components.html', 'ant-review.html'])('%s는 확대를 막지 않는다', file => {
    const viewport = read(file).match(/<meta name="viewport" content="([^"]+)"/)?.[1] ?? '';
    expect(viewport).toContain('width=device-width');
    expect(viewport).not.toMatch(/user-scalable\s*=\s*(no|0)|maximum-scale/);
  });
});

describe('contrast-shape/motion-setting', () => {
  it('움직임 끄기 장치가 앱 설정을 따른다', () => {
    const css = read('src/app/layout.css');
    expect(css).toMatch(/:root\[data-reduced-motion="true"\] \*,[^{]*\{[^}]*animation-duration:[^}]*transition-duration:/);
  });
  it('JS 움직임은 hooks/use-reduced-motion 한 곳을 거친다', () => {
    const helper = read('src/hooks/use-reduced-motion.ts');
    for (const name of ['appReducedMotion', 'useAppReducedMotion', 'subscribeReducedMotion', 'MotionGlobalConfig.skipAnimations', 'dataset.reducedMotion'])
      expect(helper).toContain(name);
  });
});

describe('icon/library', () => {
  it('아이콘 의존성은 lucide-react 하나다', () => {
    const pkg = json('package.json');
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(names).toContain('lucide-react');
    expect(names.filter(bannedIconPackage)).toEqual([]);
  });
  it('허용 목록 밖의 아이콘 패키지는 막는다', () => {
    for (const source of ['@hugeicons/react', '@iconify/react', '@mui/icons-material/Add', 'react-feather', '@tabler/icons-react', 'lucide'])
      expect(bannedIconPackage(source), source).toBe(true);
    for (const source of ['lucide-react', '../components/icon-button', '@/components/icon-button', 'react', '@number-flow/react'])
      expect(bannedIconPackage(source), source).toBe(false);
  });
});

describe('escape-hatch', () => {
  const ids = new Set(designRules.map(rule => rule.id));
  it('예외는 규칙·파일·이유·만료일을 갖고 만료되지 않았다', () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const entry of json('scripts/design-exceptions.json')) {
      expect(ids.has(entry.rule), entry.rule).toBe(true);
      expect(entry.file && existsSync(resolve(app, entry.file)), entry.file).toBe(true);
      expect(entry.reason?.trim()).toBeTruthy();
      expect(entry.expires).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.expires >= today, `${entry.rule} ${entry.file} 만료`).toBe(true);
    }
  });
  it('상한 파일은 ratchet 규칙만 갖는다', () => {
    const ratchet = designRules.filter(rule => rule.level === 'ratchet').map(rule => rule.id).sort();
    expect(Object.keys(json('scripts/design-baseline.json')).sort()).toEqual(ratchet);
    for (const cap of Object.values(json('scripts/design-baseline.json'))) expect(Number.isInteger(cap) && cap >= 0).toBe(true);
  });
});

describe('automation', () => {
  it('frontend·dev 병합 요청과 dev 푸시의 CI가 위반 0건과 실제 API 빌드를 검사한다', () => {
    const ci = readFileSync(resolve(repo, '.github/workflows/ci.yml'), 'utf8').replaceAll('\r\n', '\n');
    for (const [event, expected] of Object.entries({ push: ['dev'], pull_request: ['frontend', 'dev'] })) {
      const branches = ci.match(new RegExp(`^  ${event}:\\n    branches:\\n((?:      - [^\\n]+\\n)+)`, 'm'))?.[1];
      for (const branch of expected) expect(branches).toContain(`- ${branch}\n`);
    }
    for (const step of ['pnpm run lint\n', 'pnpm run lint:design --strict', 'pnpm test', 'pnpm run build', 'VITE_API_MODE: live']) expect(ci).toContain(step);
  });
  it('lefthook이 커밋 전 eslint·stylelint·lint:design, push 전 lint:design을 돈다', () => {
    const hooks = readFileSync(resolve(repo, 'lefthook.yml'), 'utf8');
    const [preCommit, prePush] = hooks.split(/^pre-push:/m);
    expect(preCommit).toMatch(/pre-commit:[^]*eslint[^]*stylelint[^]*run: pnpm run lint:design:staged/);
    expect(prePush).toContain('run: pnpm run lint:design');
    expect(json('package.json').scripts['lint:design:staged']).toBe('node scripts/design-report-staged.mjs');
    expect(json('package.json').scripts.prepare).toContain('lefthook');
  });
});

describe('component/raw-element', () => {
  it('기본 검사에서도 화면의 맨 태그를 표시한다', async () => {
    const { ESLint } = await import('eslint');
    const [result] = await new ESLint({ cwd: app }).lintText('export const Sample = () => <div />;', {
      filePath: resolve(app, 'src/features/dashboard/sample.jsx'),
    });
    expect(result.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: 'aml/component-raw-element' }),
    ]));
  }, 30000);

  it('Box·Text의 as로 버튼을 숨기거나 누르는 상자를 만들면 걸린다', async () => {
    const { ESLint } = await import('eslint');
    const code = "import { Box } from '../../components/layout-primitives';\n" +
      'export const A = () => <Box as="button">x</Box>;\nexport const B = () => <Box as="section" onClick={() => 1}>x</Box>;\n';
    const [result] = await new ESLint({ cwd: app }).lintText(code, { filePath: resolve(app, 'src/features/notifications/sample.jsx') });
    const rules = result.messages.map(message => message.ruleId);
    expect(rules).toContain('aml/component-raw-element');
    expect(rules).toContain('aml/component-clickable-element');
  }, 30000);
});

describe('dashboard design boundaries', () => {
  it('accepts common components and type imports but rejects direct UI implementations', async () => {
    const { ESLint } = await import('eslint');
    const code = [
      "import { Panel } from '@/components/panel';",
      "import type { DateRange } from 'react-day-picker';",
      "import { DayPicker } from 'react-day-picker';",
      "export { Dialog } from '@radix-ui/react-dialog';",
      "export const load = () => import('recharts');",
      'export const Html = () => <Panel dangerouslySetInnerHTML={{ __html: html }} />;',
      'export const Token = () => <Panel style={{ "--aml-type-body-size": "inherit" }} />;',
      'element.style.setProperty("--aml-type-body-size", "inherit");',
      'export const Color = () => <Panel color="red" />;',
      'export const Safe = () => <Panel style={{ "--dashboard-accent": "var(--text)" }} />;',
    ].join('\n');
    const [result] = await new ESLint({ cwd: app }).lintText(code, { filePath: resolve(app, 'src/features/dashboard/example.tsx') });
    expect(result.fatalErrorCount).toBe(0);
    for (const [id, lines] of [['component-dashboard-ui-source', [3, 4, 5, 6]], ['token-dashboard-usage', [7, 8, 9]]]) {
      const messages = result.messages.filter(message => message.ruleId === `aml/${id}`);
      expect(messages.map(message => [message.line, message.severity])).toEqual(lines.map(line => [line, 2]));
    }
  }, 30000);

  it('accepts local aliases of tokens and rejects direct color, keyword sizing and public token overrides', async () => {
    const stylelint = (await import('stylelint')).default;
    const { stylelintPlugins, designStylelintRules } = await import('../../scripts/design-lint-plugin.mjs');
    const result = await stylelint.lint({
      cwd: app,
      codeFilename: resolve(app, 'src/features/dashboard/example.css'),
      code: [
        '.ok { --dashboard-ink: var(--text); color: var(--dashboard-ink); font-size: var(--aml-type-body-size); }',
        '.size { font-size: large; }',
        '.paint { color: red; }',
        '.override { --aml-type-body-size: inherit; }',
        '@property --aml-type-body-size { syntax: "<length>"; inherits: true; initial-value: 0px; }',
        '.background { background: blue; }',
      ].join('\n'),
      config: { plugins: stylelintPlugins, rules: { 'aml/token-dashboard-usage': designStylelintRules['aml/token-dashboard-usage'] } },
    });
    const warnings = result.results[0].warnings;
    expect(warnings.map(warning => [warning.line, warning.severity]).sort((left, right) => left[0] - right[0]))
      .toEqual([2, 3, 4, 5, 6].map(line => [line, 'error']));
  });

  it('rejects base controls and new entry points outside the approved dashboard catalog', async () => {
    const { ESLint } = await import('eslint');
    const code = [
      "import GlideSelect from '@/components/react-bits/GlideSelect';",
      "import { ActionButton } from '../../components/primary-button';",
      "import { Select } from '../../components/ui/select.tsx';",
      "export { Select as DashboardSelect } from '@/components/ui/select';",
      "export const load = () => import('@/components/NewDashboardControl');",
    ].join('\n');
    const [result] = await new ESLint({ cwd: app }).lintText(code, { filePath: resolve(app, 'src/features/dashboard/example.tsx') });
    expect(result.messages.filter(message => message.ruleId === 'aml/component-dashboard-ui-source').map(message => message.line))
      .toEqual([3, 4, 5]);
  }, 30000);

  it('rejects a basic control copied into a different shared module', async () => {
    const { ESLint } = await import('eslint');
    const eslint = new ESLint({ cwd: app });
    const code = 'export const Control = () => <button type="button">Select</button>;';
    const [newControl] = await eslint.lintText(code, { filePath: resolve(app, 'src/components/new-control.tsx') });
    const [owner] = await eslint.lintText(code, { filePath: resolve(app, 'src/components/react-bits/GlideSelect.tsx') });
    const ownerRule = message => message.ruleId === 'aml/component-control-owner';
    expect(newControl.messages.some(ownerRule)).toBe(true);
    expect(owner.messages.some(ownerRule)).toBe(false);
  }, 30000);

  it('requires the workspace table shell and the created Alert color', async () => {
    const { ESLint } = await import('eslint');
    const code = [
      "import { WorkflowTable } from '@/components/workflow-table';",
      "import { TableCell } from '@/components/ui/table';",
      "import { Table as OtherTable } from '../../components/ui/table';",
      "export const bad = { label: '생성 Alert', color: dataSeriesColors.teal };",
      "export const good = { label: '생성 Episode', color: caseCreatedSeriesColor };",
    ].join('\n');
    const [result] = await new ESLint({ cwd: app }).lintText(code, { filePath: resolve(app, 'src/features/dashboard/example.tsx') });
    const designMessages = result.messages.filter(message => message.ruleId?.startsWith('aml/'));
    expect(designMessages.map(message => [message.ruleId, message.line])).toEqual([
      ['aml/component-dashboard-ui-source', 3], ['aml/token-series-color', 4],
    ]);
  }, 30000);
});

describe('token/inline-style', () => {
  it('타입 표기와 조건부 스타일 안에서도 실제 CSS 속성을 검사한다', async () => {
    const { ESLint } = await import('eslint');
    const examples = [
      ['({ "--position": position } as CSSProperties)', false],
      ['({ "--position": position } satisfies CSSProperties)', false],
      ['({ "--position": position } as CSSProperties)!', false],
      ['active ? ({ "--position": position } as CSSProperties) : undefined', false],
      ['active ? null : ({ "--position": position } as CSSProperties)', false],
      ['({ left: position } as CSSProperties)', true],
      ['({ "--position": position, left: position } satisfies CSSProperties)', true],
      ['active ? ({ "--position": position } as CSSProperties) : { left: position }', true],
      ['({ ...unverified, "--position": position } as CSSProperties)', true],
      ['unverified as CSSProperties', true],
    ];
    const definitions = [
      'import type { CSSProperties } from "react";',
      'declare const position: string, active: boolean, unverified: CSSProperties;',
    ];
    const shadowed = 'export const Shadowed = (undefined: CSSProperties) => <div style={active ? { "--position": position } : undefined} />;';
    const code = [...definitions, ...examples.map(([expression], index) =>
      `export const Example${index} = () => <div style={${expression}} />;`), shadowed].join('\n');
    const [result] = await new ESLint({ cwd: app }).lintText(code, {
      filePath: resolve(app, 'src/components/design-style-example.tsx'),
    });
    expect(result.fatalErrorCount).toBe(0);
    const expected = examples.flatMap(([, error], index) => error ? [definitions.length + index + 1] : []);
    expect(result.messages.filter(message => message.ruleId === 'aml/token-inline-style').map(message => message.line))
      .toEqual([...expected, definitions.length + examples.length + 1]);
  }, 30000);
});
