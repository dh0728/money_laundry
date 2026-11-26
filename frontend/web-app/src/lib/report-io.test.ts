import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildImagePdf, createCsv, downloadJudgmentPdf, MAX_PDF_JUDGMENTS } from './report-io'
import type { JudgmentRecord } from '@/lib/workspace-store'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('report exports', () => {
  it('quotes CSV fields, preserves Korean/newlines, and neutralizes spreadsheet formulas', () => {
    expect(createCsv(['판정', '사유'], [['정상', '쉼표, "인용"\n다음 줄'], ['=1+1', '  @SUM(A1)']])).toBe('\uFEFF"판정","사유"\r\n"정상","쉼표, ""인용""\n다음 줄"\r\n"\'=1+1","\'  @SUM(A1)"\r\n')
  })
  it('creates one valid PDF container with byte-accurate xref offsets, image lengths and A4 pages', () => {
    const jpeg = new Uint8Array([255, 216, 255, 217])
    const bytes = buildImagePdf([{ jpeg, width: 1240, height: 1754 }, { jpeg, width: 1240, height: 1754 }])
    const text = new TextDecoder('latin1').decode(bytes)
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text).toContain('/Type /Pages /Count 2')
    expect(text.match(/\/Type \/Page /g)).toHaveLength(2)
    expect(text).toContain('/MediaBox [0 0 595.28 841.89]')
    expect(text).toContain('/Length 4 >>\nstream\n')
    const xrefAt = Number(text.match(/startxref\n(\d+)/)?.[1])
    expect(new TextDecoder().decode(bytes.slice(xrefAt, xrefAt + 4))).toBe('xref')
    const offsets = text.slice(xrefAt).split('\n').slice(3, 11).map(line => Number(line.slice(0, 10)))
    offsets.forEach((offset, index) => expect(new TextDecoder().decode(bytes.slice(offset, offset + 7))).toBe(`${index + 1} 0 obj`))
    expect(text.endsWith('%%EOF\n')).toBe(true)
  })
  it('rejects an empty PDF and invalid image dimensions', () => {
    expect(() => buildImagePdf([])).toThrow()
    expect(() => buildImagePdf([{ jpeg: new Uint8Array(), width: 0, height: 1 }])).toThrow()
  })
  it('rejects oversized batches and invalid records before allocating a canvas', async () => {
    await expect(downloadJudgmentPdf([])).rejects.toThrow('선택')
    await expect(downloadJudgmentPdf(Array.from({ length: MAX_PDF_JUDGMENTS + 1 }, () => ({ id: 'J-261115-000001' } as JudgmentRecord)))).rejects.toThrow('최대 25건')
    await expect(downloadJudgmentPdf([{ id: 'invalid' } as JudgmentRecord])).rejects.toThrow('유효한 판정')
  })
  it('renders selected frozen text across pages and downloads one PDF Blob then revokes its URL', async () => {
    vi.useFakeTimers()
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:report')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', class extends URL { static createObjectURL = createObjectURL; static revokeObjectURL = revokeObjectURL })
    const tokens: Record<string, string> = { '--aml-surface-panel': 'Canvas', '--aml-text-primary': 'CanvasText', '--aml-font-family': 'sans-serif', '--aml-type-body-size': '14px', '--aml-type-body-lineHeight': '20px', '--aml-space-64': '64px' }
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ getPropertyValue: (name: string) => tokens[name] ?? '' } as CSSStyleDeclaration)
    const fillText = vi.fn()
    const context = { fillRect: vi.fn(), fillText, measureText: (text: string) => ({ width: text.length * 12 }), font: '' } as unknown as CanvasRenderingContext2D
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
    const image = new Blob([new Uint8Array([255, 216, 255, 217])], { type: 'image/jpeg' })
    const jpeg = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(image))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const judgment: JudgmentRecord = { id: 'J-261115-000001', caseIds: [8100], transactionIds: [7000], displayIds: ['A-261109-000041'], verdict: 'normal', reason: '고정 판정 사유', reviewer: '김OO', at: '2026-11-15T10:00:00+09:00', cases: [], reportText: '고정된 샘플 보고서\n' + '한글 근거 '.repeat(1600) }
    const pending = downloadJudgmentPdf([judgment])
    await vi.runAllTimersAsync()
    await pending
    expect(jpeg.mock.calls.length).toBeGreaterThan(1)
    expect(jpeg).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.94)
    expect(fillText.mock.calls.some(([text]) => String(text).includes('고정된 샘플 보고서'))).toBe(true)
    expect(context.font).toBe('21px sans-serif')
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob)
    expect((createObjectURL.mock.calls[0][0] as Blob).type).toBe('application/pdf')
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:report')
  })
})
