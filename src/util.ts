import { randomUUID } from 'node:crypto'

export const nowIso = () => new Date().toISOString()
export const uid = () => randomUUID()

export function fingerprint(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase()
}

export function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export { excludedPath, decodeLibraryName, normalizeLibraryRoot } from './library/profile.ts'

export class StudioError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'StudioError'
  }
}
