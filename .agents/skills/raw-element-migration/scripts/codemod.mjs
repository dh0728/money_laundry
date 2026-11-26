// 맨 태그 → Box·Text·Heading(같은 DOM을 그린다). a·button·input·select·svg·표 태그는 남긴다. 이름이 겹치는 파일은 건너뛴다.
// 실행: cd frontend/web-app && node ../../.agents/skills/raw-element-migration/scripts/codemod.mjs <파일...>
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, dirname, resolve } from 'node:path';
const ts = createRequire(resolve('package.json'))('typescript');
const BOX = new Set('div section header footer nav main article aside ul ol li dl dt dd figure figcaption form fieldset legend details summary blockquote label menu address'.split(' '));
const TEXT = new Set('span p strong b i small code time em mark abbr sub sup kbd u pre output'.split(' '));
const HEAD = /^h([1-6])$/;
const COMP = resolve('src/components/layout-primitives');
let total = 0;
for (const file of process.argv.slice(2)) {
  const src = readFileSync(file, 'utf8');
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.JSX;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
  const edits = []; const used = new Set();
  const map = tag => {
    if (BOX.has(tag)) return { name: 'Box', attr: tag === 'div' ? '' : ` as="${tag}"` };
    if (TEXT.has(tag)) return { name: 'Text', attr: tag === 'p' ? '' : ` as="${tag}"` };
    const h = HEAD.exec(tag); if (h) return { name: 'Heading', attr: h[1] === '2' ? '' : ` level={${h[1]}}` };
  };
  const visit = node => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxClosingElement(node)) && ts.isIdentifier(node.tagName)) {
      const tag = node.tagName.text; const m = map(tag);
      if (m) {
        const start = node.tagName.getStart(sf), end = node.tagName.getEnd();
        edits.push({ start, end, text: ts.isJsxClosingElement(node) ? m.name : m.name + m.attr }); used.add(m.name);
        if (!ts.isJsxClosingElement(node)) total++;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!edits.length) continue;
  // 이름 충돌 확인
  const conflict = [...used].filter(name => new RegExp(`\\b(import[^;]*\\b${name}\\b|(const|function|let|class)\\s+${name}\\b)`).test(src));
  if (conflict.length) { console.error('SKIP conflict', file, conflict); continue; }
  let out = src;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  const alias = /from '@\/components\//.test(src);
  let spec = alias ? '@/components/layout-primitives' : relative(dirname(file), COMP); if (!spec.startsWith('.') && !alias) spec = './' + spec;
  const imports = sf.statements.filter(ts.isImportDeclaration);
  const semi = imports.length ? imports[0].getText(sf).trimEnd().endsWith(';') : true;
  const quote = imports.length && imports[0].moduleSpecifier.getText(sf).startsWith('"') ? '"' : "'";
  const prior = imports.find(d => d.moduleSpecifier.text === spec || d.moduleSpecifier.text.endsWith('components/layout-primitives'));
  const names = [...used];
  if (prior) {
    const have = prior.importClause?.namedBindings?.elements?.map(e => e.getText(sf)) ?? [];
    const merged = [...new Set([...have, ...names])].sort();
    // prior 범위는 원본 좌표라 out에서 다시 찾는다
    out = out.replace(prior.getText(sf), `import { ${merged.join(', ')} } from ${quote}${prior.moduleSpecifier.text}${quote}${semi ? ';' : ''}`);
  } else {
    const line = `import { ${names.sort().join(', ')} } from ${quote}${spec}${quote}${semi ? ';' : ''}`;
    if (imports.length) { const last = imports.at(-1).getText(sf); const at = out.indexOf(last) + last.length; out = out.slice(0, at) + '\n' + line + out.slice(at); }
    else out = line + '\n' + out;
  }
  writeFileSync(file, out); console.log(file, edits.filter(e => !e.text.startsWith('/')).length);
}
console.log('opened tags replaced', total);
