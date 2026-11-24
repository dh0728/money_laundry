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
  it('행 가로선이 없다', () => {
    expect(css).toMatch(/border-block-start-width:\s*0/);
    expect(css).toMatch(/border-block-end-width:\s*0/);
  });
  it('열 세로선은 기존 테두리 토큰 30%로 모든 행에 그린다', () => {
    expect(css).toMatch(/:is\(th, td\):not\(:last-child\)\s*\{\s*border-inline-end:[^;]*var\(--aml-data-grid[^;]*30%/);
  });
  it('머리글을 1행으로 세어 홀수 행에만 반대색 3%를 얹는다', () => {
    expect(css).toMatch(/thead tr > :is\(th, td\),\s*\[data-slot="table"\] tbody tr:nth-child\(even\) > :is\(th, td\)/);
    expect(css).toMatch(/light-dark\(var\(--aml-black-100[^\n]*var\(--aml-white-100[^\n]*\)\) 3%, transparent\)/);
  });
  it('공용 Table이 규격 CSS를 불러온다', () => {
    expect(read('src/components/ui/table.tsx')).toMatch(/import "\.\/table\.css"/);
    expect(read('src/components/ui/table.tsx')).toMatch(/data-slot="table"/);
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
  it('세 작업 브랜치의 CI가 위반 0건과 실제 API 빌드를 검사한다', () => {
    const ci = readFileSync(resolve(repo, '.github/workflows/ci.yml'), 'utf8').replaceAll('\r\n', '\n');
    for (const event of ['push', 'pull_request']) {
      const branches = ci.match(new RegExp(`^  ${event}:\\n    branches:\\n((?:      - [^\\n]+\\n)+)`, 'm'))?.[1];
      for (const branch of ['fe/work', 'frontend', 'dev']) expect(branches).toContain(`- ${branch}\n`);
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
