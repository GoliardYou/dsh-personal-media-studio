export const EMBED_DIM = 256
export const EMBED_MODEL = 'local-trigram-v1'

export function embedText(input: string): Float32Array {
  const vector = new Float32Array(EMBED_DIM)
  const text = input.toLowerCase().replace(/\s+/g, '')
  if (text.length === 0) return vector
  const grams = text.length === 1 ? [text] : Array.from({ length: text.length - 1 }, (_, i) => text.slice(i, i + 2))
  for (const gram of grams) {
    vector[hash(gram) % EMBED_DIM] += 1
  }
  let norm = 0
  for (const value of vector) norm += value * value
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < vector.length; i++) vector[i] /= norm
  return vector
}

export function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let dot = 0
  for (let i = 0; i < n; i++) dot += a[i] * b[i]
  return dot
}

export function vectorToBlob(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength)
}

export function blobToVector(blob: Uint8Array | Buffer): Float32Array {
  const copy = new Uint8Array(blob.byteLength)
  copy.set(blob)
  return new Float32Array(copy.buffer)
}

function hash(value: string): number {
  let h = 2166136261
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
