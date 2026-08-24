<script lang="ts">
  /**
   * 花瓣飘落场：从右上角飘向左下角的花瓣，单个全屏 canvas 绘制，零素材依赖。
   *
   * 性能自适应（低端手机也能跑满帧）：
   *  - 数量按屏幕面积与是否触屏设备分档
   *  - 逐帧监测帧率，持续掉帧时自动减半数量（最少保留 4 片）
   *  - 尊重 prefers-reduced-motion：直接不渲染
   *  - 每片花瓣只做 translate/rotate/scale，无阴影无模糊，全部走 GPU 友好路径
   */
  import { onDestroy, onMount } from 'svelte';

  /** 桌面端基准数量，实际数量按设备能力下调 */
  export let count = 26;
  /** 花瓣颜色（默认接近樱花的暖白粉，在深色背景上不刺眼） */
  export let color = 'rgba(255, 228, 236, 0.85)';

  interface Petal {
    x: number;
    y: number;
    /** 花瓣半长（像素） */
    size: number;
    /** 下落速度（像素/秒），横向速度按固定比例派生，保证整体朝左下 */
    speed: number;
    /** 自转角与角速度 */
    angle: number;
    spin: number;
    /** 横向摆动相位与幅度 */
    swayPhase: number;
    swayRange: number;
    /** 翻面模拟：横向缩放随时间做正弦变化 */
    flipPhase: number;
    flipSpeed: number;
    alpha: number;
  }

  let canvas: HTMLCanvasElement | undefined;
  let ctx: CanvasRenderingContext2D | null = null;
  let petals: Petal[] = [];
  let animId = 0;
  let lastTime = 0;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let disabled = false;

  // 帧率监测：连续 slowFrames 帧超过 22ms（<45fps）就降档
  let slowFrames = 0;
  let downgrades = 0;
  const MAX_DOWNGRADES = 2;

  /** 按设备能力决定花瓣数量 */
  const resolveCount = (): number => {
    const touch = navigator.maxTouchPoints > 1;
    const narrow = window.innerWidth < 860;
    // 移动端/窄屏减到基准的 45%，其余按屏幕面积轻微收缩
    const base = touch || narrow ? Math.round(count * 0.45) : count;
    const cores = navigator.hardwareConcurrency ?? 4;
    return Math.max(4, cores <= 4 ? Math.round(base * 0.7) : base);
  };

  const makePetal = (initial: boolean): Petal => {
    const size = 6 + Math.random() * 9;
    return {
      // 初始化时铺满全屏，之后新生成的从右上角外侧进入
      x: initial ? Math.random() * width * 1.3 - width * 0.15 : width * (0.55 + Math.random() * 0.6),
      y: initial ? Math.random() * height : -size * 3 - Math.random() * height * 0.25,
      size,
      // 小花瓣飘得慢，制造景深
      speed: 26 + size * 3.4 + Math.random() * 22,
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 1.6,
      swayPhase: Math.random() * Math.PI * 2,
      swayRange: 14 + Math.random() * 26,
      flipPhase: Math.random() * Math.PI * 2,
      flipSpeed: 0.6 + Math.random() * 1.1,
      alpha: 0.45 + Math.random() * 0.5,
    };
  };

  const resize = () => {
    if (!canvas) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx = canvas.getContext('2d');
  };

  /** 单片花瓣：两段对称二次贝塞尔构成的水滴形 */
  const drawPetal = (c: CanvasRenderingContext2D, p: Petal, time: number) => {
    const flip = Math.cos(p.flipPhase + time * p.flipSpeed);
    const s = p.size;
    c.save();
    c.translate(p.x, p.y);
    c.rotate(p.angle);
    // 横向压缩模拟花瓣翻面（保留 0.25 下限，避免完全消失导致闪烁）
    c.scale(Math.max(Math.abs(flip), 0.25), 1);
    c.globalAlpha = p.alpha;
    c.beginPath();
    c.moveTo(0, -s);
    c.quadraticCurveTo(s * 0.82, -s * 0.18, 0, s);
    c.quadraticCurveTo(-s * 0.82, -s * 0.18, 0, -s);
    c.fill();
    c.restore();
  };

  const frame = (now: number) => {
    animId = requestAnimationFrame(frame);
    if (!ctx) return;
    const dtMs = lastTime ? now - lastTime : 16;
    lastTime = now;
    // 标签页切回来时 dt 可能非常大，钳制避免花瓣瞬移
    const dt = Math.min(dtMs, 50) / 1000;
    const time = now / 1000;

    // 掉帧降档：连续 60 帧低于 45fps 就把数量减半
    if (dtMs > 22) slowFrames++;
    else slowFrames = Math.max(0, slowFrames - 1);
    if (slowFrames > 60 && downgrades < MAX_DOWNGRADES) {
      downgrades++;
      slowFrames = 0;
      petals = petals.slice(0, Math.max(4, Math.floor(petals.length / 2)));
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = color;

    for (const p of petals) {
      p.y += p.speed * dt;
      // 主漂移朝左（0.62 倍下落速度）叠加正弦横摆
      p.x -= p.speed * 0.62 * dt;
      p.x += Math.sin(p.swayPhase + time * 0.9) * p.swayRange * dt;
      p.angle += p.spin * dt;
      // 飘出左侧或底部后从右上角重新进场
      if (p.y - p.size > height || p.x + p.size * 2 < 0) {
        Object.assign(p, makePetal(false));
      }
      drawPetal(ctx, p, time);
    }
  };

  onMount(() => {
    // 用户要求减少动态效果时不渲染任何花瓣
    disabled = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (disabled) return;
    resize();
    petals = Array.from({ length: resolveCount() }, () => makePetal(true));
    lastTime = 0;
    animId = requestAnimationFrame(frame);
    window.addEventListener('resize', resize);
  });

  onDestroy(() => {
    cancelAnimationFrame(animId);
    if (typeof window !== 'undefined') window.removeEventListener('resize', resize);
  });
</script>

{#if !disabled}
  <canvas class="petal-field" bind:this={canvas} aria-hidden="true"></canvas>
{/if}

<style>
  .petal-field {
    position: absolute;
    inset: 0;
    z-index: 15;
    pointer-events: none;
    animation: petal-fade-in 1.4s ease;
  }

  @keyframes petal-fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>
