import { ApiError } from './api'

export type Uploaded = { id: string; name: string; mime: string; size: number; kind: 'image' | 'file' | 'drive' }

const MAX_EDGE = 2560

/** Downscales and re-encodes photos/screenshots to WebP. GIFs and SVGs pass through (keeps animation). */
export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height))
    const w = Math.round(bmp.width * scale)
    const h = Math.round(bmp.height * scale)
    const canvas = new OffscreenCanvas(w, h)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.86 })
    if (blob.size >= file.size && scale === 1) return file
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.webp', { type: 'image/webp' })
  } catch {
    return file
  }
}

/**
 * PUTs a file with progress. XHR (not fetch) because fetch has no upload progress.
 * Resolves with the stored file, rejects with ApiError (or AbortError when cancelled).
 */
export function uploadFile(
  file: File,
  parent: { parentType: string; parentId: string },
  o: { onProgress?: (pct: number) => void; signal?: AbortSignal } = {},
): Promise<Uploaded> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', `/api/files?${new URLSearchParams(parent)}`)
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream')
    xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name))
    xhr.upload.onprogress = (e) => e.lengthComputable && o.onProgress?.(Math.round((e.loaded / e.total) * 100))
    xhr.onload = () => {
      let body: { file?: Uploaded; error?: { code: string; message: string; requestId: string; params?: Record<string, string> } } = {}
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        /* not json */
      }
      if (xhr.status < 300 && body.file) resolve(body.file)
      else {
        const e = body.error
        reject(new ApiError(xhr.status, (e?.code as never) ?? 'internal', e?.message ?? 'Upload failed', e?.requestId, e?.params))
      }
    }
    xhr.onerror = () => reject(new ApiError(0, 'network', 'Network error'))
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'))
    o.signal?.addEventListener('abort', () => xhr.abort())
    xhr.send(file)
  })
}

export const fileUrl = (id: string) => `/files/${id}`
