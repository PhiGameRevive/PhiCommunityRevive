/**
 * 结算成绩记录：保存到 IndexedDB 并判定 NEW BEST。
 *
 * 模组（Mods）按 osu! 的分数倍率制参与：
 *  - 写入的分数 = 实际分数 × 各模组倍率之积
 *  - RKS 按模组修正后的定数计算，与选歌页显示的定数保持一致
 *  - 倍率为 0（AT 自动游玩）时完全不写入
 */
import { getResult, saveResult } from './db';
import { getChartRanking, getRks, type ChartMeta, type Level } from './meta';
import { getModifiedRank, getScoreMultiplier, isRecordable, type ModId } from './mods';

export interface RecordOutcome {
  isNewBest: boolean;
  prevBest: number;
  rankingScore: number;
  /** 本次生效的分数倍率（1 表示无模组影响） */
  scoreMultiplier: number;
  /** 倍率折算后实际写入的分数 */
  effectiveScore: number;
  /** 成绩是否被记录（AT 等模组下为 false） */
  recorded: boolean;
}

export async function recordPlayResult(
  meta: ChartMeta,
  level: Level,
  score: number,
  accuracy: number,
  mods: ModId[] = [],
): Promise<RecordOutcome> {
  const key = `${meta.codename}-${level}`;
  const baseRank = getChartRanking(meta, level);
  // 模组修正后的定数：EZ/HT 降低、HR/DT 提高，与选歌页展示一致
  const levelRank = getModifiedRank(baseRank, mods);
  const scoreMultiplier = getScoreMultiplier(mods);
  const effectiveScore = Math.round(score * scoreMultiplier);
  const rankingScore = getRks(accuracy, levelRank);
  const recordable = isRecordable(mods);

  const prev = await getResult(key);
  const prevBest = prev?.score ?? 0;
  const isNewBest = recordable && effectiveScore > prevBest;
  if (isNewBest) {
    await saveResult({
      codename: key,
      level,
      levelRank,
      score: effectiveScore,
      accuracy,
      rankingScore,
    });
  }
  return {
    isNewBest,
    prevBest,
    rankingScore: recordable ? rankingScore : 0,
    scoreMultiplier,
    effectiveScore,
    recorded: recordable,
  };
}