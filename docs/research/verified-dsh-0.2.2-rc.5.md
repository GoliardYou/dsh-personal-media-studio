# 已核对的 DSH 接口（`@deepseek-ai/dsh@0.2.2-rc.5`）

本机 Node 为 `v24.22.3`（满足 `0.2.2-rc.5` 的 `>=24.9.0`，也满足 `0.2.3-alpha.2` 的 `^24.22.3`）。实现选用 npm `latest` 上的 **`@deepseek-ai/dsh@0.2.2-rc.5`**，并对照安装包里的类型与打包代码，而不是猜测。

Cordis 版本：`@deepseek-ai/cordis@4.1.0`。Schemastery：`@deepseek-ai/schemastery@3.19.0`。

## 插件包形态

官方《Package and install a plugin》要求外部插件同时声明：

- `dsh.bundle.patch` 指向 `cordis.patch.yml`，用 `insert` 写入自己的 Host 行。仓库内的 `ui-schedule` 不需要这份声明，因为它已经写在 `dsh-web-app` 的补丁里。第三方包缺了它，`dsh plugin add` 只会把它当成普通依赖。
- `engines.dsh`：本包为 `>=0.2.2-rc.5 <0.3.0`。
- `dsh.client`：`platform: "web"`，并导出 `./client`。浏览器包必须是懒加载 CJS 工厂：

```js
window.__ModuleLoader__.load({ id: "dsh-personal-media-studio", factory(require) { /* exports.apply */ } })
```

外壳共享模块表里可以直接 `require` 的是 `react`、`react/jsx-runtime`、`react-dom`。本插件客户端只依赖 `react` 与 `react/jsx-runtime`，没有引用 `@deepseek-ai/dsh-client-ui-primitives`。

`dsh.client.inject` 写的是 Web profile 里真实存在的包名：`dsh-client-ui-renderer`、`dsh-client-ui-layout`、`dsh-client-ui-sidebar`。`dsh-client-ui-slots` 在已发布的 CLI 依赖树里不是独立的 Loader 行（它是前端包的 devDependency），因此没有把它写进 inject，避免组合阶段找不到提供方。

## 全页工作台槽位

对照 `@deepseek-ai/dsh-client-ui-schedule` 的 `lib/client.js` 与 layout/sidebar 类型：

- `ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key }, Component))`  
  `main` 是按 key 分发的根级槽。`conversation` 是保留 key，其它 key 就是侧栏点开的中央整页。
- `ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id, order, label }, Icon))`  
  `id` 必须与 `main` 的 `key` 相同。侧栏自己画按钮，插件只提供图标和 `label`。
- 选中面板的运行时入口是 `ctx.layout.selectPanel`。侧栏按钮由壳层调用它，插件不必再包一层。

主题色使用已在官方样式里出现的 `--dsw-alias-*`（例如 `--dsw-alias-label-primary`、`--dsw-alias-bg-layer-2`、`--dsw-alias-state-business-primary`），并带有本地回退，以便深浅色都可读。

## 浏览器到 Host 的通道

`@deepseek-ai/dsh-client-connection@0.2.2-rc.5` 的 `HostConnectionFetch.register` 把精确路由挂在已经鉴权的 `/api` 通道上。路径必须是 `/api/` 开头，且每一段匹配 `^[A-Za-z0-9_$.-]+$`。`rpc.handle` 在讨论 #9484 里会因为 connection 插件自身没有注入 `webServer` 而失败；`fetch.register` 不碰 `webServer`，只写 connection 自己的路由表，并用调用方 fiber 的 `effect` 卸载。本插件因此使用：

- `POST /api/personal-media-studio/rpc`
- `GET /api/personal-media-studio/asset`

未带浏览器令牌的请求由 connection 在进入我们的处理函数之前拒绝。

## 同一套 Host 方法，两个调用方

`PersonalMediaStudioService` 是 Cordis `Service`，名字 `personalMediaStudio`。Web 路由和 `ctx.tools.register(defineTool(...))` 都调用 `StudioRuntime` 上的同一批方法。工具名使用下划线：`media_list_cards`、`media_append_thought`、`media_promote_card` 等，以符合当前模型工具名约束。

推进到 `ready_for_production` 和开始生产都要消耗一次只在 HTTP 处理函数里签发的短期 intent。`media_promote_card` / `media_start_production` 走同一个方法，但模型自己编的 `intent_id` 会被拒绝。单测覆盖了这条拒绝路径。

## 模型

`ctx.llm.stream({ provider, model, system, messages, purpose })` 是 `LlmRuntime` 上的真实方法。`purpose` 通过声明合并写进 `LlmRequestPurposeMap`：`personal-media.topic | interview | writing | asset | review`。未配置 `llm.provider` / `llm.model`，或 `listProviders()` 里没有该 provider 时，不发起调用，改走带明确标记的本地启发式预览引擎。本地素材在提示词里用 `<<<ASSET>>>` 围栏标成不可信数据，默认不把图片送给云端（`privacy.sendImagesToCloud` 默认为 false）。

## 存储

业务数据在插件自己的 `node:sqlite` `DatabaseSync` 里，WAL，17 张业务表，外加 FTS5 `trigram` 索引。Node 24 自带的 SQLite 3.54.1 上，三字及以上的中文短语可以 `MATCH`；更短的查询走 `LIKE`。向量是本地字符二元组哈希，和关键词分一起做混合检索，不依赖外部嵌入服务。

## 参考

- https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish
- https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/config
- https://deepseek-harness.github.io/deepseek-harness/en/develop/cordis-tutorial/03-services
- https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.5/docs/cookbook/adding-a-tool.md
- 安装包内 `dsh-client-ui-schedule/lib/client.js`、`dsh-client-ui-layout`、`dsh-client-connection/lib/types/rpc.d.ts`、`dsh-llm/lib/types/index.d.ts`
