import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const source = process.argv[2] || '/tmp/xhs-editor'
const html = readFileSync(join(source, 'editor/xhs-editor.html'), 'utf8')
const engine = readFileSync(join(source, 'templates/v2-avatar-green/engine.js'), 'utf8')
  .replace(
    `function inline(s) {
    let t = escapeHtml(s);
    t = t.replace(/\\*\\*(.+?)\\*\\*/g, '<span class="hl">$1</span>');
    return t;
  }`,
    `function inline(s) {
    let t = escapeHtml(s);
    t = t.replace(/==(.+?)==/g, '<span class="hl">$1</span>');
    t = t.replace(/\\*\\*(.+?)\\*\\*/g, '<span class="hl">$1</span>');
    return t;
  }`,
  )
const productCss = readFileSync(join(source, 'templates/v2-avatar-green/styles.css'), 'utf8').split('/* ---- product card + figures ---- */')[1] || ''
const start = html.indexOf('/* XHS long-article card engine')
const end = html.indexOf('</script>', start)
if (start < 0 || end < 0) throw new Error('editor engine markers missing')
let next = html.slice(0, start) + engine.trim() + '\n' + html.slice(end)
next = next.replace('</style>', `${productCss}\n</style>`)
next = next.replace(
  '<button type="button" class="btn" id="export-md">导出 .md</button>',
  `<button type="button" class="btn" id="back-draft" hidden>退回生产改稿</button>
    <button type="button" class="btn" id="pick-shot" hidden>插入截图</button>
    <button type="button" class="btn" id="pick-product" hidden>插入商品</button>
    <button type="button" class="btn" id="export-md">导出 .md</button>`,
)
const hook = `
  function editorState() {
    return {
      theme, size,
      markdown: els.md.value,
      cover_title: els.coverTitle.value,
      subtitle: els.subtitle.value,
      author: els.author.value,
      role: els.role.value,
      cover_kicker: els.kicker.value,
      badge: els.badge.value,
      series: els.series.value,
    };
  }
  function applyEditorState(s) {
    if (!s) return;
    if (s.theme === "v1" || s.theme === "v2" || s.theme === "v3") theme = s.theme;
    if (s.size) size = normalizeSize(s.size);
    const map = {
      markdown: els.md, cover_title: els.coverTitle, subtitle: els.subtitle, author: els.author,
      role: els.role, cover_kicker: els.kicker, badge: els.badge, series: els.series,
    };
    Object.keys(map).forEach((key) => { if (s[key] != null) map[key].value = s[key]; });
    render();
  }
  window.XHS_EMBED = { applyState: applyEditorState, state: editorState };
  const embedded = new URLSearchParams(location.search).get("embed") === "1";
  if (embedded) {
    ["back-draft", "pick-shot", "pick-product"].forEach((id) => { const node = $(id); if (node) node.hidden = false; });
    $("back-draft").addEventListener("click", () => parent.postMessage({ type: "pms:back" }, "*"));
    $("pick-shot").addEventListener("click", () => parent.postMessage({ type: "pms:request-asset", kind: "screenshot" }, "*"));
    $("pick-product").addEventListener("click", () => parent.postMessage({ type: "pms:request-asset", kind: "product" }, "*"));
    window.addEventListener("message", (event) => {
      const data = event.data || {};
      if (data.type === "pms:load") applyEditorState(data.state);
      if (data.type === "pms:insert") {
        els.md.value = els.md.value.replace(/\\s*$/, "") + "\\n\\n" + data.markdown + "\\n";
        render();
      }
      if (data.type === "pms:exported") {
        const a = document.createElement("a");
        a.href = data.href;
        a.download = data.name || "xhs-cards.zip";
        a.click();
        els.status.textContent = "已下载 " + a.download;
      }
      if (data.type === "pms:export-fallback") {
        if (data.index == null) downloadZip.__browser();
        else downloadOne.__browser(data.index);
      }
    });
    parent.postMessage({ type: "pms:ready" }, "*");
  } else {
    load();
    render();
  }
`
next = next.replace(
  'try { localStorage.setItem(LS, JSON.stringify(state)); } catch (e) {}',
  'try { if (!embedded) localStorage.setItem(LS, JSON.stringify(state)); } catch (e) {}\n    if (typeof embedded !== "undefined" && embedded) parent.postMessage({ type: "pms:change", state }, "*");',
)
next = next.replace(
  'async function downloadZip() {\n    if (!pages.length) return;',
  'async function downloadZip() {\n    if (typeof embedded !== "undefined" && embedded && !downloadZip.__force) {\n      parent.postMessage({ type: "pms:export", state: editorState() }, "*");\n      els.status.textContent = "正在用成片引擎导出…";\n      return;\n    }\n    if (!pages.length) return;',
)
next = next.replace(
  'async function downloadOne(i) {\n    const page = pages[i];',
  'async function downloadOne(i) {\n    if (typeof embedded !== "undefined" && embedded && !downloadOne.__force) {\n      parent.postMessage({ type: "pms:export-page", index: i, state: editorState() }, "*");\n      els.status.textContent = "正在导出第 " + (i + 1) + " 页…";\n      return;\n    }\n    const page = pages[i];',
)
if (!next.includes('load();\n  render();')) throw new Error('load/render tail missing')
next = next.replace('load();\n  render();', `${hook.trim()}\n  downloadZip.__browser = async function () { downloadZip.__force = true; try { await downloadZip(); } finally { downloadZip.__force = false; } };\n  downloadOne.__browser = async function (i) { downloadOne.__force = true; try { await downloadOne(i); } finally { downloadOne.__force = false; } };`)
const out = join(process.cwd(), 'editor')
mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'xhs-editor.html'), next)
console.log('wrote editor/xhs-editor.html', next.length)
