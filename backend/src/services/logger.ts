type LogMeta = Record<string, unknown>

function safeMeta(meta?: LogMeta) {
  if (!meta) return ''
  try {
    return JSON.stringify(meta)
  } catch {
    return '[unserializable]'
  }
}

export const logger = {
  info(message: string, meta?: LogMeta) {
    console.log(message, safeMeta(meta))
  },
  warn(message: string, meta?: LogMeta) {
    console.warn(message, safeMeta(meta))
  },
  error(message: string, error?: unknown, meta?: LogMeta) {
    const detail = error instanceof Error ? error.message : error
    console.error(message, detail, safeMeta(meta))
  },
}
