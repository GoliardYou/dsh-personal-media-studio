# 个人媒体工作室

这是一个跑在 **DeepSeek Harness（DSH）** 里的原生插件，不是独立网页。侧栏有四个入口：选题、草稿、渲染、灵感。工作室里同一排标签也能切换，地址哈希是 `#pms/topics`、`#pms/drafts`、`#pms/render`、`#pms/inspiration`。改稿是一篇完整 Markdown；渲染用小红书长文出图编辑器分页，并导出 PNG、`body.txt` 和 `article.md`。

你选一张卡，在纸感编辑台里把判断、故事和犹豫写进去；点原话可以直接改，保存后立刻换下一张。分析在后台进行：核心判断、案例、缺口、正反视角、追问，以及本地素材库里对得上的文件。只有你自己点「进入内容生产」之后，才会整理标题、小标题、金句、加黑，并匹配真实本地图片。最终审定是纸感工作台里的所见即所得：点标题、正文、金句、图注或品牌字段就能改，输入框失焦即存；导出 1242×1660 的 PNG、正文、结构和带来源的素材清单，再把成稿回写进素材库。

「灵感」是收件箱，不是自动写稿机：你丢一句原话、一个链接、一段观察进去，它只收下、不改写、不替你判断；你点「通过，进选题」才变成一张待写的卡。素材库、千帆互动、千帆交易目前是「未接」状态，不会装成已同步。DSH 里的助手可以通过工具读收件箱、按词搜索、提议候选，但不能替你通过，也不能直接建卡。

## 环境

- Node.js `>=24.9.0`（本仓库在 `v24.22.3` 上验证）
- `@deepseek-ai/dsh@0.2.2-rc.5`（`engines.dsh`：`>=0.2.2-rc.5 <0.3.0`）
- 导出优先用本机 Chrome / Chromium；没有浏览器时用 Sharp 把 SVG 栅格成同样尺寸的 PNG

## 安装到 DSH

```bash
npm install
npm run build
dsh plugin --profile web add /你的路径/dsh-personal-media-studio
```

然后在个人配置里覆盖素材目录。Profile 的 `cordis.patch.yml` 会整行替换插件配置，所以要把需要的键写全：

```yaml
- id: personal-media-studio
  name: dsh-personal-media-studio
  config:
    libraryRoots:
      - ~/素材库
    excludeGlobs:
      - "**/.git/**"
      - "**/node_modules/**"
    llm:
      provider: ""    # 留空则使用带标记的本地预览引擎
      model: ""
    privacy:
      sendImagesToCloud: false
    ocr:
      command: ""     # 可选，例如 paddleocr 可执行文件；参数是图片路径，标准输出为文字
    render:
      engine: auto    # auto | playwright | sharp
```

```bash
dsh web --no-open
```

侧栏图标打开全页工作台。未配置模型时，顶部徽标是「本地预览引擎」，整条流程仍然可以走完。配好 DSH 里已经注册的 `llm.provider` 与 `llm.model` 后，后台任务改走 `ctx.llm.stream`，四个角色（访谈、写作、素材、审定，加上选题）共用这一对 provider/model。

数据在 `$DSH_HOME/personal-media-studio/studio.sqlite`（或 `dataDir`），不写进会话日志。

## 开发

```bash
npm test          # vitest：迁移、中文 FTS、去重、卡片生命周期、灵感收件/通过/略过、任务版本守卫、导出、Cordis 热重载
npm run typecheck
npm run build
```

仓库里的 `examples/library` 是一套中文演示素材（产品图、评论截图、笔记）。生成命令：

```bash
node scripts/seed-library.mjs examples/library
```

接口核对记录在 `docs/research/verified-dsh-0.2.2-rc.5.md`。

## 架构

| 层 | 位置 | 作用 |
| --- | --- | --- |
| Host 插件 | `src/index.ts` | Cordis `apply`，注入 `tools`、`llm`、`connection` |
| 服务 | `PersonalMediaStudioService` | Web 与 `media_*` 工具调用同一 `StudioRuntime` |
| 存储 | `node:sqlite` | 20 张业务表、FTS5 trigram、本地向量 |
| 素材 | Chokidar + Sharp | 只读扫描、SHA-256 去重、缩略图、可选 OCR 命令 |
| 任务 | `jobs` 表 | 与界面解耦，重试，输入版本过期则跳过，启动时恢复 `running` |
| 通道 | `connection.fetch` | `POST /api/personal-media-studio/rpc` |
| 界面 | `src/client/app.tsx` | `main` 槽全页 + `sidebar.panellist` 图标 |

推进生产和开始生产必须由界面签发一次性 intent。模型工具可以读卡、追加、搁置、搜索素材；自己编造的 intent 会被拒绝。

灵感相关工具：

| 工具 | 作用 |
| --- | --- |
| `media_list_inspiration` | 读灵感来源、收件和待确认/已通过/已略过候选 |
| `media_search_inspiration` | 按原话、理由、来源名搜索候选 |
| `media_propose_inspiration` | 以「助手提议」身份放进一条 pending 候选；不通过、不建卡 |

完整的来源分层、归因和后续连接器设计见 [docs/INSPIRATION-SOURCES.md](docs/INSPIRATION-SOURCES.md)。

进入排版之前有一步「纯文字定稿」：原文只读展示，建议要你点了才算数。导出的 `article.md` 按小红书出图工具的 front matter、` ```product ` 和 ` ```screenshot ` 来写，可以直接交给 `xhs_render.py`。`render.engine` 设为 `xhs_render` 且填了 `render.xhsRenderPy` 时，会调用那个脚本；默认仍用插件内置的 1080×1440 渲染。三套版式是头像绿（默认）、深蓝金、公文风。

## Windows 11 安装

需要 Node.js 24 或更新（内置 `node:sqlite`），以及已安装的 DSH `0.2.2-rc.5`。在 PowerShell 里：

```powershell
node -v
cd C:\path\to\dsh-personal-media-studio
npm install
npm run build
npm run pack
dsh plugin --profile web add .\dist\dsh-personal-media-studio
dsh web --no-open
```

`npm run pack` 会在 `dist\dsh-personal-media-studio.zip` 里打好一份带 `lib/` 和 `brand/` 的目录，不依赖这个私有仓库。也可以把 zip 解开后，对解开的目录执行 `dsh plugin add`。

素材库示例配置在 `examples/lurenjia.cordis.patch.yml`。默认不扫描 `Coaching_Mindmaps_*`、`Coaching_Transcription_*`，也不收录 `一个路人甲个人微信二维码.jpg`。文件名里的零宽字符会被去掉。旧价格和退款承诺只标成「待确认」。导出回写的笔记进 `knowledgeDir`（默认 `dataDir/knowledge`），不会写进 `libraryRoots`，除非你自己把 `knowledgeDir` 指到库里。`Xhs_QA_小红书问答/markdown` 里的 `.md` 会在扫描结束时按主题收成推荐卡，默认最多 `topicSeed.maxCards`（12）张。截图、表格、`backup/` 只当素材，不各占一张卡。其余主题留在问答选题池里。没被动过的旧种子卡（一文件一张、标题是文件名）会在下次启动时清掉；你改过、搁置过或已经拿去生产的卡会留下。
