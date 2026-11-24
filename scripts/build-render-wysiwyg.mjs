import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const css = {
  'avatar-green': readFileSync(join(root, 'brand/themes/avatar-green.css'), 'utf8'),
  'navy-gold': readFileSync(join(root, 'brand/themes/navy-gold.css'), 'utf8'),
  gongwen: readFileSync(join(root, 'brand/themes/gongwen.css'), 'utf8'),
}
const dog = `data:image/png;base64,${readFileSync(join(root, 'brand/dog.png')).toString('base64')}`
const source = readFileSync(join(root, 'prototype/render-wysiwyg.src.html'), 'utf8')
const html = source
  .replace('__THEME_JSON__', () => JSON.stringify(css).replace(/</g, '\\u003c'))
  .replace('__DOG__', () => dog)
writeFileSync(join(root, 'prototype/render-wysiwyg.html'), html)
console.log(`wrote prototype/render-wysiwyg.html (${Math.round(html.length / 1024)} KB)`)
