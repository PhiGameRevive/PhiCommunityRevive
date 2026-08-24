/**
 * 界面缩放：整体放大/缩小除游玩页之外的所有 UI。
 *
 * 实现是把 CSS `zoom` 加在根元素（<html>）上，等价于浏览器自身的页面缩放：
 * zoom 参与布局计算，初始包含块会随之换算，因此项目里大量使用的
 * `position: fixed; inset: 0` 全屏容器仍能正确铺满视口，只是内部内容整体变大/变小。
 * （若把 zoom 加在中间的包裹 div 上，fixed 元素的包含块仍是视口，缩放行为不可靠。）
 *
 * 游玩页是 Phaser canvas，缩放会让触摸坐标与判定线错位，由 +layout.svelte 按路由复位为 1。
 */

const SCALE_KEY = 'phiUiScale';
/** 缩放变更事件：设置页/开场缩放页调整后广播，让 +layout 立即同步 */
export const UI_SCALE_EVENT = 'phi-ui-scale';

export const MIN_UI_SCALE = 0.75;
export const MAX_UI_SCALE = 1.5;
export const UI_SCALE_STEP = 0.05;
export const DEFAULT_UI_SCALE = 1;

/** 夹紧到合法区间并对齐步长，避免浮点误差累积出 1.0500000000000003 这类值 */
export const clampUiScale = (value: number): number => {
  if (!Number.isFinite(value)) return DEFAULT_UI_SCALE;
  const stepped = Math.round(value / UI_SCALE_STEP) * UI_SCALE_STEP;
  return Math.min(Math.max(Number(stepped.toFixed(2)), MIN_UI_SCALE), MAX_UI_SCALE);
};

export const loadUiScale = (): number => {
  try {
    const raw = localStorage.getItem(SCALE_KEY);
    return raw ? clampUiScale(Number(raw)) : DEFAULT_UI_SCALE;
  } catch {
    return DEFAULT_UI_SCALE;
  }
};

export const saveUiScale = (value: number): number => {
  const scale = clampUiScale(value);
  try {
    localStorage.setItem(SCALE_KEY, String(scale));
  } catch {
    /* 隐私模式/配额异常时仅本次会话生效 */
  }
  return scale;
};

/** 把缩放应用到根元素；scale 为 1 时移除内联样式，避免多余的层叠上下文 */
export const applyUiScale = (scale: number): void => {
  const root = document.documentElement;
  if (scale === 1) root.style.removeProperty('zoom');
  else root.style.setProperty('zoom', String(clampUiScale(scale)));
};

/** 保存并立即生效，同时通知其他组件同步 */
export const commitUiScale = (value: number): number => {
  const scale = saveUiScale(value);
  applyUiScale(scale);
  window.dispatchEvent(new CustomEvent(UI_SCALE_EVENT, { detail: scale }));
  return scale;
};

/** 是否已经完成过首次界面缩放设置（跨节点跳转时由 URL 参数继承） */
export const hasUiScalePreference = (): boolean => {
  try {
    return localStorage.getItem(SCALE_KEY) !== null;
  } catch {
    return false;
  }
};
