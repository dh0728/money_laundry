// 화면 동일성 검사: 같은 화면을 고치기 전·후로 찍어 DOM 구조와 픽셀을 비교한다.
// 실행(frontend/web-app에서, dev 서버가 떠 있어야 한다):
//   node ../../.agents/skills/raw-element-migration/scripts/parity.mjs capture before dash-all "/dashboard/all?data=sample"
//   node ../../.agents/skills/raw-element-migration/scripts/parity.mjs capture after  dash-all "/dashboard/all?data=sample"
//   node ../../.agents/skills/raw-element-migration/scripts/parity.mjs compare dash-all
// 환경 변수: BASE(기본 http://127.0.0.1:5173) · THEME(dark|light, 기본 dark) · PARITY_DIR(기본 /tmp/raw-element-parity)
// · CHROME_PATH(설치된 Chrome을 쓸 때; 없으면 `pnpm exec playwright install chromium` 한 번)
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const require = createRequire(resolve('package.json'));
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch').default ?? require('pixelmatch');

const [mode, ...args] = process.argv.slice(2);
const dir = process.env.PARITY_DIR ?? '/tmp/raw-element-parity';
const base = process.env.BASE ?? 'http://127.0.0.1:5173';
const theme = process.env.THEME ?? 'dark';

// 자동 id(useId)·현재 시각·필터 순서처럼 매번 바뀌는 값은 지우고 태그·속성·글자만 남긴다.
function domOutline() {
  const skip = /^(style|id|for|href|aria-controls|aria-labelledby|aria-describedby)$|^data-radix/;
  const lines = [];
  const walk = (node, depth) => {
    if (node.nodeType === 3) { const text = node.textContent.trim(); if (text) lines.push(`${' '.repeat(depth)}#${text.slice(0, 60)}`); return; }
    if (node.nodeType !== 1 || ['SCRIPT', 'STYLE', 'FILTER'].includes(node.tagName.toUpperCase())) return;
    const attrs = [...node.attributes].filter(attr => !skip.test(attr.name)).map(attr => `${attr.name}=${attr.value.slice(0, 80)}`).sort().join(' ');
    lines.push(`${' '.repeat(depth)}${node.tagName.toLowerCase()} ${attrs}`);
    for (const child of node.childNodes) walk(child, depth + 1);
  };
  walk(document.body, 0);
  return lines.join('\n');
}
const normalize = text => text.replace(/_r_[0-9a-z]+_/g, '_r_').replace(/datetime=[\dT:.Z-]+/g, 'datetime=T').replace(/\d{2}:\d{2}(:\d{2})?/g, 'HH:MM');

async function capture(stage, name, route) {
  mkdirSync(`${dir}/${stage}`, { recursive: true });
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  for (let attempt = 1; ; attempt++) {
    await page.goto(base + '/');
    const login = page.locator('button', { hasText: '관리자로 간편 로그인' }).first();
    if (await login.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false)) await login.click();
    await page.waitForTimeout(1500);
    await page.goto(base + route);
    await page.waitForTimeout(4000);
    if (!new URL(page.url()).pathname.startsWith('/login')) break;
    if (attempt === 3) throw new Error(`로그인 화면에 머묾: ${route}`);
  }
  await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
  await page.waitForTimeout(1500);
  writeFileSync(`${dir}/${stage}/${name}.dom.txt`, normalize(await page.evaluate(domOutline)));
  await page.screenshot({ path: `${dir}/${stage}/${name}.png` });
  console.log(`${stage}/${name} ${page.url()}`);
  await browser.close();
}

function compare(name) {
  const [before, after] = ['before', 'after'].map(stage => readFileSync(`${dir}/${stage}/${name}.dom.txt`, 'utf8').split('\n'));
  const changed = before.length !== after.length ? Math.abs(before.length - after.length) + 1 : before.filter((line, index) => line !== after[index]).length;
  const [a, b] = ['before', 'after'].map(stage => PNG.sync.read(readFileSync(`${dir}/${stage}/${name}.png`)));
  const pixels = a.width === b.width && a.height === b.height ? pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.1 }) : 'size';
  console.log(`${name} dom-changed-lines=${changed} pixels=${pixels}`);
  // DOM이 같으면 겉모습도 같다. 픽셀 차이는 움직이는 로고·버튼 광택·시각 글자 정도만 허용한다.
  if (changed) process.exitCode = 1;
}

if (mode === 'capture') await capture(...args);
else if (mode === 'compare') compare(args[0]);
else { console.error('mode: capture <before|after> <name> <route> | compare <name>'); process.exitCode = 2; }
