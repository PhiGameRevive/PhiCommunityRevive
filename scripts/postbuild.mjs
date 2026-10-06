/*
 * 构建后处理：把 SPA 回退页 404.html 复制一份为 index.html。
 *
 * 背景：本项目 ssr=false，adapter-static 只把应用壳写成 404.html（fallback），
 * 不产出 index.html。各静态托管对根路径 / SPA 回退的处理不同：
 *   - GitHub Pages：请求不存在的路径时回退 404.html（可用，但状态码为 404）
 *   - EdgeOne：SPA 需要 index.html 作为回退目标（edgeone.json 里 /* → /index.html）
 * 因此补一份 index.html，让根路径与未知路径都能 200 返回应用壳。
 */
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const buildDir = join(process.cwd(), 'build');
const fallback = join(buildDir, '404.html');
const index = join(buildDir, 'index.html');

if (!existsSync(fallback)) {
  console.warn('[postbuild] 未找到 build/404.html，跳过 index.html 生成');
  process.exit(0);
}

copyFileSync(fallback, index);
console.log('[postbuild] 已由 404.html 生成 index.html');
