# AGENTS.md

PhiCommunity Revive 是纯原生 JavaScript（ES Modules）+ Webpack 5 的多页节奏游戏；没有框架、类型检查或测试套件。谱面不在本仓库，而在 `PhiCommunity-Charts-Repo`。

## 命令与验证

- 使用 pnpm：`pnpm install`、`pnpm start`（Webpack dev server，默认 `http://localhost:8080`，自动打开浏览器）、`pnpm build`（输出 `dist/`）、`pnpm watch`（生产配置 watch）。
- `pnpm test` 只是必然以 1 退出的占位脚本，不要把它当作验证。仓库也没有 lint/typecheck 脚本；按改动范围运行 `pnpm exec eslint <files>` 和 `pnpm exec prettier --write <files>`，最后以 `pnpm build` 验证集成。
- Prettier 使用 tab、单引号、分号、256 列和 CRLF；避免无关缩进或换行转换。

## 构建接线

- 页面由 `config/webpack.common.js` 显式接线。新增或重命名页面时必须同时更新 `entry` 和 `pagePlugins`（HtmlWebpackPlugin）；只新增 `src/<page>/` 不会产出 HTML。
- 非标准入口：根页是 `src/index.redirect.js`；游戏引擎 `whilePlaying` 是 `src/whilePlaying/script.phi.community.core.js`；`aboutUs` 使用共享的 `src/template.html`；`calibrate`、`statistic` 输出到 `settings/<page>/index.html`。
- `public/` 会原样复制到 `dist/`。Service Worker 源码是 `src/sw.js`，仅生产配置通过 Workbox `InjectManifest` 生成 `/service-worker.js`；开发构建不会生成它。

## 谱面源配置

- `.env` 是已跟踪的构建配置，不是本地秘密文件。Webpack 用 dotenv 读取四个 `CHARTS_SOURCE*` 值，再由 DefinePlugin 编译进浏览器代码；修改后必须重建。
- `src/utils/chartSource.js` 根据当前 hostname 是否包含 `cf`、`vercel`、`eo` 选择对应源，否则使用 `CHARTS_SOURCE`。这只是子串判断，调整域名或源选择时要同时检查该文件和 `.env`。
- `build:cf` / `build:vercel` 的 `--env charts-source` 替换器仍搜索已不存在的 `https://charts.focalors.ltd`，目前不会改变实际谱面源；不要依赖这两个脚本，使用 `.env`。

## CI、部署与资源

- 本地和 Vercel 使用 pnpm，但 `.github/workflows/page-deployment.yml` 固定使用 Node 17 + npm，在 `main` push 后构建并发布 `dist/` 到 `gh-pages`，随后触发 APP 仓库 dispatch。改依赖或构建流程时需兼顾这条 npm CI 路径。
- `dist/` 是生成物且被忽略，不要手改或提交。
- README 将源码声明为 AGPL-3.0、媒体资源声明为原团队保留版权，但 `package.json` 的 license 字段仍是 GPL-3.0；不要擅自统一或重许可，修改/替换音频、图片等资源前先核对权利说明。
