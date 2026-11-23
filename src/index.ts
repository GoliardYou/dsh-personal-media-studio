import { Service, type Context } from '@deepseek-ai/cordis'
import { Config, type StudioConfig } from './config.ts'
import { StudioRuntime } from './runtime.ts'
import { registerTools } from './tools.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    personalMediaStudio: PersonalMediaStudioService
  }
}

interface ConnectionFetch {
  register(route: {
    path: string
    methods: Array<'GET' | 'HEAD' | 'POST'>
    requestBody: 'buffered' | 'streaming'
    fetch: (request: Request) => Promise<Response> | Response
  }): unknown
}

export class PersonalMediaStudioService extends Service {
  constructor(ctx: Context, readonly runtime: StudioRuntime) {
    super(ctx, 'personalMediaStudio')
  }
}

export const name = 'personal-media-studio'
export const inject = ['tools', 'llm', 'connection'] as const
export { Config }

export async function apply(ctx: Context, config: StudioConfig) {
  const runtime = await StudioRuntime.open(ctx, config)
  ctx.effect(() => () => { void runtime.dispose() })
  ctx.plugin(PersonalMediaStudioService, runtime)
  registerTools(ctx, runtime)
  const connection = (ctx as Context & { connection: { fetch: ConnectionFetch } }).connection
  connection.fetch.register({
    path: '/api/personal-media-studio/rpc',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: request => runtime.handleRpc(request),
  })
  connection.fetch.register({
    path: '/api/personal-media-studio/asset',
    methods: ['GET', 'HEAD'],
    requestBody: 'buffered',
    fetch: request => runtime.handleAsset(request),
  })
}
