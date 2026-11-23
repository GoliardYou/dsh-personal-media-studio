import { build } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'

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
})

let code = client.outputFiles[0].text.replace(/^["']use strict["'];\s*/, '')
const wrapped = `window.__ModuleLoader__.load({id:\`dsh-personal-media-studio\`,factory:function(require){var module={exports:{}};var exports=module.exports;\n${code}\nreturn module.exports;}});\n`
mkdirSync('lib', { recursive: true })
writeFileSync('lib/client.js', wrapped)
console.log('built lib/index.js and lib/client.js')
