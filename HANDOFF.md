# 交接说明

个人媒体工作室（`dsh-personal-media-studio`）是 DeepSeek Harness（DSH `0.2.2-rc.5`，Node `>=24.9.0`）的原生插件，不是独立网页。侧栏三个入口，主界面同一排标签，哈希可直达：

| 阶段 | 哈希 | 做什么 |
|---|---|---|
| 选题 | `#pms/topics` | 选题卡、问答选题池、写下原话、后台分析、标为成熟 |
| 生产改稿 | `#pms/drafts` | 把原话收成一篇 Markdown，只分段、加小标题和加粗，不改句子 |
| 渲染 | `#pms/render` | 内嵌小红书长文出图编辑器（头像绿 / 深蓝金 / 公文风，1080×1440），导出 PNG、`body.txt`、`article.md` |

业务在 `PersonalMediaStudioService` / `StudioRuntime`。界面和 `media_*` 工具走同一套方法。只有用户在界面上明确确认，才能把卡推进到下一阶段。

## 目录

- `src/` 插件宿主、运行时、选题聚类、文稿拼接、渲染导出
- `src/client/` 三个阶段的 React 界面
- `editor/xhs-editor.html` 渲染阶段用的离线编辑器（由 `scripts/prepare-editor.mjs` 从上游包生成）
- `brand/` 头像、三套主题 CSS
- `examples/lurenjia.cordis.patch.yml` 路人甲素材库配置样例
- `examples/library/` 本地假素材，给测试和截图用
- `tests/` Vitest。`scripts/e2e-dsh.mjs` 是真实 DSH 里的手工旅程，不在 `npm test` 里
- `docs/research/` 核对过的 DSH 0.2.2-rc.5 接口笔记

`lib/` 和 `dist/` 是构建产物，不进 git。

## 构建、测试、打包

```bash
npm install
npm run build          # esbuild → lib/index.js、lib/client.js
npm test               # vitest run
npm run typecheck
npm run pack           # dist/dsh-personal-media-studio.zip
```

打包会去掉 `scripts`、`devDependencies`、`allowScripts`，避免解压后 `npm install` 去跑没带上的 `scripts/build.mjs`。安装用解压后的目录：

```powershell
dsh plugin --profile web add C:\Users\yigel\dsh-plugins\dsh-personal-media-studio
```

## 用户笔记本上的位置

- 插件目录：`C:\Users\yigel\dsh-plugins\dsh-personal-media-studio`
- Profile：`C:\Users\yigel\.dsh\profiles\web\cordis.patch.yml`
- 数据目录：`~/.dsh/personal-media-studio`（SQLite、导出、默认回写 `knowledge/`）
- 启动脚本：`启动个人媒体工作室.ps1`，然后 `dsh web`，端口 **3080**
- 素材库：`C:\Users\yigel\一个路人甲小红书素材库`，`libraryProfile: lurenjia`
- 模型：`llm.provider` 为 `deepseek-official`，`llm.model` 为 `deepseek-flash`。凭据只用 DSH 自己已经配置好的，**不要把 key 写进仓库、补丁或脚本**

`cordis.patch.yml` 会整段替换插件配置，改的时候把要保留的键写全。样例在 `examples/lurenjia.cordis.patch.yml`。回写目录 `knowledgeDir` 默认为空，实际写到 `dataDir/knowledge`，不会进素材库；只有用户明确把 `knowledgeDir` 指进库里才写到那里。

## 硬规则

- 素材库只读。不要往 `libraryRoots` 里写文件、改名或删除。
- 不扫描 `Coaching_Mindmaps*`、`Coaching_Transcription*`。
- 不使用、不索引 `一个路人甲个人微信二维码.jpg`。
- 不改作者原句。生成稿只能分段、加 `##`、加粗和引用。
- 不向国内平台发帖、上传或调用它们的发布接口。价格和退款一律标成「待确认」，不自动沿用。

## 已知问题

- 生产改稿的本地拼接是规则引擎，分节和加粗比较粗，长文还要人改。
- 种子卡里有一张跑题的「蓝莓不甜的原因」，不是问答聚类出来的正式选题。
