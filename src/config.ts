import Schema from '@deepseek-ai/schemastery'

export interface StudioConfig {
  dataDir: string
  libraryRoots: string[]
  excludeGlobs: string[]
  exportDir: string
  watch: boolean
  llm: {
    provider: string
    model: string
  }
  privacy: {
    sendImagesToCloud: boolean
  }
  ocr: {
    command: string
  }
  render: {
    engine: 'auto' | 'playwright' | 'sharp'
  }
}

export const Config: Schema<StudioConfig> = Schema.object({
  dataDir: Schema.string().default(''),
  libraryRoots: Schema.array(Schema.string()).default([]),
  excludeGlobs: Schema.array(Schema.string()).default(['**/.git/**', '**/node_modules/**', '**/.DS_Store']),
  exportDir: Schema.string().default(''),
  watch: Schema.boolean().default(true),
  llm: Schema.object({
    provider: Schema.string().default(''),
    model: Schema.string().default(''),
  }),
  privacy: Schema.object({
    sendImagesToCloud: Schema.boolean().default(false),
  }),
  ocr: Schema.object({
    command: Schema.string().default(''),
  }),
  render: Schema.object({
    engine: Schema.union(['auto', 'playwright', 'sharp']).default('auto'),
  }),
})
