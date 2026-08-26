/**
 * 游玩模组（Mods）：在选歌页选择，用于增减难度，并按 osu! 的方式给分数乘以倍率。
 *
 * 大部分模组都建立在引擎现有能力之上：
 *  - 判定窗口   perfectJudgment / goodJudgment（EZ 放宽、HR 收紧）
 *  - 谱面倍速   timeScale（走 Clock.setRate，音乐与判定同步变速）
 *  - 翻转掩码   chartFlipping（bit1 水平、bit2 垂直）
 *  - 自动游玩   Config.autoplay
 *  - 练习模式   Config.practice（自由跳转 + A/B 循环，播完不结算）
 *  - 无法失败   Config.noFail（关闭失败判定；AT/PR 隐含开启）
 *  - 下隐       Config.hidden（音符接近判定线时淡出隐藏）
 *  - 全连/暴毙  Config.perfectFail / suddenDeath（特定判定直接失败）
 *  - 上隐       Config.sudden（音符出现时间缩短）
 *  - 无线       Config.noLines（隐藏判定线）
 *  - 关背景     Config.blackout（隐藏曲绘背景）
 *  - 残血/复活  Config.lowLife / resurrect（开局生命值 / 失败半血续一次）
 *
 * 成绩规则（分数倍率制）：
 *  - 写入记录的分数 = 实际分数 × 所有已启用模组倍率之积
 *  - RKS 按「模组修正后的定数」计算，与选歌页显示的定数一致
 *  - 倍率为 0（自动分区的 AT / PR）时完全不记录成绩
 */
import type { Preferences } from './types';

export type ModId =
  | 'NF'
  | 'EZ'
  | 'HT'
  | 'AT'
  | 'PR'
  | 'HR'
  | 'DT'
  | 'HD'
  | 'MR'
  | 'VM'
  | 'PF'
  | 'SD'
  | 'SU'
  | 'HP'
  | 'NL'
  | 'RS'
  | 'RR'
  | 'BL'
  | 'MW'
  | 'WW'
  | 'DB';

/** 分组：降低难度 / 提升难度 / 特殊（不改变难度）/ 自动（不计分的辅助模式） */
export type ModCategory = 'reduction' | 'increase' | 'special' | 'auto';

export interface ModDef {
  id: ModId;
  /** 两字母缩写，用于徽章展示 */
  short: string;
  name: string;
  description: string;
  category: ModCategory;
  /** 分数倍率；0 表示该成绩不记录 */
  scoreMultiplier: number;
  /** 定数修正量（叠加），用于选歌页显示与 RKS 计算 */
  rankDelta: number;
  /** 互斥组：同组内只能启用一个 */
  exclusive?: string;
  /** 仅桌面端可用（依赖 window.open 弹窗与 window.moveTo，移动端/Safari 无效） */
  desktopOnly?: boolean;
}

export const MOD_CATEGORY_LABELS: Record<ModCategory, string> = {
  reduction: '降低难度',
  increase: '提升难度',
  special: '特殊',
  auto: '自动',
};

/**
 * 面板中分区的展示顺序。
 * 这里是唯一的顺序来源——新增分区只需改这里与 MOD_CATEGORY_LABELS，
 * 界面会自动跟上（不要在页面里另写一份列表）。
 */
export const MOD_CATEGORY_ORDER: ModCategory[] = ['reduction', 'increase', 'special', 'auto'];

export const MODS: ModDef[] = [
  {
    id: 'NF',
    short: 'NF',
    name: '无法失败',
    description: '失误过多也不会失败',
    category: 'reduction',
    scoreMultiplier: 0.5,
    rankDelta: -1,
  },
  {
    id: 'EZ',
    short: 'EZ',
    name: '简单',
    description: '判定窗口放宽 25%',
    category: 'reduction',
    scoreMultiplier: 0.5,
    rankDelta: -2,
    exclusive: 'judgment',
  },
  {
    id: 'HT',
    short: 'HT',
    name: '慢速',
    description: '谱面与音乐速度降至 75%',
    category: 'reduction',
    scoreMultiplier: 0.3,
    rankDelta: -1.5,
    exclusive: 'rate',
  },
  {
    id: 'RS',
    short: 'RS',
    name: '复活',
    description: '生命耗尽时半血复活一次，继续游玩',
    category: 'reduction',
    scoreMultiplier: 0.8,
    rankDelta: -1,
  },
  {
    id: 'HR',
    short: 'HR',
    name: '硬核',
    description: '判定窗口收紧 25%',
    category: 'increase',
    scoreMultiplier: 1.06,
    rankDelta: 1,
    exclusive: 'judgment',
  },
  {
    id: 'DT',
    short: 'DT',
    name: '倍速',
    description: '谱面与音乐速度提升至 130%',
    category: 'increase',
    scoreMultiplier: 1.12,
    rankDelta: 1.5,
    exclusive: 'rate',
  },
  {
    id: 'HD',
    short: 'HD',
    name: '下隐 (实验性)',
    description: '音符接近判定线时淡出隐藏',
    category: 'increase',
    scoreMultiplier: 1.1,
    rankDelta: 1,
  },
  {
    id: 'PF',
    short: 'PF',
    name: '全连 (实验性)',
    description: '出现非 PERFECT 判定立即失败',
    category: 'increase',
    scoreMultiplier: 1.08,
    rankDelta: 1,
    exclusive: 'precision',
  },
  {
    id: 'SD',
    short: 'SD',
    name: '暴毙',
    description: '任意 MISS 立即失败',
    category: 'increase',
    scoreMultiplier: 1.05,
    rankDelta: 0.5,
    exclusive: 'precision',
  },
  {
    id: 'SU',
    short: 'SU',
    name: '上隐 (实验性)',
    description: '音符出现时间缩短为 40%，更考验读谱',
    category: 'increase',
    scoreMultiplier: 1.08,
    rankDelta: 0.5,
  },
  {
    id: 'HP',
    short: 'HP',
    name: '残血',
    description: '开局生命仅 30%，容错极低',
    category: 'increase',
    scoreMultiplier: 1.05,
    rankDelta: 0.5,
  },
  {
    id: 'NL',
    short: 'NL',
    name: '无线 (实验性)',
    description: '隐藏全部判定线，仅剩音符',
    category: 'increase',
    scoreMultiplier: 1.12,
    rankDelta: 1,
  },
  {
    id: 'MR',
    short: 'MR',
    name: '水平镜像',
    description: '谱面左右翻转',
    category: 'special',
    scoreMultiplier: 1,
    rankDelta: 0,
    exclusive: 'flip',
  },
  {
    id: 'VM',
    short: 'VM',
    name: '垂直翻转',
    description: '谱面上下翻转',
    category: 'special',
    scoreMultiplier: 1,
    rankDelta: 0,
    exclusive: 'flip',
  },
  {
    id: 'RR',
    short: 'RR',
    name: '旋转 180°',
    description: '谱面整体旋转 180 度（水平+垂直镜像合体）',
    category: 'special',
    scoreMultiplier: 1,
    rankDelta: 0,
    exclusive: 'flip',
  },
  {
    id: 'BL',
    short: 'BL',
    name: '关背景',
    description: '隐藏曲绘背景，纯黑演出',
    category: 'special',
    scoreMultiplier: 1,
    rankDelta: 0,
  },
  {
    id: 'MW',
    short: 'MW',
    name: '律动窗',
    description: '游玩界面移入小窗，随音乐能量律动漂移（仅桌面端）',
    category: 'special',
    scoreMultiplier: 1,
    rankDelta: 0,
    exclusive: 'window',
    desktopOnly: true,
  },
  {
    id: 'WW',
    short: 'WW',
    name: '游走窗',
    description: '游玩界面移入小窗，小窗在屏幕上游走（仅桌面端）',
    category: 'special',
    scoreMultiplier: 1,
    rankDelta: 0,
    exclusive: 'window',
    desktopOnly: true,
  },
  {
    id: 'DB',
    short: 'DB',
    name: '干扰窗',
    description: '开局弹出 3 个黑色小窗四处移动，干扰视觉（仅桌面端）',
    category: 'special',
    scoreMultiplier: 1,
    rankDelta: 0,
    desktopOnly: true,
  },
  {
    id: 'AT',
    short: 'AT',
    name: '自动游玩',
    description: '由程序完成全部打击',
    category: 'auto',
    scoreMultiplier: 0,
    rankDelta: 0,
    exclusive: 'auto',
  },
  {
    id: 'PR',
    short: 'PR',
    name: '练习模式',
    description: '可自由跳转与 A/B 点循环，播完不结算',
    category: 'auto',
    scoreMultiplier: 0,
    rankDelta: 0,
    exclusive: 'auto',
  },
];

const MOD_MAP = new Map<ModId, ModDef>(MODS.map((m) => [m.id, m]));

export const getMod = (id: ModId): ModDef | undefined => MOD_MAP.get(id);

/* ---------------- 持久化 ---------------- */

const MODS_KEY = 'phiMods';

const isModId = (v: unknown): v is ModId => typeof v === 'string' && MOD_MAP.has(v as ModId);

/** 读取已启用的模组（按 MODS 顺序归一化，过滤未知与互斥冲突） */
export const loadMods = (): ModId[] => {
  try {
    const raw = localStorage.getItem(MODS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return normalizeMods(parsed.filter(isModId));
  } catch {
    return [];
  }
};

export const saveMods = (mods: ModId[]): ModId[] => {
  const normalized = normalizeMods(mods);
  try {
    localStorage.setItem(MODS_KEY, JSON.stringify(normalized));
  } catch {
    /* 隐私模式/配额异常时仅本次会话生效 */
  }
  return normalized;
};

/** 去重、按定义顺序排序，并保证每个互斥组最多一个（保留后出现的） */
export const normalizeMods = (mods: ModId[]): ModId[] => {
  const kept = new Set<ModId>();
  const groups = new Map<string, ModId>();
  for (const id of mods) {
    const def = MOD_MAP.get(id);
    if (!def) continue;
    if (def.exclusive) {
      const prev = groups.get(def.exclusive);
      if (prev) kept.delete(prev);
      groups.set(def.exclusive, id);
    }
    kept.add(id);
  }
  return MODS.filter((m) => kept.has(m.id)).map((m) => m.id);
};

/** 切换单个模组：启用时自动踢掉同互斥组的其他模组 */
export const toggleMod = (mods: ModId[], id: ModId): ModId[] => {
  const def = MOD_MAP.get(id);
  if (!def) return mods;
  if (mods.includes(id)) return normalizeMods(mods.filter((m) => m !== id));
  const next = def.exclusive
    ? mods.filter((m) => MOD_MAP.get(m)?.exclusive !== def.exclusive)
    : [...mods];
  return normalizeMods([...next, id]);
};

/* ---------------- 应用到游玩配置 ---------------- */

/** 判定窗口缩放：EZ 放宽、HR 收紧 */
const JUDGMENT_SCALE: Partial<Record<ModId, number>> = { EZ: 1.25, HR: 0.75 };
/** 速度倍率 */
const RATE_SCALE: Partial<Record<ModId, number>> = { HT: 0.75, DT: 1.3 };

/**
 * 在玩家偏好之上叠加模组效果，返回新对象（不修改传入的偏好，
 * 也不会污染 localStorage 中保存的用户设置）。
 */
export const applyModsToPreferences = (preferences: Preferences, mods: ModId[]): Preferences => {
  const next: Preferences = { ...preferences };
  for (const id of mods) {
    const judgment = JUDGMENT_SCALE[id];
    if (judgment !== undefined) {
      next.perfectJudgment = Math.round(next.perfectJudgment * judgment);
      next.goodJudgment = Math.round(next.goodJudgment * judgment);
    }
    const rate = RATE_SCALE[id];
    if (rate !== undefined) next.timeScale = Number((next.timeScale * rate).toFixed(3));
    if (id === 'MR') next.chartFlipping |= 1;
    if (id === 'VM') next.chartFlipping |= 2;
    if (id === 'RR') next.chartFlipping |= 3;
  }
  return next;
};

/** 是否启用自动游玩 */
export const isAutoplay = (mods: ModId[]): boolean => mods.includes('AT');

/** 是否启用练习模式（可自由跳转与 A/B 循环，播完不结算） */
export const isPractice = (mods: ModId[]): boolean => mods.includes('PR');

/**
 * 是否免于失败判定。
 * NF 显式开启；AT（程序代打）与 PR（练习）同样不应触发失败。
 */
export const isNoFail = (mods: ModId[]): boolean =>
  mods.includes('NF') || mods.includes('AT') || mods.includes('PR');

/** 是否启用下隐（音符接近判定线时淡出隐藏） */
export const isHidden = (mods: ModId[]): boolean => mods.includes('HD');

/** 全连（PF）：出现非 PERFECT 判定立即失败 */
export const isPerfect = (mods: ModId[]): boolean => mods.includes('PF');

/** 暴毙（SD）：任意 MISS 立即失败 */
export const isSuddenDeath = (mods: ModId[]): boolean => mods.includes('SD');

/** 上隐（SU）：音符出现时间缩短，更考验读谱 */
export const isSudden = (mods: ModId[]): boolean => mods.includes('SU');

/** 无线（NL）：隐藏判定线，仅剩音符 */
export const isNoLines = (mods: ModId[]): boolean => mods.includes('NL');

/** 关背景（BL）：隐藏曲绘背景 */
export const isBlackout = (mods: ModId[]): boolean => mods.includes('BL');

/** 残血（HP）：开局生命值低于满值 */
export const isLowLife = (mods: ModId[]): boolean => mods.includes('HP');

/** 复活（RS）：生命耗尽时半血复活一次 */
export const isResurrect = (mods: ModId[]): boolean => mods.includes('RS');

/** 分数倍率（所有已启用模组之积）；0 表示不记录成绩 */
export const getScoreMultiplier = (mods: ModId[]): number =>
  mods.reduce((acc, id) => acc * (MOD_MAP.get(id)?.scoreMultiplier ?? 1), 1);

/** 定数修正量之和 */
export const getRankDelta = (mods: ModId[]): number =>
  mods.reduce((acc, id) => acc + (MOD_MAP.get(id)?.rankDelta ?? 0), 0);

/** 模组修正后的定数（不小于 0），用于选歌页显示与 RKS 计算 */
export const getModifiedRank = (rank: number, mods: ModId[]): number => {
  if (rank <= 0) return rank;
  return Math.max(0, Number((rank + getRankDelta(mods)).toFixed(1)));
};

/** 成绩是否会被记录（AT 等倍率为 0 的模组不记录） */
export const isRecordable = (mods: ModId[]): boolean => getScoreMultiplier(mods) > 0;
