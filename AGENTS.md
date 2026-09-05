# AGENTS.md

PhiCommunity Revive 是基于 **SvelteKit 2 + Svelte 5（legacy 模式）+ Vite 6 + TypeScript** 的 Phigros-like 节奏游戏，纯前端 SPA（`ssr = false`）。谱面不在本仓库：游玩时按需从远端谱面仓库 HTTP 拉取。

## 命令与验证
- 包管理一律 `pnpm`（11.x）。`patchedDependencies`/`allowBuilds` 在 `pnpm-workspace.yaml`；`package.json` 里的 `pnpm.patchedDependencies` 已被忽略，每次 pnpm 命令都会打印一条无害警告。
- `pnpm dev`：Vite dev server（8080，`--host --open`）。
- `pnpm check`：类型检查（`svelte-kit sync && svelte-check`）。**当前基线 0 错误 0 警告**，这是主要验证手段，不要直接跑 `tsc`（tsconfig 依赖生成的 `.svelte-kit/`）。
- `pnpm build`：adapter-static 输出到 `build/`，GitHub Pages / Vercel / EdgeOne 均以它为产物。
- `pnpm preview`：在 8080 预览生产构建。
- `pnpm lint` / `lint:fix` **是坏的**：ESLint v9 需要 `eslint.config.js`，仓库只有过时的 `.eslintrc.json`，命令必然以 exit 2 失败，别拿它当门禁。
- `pnpm format` / `format:check`：Prettier 可用。配置：tab、单引号、分号、CRLF（`endOfLine: crlf`）、printWidth 256——改动时避免引入行尾/缩进噪音。
- 没有测试套件；验证 = `pnpm check` + `pnpm build` + 浏览器手测。

## 构建与环境
- `.env` 是 **git 跟踪的构建配置**（非秘密文件），经 `import.meta.env`（`VITE_*`）在构建期编译进前端，修改后必须重建。
- 谱面源按部署域名**子串**选择：含 `cf`/`vercel`/`eo` 分别用 `VITE_CHARTS_SOURCE_CF/VERCEL/EO`，否则回落到 `VITE_CHARTS_SOURCE`（逻辑在 `src/lib/chartSource.ts`）。`VITE_SITE_*` 是开场节点选择页的部署地址，按 hostname **精确匹配**。
- 谱面清单/元数据/音频/曲绘运行时从远端谱面仓库拉取（`content.json` 列目录 + 每曲 `meta.json`，见 `src/lib/meta.ts`、`src/lib/sources.ts`）。开发调试依赖网络与该源的 CORS。
- 三路谱面源在 `src/lib/sources.ts` 聚合：`phi`（默认）/ `ptc`（PhiTogether）/ `pz`（PhiZone），codename 带 `phi-`/`ptc-`/`pz-` 前缀。

## 架构速览
- SPA：`src/routes/+layout.ts` 设 `ssr = false`；adapter-static 以 `fallback: 404.html` 承接未预渲染的动态路由（如 `/play/[codename]/[level]`），静态托管下表现为 SPA 回退。新增页面无需手动接线。
- 代码风格：Svelte 5 但**全部使用 legacy（非 runes）响应式**——`let` / `$:` / `onMount` / `afterNavigate`，全 `src` 没有任何 `$state`/`$effect`。新代码不要引入 runes。注意 `$:` 不会追踪 `$app/state` 等导入对象（`+layout.svelte` 有注释说明）。
- 游玩引擎在 `src/lib/player/`：`main.ts` 创建 Phaser 4（WEBGL）实例并把实例挂到 `globalThis.__PHASER_GAME__`；主场景 `scenes/Game.ts`；`objects/`、`handlers/`、`services/`、`EventBus.ts` 分层。源自 Team-PhiZone/player（**MPL-2.0**，见 `LICENSES/`），文件头注保留。
- Phaser 是 fork 固定提交：`phaser: github:Naptie/phaser#2b2669f…`，另有 `phaser4-rex-plugins` 的 patch（`patches/`）。不要擅自升级。
- 谱面格式转换在 `src/lib/converters/`（RPE/PEC、Phira、Phiediter），各格式相对官方渲染的时间/坐标/旋转换算存在历史差异，务必先读文件头注释再动。
- 成绩/本地谱面/回放存 IndexedDB：库 `PhiCommunityPlayResults` v3（objectStore：成绩、`localCharts`、`replays`），封装在 `src/lib/db.ts`。结构兼容旧项目，别改库名/键。
- PWA：`vite-plugin-pwa` injectManifest，SW 源码 `src/sw.js`；`devOptions.enabled = false`，**开发模式没有 Service Worker**，PWA/缓存行为须用 `pnpm build && pnpm preview` 验证。大体积游戏资源由 sw.js 运行时 CacheFirst 接管（首装只预缓存应用壳）；`/cache` 页可管理缓存。
- 音游资源（音符贴图、字体、shaders、结算音频等）在 `static/game/`，随构建原样进入 `build/`。

## 历史遗留（不要动）
`legacy/`、`config/webpack.*.js`、`assets/`、`AssetSources/` 是重构前的 Webpack 多页项目残留，仍被 git 跟踪但 **src 完全不引用**，不是当前构建的一部分。不要按它们推断结构，也不要修改它们。

## 许可
- README 声明源码 AGPL-3.0，但 `package.json` 的 `license` 字段历史遗留为 GPL-3.0，**未统一，不要擅自改**。
- `src/lib/player|converters/`、`src/lib/types.ts`、`src/lib/utils.ts` 基于 MPL-2.0 的 PhiZone player；`static/game/ending/GradeHit.wav` 为 CC BY-NC-SA 4.0；其余媒体资源版权归原团队。替换/新增资源前核对 README 的权利说明。
