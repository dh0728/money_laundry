import { buildImagePdf } from '../../lib/preview-pdf.js';
import { downloadBlob } from '../../lib/report-io';
import { createExportCanvas } from '../../components/export-canvas';
import { judgmentReasonLabels } from './case-judgment-data.js';
import { modelRiskBand, modelRiskLabels } from '../settings/model-risk-settings.js';
import '../../styles/case-report-tokens.css';

const number = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 12 });
const clock = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});
const verdictText = { normal: '정상', abnormal: '이상', unjudged: '판정 전' };
const labelFor = value => verdictText[value] ?? '기록 없음';

function reportStyle() {
  const style = getComputedStyle(document.documentElement);
  const token = role => style.getPropertyValue(`--case-report-${role}`).trim();
  const measure = role => Number.parseFloat(token(role));
  const palette = ['ink', 'muted', 'line', 'soft', 'paper', 'brand', 'normal', 'abnormal', 'table-stripe'];
  return {
    measure,
    fontFamily: style.getPropertyValue('--aml-font-family').trim(),
    colors: Object.fromEntries(palette.map(role => [role, token(role)])),
    type: role => measure(`type-${role}`),
    weight: role => measure(`weight-${role}`),
    leading: role => measure(`leading-${role}`),
  };
}

function sourceTime(value) {
  if (!value) return '';
  const input = String(value).trim();
  const local = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(input);
  const date = new Date(local ? input.replace(' ', 'T') + (input.length === 10 ? 'T00:00+09:00' : '+09:00') : input);
  return Number.isFinite(date.getTime()) ? clock.format(date) : '';
}

function fieldsFor(target) {
  return Array.isArray(target.related) ? target.related : target.from && target.to ? [target] : [];
}

function uniqueRecords(records) {
  return [...new Map(records.filter(row => row?.code).map(row => [row.code, row])).values()];
}

function totalsByCurrency(records) {
  const amounts = new Map();
  for (const row of records) {
    if (row.currency && Number.isFinite(row.amount)) amounts.set(row.currency, (amounts.get(row.currency) ?? 0) + row.amount);
  }
  return [...amounts].sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => `${number.format(amount)} ${currency}`).join('  ·  ') || '금액 기록 없음';
}

function evidencePeriod(records) {
  const dates = records.map(row => sourceTime(row.timestamp)).filter(Boolean).sort();
  const from = dates[0], to = dates.at(-1);
  if (!from) return '시각 기록 없음';
  return from === to ? `${from} KST` : `${from} ~ ${to} KST`;
}

function splitLines(context, value, width, font) {
  context.font = font;
  return String(value ?? '').split(/\r?\n/).flatMap(paragraph => {
    const lines = [];
    let line = '';
    for (const word of paragraph.split(/ +/)) {
      const next = line ? `${line} ${word}` : word;
      if (context.measureText(next).width <= width) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      line = '';
      for (const character of word) {
        if (line && context.measureText(line + character).width > width) {
          lines.push(line);
          line = '';
        }
        line += character;
      }
    }
    return [...lines, line];
  });
}

function makeWriter({ measure, fontFamily, colors, type, weight, leading }) {
  const page = {
    width: measure('page-width'),
    height: measure('page-height'),
    margin: measure('page-margin'),
    limit: measure('content-limit'),
    scale: measure('raster-scale'),
  };
  const contentWidth = page.width - 2 * page.margin;
  const ruleWidth = measure('rule');
  const headingHeight = leading('heading') + measure('text-gap');
  const textFont = (size, fontWeight) => `${fontWeight} ${size}px ${fontFamily}`;
  const images = [];
  let context, canvas, cursor, continuation;
  const paint = (content, x, y, { size = type('body'), fontWeight = weight('regular'), color = colors.ink } = {}) => {
    context.fillStyle = color;
    context.font = textFont(size, fontWeight);
    context.fillText(content, x, y);
  };
  const rectangle = (x, y, width, height, fill) => {
    context.fillStyle = fill;
    context.fillRect(x, y, width, height);
  };
  const rule = y => rectangle(page.margin, y, contentWidth, ruleWidth, colors.line);
  const finish = () => {
    rule(measure('footer-rule'));
    const baseline = measure('footer-text');
    paint('AML RADAR  /  내부 관리 검토', page.margin, baseline, { size: type('caption'), color: colors.muted });
    paint(String(images.length + 1).padStart(2, '0'), page.width - page.margin - measure('footer-number-width'), baseline,
      { size: type('detail'), fontWeight: weight('bold'), color: colors.brand });
    const sheet = canvas;
    images.push(sheet.encode('image/jpeg', .94).then(async blob => ({
      width: sheet.width, height: sheet.height, jpeg: new Uint8Array(await blob.arrayBuffer()),
    })));
  };
  const start = () => {
    if (canvas) finish();
    canvas = createExportCanvas(page.width * page.scale, page.height * page.scale, { alpha: false });
    context = canvas.context;
    if (!context) throw new Error('PDF를 만들 수 없는 브라우저입니다.');
    context.scale(page.scale, page.scale);
    context.textBaseline = 'alphabetic';
    rectangle(0, 0, page.width, page.height, colors.paper);
    rectangle(0, 0, page.width, measure('masthead-band'), colors.brand);
    const baseline = measure('masthead-text');
    paint('AML RADAR', page.margin, baseline, { size: type('wordmark'), fontWeight: weight('display'), color: colors.brand });
    paint('내부 관리 검토용', page.width - page.margin - measure('masthead-label-width'), baseline,
      { size: type('detail'), fontWeight: weight('bold'), color: colors.muted });
    rule(measure('masthead-rule'));
    cursor = measure('content-start');
    if (continuation) {
      paint(`${continuation} · 계속`, page.margin, cursor, { fontWeight: weight('bold'), color: colors.brand });
      cursor += measure('continuation-height');
    }
  };
  const ensure = height => {
    if (cursor + height <= page.limit) return false;
    start();
    return true;
  };
  const text = (value, { size = type('body'), fontWeight = weight('regular'), color = colors.ink,
    lineHeight = leading('body'), x = page.margin, width = page.width - page.margin - x, bottom = measure('text-gap') } = {}) => {
    for (const line of splitLines(context, value, width, textFont(size, fontWeight))) {
      ensure(lineHeight);
      paint(line, x, cursor + size, { size, fontWeight, color });
      cursor += lineHeight;
    }
    cursor += bottom;
  };
  const heading = (value, nextHeight = measure('heading-follow-height')) => {
    ensure(headingHeight + nextHeight);
    text(value, { size: type('heading'), fontWeight: weight('heading'), lineHeight: leading('heading'), color: colors.brand });
  };
  const metrics = items => {
    const height = measure('metric-height');
    const blockHeight = height + measure('metric-bottom-gap');
    ensure(blockHeight);
    const gap = measure('metric-gap');
    const width = (contentWidth - gap * (items.length - 1)) / items.length;
    items.forEach(([label, value], index) => {
      const x = page.margin + index * (width + gap);
      const labelX = x + measure('metric-inset');
      rectangle(x, cursor, width, height, colors.soft);
      paint(label, labelX, cursor + measure('metric-label-offset'),
        { size: type('detail'), fontWeight: weight('metric-label'), color: colors.muted });
      paint(value, labelX, cursor + measure('metric-value-offset'),
        { size: type('metric'), fontWeight: weight('display') });
    });
    cursor += blockHeight;
  };

  const table = (title, rows) => {
    const columns = [
      ['거래 ID / 시각 KST', measure('table-column-transaction')],
      ['송금 → 수취 / 결제 수단', measure('table-column-route')],
      ['원본 금액', measure('table-column-amount')],
      ['모델 / 판정 / 처리', measure('table-column-status')],
    ];
    const lineHeight = leading('table');
    const headerHeight = measure('table-header-height');
    const inset = measure('table-inset');
    const size = type('detail');
    const rowFont = textFont(size, weight('regular'));
    const rowLines = row => row.map((value, index) => splitLines(context, value, columns[index][1] - 2 * inset, rowFont));
    const rowHeight = lines => Math.max(...lines.map(column => column.length)) * lineHeight + measure('table-row-padding');
    const drawHeader = () => {
      rectangle(page.margin, cursor, contentWidth, headerHeight, colors.soft);
      let x = page.margin;
      for (const [label, width] of columns) {
        paint(label, x + inset, cursor + measure('table-header-offset'), { size, fontWeight: weight('bold'), color: colors.brand });
        x += width;
      }
      cursor += headerHeight;
    };
    const firstHeight = headerHeight + rowHeight(rowLines(rows[0])) + ruleWidth;
    ensure(headingHeight + firstHeight);
    heading(title, firstHeight);
    drawHeader();
    rows.forEach((row, index) => {
      const lines = rowLines(row);
      const height = rowHeight(lines);
      if (ensure(height + ruleWidth)) drawHeader();
      if (index % 2 === 1) rectangle(page.margin, cursor, contentWidth, height, colors['table-stripe']);
      let x = page.margin;
      lines.forEach((column, cell) => {
        column.forEach((line, i) => paint(line, x + inset, cursor + measure('table-cell-offset') + i * lineHeight,
          { size, color: i === 0 ? colors.ink : colors.muted }));
        x += columns[cell][1];
      });
      cursor += height;
      rule(cursor);
      cursor += ruleWidth;
    });
    cursor += measure('table-bottom-gap');
  };
  const setContinuation = value => { continuation = value; };
  start();
  return { text, heading, metrics, table, ensure, setContinuation, finish: async () => {
    finish();
    return Promise.all(images);
  } };
}

function evidenceCells(row) {
  const timestamp = sourceTime(row.timestamp);
  const amount = Number.isFinite(row.amount) && row.currency ? `${number.format(row.amount)} ${row.currency}` : '기록 없음';
  const score = Number.isFinite(row.score) ? `${number.format(row.score)}점` : '점수 기록 없음';
  return [
    `${row.code}\n${timestamp || '시각 기록 없음'}`,
    `${row.from?.code ?? '기록 없음'} → ${row.to?.code ?? '기록 없음'}\n${row.method || '수단 기록 없음'}`,
    amount,
    `${score} · ${labelFor(row.verdict)}${row.status ? `\n${row.status}` : ''}`,
  ];
}

export async function createCaseReportPdf(rows) {
  if (!rows.length) throw new Error('보고서에 포함할 판정을 선택해 주세요.');
  await document.fonts?.ready;
  const style = reportStyle();
  const { measure, colors, type, weight, leading } = style;
  const output = makeWriter(style);
  const selectedTargets = uniqueRecords(rows.flatMap(row => row.targets ?? []));
  const allEvidence = uniqueRecords(selectedTargets.flatMap(fieldsFor));
  const abnormal = rows.filter(row => row.verdict === 'abnormal').length;
  const normal = rows.filter(row => row.verdict === 'normal').length;
  const highestScores = allEvidence.filter(record => modelRiskBand(record.score) === 'high')
    .toSorted((left, right) => right.score - left.score || left.code.localeCompare(right.code));
  output.text('AML 판정 검토 보고서',
    { size: type('title'), fontWeight: weight('display'), lineHeight: leading('title'), bottom: measure('title-gap') });
  output.text(`생성 시각  ${clock.format(new Date())} KST`,
    { size: type('detail'), color: colors.muted, bottom: measure('time-gap') });
  output.metrics([
    ['선택 판정', `${number.format(rows.length)}건`], ['이상 판정', `${number.format(abnormal)}건`],
    ['연결 거래 · 중복 제거', `${number.format(allEvidence.length)}건`],
  ]);
  output.heading('요약');
  output.text(`정상 ${number.format(normal)}건 · 이상 ${number.format(abnormal)}건 · 기타 ${number.format(rows.length - normal - abnormal)}건 · 판정 대상 ${number.format(selectedTargets.length)}건`);
  output.text(`근거 거래 기간  ${evidencePeriod(allEvidence)}`);
  output.text(`통화별 근거 금액  ${totalsByCurrency(allEvidence)}`);
  if (highestScores.length) {
    const highest = highestScores[0];
    output.text(`모델 ${modelRiskLabels().high}  ${number.format(highestScores.length)}건 · 최고 ${number.format(highest.score)}점 (${highest.code})`);
  }
  output.text('자료 범위  AML RADAR에서 선택한 판정과 그에 연결된 거래. 동일 거래 ID는 전체 합계에서 한 번 집계합니다.',
    { size: type('detail'), color: colors.muted, lineHeight: leading('detail'), bottom: measure('section-gap') });

  for (const row of rows) {
    const targets = row.targets ?? [];
    const evidence = uniqueRecords(targets.flatMap(fieldsFor)).sort((a, b) =>
      String(a.timestamp ?? '').localeCompare(String(b.timestamp ?? '')) || a.code.localeCompare(b.code));
    const patterns = [...new Set((row.patterns ?? []).filter(Boolean))];
    const time = sourceTime(row.at);
    const reviewer = row.reviewer || row.actor || '기록 없음';
    const reasonCategory = Object.hasOwn(judgmentReasonLabels, row.reasonCategory)
      ? judgmentReasonLabels[row.reasonCategory] : '기록 없음';
    output.setContinuation(undefined);
    output.ensure(measure('case-start-clearance'));
    output.setContinuation(row.id);
    output.heading(`${row.id} · ${row.kind || '업무'}`, measure('case-heading-follow-height'));
    output.text(`사람 판정  ${labelFor(row.verdict)}`, { fontWeight: weight('heading'),
      color: colors[row.verdict] ?? colors.ink });
    output.text(`판정 시각  ${time ? `${time} KST` : '기록 없음'}   ·   판정자 ${reviewer}`,
      { color: colors.muted });
    output.text(`판정 근거 유형  ${reasonCategory}`, { color: colors.muted });
    output.text(`검토 자료  ${row.evidence || '기록 없음'}`);
    output.text(`확인 사실  ${row.observations || '기록 없음'}`);
    output.text(`판정 사유  ${row.reason || '기록 없음'}`);
    if (patterns.length) output.text(`관련 패턴  ${patterns.join('  ·  ')}`);
    output.text(`근거 거래  ${number.format(evidence.length)}건   ·   ${evidencePeriod(evidence)}`);
    output.text(`통화별 금액  ${totalsByCurrency(evidence)}`, { bottom: measure('amount-gap') });
    if (targets.length) {
      output.ensure(measure('reference-clearance'));
      output.text('판정 대상과 근거 참조', { fontWeight: weight('heading'), bottom: measure('compact-gap') });
      for (const target of targets) {
        const references = uniqueRecords(fieldsFor(target)).map(record => record.code);
        const related = references.length > 0 && !(references.length === 1 && references[0] === target.code)
          ? `  ←  ${references.join(', ')}` : '';
        output.text(`${target.code}${related}`, { size: type('detail'), color: colors.muted, lineHeight: leading('detail') });
      }
    }
    if (evidence.length) {
      output.table('연결 거래 근거', evidence.map(evidenceCells));
    } else {
      output.text('연결된 근거 거래 기록이 없습니다.', { color: colors.muted, bottom: measure('section-gap') });
    }
  }

  output.setContinuation('후속 확인 사항');
  output.heading('후속 확인 사항', measure('follow-up-clearance'));
  output.text('1. 연결 거래 ID로 원장을 대조하고 송금·수취 계좌, 거래 시각, 금액 및 원통화를 확인합니다.');
  output.text('2. 동일 계좌나 반복 경로가 여러 판정에 걸쳐 나타난 경우 거래 목적과 검토 근거를 함께 확인합니다.');
  if (rows.some(row => !row.reason || !row.at)) {
    output.text('3. 판정 사유 또는 시각이 누락된 건은 업무 이력에서 근거를 확인하고 검토 메모에 남깁니다.');
  }
  return buildImagePdf(await output.finish());
}

export async function downloadCaseReport(rows) {
  const pdf = await createCaseReportPdf(rows);
  downloadBlob('AML-RADAR-판정-검토-보고서.pdf', new Blob([pdf], { type: 'application/pdf' }));
}
