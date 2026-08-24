/**
 * 开场动画风格开关。
 *
 * 'new'    —— 19 秒完整时间轴（TapToStartNew.mp3），高潮命中时飘落花瓣
 * 'legacy' —— 旧版 8.5 秒开场（TapToStart.mp3）
 *
 * 不放进 Preferences：那个类型会整体交给 Phaser 引擎，不该混入 UI 偏好。
 */

export const INTRO_STYLES = ['new', 'legacy'] as const;
export type IntroStyle = (typeof INTRO_STYLES)[number];

const INTRO_KEY = 'phiIntroStyle';
/** 是否已完整看过一次开场（首次启动的 19 秒不允许跳过） */
const INTRO_SEEN_KEY = 'phiIntroSeen';

export const DEFAULT_INTRO_STYLE: IntroStyle = 'new';

export const loadIntroStyle = (): IntroStyle => {
  try {
    const raw = localStorage.getItem(INTRO_KEY);
    return (INTRO_STYLES as readonly string[]).includes(raw ?? '') ? (raw as IntroStyle) : DEFAULT_INTRO_STYLE;
  } catch {
    return DEFAULT_INTRO_STYLE;
  }
};

export const saveIntroStyle = (style: IntroStyle): void => {
  try {
    localStorage.setItem(INTRO_KEY, style);
  } catch {
    /* 忽略 */
  }
};

/** 首次启动（未看过开场）时不允许跳过前摇 */
export const hasSeenIntro = (): boolean => {
  try {
    return localStorage.getItem(INTRO_SEEN_KEY) === 'true';
  } catch {
    return false;
  }
};

export const markIntroSeen = (): void => {
  try {
    localStorage.setItem(INTRO_SEEN_KEY, 'true');
  } catch {
    /* 忽略 */
  }
};
