/**
 * 生成 docs/design-system.html。
 *
 * 把 tokens.css 与 components.css 内联进模板，产出一个自包含的规范页 ——
 * 这样它既能通过 file:// 直接双击打开，也能经任意静态服务器预览，
 * 不依赖相对路径。令牌的唯一真源仍然是 src/client/*.css，
 * 改完令牌重跑本脚本即可。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = p => readFileSync(resolve(root, p), 'utf8')

const template = read('scripts/design-system/template.html')
const tokens = read('src/client/tokens.css')
const components = read('src/client/components.css')
const layout = read('src/client/styles.css')

const block = (label, css) =>
  `<style data-source="${label}">\n/* ── ${label} 内联副本 · 源文件 src/client/${label} ── */\n${css}\n</style>`

let html = template
  .replace('<!-- INJECT_TOKENS -->', block('tokens.css', tokens))
  .replace('<!-- INJECT_COMPONENTS -->', block('components.css', components))
  .replace('<!-- INJECT_LAYOUT -->', block('styles.css', layout))

if (html.includes('INJECT_')) {
  throw new Error('模板占位符未被全部替换，请检查 template.html')
}

writeFileSync(resolve(root, 'docs/design-system.html'), html)

const kb = (Buffer.byteLength(html) / 1024).toFixed(1)
console.log(
  `docs/design-system.html 已生成 · ${kb} KB · 内联 ` +
  `tokens ${tokens.split('\n').length} 行 / components ${components.split('\n').length} 行 / layout ${layout.split('\n').length} 行`
)
