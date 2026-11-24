# PMS 设计规范系统

个人媒体工作室（Personal Media Studio）的界面设计规范。本文是**开发交接文档**，可视化版本见 [`design-system.html`](./design-system.html)。

> 规范页是**构建产物**：`npm run docs` 把 `tokens.css` 与 `components.css` 内联进模板，产出自包含的 HTML。令牌始终是唯一真源，规范页不会与代码脱节。产物可双击直接打开，也能放进任意静态服务器。

---

## 1. 一句话原则

**界面里出现的每一个颜色、字号、间距、圆角，都必须能追溯到某个令牌。令牌之外的值视为缺陷。**

---

## 2. 三层令牌架构

```
tokens.css
├── Layer 1  Primitive   品牌原始值（--pms-green-500 等）
│                        永不直接用于界面
├── Layer 2  Semantic    界面语义（--pms-surface-base 等）
│                        优先消费 DSH 宿主 --dsw-alias-*，回退到 Layer 1
└── Layer 3  Canvas      出图令牌（--pms-canvas-*）
                         固定值，不跟随宿主主题
```

**为什么分三层**

界面跑在 DSH 宿主里，宿主管着明暗主题。如果把 `#F8F9F5` 写死在组件里，用户在深色模式下会看到刺眼的白块。所以界面语义层必须先问宿主要值：

```css
--pms-surface-base: var(--dsw-alias-bg-base, var(--pms-neutral-50));
/*                  ↑ 宿主提供就用宿主的    ↑ 宿主没有才用品牌值 */
```

而出图画布是另一回事。1242×1660 的 PNG 要发到小红书，颜色不能随编辑器主题变。所以 `--pms-canvas-*` 是硬编码常量，**任何情况下都不允许**在 `.pms-page` 内使用界面令牌。

---

## 3. 文件职责

| 文件 | 职责 | 允许出现 |
|---|---|---|
| `src/client/tokens.css` | 令牌定义（唯一真源） | 十六进制色值、px 值（仅令牌定义处） |
| `src/client/components.css` | 可复用组件 | 只允许 `var(--pms-*)` |
| `src/client/styles.css` | 布局与业务特化 | 只允许 `var(--pms-*)` |
| `scripts/design-system/template.html` | 规范页模板 | 文档排版样式、占位符 |
| `docs/design-system.html` | 规范页（**生成物，勿手改**） | — |

加载顺序固定为 **tokens → components → styles**，在 `app.tsx` 的 `apply()` 中拼接为一个 `<style>` 注入：

```ts
style.textContent = `${tokens}\n${components}\n${css}`
```

改顺序会破坏层叠优先级。

规范页同样消费这两个文件，但走构建：

```bash
npm run docs   # template.html + tokens.css + components.css → docs/design-system.html
```

---

## 4. 令牌清单

### 4.1 色彩

**品牌色阶**（Primitive，只读）

| 组 | 步进 | 主值 |
|---|---|---|
| Green | 50 → 950 | `--pms-green-500: #34906C`（品牌标识） |
| Gold | 50 → 900 | `--pms-gold-500: #D4A54A`（装饰专用） |
| Neutral | 0 → 950 | `--pms-neutral-800: #2A2C29`（正文） |
| Paper | 0 / 50 / 100 / 200 / 500 / 600 / 900 | `--pms-paper-50: #F7F3E9`（聚焦编辑台专用） |

**语义令牌**（业务代码只用这一层）

| 令牌 | 用途 |
|---|---|
| `--pms-surface-base` / `-raised` / `-sunken` / `-overlay` | 四级表面 |
| `--pms-text-primary` / `-secondary` / `-tertiary` / `-inverse` / `-accent` | 五级文字 |
| `--pms-border-subtle` / `-default` / `-strong` / `-selected` | 四档边框 |
| `--pms-primary` / `-hover` / `-fg` / `-soft` | 主操作 |
| `--pms-state-success` / `-warning` / `-danger` / `-info`（各带 `-soft`） | 状态 |
| `--pms-focus-ring` / `-focus-color` | 焦点环 |
| `--pms-focus-bg` / `-sheet` / `-sunken` | 聚焦模式三级纸面 |
| `--pms-focus-ink` / `-ink-soft` / `-ink-faint` | 聚焦模式三级墨色 |
| `--pms-focus-rule` / `-accent` | 稿纸裁切线 / 强调 |
| `--pms-focus-sheet-max` / `-rail-w` / `-track-w` / `-track-h` / `-input-h` / `-input-h-compact` | 聚焦模式尺寸约束（短屏用 compact） |
| `--pms-marker-w` | 建议条、骑缝章等细标记的线宽；禁止裸 `3px` |

**画布令牌**（固定）

`--pms-canvas-paper` `-ink` `-ink-deep` `-text` `-muted` `-gold` `-gold-soft` `-rule` `-mark-bg` `-mark-fg`

### 4.2 排版

```
--pms-text-2xs  11px   极小角标
--pms-text-xs   12px   元信息、时间戳
--pms-text-sm   13px   紧凑辅助
--pms-text-base 14px   界面正文默认
--pms-text-md   16px   用户输入、文章正文
--pms-text-lg   18px   卡片标题
--pms-text-xl   20px   区块标题
--pms-text-2xl  24px   次级页面标题
--pms-text-3xl  28px   页面主标题
--pms-text-4xl  34px   画布正文
--pms-text-5xl  42px   画布金句
```

行高：`tight 1.25` / `snug 1.35` / `normal 1.55` / `relaxed 1.75` / `canvas 1.65`
字重：`400 / 500 / 600 / 700 / 800`（**废止 680 等非标值**）

字体族：
- `--pms-font-sans` 界面
- `--pms-font-serif` 长文与画布
- `--pms-font-mono` 规格值、十六进制、时间

### 4.3 间距（4pt 网格）

```
--pms-space-1..12  →  2 4 8 12 16 20 24 32 40 48 64 80
```

语义别名（优先用这些，语义比数值更稳定）：

```
--pms-gap-inline   8px    行内元素之间
--pms-gap-stack    12px   堆叠元素之间
--pms-gap-group    20px   分组之间
--pms-gap-section  32px   区块之间
--pms-pad-control  8px 12px
--pms-pad-card     16px
--pms-pad-panel    16px
--pms-inset-page   24px   页面左右内边距
```

### 4.4 圆角（原 9 种 → 6 档）

```
xs 4  →  sm 8  →  md 10  →  lg 12  →  xl 16  →  2xl 20  →  full 999
```

| 值 | 用于 |
|---|---|
| `xs` | 标记、画布高亮 |
| `sm` | 色片、缩略图内块 |
| `md` | 图片、小卡 |
| `lg` | 输入框、按钮组 |
| `xl` | 卡片、面板 |
| `2xl` | 大容器、画布框 |
| `full` | 胶囊按钮、徽标 |

### 4.5 阴影

```
--pms-shadow-xs / -sm / -md / -lg
```

界面只用 3 档表达层级，`-lg` 留给浮层。画布投影是独立的 `--pms-canvas-shadow`，因为它模拟纸张而非 UI 层级。

### 4.6 动效

```
--pms-duration-fast   120ms   悬停、聚焦
--pms-duration-base   180ms   卡片、展开
--pms-duration-slow   280ms   面板、页面切换

--pms-ease-standard  cubic-bezier(0.2, 0, 0.2, 1)   进入与形变
--pms-ease-exit      cubic-bezier(0.4, 0, 1, 1)     退出与收起
```

超出这五条的时长或曲线视为违规。

**例外：循环动画。** 加载指示 `pms-spin` 与骨架微光 `pms-shimmer` 按「一圈多久」计，不适用单次的 120–280ms 分档；它们必须遵守 `prefers-reduced-motion`。一次性换卡动画仍走 `--pms-duration-slow`。

### 4.7 层级与尺寸

```
--pms-z-sticky 10  |  -overlay 20  |  -toast 30  |  -modal 40

--pms-tap-min       44px     触控目标下限
--pms-control-h-sm  30px
--pms-control-h-md  36px
--pms-control-h-lg  44px
--pms-reading-max   72ch     长文可读宽度
--pms-canvas-w/h    1242×1660
```

---

## 5. 组件 API

### 按钮

```tsx
<button className="pms-btn pms-btn--primary">进入内容生产</button>
<button className="pms-btn">暂存</button>
<button className="pms-btn pms-btn--ghost">取消</button>
<button className="pms-btn pms-btn--outline-accent">暂存留在本阶段</button>
<button className="pms-btn pms-btn--danger">删除草稿</button>

// 尺寸
className="pms-btn pms-btn--primary pms-btn--sm"
className="pms-btn pms-btn--primary pms-btn--lg"

// 加载态：文字保持占位，不跳动
<button className="pms-btn pms-btn--primary" aria-busy="true">处理中</button>
```

约束：**一屏只允许一个 `--primary`**。主色代表「用户此刻最该做的事」，出现两个就没有主次了。

### 表单

```tsx
<div className="pms-field">
  <label htmlFor="t">选题标题</label>
  <input className="pms-input" id="t" />
  <small>显示在卡片正面，建议 30 字以内。</small>
</div>

// 错误态
<div className="pms-field" data-invalid="true">
  <label htmlFor="p">素材目录</label>
  <input className="pms-input" id="p" aria-invalid="true" />
  <span className="pms-field-error">目录不可读，请检查路径或权限。</span>
</div>
```

### 徽标

```tsx
<span className="pms-badge">默认</span>
<span className="pms-badge pms-badge--accent">推荐</span>
<span className="pms-badge pms-badge--success"><i className="pms-dot" />已采纳</span>
<span className="pms-badge pms-badge--warn">待确认</span>
<span className="pms-badge pms-badge--danger">已拒绝</span>
<span className="pms-badge pms-badge--info">本地预览引擎</span>
```

### 卡片

```tsx
<button className="pms-card pms-card--interactive">
  <h2 className="pms-card__title">为什么越努力越焦虑</h2>
  <p className="pms-card__body">这个问题被问了七次。</p>
  <div className="pms-card__meta"><span>2 小时前</span></div>
</button>

// 选中态
<div className="pms-card is-selected">…</div>
```

`pms-card--interactive` 才带悬停反馈与可点击语义。静态卡片别加，否则用户会以为能点。

### 反馈

```tsx
<div className="pms-empty"><strong>还没有推荐卡</strong><span>下面的选题池可以搜。</span></div>
<div className="pms-error">导出失败：未找到 Chrome，已回退到 Sharp。</div>
<div className="pms-notice pms-notice--warn">价格一律标记为「待确认」。</div>
<div className="pms-toast">已回写进素材库</div>
```

空态必须给出**下一步**，不能只说「没有数据」。

### 5.4 结构层

这一组是布局骨架，不属于单点组件。

| 类 | 作用 | 关键约束 |
|---|---|---|
| `pms-toolbar` | 单行工具栏，固定 56px | 不换行、不滚动；`--sub` 变体 48px 用于二级条 |
| `pms-segmented` / `pms-segment` | 位置指示导航 | 视觉权重低于按钮；`aria-selected` 驱动选中态 |
| `pms-view` | 视图容器 | `flex:1; min-height:0`；`--padded` 加页边距 |
| `pms-scroll` | 列表滚动区 | 唯一允许纵向滚动的区域 |
| `pms-workarea` | 主列 + 320px 侧栏 | 侧栏固定宽，不随窗口伸缩 |
| `pms-drawer` | 并排抽屉 | **不覆盖内容**，浮层会让人丢失上下文 |
| `pms-composer-bar` | 底部固定操作条 | 高频动作不随长列表滚走 |
| `pms-reading` | 阅读列 | 限宽 72ch 居中 |
| `pms-skeleton-card` | 加载骨架 | 保留版式轮廓，避免高度塌陷 |

```tsx
<div className="pms-view pms-view--padded">
  <div className="pms-workarea">
    <section className="pms-workarea__main">
      <div className="pms-card-head">…</div>       {/* 固定 */}
      <div className="pms-scroll">…</div>          {/* 滚动 */}
      <div className="pms-composer-bar">…</div>    {/* 固定 */}
    </section>
    <aside className="pms-workarea__side">…</aside>
  </div>
</div>
```

### 5.5 布局模型

```
.pms-root            纵向 flex，高度锁死一屏，overflow:hidden
├─ .pms-toolbar      56px，不滚动
├─ .pms-body         flex:1 + min-height:0   ← 缺了 min-height:0 子区就无法收缩
│   └─ .pms-view     flex:1 纵向
│       ├─ .pms-toolbar--sub   可选二级条
│       ├─ .pms-scroll         列表页滚动
│       └─ .pms-workarea       工作台，内部各列自滚
└─ .pms-toast
```

五个视图的结构：

| 视图 | 结构 |
|---|---|
| 选题看板 | 二级条（看板/问答池/聚焦切换） + 网格滚动区 |
| 卡片聚焦 | 二级条（进度 + 退出） + 单张稿纸（头部固定 / 正文自滚 / 输入贴底） + 268px 分析栏 |
| 卡片工作台 | 卡头固定 + 时间线滚动 + 输入条固定 + 320px 分析侧栏 |
| 改稿工作室 | 二级条（写作/阅读） + 限宽正文 + 320px 侧栏（大纲/建议/版本） |
| 渲染 | 编辑器吃满剩余高度 + 素材抽屉并排 |

---

## 6. 旧类名迁移

保留别名以避免破坏现有界面，但新代码不要再用：

| 旧写法 | 新写法 |
|---|---|
| `pms-btn primary` | `pms-btn pms-btn--primary` |
| `pms-badge warn` | `pms-badge pms-badge--warn` |
| `pms-stages button.on` | `pms-segmented` / `pms-segment[aria-selected]` |
| `pms-top` + `pms-stages` | `pms-toolbar`（合并为单行） |
| `pms-split`（浮动比例） | `pms-workarea`（主列 + 固定 320px 侧栏） |
| `pms-suggest`（浮层） | `pms-drawer`（并排，不遮挡） |
| `pms-article*` | `pms-editor` / `pms-reader` / `pms-outline` |
| `pms-grid` | `pms-board`（同行等高） |
| `pms-col`（自带 padding/border） | `pms-panel`（`pms-col` 仅指分栏列） |

---

## 7. 无障碍基线（WCAG 2.1 AA）

| 要求 | 实现 |
|---|---|
| 文字对比度 ≥4.5:1 | 全部实测。三级文字从 `#7C8076`(3.81:1) 调至 `#707468`(4.53:1) |
| 焦点可见 | 全局 `:focus-visible` 统一焦点环，鼠标点击不显示 |
| 触控目标 44px | `@media (pointer: coarse)` 自动补齐 |
| 动效偏好 | 尊重 `prefers-reduced-motion`，全局降为 0.01ms |
| 语义结构 | 原生 `button` / `label`，不滥用 div |
| 状态不只靠颜色 | 徽标带文字标签，不只依赖红绿 |

**不可用组合**（已实测，禁止打破）

| 组合 | 比值 | 结论 |
|---|---|---|
| `--pms-canvas-gold` 作文字 | 2.26:1 | 禁止，仅装饰 |
| `--pms-green-500` 作正文 | 3.92:1 | 仅限 ≥18.66px 粗体或图形 |
| 白字 / `--pms-green-600` | 5.48:1 | 主按钮标准组合 |
| 三级文字 / 纸白 | 4.53:1 | 刚好合格，不得再调浅 |

修改任何色彩令牌后，必须重跑对比度校验（见 `docs/design-system.html` 的「对比度自检」表）。

---

## 8. 深色模式

三处声明，优先级从低到高：

1. `@media (prefers-color-scheme: dark)` — 系统偏好
2. `[data-theme="dark"] .pms-root` — 宿主显式主题
3. `.pms-root[data-pms-theme="dark"]` — 本插件强制

深色下主按钮反转为**亮绿底 + 深字**（`#4FAE85` / `#0A1F19`，6.32:1），不是简单的白字换黑字。

画布令牌**不参与**任何深色切换。这是本产品最容易出错的地方。

---

## 9. 常见错误

**❌ 写死颜色**
```css
.card { background: #FFFFFF; }        /* 深色模式下刺眼 */
✅ .card { background: var(--pms-surface-raised); }
```

**❌ 自造圆角**
```css
.badge { border-radius: 7px; }        /* 刻度外取值 */
✅ .badge { border-radius: var(--pms-radius-full); }
```

**❌ 在画布里用界面令牌**
```css
.pms-page { color: var(--pms-text-primary); }   /* 导出会随主题变 */
✅ .pms-page { color: var(--pms-canvas-text); }
```

**❌ 用金色写字**
```css
.hint { color: var(--pms-gold-500); }           /* 2.26:1，不可读 */
✅ .hint { color: var(--pms-text-secondary); }
```

**❌ 一屏多个主按钮**
```tsx
<button className="pms-btn pms-btn--primary">保存</button>
<button className="pms-btn pms-btn--primary">发布</button>   /* 没有主次 */
```

---

## 10. 变更流程

1. 改令牌 → 改 `tokens.css`（唯一入口）
2. 跑 `npm run docs` 重新生成规范页，确认色板、字阶、对比度表仍符合预期
3. 在深色模式下过一遍
4. 跑 `npm run build && npm run typecheck`
5. 若新增视觉值，先问：现有令牌能否表达同一意图？能则不新增。

### 提交前自查

- [ ] 新 CSS 里没有十六进制色值
- [ ] 没有裸 px 圆角与字号
- [ ] 间距是 4 的倍数，优先用 `--pms-gap-*` / `--pms-pad-*`
- [ ] 交互元素有 hover / active / disabled / focus-visible 四态
- [ ] 纯图标按钮带 `aria-label`，表单控件有对应 `label`
- [ ] 画布区域未误用界面令牌
- [ ] 深色模式下文字可读、边框可见
- [ ] Tab 键走完全流程，焦点环始终可见

---

## 11. 规范现状

| 指标 | 规范前 | 规范后 |
|---|---|---|
| 圆角取值 | 9 种野生值 | 6 档刻度 + full |
| 字号取值 | 9 种 | 11 档字阶（含画布专用） |
| 间距组合 | 16 种 | 4pt 网格 + 8 个语义别名 |
| 宿主令牌调用 | 58 处重复 fallback | 每处一次，收敛到语义层 |
| 裸色值 | 6 处硬编码 | 0（全部令牌化） |
| 三级文字对比度 | 3.81:1（不达标） | 4.53:1（AA 合格） |
| 暗色模式 | 无兜底 | 三级声明兜底 |
| 焦点态 | 仅默认 outline | 统一焦点环 |
| 触控目标 | 未约束 | 44px 自动补齐 |

### 结构重设计

| 指标 | 改动前 | 改动后 |
|---|---|---|
| 顶部占用 | 约 150px（大标题 + 副标题 + 独立导航条） | 56px 单行工具栏 |
| 导航层级 | 侧栏入口 + 页内胶囊条（两层） | 页内单层分段控件 |
| 渲染区高度 | `calc(100vh - 220px)` 补丁 | 吃满剩余高度 |
| 选题页 | 看板与问答池上下堆叠 | 分段切换，一页装下 |
| 卡片输入框 | 沉在时间线末尾 | 固定在底部操作条 |
| 分析侧栏 | 浮动 0.8fr | 固定 320px |
| 正文宽度 | 全宽 textarea | 限宽 72ch 居中 |
| 建议面板 | sticky 浮层遮挡正文 | 侧栏切页，与正文并排 |
| 加载态 | 一行文字，高度塌陷 | 骨架屏保留轮廓 |

---

## 12. 选题处理工作台（DSH 对话式）

看板负责「俯视全部」，处理工作台负责「一次一件」。选题阶段不再有单独的卡片页：**点任意卡片、创建新选题、打开旧链接，都进入同一个对话式工作台**。这也是唯一会把卡片送去改稿的入口。

### 12.1 入口与退出

| 入口 | 起点 |
|---|---|
| 看板点击任意卡片 | 该卡；队列按看板顺序从它开始 |
| 「新建选题」创建成功 | 新卡；创建后直接进入 |
| `#pms/topics/focus/<cardId>` | 该卡；用于直达与复现问题 |
| Topic 阶段的旧链接 `#pms/topics/<cardId>` | 自动改写成上面的聚焦链接 |

工作台顶部左侧固定「← 回看板」，右侧是「AI 分析」和「删除」。没有「开始处理」按钮，也没有第二套卡片详情页；阶段导航在进入聚焦后退场，退出即回看板。

### 12.2 队列与动作

```
idle --进入(startId)--> focus(queue[0])
focus --只保存--> focus(同一张，追加一条原话)
focus --记下，换一张--> advanceCard(shelve) -> focus(queue[next])
focus --标为成熟--> 确认弹窗 -> advanceCard(mature) -> focus(queue[next])
focus --删除--> 确认弹窗 -> deleteCard -> 回看板（toast 可撤销）
focus --回看板 / Esc--> idle
```

- **一轮**：按看板顺序拍快照，旋转到 `startId` 为首；`processed` 记录本轮处理过的卡，一轮内不重复。一轮走完自动进入下一轮；全部离开选题时显示完成态，提供「回看板 / 去问答池」。
- **原子推进**：`advanceCard` 在单事务里追加原话并改状态，`clientOpId` 做幂等；输入为空时退回 `shelve` / `markMature`，不产生空原话。
- **不推进动作**：「只保存」只追加原话，进度不动。未提交输入按卡存 `sessionStorage`，换卡换成那张卡自己的草稿。
- **素材关联**：选题阶段不再让用户给原话勾选素材；相关素材只在「AI 分析」里以只读方式出现，真正插入图片发生在渲染页。原话的 `attachmentAssetIds` 保留为空数组以兼容旧数据。
- **快捷键**：`Ctrl/⌘ + Enter` 记下并换一张；`Esc` 先关 AI 分析，再退出工作台；弹窗打开时 `Esc` 只取消弹窗。换卡后焦点回到输入框。

### 12.3 视觉：对话式工作台

不是纸面编辑器，而是 DSH 对话窗口的延伸：顶部标题、中间对话、底部输入框。

| 元素 | 做法 | 意图 |
|---|---|---|
| 内容列 | 760px 居中，header / thread / composer 共用 | 与 DSH 对话窗口同一条阅读轴 |
| 标题区 | kicker + 标题 + 状态/原话数/进度 | 一屏先回答「这是哪张、处理到哪」 |
| 灵感 | 默认一行「灵感 + 首句 + N 人问过 + 原始素材」 | 默认不展开原始材料 |
| 原话 | 右对齐气泡 + 时间，`white-space: pre-wrap` | 像对话里的「我」，保留原话换行 |
| 输入框 | 底部常驻、无边框、`focus-within` 外框、随内容长高到 200px | 不抢视线，长文有地方写 |
| 动作 | 只保存（quiet）/ 记下，换一张（outline-accent）/ 标为成熟（primary） | 唯一点击即推进的是成熟 |
| AI 分析 | 默认收起；按钮在标题右侧；窄面板改为右侧覆盖抽屉 | 名称直接说明内容与来源 |
| 空态 | 一句提示，不铺卡片 | 没有输入时保持安静 |

**AI 分析**的含义：后台自动整理的核心判断、还缺什么、正反视角、继续追问和相关素材；只读，不改原话。打开后右栏标题下方固定写「后台自动更新 · 不改你的原话」，避免被误解成编辑区。

### 12.4 结构约束

```
.pms-body                       容器查询：pms-panel（按面板宽度，不按视口）
└─ .pms-focus                   grid：主列（+ 可选 320px AI 分析）
   ├─ .pms-sr-only              换卡进度与标题的 aria-live 播报
   ├─ .pms-focus__main           flex 列
   │  ├─ .pms-chat-head          标题 / 元信息 / AI 分析 / 删除
   │  ├─ .pms-chat-scroll        唯一滚动区
   │  │  └─ .pms-chat-thread     灵感 + 原话气泡 + 空态
   │  └─ .pms-chat-composer      输入框 + 只保存 + 记下 / 成熟
   ├─ .pms-chat-aside            AI 分析；默认不渲染
   └─ .pms-confirm               成熟 / 删除确认：aria-modal + inert + 焦点陷阱
```

- **容器查询**：`@container pms-panel (max-width: 780px)` 时 AI 分析改为覆盖式右抽屉，不再隐藏开关；`520px` 时标题降级、进度条只留文字。
- **短屏**：`@media (max-height: 760px)` 收紧标题与输入区，输入框最高 150px。
- **确认弹窗**：成熟和删除都先确认；关闭态用 `tone="danger"`。取消不消耗卡片。
- **按钮权重**：一屏只有一个 `--primary`，即「标为成熟，送去改稿」；「记下，换一张」用 `--outline-accent`；「只保存」是低权重文字动作；删除只在标题栏，且与 AI 分析用细分隔线隔开。

### 12.5 与生产改稿的衔接

- 成熟后卡片进入生产改稿；改稿页「退回选题」调用 `returnToTopics` 把状态改回 `open`，并**回到看板**（`#pms/topics`），不再落到旧卡片页。
- 选题阶段的删除可在 toast 里撤销；成熟也可在 toast 里退回选题。
- 出图画布令牌不参与本节，导出颜色不受工作台影响。

### 12.6 变更检查

- [ ] 新增入口必须复用同一个 `.pms-focus` 工作台，不得再复制一套卡片详情页
- [ ] 新增推进路径时，确认它是否应该结束当前卡；不该的话不要动 `processed`
- [ ] 换卡走草稿读写；输入、错误提示、AI 分析展开状态都要复位
- [ ] 进度口径是「本轮已处理 / 本轮共几张」，第 2 轮要重置
- [ ] 原子推进必须带 `clientOpId`；空输入不能调用 `advanceCard`
- [ ] 一屏只有一个绿色主按钮；AI 分析默认收起
- [ ] 删除与成熟都要有确认；删除还要有 toast 撤销
- [ ] 没有在 `.pms-focus` 内使用 `--pms-canvas-*`
