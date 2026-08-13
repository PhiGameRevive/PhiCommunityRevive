/**
 * 谱面元数据（谱面仓库 meta.json）与工具函数。
 *
 * 谱面仓库结构（PhiCommunity-Charts-Repo）：
 *   {chartSource}/{codename}/meta.json
 *   {chartSource}/{codename}/{chartEZ|chartHARD|chartIN|chartAT|chartSP}  谱面文件（RPE JSON 或 PEC）
 *   {chartSource}/{codename}/{illustration}  曲绘
 *   {chartSource}/{codename}/{musicFile}  音乐
 *   {chartSource}/{codename}/{lineTexture}?  判定线贴图（可选）
 *   {chartSource}/{codename}/{backgroundAnimation}?  背景动画（可选）
 */
import { chartSource } from './chartSource';

export const LEVELS = ['ez', 'hd', 'in', 'at', 'sp'] as const;
export type Level = (typeof LEVELS)[number];

export interface ChartMeta {
  codename: string;
  name: string;
  artist: string;
  illustration: string;
  musicFile: string;
  chartDesigner?: string;
  ezChartDesigner?: string;
  hdChartDesigner?: string;
  inChartDesigner?: string;
  atChartDesigner?: string;
  ezRanking?: number;
  hdRanking?: number;
  inRanking?: number;
  atRanking?: number;
  chartEZ?: string;
  chartHARD?: string;
  chartIN?: string;
  chartAT?: string;
  chartSP?: string;
  illustrator?: string;
  lineTexture?: string;
  backgroundAnimation?: string;
}

export async function fetchMeta(codename: string): Promise<ChartMeta> {
  const response = await fetch(encodeURI(`${chartSource}/${codename}/meta.json`));
  if (!response.ok) {
    throw new Error(`Failed to fetch meta.json for ${codename}: ${response.status}`);
  }
  return (await response.json()) as ChartMeta;
}

export function getChartFile(meta: ChartMeta, level: Level): string | undefined {
  if (level === 'sp') return meta.chartSP;
  const key = `chart${level.toUpperCase()}` as keyof ChartMeta;
  return meta[key] as string | undefined;
}

export function getChartDesigner(meta: ChartMeta, level: Level): string {
  if (level === 'sp') return meta.chartDesigner ?? 'Unknown';
  const key = `${level}ChartDesigner` as keyof ChartMeta;
  return (meta[key] as string | undefined) ?? meta.chartDesigner ?? 'Unknown';
}

export function getChartRanking(meta: ChartMeta, level: Level): number {
  if (level === 'sp') return 0;
  const key = `${level}Ranking` as keyof ChartMeta;
  return (meta[key] as number | undefined) ?? 0;
}

export const chartUrl = (codename: string, file: string) =>
  `${chartSource}/${encodeURIComponent(codename)}/${encodeURIComponent(file)}`;

export const songUrl = (codename: string, file: string) =>
  `${chartSource}/${encodeURIComponent(codename)}/${encodeURIComponent(file)}`;

/**
 * RKS（Ranking Score）计算：((acc * 100 - 55) / 45)² × 定数
 */
export function getRks(accuracy: number, levelRank: number): number {
  if (accuracy >= 0.7 && levelRank > 0) {
    return Number(
      (Math.pow((accuracy * 100 - 55) / 45, 2) * levelRank).toFixed(2),
    );
  }
  return 0;
}

/**
 * 成绩等级（Phigros 规则）：
 *   Phi ≥ 100% | V ≥ 99% | S ≥ 96% | A ≥ 92% | B ≥ 88% | C ≥ 80% | F < 80%
 */
export type Rank = 'Phi' | 'V' | 'S' | 'A' | 'B' | 'C' | 'F';

export function getRank(accuracy: number): Rank {
  if (accuracy >= 1) return 'Phi';
  if (accuracy >= 0.99) return 'V';
  if (accuracy >= 0.96) return 'S';
  if (accuracy >= 0.92) return 'A';
  if (accuracy >= 0.88) return 'B';
  if (accuracy >= 0.8) return 'C';
  return 'F';
}