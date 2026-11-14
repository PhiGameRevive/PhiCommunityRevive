<div align="center">
<img alt="logo" height="80" src="./static/AppIcon.png" />
<h1>PhiCommunity Revive</h1>

<p>A fork version of Phicommunity</p>
</div>
<br />

## 📄 这是什么？

这是一款名为`PhiCommunity`的节奏游戏分支可自部署的版本，它仿照`Phigros`制作，源仓库为[PhiCommunity](https://github.com/yuameshi/phicommunity)

本项目是基于 **SvelteKit + Vite + TypeScript** 重构的版本，谱面引擎基于 [PhiZone Player](https://github.com/Team-PhiZone/player)（Phaser 4），并兼容 PRPR / Phira 的 `extra.json` 故事板格式。

## 🚀 本地开发

```bash
pnpm install
pnpm dev       # http://localhost:8080
pnpm check     # svelte-check 类型检查
pnpm build     # 产物输出到 build/
```

## 🔧 谱面源配置

在 `.env` 中配置四个值（构建时编译进浏览器代码，修改后必须重建）：

| 变量 | 用途 |
| ---- | ---- |
| `VITE_CHARTS_SOURCE` | 默认谱面源域名 |
| `VITE_CHARTS_SOURCE_CF` | 域名含 `cf` 时使用 |
| `VITE_CHARTS_SOURCE_VERCEL` | 域名含 `vercel` 时使用 |
| `VITE_CHARTS_SOURCE_EO` | 域名含 `eo` 时使用 |

谱面仓库部署方法请转到 [PhiCommunity-Charts-Repo](https://github.com/PhiGameRevive/PhiCommunity-Charts-Repo)

## 📖 故事模式《余页》

选歌页右上角的「余页 · 故事」入口（或直接访问 `/story`）会进入独立的故事模式：10 章、9 座区域、50 个调查场景、32 首曲目、9 道证据谜题、12 段黑白过场。故事画面为程式化黑白，与谱面渲染互不影响。

- 存档写在独立数据库 `PhiCommunityYuye`，**不会**写入自由模式的最佳成绩、RKS、回放或本地谱面。
- 曲目节点提供手动演奏、自动伴奏、纯聆听三种方式，都不计成绩；剧情可完整通关。
- 含较强恐怖表现，可在故事设置的「降低动态／允许较强恐怖表现」中调整，关键剧情与结局不会因此减少。
- 谜题 P06 的源码线索在 `story-evidence/yuye/edition-01/`，站内镜像始终可读；如需在面板显示外链，须在发布后运行 `node scripts/set-story-revision.mjs <40位提交SHA>` 再重建，未配置时会明确标注「尚未发布」。
- 开发与验证命令：`pnpm test:story`、`pnpm story:duration`、`pnpm story:encoding`。

实现现状、已验证项目与尚未验证项见 [docs/design/story-mode/implementation.md](./docs/design/story-mode/implementation.md)。

## 🌐 部署

### Github Pages

1. 点击右上角`Fork`按钮创建当前仓库的副本
    > **可选** 在`.env`文件中输入自己谱面仓库文件的域名
2. 点击项目界面的`Actions`, 点击绿色按钮启用`Github Actions`
3. 点开项目设置, 转到`Pages`选项卡, 应用以下设置

| 设置项       | 设置内容                                                                |
| ------------- | ----------------------------------------------------------------------- |
| Source        | `Deploy from a branch`                                                  |
| Branch        | `gh-pages` `/`(root)                                                    |
| Custom Domain | 输入你的域名, 在域名控制台添加`CNAME`记录, 内容为`你的用户名.github.io` |

5. 点击`Save`保存即可, `Github Actions`会自动运行; 也可以在`Actions`选项卡中手动触发 `Build and Deploy to GitHub Pages`

### Edgeone Pages

1. 注册 [Edgeone 账号](https://edgeone.cn/)
    > **可选** 在`.env`文件中输入自己谱面仓库文件的域名
2. 打开 [Edgeone 控制台](https://console.tencentcloud.com/edgeone), 转到`Pages`选项卡
3. 点击`创建项目`, 选择`导入Git仓库`, 构建设置如下

| 构建设置     | 设置内容               |
| ------------ | ---------------------- |
| 项目名称 | 更改成只含小写字母的名称即可 |
| 构建命令     | `pnpm build`          |
| 安装命令     | `pnpm i`               |
| 输出目录 | `build`                 |

4. 点击`保存并部署`, 等待部署完成即可访问
5. 进入项目页面点击`自定义域`添加自己的域名
    > **注意**: 你的域名一定要带`eo`关键字, 否则谱面链接会使用默认配置（其实也不是必须）

### Vercel

1. 打开 [Vercel 网站](https://vercel.com), 注册账号
2. 进入主页面点击`Add New`, 选择`Project`
3. 在仓库选择页面选择你刚刚创建的副本, 随后点击`Deploy`
4. 部署完成后添加域名, 这里不过多赘述
    > **注意**: 你的域名一定要带`vercel`关键字, 否则谱面链接会使用默认配置（其实也不是必须）

## 📜 许可证

- 本仓库源码遵循 **AGPL-3.0**（`package.json` 中的 license 字段历史遗留为 GPL-3.0，未统一）
- `src/lib/player/`、`src/lib/converters/`、`src/lib/types.ts`、`src/lib/utils.ts` 基于 [PhiZone Player](https://github.com/Team-PhiZone/player)（**MPL-2.0**，副本见 `LICENSES/MPL-2.0-PhiZone-Player.txt`），修改用于 web-only 环境
- 谱面解析兼容 PRPR / Phira 格式（仅参考其格式规范，未复制代码）
- `static/game/ending/GradeHit.wav`（结算等级音效）by Naptie（基于 [Pixabay](https://pixabay.com/) 音效），遵循 **CC BY-NC-SA 4.0**：非商业使用、署名来源、衍生作品以相同许可发布
- 结算音乐使用本项目自有 `legacy/LevelOver/LevelOver0-3.ogg`（PhiZone 的 results music 为专有资产，未使用）
- 其余媒体资源（曲绘、音符皮肤、打击音效等）版权归原团队/原出处所有