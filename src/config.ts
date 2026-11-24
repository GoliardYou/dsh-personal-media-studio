import Schema from '@deepseek-ai/schemastery'

export interface StudioConfig {
  dataDir: string
  libraryRoots: string[]
  libraryProfile: 'generic' | 'lurenjia'
  /** Where finished notes are written. Empty means dataDir/knowledge, never a library root. */
  knowledgeDir: string
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
  brand: {
    author: string
    role: string
  }
  render: {
    engine: 'auto' | 'playwright' | 'sharp' | 'xhs_render'
    size: 'small' | 'standard' | 'large'
    xhsRenderPy: string
  }
}

export const Config: Schema<StudioConfig> = Schema.object({
  dataDir: Schema.string().default(''),
  libraryRoots: Schema.array(Schema.string()).default([]),
  libraryProfile: Schema.union(['generic', 'lurenjia']).default('generic'),
  knowledgeDir: Schema.string().default(''),
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
  brand: Schema.object({
    author: Schema.string().default('一个路人甲'),
    role: Schema.string().default('自学面试上岸'),
  }),
  render: Schema.object({
    engine: Schema.union(['auto', 'playwright', 'sharp', 'xhs_render']).default('auto'),
    size: Schema.union(['small', 'standard', 'large']).default('standard'),
    xhsRenderPy: Schema.string().default(''),
  }),
})
