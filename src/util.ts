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

export function excludedPath(rel: string, patterns: string[]): boolean {
  const parts = rel.split(/[\\/]+/).filter(Boolean)
  if (parts.some(part => part === 'node_modules' || part === '.git' || part.startsWith('.'))) return true
  for (const pattern of patterns) {
    if (pattern.includes('node_modules') && parts.includes('node_modules')) return true
    if (pattern.includes('.git') && parts.includes('.git')) return true
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1)
      if (rel.endsWith(suffix)) return true
    }
    const literal = pattern.replace(/\*\*/g, '').replace(/\*/g, '')
    if (literal && rel.includes(literal)) return true
  }
  return false
}

export class StudioError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'StudioError'
  }
}
