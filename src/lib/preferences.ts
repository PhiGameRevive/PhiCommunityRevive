/**
 * 玩家偏好：localStorage 持久化，映射到引擎的 Preferences。
 */
import type { Preferences } from './types';

const PREF_KEY = 'phiPreferences';

export const DEFAULT_PREFERENCES: Preferences = {
  aspectRatio: null,
  backgroundBlur: 1,
  backgroundLuminance: 0.5,
  chartFlipping: 0,
  chartOffset: 0,
  fcApIndicator: true,
  goodJudgment: 160,
  hitSoundVolume: 0.75,
  lineThickness: 1,
  musicVolume: 1,
  noteSize: 1,
  perfectJudgment: 80,
  simultaneousNoteHint: true,
  timeScale: 1,
  useVideoBackground: true,
  videoBackgroundAlpha: 0.5,
  persistentSeekBar: false,
};

export function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return { ...DEFAULT_PREFERENCES, ...parsed };
  } catch (e) {
    console.error('Failed to load preferences', e);
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(preferences: Preferences): void {
  localStorage.setItem(PREF_KEY, JSON.stringify(preferences));
}