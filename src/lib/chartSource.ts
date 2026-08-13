/**
 * 谱面源选择：根据部署域名自动选择对应源，默认使用主源。
 *
 * 判断逻辑沿用旧项目（hostname 子串匹配）：
 * - 含 "cf" → Cloudflare Pages 源
 * - 含 "vercel" → Vercel 源
 * - 含 "eo" → EdgeOne 源
 * - 其他 → 默认源
 *
 * 对应环境变量在 .env（VITE_CHARTS_SOURCE*），修改后需重新构建。
 */
function isCloudflarePages(): boolean {
  return window.location.hostname.includes('cf');
}

function isVercel(): boolean {
  return window.location.hostname.includes('vercel');
}

function isEdgeOne(): boolean {
  return window.location.hostname.includes('eo');
}

export function getChartSource(): string {
  if (isCloudflarePages()) {
    return import.meta.env.VITE_CHARTS_SOURCE_CF;
  } else if (isVercel()) {
    return import.meta.env.VITE_CHARTS_SOURCE_VERCEL;
  } else if (isEdgeOne()) {
    return import.meta.env.VITE_CHARTS_SOURCE_EO;
  } else {
    return import.meta.env.VITE_CHARTS_SOURCE;
  }
}

export const chartSource = getChartSource();