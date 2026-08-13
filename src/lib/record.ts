/**
 * 结算成绩记录：保存到 IndexedDB 并判定 NEW BEST。
 */
import { getResult, saveResult } from './db';
import { getChartRanking, getRks, type ChartMeta, type Level } from './meta';

export interface RecordOutcome {
  isNewBest: boolean;
  prevBest: number;
  rankingScore: number;
}

export async function recordPlayResult(
  meta: ChartMeta,
  level: Level,
  score: number,
  accuracy: number,
): Promise<RecordOutcome> {
  const key = `${meta.codename}-${level}`;
  const levelRank = getChartRanking(meta, level);
  const rankingScore = getRks(accuracy, levelRank);
  const prev = await getResult(key);
  const prevBest = prev?.score ?? 0;
  const isNewBest = score > prevBest;
  if (isNewBest) {
    await saveResult({
      codename: key,
      level,
      levelRank,
      score,
      accuracy,
      rankingScore,
    });
  }
  return { isNewBest, prevBest, rankingScore };
}