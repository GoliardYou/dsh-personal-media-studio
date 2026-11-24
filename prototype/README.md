# 静态设计稿存档

这里保存 2026-11-24 一天里确认过的四个阶段。每个文件都能直接双击打开，不依赖服务、构建或网络。

| 阶段 | 文件 | 确认时的状态 | 截图 |
|---|---|---|---|
| 1. 聚焦工作台 | `focus-paper.html` | 去掉聊天气泡，改成“纸 + 页边批注”：笔记可直接改、底部随时记、AI 批注可收起，队列仍保留 | `screenshots/focus-1440.png`、`focus-390.png` |
| 2. 工作室四屏 | `studio-paper.html` | 同一套纸感语言扩展到选题库、草稿、改稿台、渲染；选题是编辑目录，不是卡片墙 | `screenshots/studio-topics-1440.png`、`studio-editor-1440.png`、`studio-render-1440.png`、`studio-topics-390.png` |
| 3. 真实版式 WYSIWYG | `render-wysiwyg.html` | 用真实 avatar-green / navy-gold / gongwen 卡片，在 1080×1440 iframe 里点字改字、选字加粗/高亮、图片替换/裁切/图注、品牌设置；Markdown 只放在“高级”里 | `screenshots/wysiwyg-1440.png`、`wysiwyg-1440-edit.png`、`wysiwyg-1440-dark.png`、`wysiwyg-390.png` |
| 4. 灵感源 | `sources-paper.html` | 素材库、作者原话、千帆互动/交易收进同一条流；每条带出处、样本量和归因方式；导入/同步/设置都有原型 | `screenshots/sources-1440.png`、`sources-1440-dark.png`、`sources-390.png` |

## 文件说明

- `focus-paper.html`、`studio-paper.html`、`sources-paper.html`：单文件原型，HTML/CSS/JS 全内联。
- `render-wysiwyg.src.html`：真实版式原型的源文件，主题 CSS 和头像用占位符。
- `render-wysiwyg.html`：构建产物。改完源文件后运行：
  ```bash
  node scripts/build-render-wysiwyg.mjs
  ```
- `scripts/build-render-wysiwyg.mjs`：读取 `brand/themes/*.css` 和 `brand/dog.png`，替换占位符。

## 这些原型的边界

- 全部是**静态演示**：自动保存、导出、版本、图片持久化、AI 批注、同步都只在浏览器里模拟；刷新后只剩主题偏好。
- `render-wysiwyg.html` 的 iframe 是“预览 + 编辑桥”的验证，不是已经接进插件的实现。真正接入时要复用同一条消息协议：`pageId + blockId + field + html/text`，并且 `commit` 要在 iframe 被替换前同步完成。
- 没有做自由拖拽、任意像素级字号、模板市场。这些是另一个量级的产品。
- `sources-paper.html` 不连接素材库、不读真实文件、不导入 CSV；来源数字是真实历史数据的摘要，交互是模拟。来源设计说明见 `docs/INSPIRATION-SOURCES.md`。
- 视觉验收以 1440 / 1024 / 390 的计算盒模型为准；当前环境的 `read_image` 有 sharp 加载问题，没有做像素级人工复核。

## 与真实插件的关系

这四个原型是“界面语言 + 交互协议”的样稿，不是替换现有业务代码。接入顺序建议：

1. 聚焦工作台：先接 `editThought` / 自动保存，再把 AI 批注锚到句子。
2. 工作室：选题/草稿沿用现有数据，改稿台先做只读预览。
3. WYSIWYG：先在 `BrandFrame` 里注入编辑桥，保留现有 `saveDraft` / 版本 / 导出；不要重写品牌模板。
4. 灵感源：先做只读索引和手动收藏，再接千帆互动/交易；来源设计见 `docs/INSPIRATION-SOURCES.md`。
