import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(.:)/, '$1'));
const infra = path.resolve(here, '..');
const markdownDir = path.join(infra, 'markdown');
const pagesDir = path.join(here, 'pages');
const assetsDir = path.join(here, 'assets');
fs.mkdirSync(pagesDir, { recursive: true });
fs.mkdirSync(assetsDir, { recursive: true });
const draftOnly = process.argv.includes('--draft-only');
const v2Only = process.argv.includes('--v2-only');

const esc = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const inline = (value) => {
  let s = esc(value);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<a class="image-link" href="$2"><img class="doc-image" src="$2" alt="$1" loading="lazy"></a>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const target = href.endsWith('.md') ? href.replace(/\.md(#.*)?$/, '.html$1') : href;
    const mapped = target === 'README.html' ? '../index.html' : target;
    return `<a href="${esc(mapped)}">${label}</a>`;
  });
  return s;
};

function markdown(source) {
  const lines = source.replace(/\r/g, '').split('\n');
  const out = [];
  let paragraph = [];
  let list = null;
  let code = null;
  const flushParagraph = () => { if (paragraph.length) { out.push(`<p>${inline(paragraph.join(' '))}</p>`); paragraph = []; } };
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (code) {
      if (line.startsWith('```')) {
        if (code === 'mermaid') out.push(`<pre class="mermaid">${esc(codeLines.join('\n'))}</pre>`);
        else out.push(`<pre><code>${esc(codeLines.join('\n'))}</code></pre>`);
        code = null;
        codeLines = [];
      }
      else codeLines.push(line);
      continue;
    }
    const fence = line.match(/^```\s*(.*)$/);
    if (fence) { flushParagraph(); closeList(); code = fence[1].trim() || 'text'; var codeLines = []; continue; }
    if (!line.trim()) { flushParagraph(); closeList(); continue; }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) { flushParagraph(); closeList(); const level = heading[1].length; out.push(`<h${level} id="s-${i}">${inline(heading[2])}</h${level}>`); continue; }
    if (/^---+$/.test(line.trim())) { flushParagraph(); closeList(); out.push('<hr>'); continue; }
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-+/.test(lines[i + 1])) {
      flushParagraph(); closeList();
      const rows = [line]; i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) { rows.push(lines[i]); i++; }
      i--;
      const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map(v => v.trim());
      out.push('<div class="table-wrap"><table><thead><tr>' + cells(rows[0]).map(v => `<th>${inline(v)}</th>`).join('') + '</tr></thead><tbody>');
      for (const row of rows.slice(1)) out.push('<tr>' + cells(row).map(v => `<td>${inline(v)}</td>`).join('') + '</tr>');
      out.push('</tbody></table></div>'); continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    const numbered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (bullet || numbered) { flushParagraph(); const wanted = bullet ? 'ul' : 'ol'; if (list !== wanted) { closeList(); list = wanted; out.push(`<${list}>`); } out.push(`<li>${inline((bullet || numbered)[1])}</li>`); continue; }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) { flushParagraph(); closeList(); out.push(`<blockquote>${inline(quote[1])}</blockquote>`); continue; }
    paragraph.push(line.trim());
  }
  flushParagraph(); closeList();
  return out.join('\n');
}

const css = `
:root{--ink:#172033;--muted:#657187;--line:#d9e0ea;--soft:#f5f7fa;--blue:#2463eb;--nav:#10264a}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;color:var(--ink);background:#eef2f7;font-family:Inter,"Pretendard","Noto Sans KR",system-ui,sans-serif;line-height:1.75}.layout{max-width:1180px;margin:auto;min-height:100vh;background:#fff;box-shadow:0 0 36px #20304b12}.layout.wide{max-width:1500px}.top{padding:30px 44px;color:#fff;background:linear-gradient(135deg,#10264a,#2463eb)}.top a{color:#fff;text-decoration:none}.top small{color:#c9dbff}.content{display:grid;grid-template-columns:245px minmax(0,1fr)}aside{padding:26px 18px;border-right:1px solid var(--line);background:#f8fafc}aside strong{display:block;margin:0 9px 12px}aside a{display:block;padding:7px 9px;border-radius:6px;color:#4c5a70;text-decoration:none;font-size:.86rem}aside a:hover,aside a.current{color:var(--blue);background:#eaf1ff}aside.sticky-nav{align-self:start;position:sticky;top:0;max-height:100vh;overflow:auto}main{min-width:0;padding:38px 52px 70px}h1{margin:0 0 22px;font-size:2.1rem;line-height:1.25;letter-spacing:-.035em}h2{margin:44px 0 12px;padding-bottom:8px;border-bottom:1px solid var(--line);font-size:1.45rem;scroll-margin-top:20px}h3{margin:30px 0 8px;font-size:1.13rem;scroll-margin-top:20px}p{margin:10px 0;color:#46536a}a{color:var(--blue)}code{padding:2px 5px;border-radius:4px;background:#edf1f7;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.9em}pre{padding:18px;overflow:auto;border:1px solid #d3dce9;border-radius:10px;background:#101827;color:#e6edf7;line-height:1.55}pre code{padding:0;background:none;color:inherit}.diagram{background:#f8fbff;color:#26354e}blockquote{margin:18px 0;padding:14px 18px;border-left:4px solid var(--blue);background:#f0f5ff;color:#354764}li{margin:6px 0;color:#46536a}.table-wrap{overflow:auto;margin:18px 0}table{width:100%;border-collapse:collapse;font-size:.9rem}th,td{padding:11px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{background:var(--soft);white-space:nowrap}.image-link{display:block;margin:20px 0;text-decoration:none}.doc-image{display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:12px;background:#fff;box-shadow:0 8px 28px rgba(32,48,75,.1)}hr{margin:42px 0;border:0;border-top:1px solid var(--line)}.back{display:inline-block;margin-bottom:18px;font-weight:700;text-decoration:none}.footer{padding:20px 44px;border-top:1px solid var(--line);color:var(--muted);font-size:.84rem}@media(max-width:800px){.content{display:block}aside{display:none}main{padding:28px 22px 55px}.top,.footer{padding-left:22px;padding-right:22px}}@media print{body{background:#fff}.layout{box-shadow:none}.content{display:block}aside{display:none}.top{background:#173d75!important;print-color-adjust:exact}main{padding:25px 38px}.doc-image{box-shadow:none}}
`;
if (!draftOnly && !v2Only) fs.writeFileSync(path.join(assetsDir, 'style.css'), css.trim() + '\n');

const docs = fs.readdirSync(markdownDir).filter(name => /^\d{2}-.+\.md$/.test(name)).sort();
const titles = new Map(docs.map(name => {
  const first = fs.readFileSync(path.join(markdownDir, name), 'utf8').match(/^#\s+(.+)$/m)?.[1] || name;
  return [name, first];
}));
const nav = (current) => docs.map(name => `<a ${name === current ? 'class="current"' : ''} href="${name.replace('.md','.html')}">${name.slice(0,2)}. ${esc(titles.get(name).replace(/ 기본 개념$/, ''))}</a>`).join('\n');

for (const name of docs) {
  if (draftOnly || v2Only) break;
  const source = fs.readFileSync(path.join(markdownDir, name), 'utf8').replace(/^#\s+[^\r\n]+\r?\n/, '').replace(/^\[인프라 결정 기록으로 돌아가기\]\(README\.md\)\s*/m, '');
  const title = titles.get(name);
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><link rel="stylesheet" href="../assets/style.css"></head><body><div class="layout"><header class="top"><a href="../index.html"><small>AML INFRASTRUCTURE GUIDE</small><br><strong>인프라 아키텍처 문서</strong></a></header><div class="content"><aside><strong>개념 문서</strong>${nav(name)}</aside><main><a class="back" href="../index.html">← 결정 요약으로 돌아가기</a><h1>${esc(title)}</h1>${markdown(source)}</main></div><footer class="footer">원본 문서: <a href="../../markdown/${name}">${name}</a></footer></div></body></html>`;
  fs.writeFileSync(path.join(pagesDir, name.replace('.md', '.html')), html);
}

const draftName = '아키텍처1차초안.md';
const draftPath = path.join(markdownDir, draftName);
if (fs.existsSync(draftPath) && !v2Only) {
  const rawDraft = fs.readFileSync(draftPath, 'utf8').replace('](자금세탁소drawio.png)', '](../자금세탁소drawio.png)');
  const draftTitle = rawDraft.match(/^#\s+(.+)$/m)?.[1] || 'AML 아키텍처 1차 초안';
  const draftSource = rawDraft.replace(/^#\s+[^\r\n]+\r?\n/, '');
  const toc = draftSource.replace(/\r/g, '').split('\n').map((line, i) => {
    const heading = line.match(/^##\s+(.+)$/);
    return heading ? `<a href="#s-${i}">${inline(heading[1])}</a>` : '';
  }).filter(Boolean).join('\n');
  const draftHtml = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(draftTitle)}</title><link rel="stylesheet" href="assets/style.css"></head><body><div class="layout wide"><header class="top"><a href="index.html"><small>AML INFRASTRUCTURE ARCHITECTURE</small><br><strong>인프라 아키텍처 1차 초안</strong></a></header><div class="content"><aside class="sticky-nav"><strong>문서 목차</strong>${toc}</aside><main><a class="back" href="index.html">← 인프라 결정 요약으로 돌아가기</a><h1>${esc(draftTitle)}</h1>${markdown(draftSource)}</main></div><footer class="footer">원본 문서: <a href="../markdown/${draftName}">${draftName}</a> · 다이어그램을 클릭하면 원본 크기로 볼 수 있습니다.</footer></div></body></html>`;
  if (draftOnly) console.log(draftHtml);
  else fs.writeFileSync(path.join(here, 'architecture-draft.html'), draftHtml);
}

if (!draftOnly && !v2Only) {
  let index = fs.readFileSync(path.join(here, 'index.html'), 'utf8');
  index = index.replace(/href="(\d{2}-[^"#]+)\.md"/g, 'href="pages/$1.html"');
  index = index.replace(/href="(?:README\.md|\.\.\/(?:markdown\/)?README\.md)"/g, 'href="../markdown/README.md"');
  fs.writeFileSync(path.join(here, 'index.html'), index);
}
const v2Name = '아키텍처v2.md';
const v2Path = path.join(markdownDir, v2Name);
if (fs.existsSync(v2Path) && !draftOnly) {
  const rawV2 = fs.readFileSync(v2Path, 'utf8')
    .replace('](아키텍처v2.drawio)', '](../아키텍처v2.drawio)')
    .replace('](아키텍처v2.png)', '](../아키텍처v2.png)');
  const v2Title = rawV2.match(/^#\s+(.+)$/m)?.[1] || 'AML 모니터링 시스템 인프라 아키텍처 V2';
  const v2Source = rawV2.replace(/^#\s+[^\r\n]+\r?\n/, '');
  const toc = v2Source.replace(/\r/g, '').split('\n').map((line, i) => {
    const heading = line.match(/^##\s+(.+)$/);
    return heading ? `<a href="#s-${i}">${inline(heading[1])}</a>` : '';
  }).filter(Boolean).join('\n');
  const v2Html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(v2Title)}</title><link rel="stylesheet" href="assets/style.css"><style>.version{display:inline-flex;margin:0 0 18px;padding:5px 10px;border-radius:999px;background:#eaf1ff;color:#2463eb;font-size:.8rem;font-weight:800}.mermaid{display:flex;justify-content:center;margin:20px 0;padding:20px;overflow:auto;border:1px solid #d3dce9;border-radius:12px;background:#fff;color:#26354e}.mermaid svg{max-width:100%;height:auto}.hero-note{margin:-8px 0 24px;color:#657187}.toc-title{position:sticky;top:0;padding-top:6px;background:#f8fafc;z-index:1}</style></head><body><div class="layout wide"><header class="top"><a href="index.html"><small>AML INFRASTRUCTURE ARCHITECTURE</small><br><strong>인프라 아키텍처 V2</strong></a></header><div class="content"><aside class="sticky-nav"><strong class="toc-title">문서 목차</strong>${toc}</aside><main><span class="version">LATEST · V2</span><h1>${esc(v2Title)}</h1><p class="hero-note">거래 접수부터 비동기 수집, 추론 작업 생성, 외부 GPU 추론, 결과 저장과 운영 가드레일까지 정리한 최신 기준안입니다.</p>${markdown(v2Source)}</main></div><footer class="footer">원본 문서: <a href="../markdown/${v2Name}">${v2Name}</a> · 기준 도면: <a href="../아키텍처v2.drawio">아키텍처v2.drawio</a></footer></div><script type="module">import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';mermaid.initialize({startOnLoad:true,theme:'neutral',securityLevel:'loose',sequence:{useMaxWidth:true,wrap:true},flowchart:{useMaxWidth:true,htmlLabels:true}});</script></body></html>`;
  fs.writeFileSync(path.join(here, 'architecture-draftv2.html'), v2Html);
}

if (!draftOnly && !v2Only) console.log(`Built index.html, architecture-draft.html, architecture-draftv2.html and ${docs.length} concept pages.`);
if (v2Only) console.log('Built architecture-draftv2.html.');
