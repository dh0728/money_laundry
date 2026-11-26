type ExportImageType = 'image/png' | 'image/jpeg'

export function createExportCanvas(width: number, height: number, options?: CanvasRenderingContext2DSettings) {
  if (typeof OffscreenCanvas === 'function') {
    const offscreen = new OffscreenCanvas(width, height)
    const context = offscreen.getContext('2d', options)
    if (context && typeof offscreen.convertToBlob === 'function') {
      return {
        context,
        width: offscreen.width,
        height: offscreen.height,
        encode: (type: ExportImageType, quality?: number) => offscreen.convertToBlob({ type, quality }),
      }
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  function encode(type: ExportImageType, quality?: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob) resolve(blob)
        else reject(new Error(type === 'image/png' ? 'PNG 파일을 만들 수 없습니다.' : 'PDF 페이지 이미지를 만들 수 없습니다.'))
      }, type, quality)
    })
  }

  return { context: canvas.getContext('2d', options), width: canvas.width, height: canvas.height, encode }
}
