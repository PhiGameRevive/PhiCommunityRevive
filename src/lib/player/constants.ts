/*
 * Derived from Team-PhiZone/player (https://github.com/Team-PhiZone/player).
 * SPDX-License-Identifier: MPL-2.0
 * Modified by PhiCommunity Revive for web-only usage.
 */
import { base } from '$app/paths';
import type { LevelType, NoteSkinName, ResourcePack } from '$lib/types';

/*
    The text to display underneath the combo counter.
*/
export const COMBO_TEXT = 'COMBO';

/*
    The size of hit effects, which will be scaled by the note size from the preferences.
*/
export const HIT_EFFECTS_SIZE = 1.1;

/*
    The size of hit effects particles, which will be scaled by HIT_EFFECTS_SIZE.
*/
export const HIT_EFFECTS_PARTICLE_SIZE = 27;

/*
    The sidelength (in pixels) of the square area in which the hit effects particles will be
    randomly scattered, which will be scaled by HIT_EFFECTS_SIZE.
*/
export const HIT_EFFECTS_PARTICLE_SPREAD_RANGE = 400;

/*
    The base size of notes, which will be scaled by the note size from the preferences.
*/
export const NOTE_BASE_SIZE = 0.19;

/*
    The priorities for each note type. A note with a higher priority will be rendered on top of those with relatively lower priorities.
*/
export const NOTE_PRIORITIES = [0, 3, 1, 4, 2];

/*
    Minimum velocity (in chart pixels per second) required to Perfect a Flick note.
*/
export const FLICK_VELOCTY_THRESHOLD = 75;

/*
    Maximum no-input interval (in milliseconds) allowed before a Hold note is considered missed.
*/
export const HOLD_BODY_TOLERANCE = 100;

/*
    Interval (in milliseconds) between the end of a Hold note and the judgment time of the note.
*/
export const HOLD_TAIL_TOLERANCE = 100;

/*
    Maximum distance (in chart pixels) between the projections of the input and a note along
    the judgment line allowed to hit the note.
*/
export const JUDGMENT_THRESHOLD = 180;

/*
    The radius (in percentage) of rounded corners of the illustration on the results scene.
    0 for no rounding; 100 for full rounding.
*/
export const RESULTS_ILLUSTRATION_CORNER_RADIUS = 12;

/*
    The regular expression to match keyboard inputs for playing.
*/
export const KEYBOARD_INPUT_REGEX = /^[0-9a-z`\-=[\]\\;',./ ]$/;

/*
    The maximum dimension (width or height) of images on mobile platforms. Images exceeding
    this limit will be scaled down proportionally before being handed to Phaser, to prevent
    issues with high-resolution/large images on devices with limited resources.
*/
export const MOBILE_MAX_IMAGE_DIMENSION = 2048;

/*
    失败判定：生命值从 1 开始，MISS 与 BAD 各扣除下列比例，
    Perfect / Good 会回复少量生命。降到 0 即触发失败（NF / AT / PR 模组下不启用）。
*/
export const LIFE_PENALTY_MISS = 0.06;
export const LIFE_PENALTY_BAD = 0.03;
export const LIFE_RECOVER_PERFECT = 0.012;
export const LIFE_RECOVER_GOOD = 0.006;

/* 残血（HP）模组：开局生命值；复活（RS）模组：失败后恢复到的生命值 */
export const LOW_LIFE_START = 0.3;
export const RESURRECT_LIFE = 0.5;

/* 上隐（SU）模组：音符出现时间（visibleTime）的保留比例 */
export const SUDDEN_VISIBLE_RATIO = 0.4;

/*
    转换器给音符 visibleTime 的默认值是 999999（= 从一开始就可见，无前摇），
    真实前摇由 PhiEditer 的 alpha 事件换算成秒（通常 1~2s）。
    上隐时：>= 60s 一律视为哨兵（任何音符提前 60s 出现都等于全程可见），
    统一压缩成短前摇，否则哨兵值 ×0.4 后仍是几十万秒，观感无变化。
*/
export const VISIBLE_TIME_SENTINEL = 60;
export const SUDDEN_SENTINEL_LEAD_SEC = 0.5;

/*
    前奏/间奏倒计时：相邻可交互音符间隔超过该秒数才显示倒计时；
    前奏剩余超过 SKIP_LEAD_SEC 时提供「跳过前奏」，跳过后还剩该秒数。
*/
export const MIN_INTRO_SEC = 3;
export const SKIP_LEAD_SEC = 3;

/*
    尾奏跳过 / 提前结算：
    - 最后一个音符判定结束后，音乐剩余超过 OUTRO_MIN_SEC 时显示「跳过尾奏」；
    - 提前结算设置开启时，最后一个音符判定结束后再等 EARLY_FINISH_DELAY 秒出结算。
*/
export const OUTRO_MIN_SEC = 3;
export const EARLY_FINISH_DELAY = 0.6;

/*
    失败演出：音频在此时长内线性减速至停止（毫秒）。
*/
export const FAIL_SLOWDOWN_MS = 1200;

/*
    HTMLMediaElement.playbackRate 的合法区间。
    低于 MIN_PLAYBACK_RATE（Chromium 的 kMinRate = 1/16）会抛
    NotSupportedError，因此减速演出与倍速模组都必须在此范围内取值。
*/
export const MIN_PLAYBACK_RATE = 0.0625;
export const MAX_PLAYBACK_RATE = 16;

/** 把播放速率钳制到浏览器支持的区间 */
export const clampPlaybackRate = (rate: number): number => {
  if (!Number.isFinite(rate)) return 1;
  return Math.min(Math.max(rate, MIN_PLAYBACK_RATE), MAX_PLAYBACK_RATE);
};

/*
    下隐（HD）模组：音符接近判定线时淡出隐藏。

    阈值按「距打击还有多少秒」而非距离衡量。距离会让淡出时长随音符速度变化——
    高速音符（或含 speed 事件的谱面）几帧就能穿过整个淡出区间，看起来是凭空消失
    而非渐隐。改用时间后，任何速度的音符淡出观感一致。
*/
export const HIDDEN_FADE_START_SEC = 0.75;
export const HIDDEN_FADE_END_SEC = 0.38;

/**
 * 下隐模组的透明度系数。
 * @param secToHit 距打击时刻还有多少秒（已过打击点时为负）
 */
export const hiddenAlphaFactor = (secToHit: number): number => {
  if (!Number.isFinite(secToHit)) return 1;
  if (secToHit >= HIDDEN_FADE_START_SEC) return 1;
  if (secToHit <= HIDDEN_FADE_END_SEC) return 0;
  return (secToHit - HIDDEN_FADE_END_SEC) / (HIDDEN_FADE_START_SEC - HIDDEN_FADE_END_SEC);
};

export const DEFAULT_RESOURCE_PACK_ID = '__default__';

/*
    The default resource pack to use when no resource pack is specified or imported.
*/
export const DEFAULT_RESOURCE_PACK: ResourcePack<string> & { id: string } = {
  id: DEFAULT_RESOURCE_PACK_ID,
  name: 'Default',
  author: '鏄熼箍ELEC, Supa7onyz & Naptie',
  description: 'The default look of PhiZone Player.',
  thumbnail: `${base}/banner.png`,
  noteSkins: ([
    'Tap',
    'TapHL',
    'HoldHead',
    'HoldBody',
    'HoldTail',
    'HoldHeadHL',
    'HoldBodyHL',
    'HoldTailHL',
    'Flick',
    'FlickHL',
    'Drag',
    'DragHL',
  ] as NoteSkinName[]).map((name) => {
    return {
      name,
      file: `${base}/game/notes/${name}.png`,
    };
  }),
  hitSounds: (['Tap', 'Flick', 'Drag'] as const).map((name) => {
    return {
      name,
      // 默认音效文件名统一为小写，避免 Linux 部署环境的大小写差异。
      file: `${base}/game/hitsounds/${name.toLowerCase()}.ogg`,
    };
  }),
  hitEffects: {
    spriteSheet: `${base}/game/HitEffects.png`,
    frameWidth: 375,
    frameHeight: 378,
    frameRate: 128,
    particle: {
      count: 5,
      style: 'circle',
    },
  },
  ending: {
    grades: (['A', 'B', 'C', 'F', 'Phi', 'S', 'V-FC', 'V'] as const).map((name) => {
      return {
        name,
        file: `${base}/game/grades/${name}.png`,
      };
    }),
    music: [0, 1, 2, 3, 4].map((levelType) => {
      return {
        levelType: levelType as LevelType,
        beats: 64,
        bpm: 140,
        file: `${base}/game/ending/LevelOver${Math.min(levelType, 3)}.ogg`,
      };
    }),
  },
  fonts: [
    ...(['Outfit', 'NotoSansSC'] as const).map((name) => {
      return {
        name,
        type: 'truetype' as const,
        file: `${base}/fonts/${name}/${name}.ttf`,
      };
    }),
    {
      name: 'Outfit',
      type: 'bitmap' as const,
      texture: `${base}/fonts/Outfit/Outfit.png`,
      descriptor: `${base}/fonts/Outfit/Outfit.fnt`,
    },
  ],
};
