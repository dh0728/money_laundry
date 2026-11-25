// Standalone preview copy of the JPEG PDF writer in src/lib/report-io.ts.
/** JPEG-backed A4 pages; byte offsets include the binary image streams. */
export function buildImagePdf(pages) {
  if (!pages.length || pages.some(page => !Number.isInteger(page.width) || !Number.isInteger(page.height) || page.width <= 0 || page.height <= 0 || !page.jpeg.length)) throw new Error('PDF 페이지가 없습니다.')
  const encoder = new TextEncoder()
  const chunks = []
  const offsets = [0]
  let length = 0
  const append = (value) => { const bytes = typeof value === 'string' ? encoder.encode(value) : value; chunks.push(bytes); length += bytes.length }
  const object = (id, body) => { offsets[id] = length; append(`${id} 0 obj\n${body}\nendobj\n`) }
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
