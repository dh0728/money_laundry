import { patternName } from '@/mocks/dashboard-data'
import type { JudgmentRecord } from '@/lib/workspace-store'
import { verdictLabel } from './report-model'
import { createExportCanvas } from '@/components/export-canvas'

type CsvValue = string | number | boolean | null | undefined
export const MAX_PDF_JUDGMENTS = 25
const MAX_PDF_PAGES = 100
const MAX_PDF_IMAGE_BYTES = 32 * 1024 * 1024
export function createCsv(headers: readonly string[], rows: readonly (readonly CsvValue[])[]) {
  const quote = (value: CsvValue) => {
    let text = String(value ?? '')
    if (/^\s*[=+\-@]|^[\t\r\n]/.test(text)) text = `'${text}`
    return `"${text.replaceAll('"', '""')}"`
  }
  return `\uFEFF${[headers, ...rows].map(row => row.map(quote).join(',')).join('\r\n')}\r\n`
}
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename.replace(/[\\/:*?"<>|]/g, '-')
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function downloadCsv(filename: string, headers: readonly string[], rows: readonly (readonly CsvValue[])[]) {
  downloadBlob(filename, new Blob([createCsv(headers, rows)], { type: 'text/csv;charset=utf-8' }))
}

export type PdfImagePage = { jpeg: Uint8Array; width: number; height: number }
/** JPEG-backed A4 pages; byte offsets include the binary image streams. */
export function buildImagePdf(pages: readonly PdfImagePage[]): Uint8Array<ArrayBuffer> {
  if (!pages.length || pages.some(page => !Number.isInteger(page.width) || !Number.isInteger(page.height) || page.width <= 0 || page.height <= 0 || !page.jpeg.length)) throw new Error('PDF 페이지가 없습니다.')
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  const offsets = [0]
  let length = 0
  const append = (value: string | Uint8Array) => { const bytes = typeof value === 'string' ? encoder.encode(value) : value; chunks.push(bytes); length += bytes.length }
  const object = (id: number, body: string) => { offsets[id] = length; append(`${id} 0 obj\n${body}\nendobj\n`) }
  append('%PDF-1.4\n')
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, index) => `${3 + index * 3} 0 R`).join(' ')}] >>`)
  pages.forEach((page, index) => {
    const id = 3 + index * 3
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`)
    offsets[id + 1] = length
    append(`${id + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`)
    append(page.jpeg)
    append('\nendstream\nendobj\n')
    const commands = 'q\n595.28 0 0 841.89 0 0 cm\n/Im0 Do\nQ\n'
    object(id + 2, `<< /Length ${encoder.encode(commands).length} >>\nstream\n${commands}endstream`)
  })
  const xref = length
  append(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`)
  offsets.slice(1).forEach(offset => append(`${String(offset).padStart(10, '0')} 00000 n \n`))
  append(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  const result = new Uint8Array(length)
  let cursor = 0
  chunks.forEach(chunk => { result.set(chunk, cursor); cursor += chunk.length })
  return result
}

export function reportParagraphs(judgment: JudgmentRecord) {
  return [
    `판정 ID: ${judgment.id}`, `판정: ${verdictLabel(judgment.verdict)}`,
    `검토자: ${judgment.reviewer} · 판정 시각: ${judgment.at}`,
    `대상: ${judgment.displayIds.join(', ')}`, `판정 사유: ${judgment.reason}`,
    '', '판정 당시 고정 근거',
    ...judgment.cases.flatMap(record => [
      `${record.displayId} · 담당 ${record.assignee}`,
      `추정 패턴 ${patternName(record.typeCode)} ${Math.round(record.probability * 100)}% · 모델 점수 ${record.score.toFixed(2)}`,
      `거래 ${record.transactionIds.length}건 · ${record.amountUsd === null ? '금액 값 없음' : `${record.amountUsd.toLocaleString('ko-KR')} USD`}`,
    ]),
    `판정 대상 거래: ${judgment.transactionIds.join(', ') || '값 없음'}`,
    '', 'AI 보고서 샘플', judgment.reportText,
  ]
}

function* wrapReportLines(paragraphs: readonly string[], maxWidth: number, measure: (line: string) => number) {
  for (const paragraph of paragraphs) {
    for (const sourceLine of paragraph.split(/\r?\n/)) {
      let line = ''
      for (const character of sourceLine) {
        if (line && measure(line + character) > maxWidth) {
          yield line
          line = ''
        }
        line += character
      }
      yield line
    }
  }
}

async function renderReportPages(judgments: readonly JudgmentRecord[]) {
  if (document.fonts) await document.fonts.ready
  const root = document.querySelector('[data-ui="aml-app"]') ?? document.documentElement
  const tokens = getComputedStyle(root)
  const token = (name: string) => tokens.getPropertyValue(name).trim()
  const background = token('--aml-surface-panel')
  const foreground = token('--aml-text-primary')
  if (!background || !foreground) throw new Error('보고서의 화면 스타일을 불러오지 못했습니다.')
  const font = token('--aml-font-family')
  const size = parseFloat(token('--aml-type-body-size')) * 1.5
  const lineHeight = parseFloat(token('--aml-type-body-lineHeight')) * 1.5
  const margin = parseFloat(token('--aml-space-64'))
  const width = 1240, height = 1754
  const pages: PdfImagePage[] = []
  let imageBytes = 0
  for (const judgment of judgments) {
    let canvas: ReturnType<typeof createExportCanvas>
    let context!: NonNullable<typeof canvas.context>
    let y!: number
    const startPage = () => {
      canvas = createExportCanvas(width, height)
      if (!canvas.context) throw new Error('PDF를 만들 수 없는 브라우저입니다.')
      context = canvas.context
      context.fillStyle = background; context.fillRect(0, 0, width, height)
      context.fillStyle = foreground
      context.font = `${size}px ${font}`
      context.textBaseline = 'top'
      context.fillText(`AML RADAR · ${judgment.id}`, margin, margin)
      y = margin + lineHeight * 2
    }
    const finishPage = async () => {
      if (pages.length >= MAX_PDF_PAGES) throw new Error('샘플 PDF는 최대 100쪽입니다. 선택을 줄이거나 서버 내보내기 작업이 필요합니다.')
      context.fillText(`샘플 데이터 · 실제 AI 모델 실행 아님 · ${pages.length + 1}쪽`, margin, height - margin)
      const image = await canvas.encode('image/jpeg', 0.94)
      imageBytes += image.size
      if (imageBytes > MAX_PDF_IMAGE_BYTES) throw new Error('샘플 PDF 크기 한도를 초과했습니다. 선택을 줄이거나 서버 내보내기 작업이 필요합니다.')
      pages.push({ width, height, jpeg: new Uint8Array(await image.arrayBuffer()) })
    }
    startPage()
    const lines = wrapReportLines(reportParagraphs(judgment), width - margin * 2, line => context.measureText(line).width)
    for (const line of lines) {
      if (y + lineHeight > height - margin - lineHeight) {
        await finishPage()
        startPage()
      }
      context.fillText(line, margin, y)
      y += lineHeight
    }
    await finishPage()
    // Keep one canvas active at a time and let the UI respond between judgments.
    await new Promise<void>(resolve => window.setTimeout(resolve, 0))
  }
  return pages
}

export async function downloadJudgmentPdf(judgments: readonly JudgmentRecord[]): Promise<void> {
  if (!judgments.length) throw new Error('판정 기록을 선택해 주세요.')
  if (judgments.length > MAX_PDF_JUDGMENTS) throw new Error(`샘플 PDF는 한 번에 최대 ${MAX_PDF_JUDGMENTS}건입니다. 더 큰 범위는 서버 내보내기 작업이 필요합니다.`)
  if (judgments.some(judgment => !/^J-\d{6}-\d{6}$/.test(judgment.id))) throw new Error('유효한 판정 기록만 보고서로 만들 수 있습니다.')
  const pages = await renderReportPages(judgments)
  downloadBlob(`AML-RADAR-보고서-${judgments[0].id}-${judgments.length}건.pdf`, new Blob([buildImagePdf(pages)], { type: 'application/pdf' }))
}
