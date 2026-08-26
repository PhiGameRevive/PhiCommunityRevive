/**
 * 桌面端弹窗类模组（MW 律动窗 / WW 游走窗 / DB 干扰窗）。
 *
 * 浏览器限制：
 *  - window.open 必须在用户手势的同步调用栈内执行，否则被弹窗拦截器拦掉；
 *  - window.moveTo / moveBy 仅对脚本（window.open）创建的窗口有效，
 *    普通标签页、移动端 Safari / Chrome 均无法移动窗口。
 *    因此本模块只面向桌面 Chromium（Chrome / Edge），Firefox 桌面大概率可用。
 */

export const POPUP_END_KEY = 'phiPopupEnd';

/** 判断是否为桌面端（主要输入设备为鼠标/触控板） */
export const isDesktop = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return (
      window.matchMedia('(pointer: fine)').matches &&
      !window.matchMedia('(pointer: coarse)').matches
    );
  } catch {
    return false;
  }
};

/** 结束信号：游玩退出 / 加载失败时写入，黑窗轮询到后自动关闭 */
export const signalPopupEnd = (): void => {
  try {
    localStorage.setItem(POPUP_END_KEY, String(Date.now()));
  } catch {
    /* 存储不可用时黑窗会靠兜底时长自关 */
  }
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/* ---------------- 浮窗（MW 律动窗 / WW 游走窗） ---------------- */

const FLOATING_FEATURES =
  'width=960,height=600,outerWidth=960,outerHeight=600,left=80,top=60,' +
  'menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=no';

/** 浮窗期望的窗口尺寸（outer，含边框），用于拉回被系统异常放大的窗口 */
const FLOAT_TARGET_W = 960;
const FLOAT_TARGET_H = 600;

/**
 * 打开承载游玩界面的小窗，返回窗口引用（被弹窗拦截时返回 null）。
 * 必须在用户手势内调用；随后由调用方导航到 /play/... 页面。
 */
export const openFloatingWindow = (): Window | null => {
  const win = window.open('', 'phi_float_play', FLOATING_FEATURES);
  if (!win) return null;
  // 先写入黑色占位，避免 about:blank 白屏闪烁（随后会被导航到 /play）
  try {
    win.document.write(
      '<!doctype html><html><head><meta charset="utf-8"></head>' +
        '<body style="margin:0;background:#0a0a0c"></body></html>',
    );
    win.document.close();
  } catch {
    /* 跨源异常时忽略 */
  }
  return win;
};

/** 把窗口坐标限制在可用屏幕内并移动过去 */
const moveToClamped = (x: number, y: number) => {
  const w = self.outerWidth || FLOAT_TARGET_W;
  const h = self.outerHeight || FLOAT_TARGET_H;
  const maxX = (self.screen.availWidth || 1280) - w - 4;
  const maxY = (self.screen.availHeight || 800) - h - 4;
  self.moveTo(clamp(x, 0, maxX), clamp(y, 0, maxY));
};

/** 探测当前浏览器是否允许脚本移动窗口（moveTo/moveBy 仅对脚本打开的窗口有效） */
const detectMovable = (): boolean => {
  try {
    const sx = self.screenX;
    const sy = self.screenY;
    self.moveTo(sx + 1, sy);
    const ok = self.screenX === sx + 1;
    self.moveTo(sx, sy);
    return ok;
  } catch {
    return false;
  }
};

/**
 * 在小窗内启动窗口漂移。kind：
 *  - 'music'：随音乐 bass 能量在起始位置附近律动（需要 getAnalyser 提供频谱）
 *  - 'wander'：随机游走 + 屏幕边界反弹
 * 返回停止函数；浏览器不允许移动 / 拿不到频谱时返回空函数并 alert 提示。
 */
export const startPopupDrift = (
  kind: 'music' | 'wander',
  getAnalyser: () => AnalyserNode | null,
): (() => void) => {
  if (!detectMovable()) {
    alert('当前浏览器不允许脚本移动窗口。请使用 Chrome / Edge 桌面版游玩弹窗类模组。');
    return () => {};
  }

  let analyser: AnalyserNode | null = null;
  if (kind === 'music') {
    try {
      analyser = getAnalyser();
    } catch {
      analyser = null;
    }
    if (!analyser) {
      alert('无法获取音乐频谱，律动窗无法工作（当前可能是不支持 Web Audio 的环境）。');
      return () => {};
    }
  }

  // 音乐律动：慢速 Lissajous 轨迹在全屏漫游，叠加 bass 能量驱动的抖动
  const centerX = (self.screen.availWidth - (self.outerWidth || FLOAT_TARGET_W)) / 2;
  const centerY = (self.screen.availHeight - (self.outerHeight || FLOAT_TARGET_H)) / 2;
  const rangeX = Math.max(0, (self.screen.availWidth - (self.outerWidth || FLOAT_TARGET_W)) / 2 - 40);
  const rangeY = Math.max(0, (self.screen.availHeight - (self.outerHeight || FLOAT_TARGET_H)) / 2 - 40);
  // 窗口中心的平滑位置（从当前位置起步，避免暂停恢复时跳变）
  let px = self.screenX;
  let py = self.screenY;
  const buf = new Uint8Array(analyser?.frequencyBinCount ?? 256);
  // 游走状态：速度分量（px/tick）
  let vx = (Math.random() * 2 - 1) * 6;
  let vy = (Math.random() * 2 - 1) * 6;
  const stepMs = kind === 'music' ? 50 : 40;

  let stopped = false;
  const tick = () => {
    if (stopped) return;
    try {
      // 尺寸守卫：某些环境下 Chrome 会把脚本打开的窗口撑大（features 的
      // width/height 解析不可靠），检测到明显大于目标尺寸时用 resizeTo 拉回。
      // 最大化窗口时 resizeTo 会被浏览器忽略，不会破坏手动全屏。
      try {
        const ow = self.outerWidth;
        const oh = self.outerHeight;
        if (ow > FLOAT_TARGET_W + 24 || oh > FLOAT_TARGET_H + 24) {
          self.resizeTo(FLOAT_TARGET_W, FLOAT_TARGET_H);
        }
      } catch {
        /* 忽略 */
      }
      if (kind === 'music' && analyser) {
        analyser.getByteFrequencyData(buf);
        let sum = 0;
        const n = Math.min(8, buf.length);
        for (let i = 0; i < n; i++) sum += buf[i];
        const bass = sum / (n * 255);
        const t = performance.now() / 1000;
        // 慢速全屏漫游：窗口中心平滑跟踪 Lissajous 轨迹（周期约 20~27 秒）
        const tx = centerX + Math.sin(t * 0.31) * rangeX;
        const ty = centerY + Math.cos(t * 0.23) * rangeY;
        px += (tx - px) * 0.05;
        py += (ty - py) * 0.05;
        // 音乐律动抖动：bass 越强振幅越大
        const amp = 30 + bass * 110;
        const dx = Math.sin(t * 2.6) * amp * (0.4 + bass);
        const dy = Math.cos(t * 2.0) * amp * (0.4 + bass);
        moveToClamped(px + dx, py + dy);
      } else {
        vx = clamp(vx + (Math.random() * 2 - 1) * 2.4, -8, 8);
        vy = clamp(vy + (Math.random() * 2 - 1) * 2.4, -8, 8);
        const w = self.outerWidth || FLOAT_TARGET_W;
        const h = self.outerHeight || FLOAT_TARGET_H;
        const maxX = (self.screen.availWidth || 1280) - w - 4;
        const maxY = (self.screen.availHeight || 800) - h - 4;
        let nx = self.screenX + vx;
        let ny = self.screenY + vy;
        if (nx < 0) {
          nx = 0;
          vx = Math.abs(vx) * (0.7 + Math.random() * 0.5);
        }
        if (ny < 0) {
          ny = 0;
          vy = Math.abs(vy) * (0.7 + Math.random() * 0.5);
        }
        if (nx > maxX) {
          nx = maxX;
          vx = -Math.abs(vx) * (0.7 + Math.random() * 0.5);
        }
        if (ny > maxY) {
          ny = maxY;
          vy = -Math.abs(vy) * (0.7 + Math.random() * 0.5);
        }
        self.moveTo(Math.round(nx), Math.round(ny));
      }
    } catch {
      /* 窗口已被关闭等：停止循环 */
      stop();
    }
  };

  const interval = window.setInterval(tick, stepMs);
  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.clearInterval(interval);
  };
  window.addEventListener('beforeunload', stop);
  return stop;
};

/* ---------------- 黑窗（DB 干扰窗） ---------------- */

const BLACK_FEATURES =
  'width=100,height=100,outerWidth=100,outerHeight=100,menubar=no,toolbar=no,location=no,status=no,resizable=no,scrollbars=no';

/** 黑窗自驱脚本：随机游走 + 边界反弹 + 结束信号变化检测 + opener 关闭检测，并有兜底时长 */
const BLACK_WINDOW_SCRIPT = `
(() => {
  var STEP = 7;
  var vx = (Math.random() * 2 - 1) * STEP;
  var vy = (Math.random() * 2 - 1) * STEP;
  var KEY = 'phiPopupEnd';
  var initial = null;
  try { initial = localStorage.getItem(KEY); } catch (e) { initial = null; }
  var tick = function () {
    try {
      var now = localStorage.getItem(KEY);
      if (now !== null && now !== initial) { self.close(); return; }
      if (self.opener && self.opener.closed) { self.close(); return; }
      // 尺寸守卫：Chrome 有时不按 features 尺寸打开弹窗，发现被撑大时拉回 100×100
      try {
        if (self.outerWidth > 112 || self.outerHeight > 112) { self.resizeTo(100, 100); }
      } catch (e) {}
      var w = self.outerWidth || 100;
      var h = self.outerHeight || 100;
      var maxX = (self.screen.availWidth || 1280) - w - 4;
      var maxY = (self.screen.availHeight || 800) - h - 4;
      var nx = self.screenX + vx;
      var ny = self.screenY + vy;
      if (nx < 0) { nx = 0; vx = Math.abs(vx) * (0.7 + Math.random() * 0.5); }
      if (ny < 0) { ny = 0; vy = Math.abs(vy) * (0.7 + Math.random() * 0.5); }
      if (nx > maxX) { nx = maxX; vx = -Math.abs(vx) * (0.7 + Math.random() * 0.5); }
      if (ny > maxY) { ny = maxY; vy = -Math.abs(vy) * (0.7 + Math.random() * 0.5); }
      self.moveTo(Math.round(nx), Math.round(ny));
    } catch (e) { self.close(); }
  };
  setInterval(tick, 40);
  setTimeout(function () { try { self.close(); } catch (e) {} }, 180000);
})();
`;

/**
 * 弹出 count 个黑色干扰小窗（各自随机游走）。返回实际打开的数量。
 * 必须在用户手势同步栈内调用以获得弹窗许可。
 */
export const openBlackWindows = (count = 3): number => {
  let opened = 0;
  for (let i = 0; i < count; i++) {
    const win = window.open(
      '',
      `phi_black_${i}_${Math.floor(Math.random() * 1e6)}`,
      BLACK_FEATURES,
    );
    if (!win) continue;
    try {
      win.document.write(
        '<!doctype html><html><head><meta charset="utf-8"></head>' +
          '<body style="margin:0;overflow:hidden;background:#000;cursor:default">' +
          '<script>' + BLACK_WINDOW_SCRIPT + '<\/script>' +
          '</body></html>',
      );
      win.document.close();
      opened++;
    } catch {
      try {
        win.close();
      } catch {
        /* 忽略 */
      }
    }
  }
  return opened;
};
