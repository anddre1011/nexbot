const DEFAULT_MAX_IMAGE_SIDE = 1600
const DEFAULT_JPEG_QUALITY = 0.82

export async function optimizeUploadFile(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') return file
  if (file.size <= 350 * 1024) return file
  if (typeof createImageBitmap === 'undefined') return file

  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, DEFAULT_MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      return file
    }

    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', DEFAULT_JPEG_QUALITY)
    })

    if (!blob || blob.size >= file.size) return file

    return new File([blob], renameAsJpeg(file.name), {
      type: 'image/jpeg',
      lastModified: Date.now(),
    })
  } catch {
    return file
  }
}

function renameAsJpeg(name: string) {
  return name.replace(/\.[^.]+$/, '') + '.jpg'
}
