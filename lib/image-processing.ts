export const IMAGE_TYPES =
  'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif'
export async function prepareImage(
  file: Blob,
): Promise<{ image: Blob; thumbnail: Blob }> {
  if (file.size > 20 * 1024 * 1024) throw new Error('Фото больше 20 МБ.')
  let source = file
  if (
    /hei[cf]/i.test(file.type) ||
    ('name' in file && /\.hei[cf]$/i.test(String(file.name)))
  ) {
    const { default: convert } = await import('heic2any')
    const converted = await convert({
      blob: file,
      toType: 'image/jpeg',
      quality: 0.92,
    })
    source = Array.isArray(converted) ? converted[0] : converted
  }
  const url = URL.createObjectURL(source),
    img = new window.Image()
  try {
    img.src = url
    await img.decode()
    async function resize(max: number, quality: number) {
      const scale = Math.min(
          1,
          max / Math.max(img.naturalWidth, img.naturalHeight),
        ),
        canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Не удалось обработать фото.')
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Повреждённое фото.'))),
          'image/jpeg',
          quality,
        ),
      )
      canvas.width = canvas.height = 0
      return blob
    }
    const image = await resize(2000, 0.9),
      thumbnail = await resize(480, 0.85)
    return { image, thumbnail }
  } catch {
    throw new Error('Не удалось прочитать фото. Выберите другое или повторите.')
  } finally {
    img.src = ''
    URL.revokeObjectURL(url)
  }
}
