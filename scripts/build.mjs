import { build } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

// 注入到界面 <style> 的构建戳：换包后在 DSH 里一眼能确认运行的是新产物。
const stamp = createHash('sha1').update(`${new Date().toISOString()}|${process.version}`).digest('hex').slice(0, 8)

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  packages: 'external',
  target: 'node24',
  sourcemap: true,
})

const client = await build({
  entryPoints: ['src/client/app.tsx'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  write: false,
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom'],
  loader: { '.css': 'text' },
  define: { __PMS_BUILD_STAMP__: JSON.stringify(stamp) },
})

let code = client.outputFiles[0].text.replace(/^["']use strict["'];\s*/, '')
const wrapped = `window.__ModuleLoader__.load({id:\`dsh-personal-media-studio\`,factory:function(require){var module={exports:{}};var exports=module.exports;\n${code}\nreturn module.exports;}});\n`
mkdirSync('lib', { recursive: true })
writeFileSync('lib/client.js', wrapped)
console.log('built lib/index.js and lib/client.js')
