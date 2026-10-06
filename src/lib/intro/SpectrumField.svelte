<script lang="ts">
  /**
   * 白色音频频谱（开场动画衬托层）。
   *
   * 直接消费父组件的 AnalyserNode：每帧取频域数据，对数分桶后画成底部居中的
   * 圆角柱状频谱。为了"带感"，在读数上做了三层增益：
   *  1. 抬底噪（减去 floor 再归一），让安静段也有可见的律动
   *  2. gamma 压缩（pow < 1）放大中低频细节，高潮鼓点直接顶到顶
   *  3. 快速攻击 / 缓速释放的包络，跳变不拖尾、回落有余韵
   *
   * 性能：只用 fillRect + roundRect，不上 shadowBlur / 滤镜；柱数按视口自适应。
   * 尊重 prefers-reduced-motion（降级为单帧静态波形）；无 analyser 时画呼吸静态波形。
   */
  import { onDestroy, onMount } from 'svelte';

  /** 父组件的频谱分析节点（随开场音频起播而创建） */
  export let analyser: AnalyserNode | null = null;
  /** 整体强度 0~1（高潮时拉到 1） */
  export let intensity = 0.35;
  /** 柱子数量，0 = 按视口自适应 */
  export let barCount = 0;
  /** 频谱区域高度（vh） */
  export let heightVh = 24;

  let canvas: HTMLCanvasElement | undefined;
  let ctx: CanvasRenderingContext2D | null = null;
  let animId = 0;
  let dpr = 1;
  let cssW = 0;
  let cssH = 0;
  let disabled = false;

  // 显式指定 ArrayBuffer 泛型：getByteFrequencyData 不接受 SharedArrayBuffer 视图
  let bins: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(0));
  /** 每根柱子的平滑高度（0~1） */
  let env: number[] = [];
  let bars = 0;
  /** intensity 的平滑值，避免切换瞬间跳变 */
  let shownIntensity = 0;

  /** 读数增益参数：抬高底噪 + gamma 压缩 + 总增益（整体压低，避免长时间顶满） */
  const FLOOR = 0.22;
  const GAMMA = 0.9;
  const GAIN = 1.12;

  // 铺满全屏后柱子变宽，相应加密根数，让它保持"频谱"而不是"色块"
  const resolveBars = () => barCount || (cssW < 520 ? 48 : cssW < 900 ? 72 : 104);

  const resize = () => {
    if (!canvas) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssW = window.innerWidth;
    cssH = Math.round((heightVh / 100) * window.innerHeight);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    ctx = canvas.getContext('2d');
    bars = resolveBars();
    env = new Array(bars).fill(0);
    bins = new Uint8Array(new ArrayBuffer(analyser?.frequencyBinCount ?? 0));
  };

  /** 对数分桶（低频窄、高频宽）后做增益整形，返回 0~1 */
  const sample = (i: number): number => {
    if (!analyser || bins.length === 0) return 0;
    const n = bins.length;
    const from = Math.floor(Math.pow(i / bars, 1.6) * n);
    const to = Math.max(from + 1, Math.floor(Math.pow((i + 1) / bars, 1.6) * n));
    let sum = 0;
    let count = 0;
    for (let k = from; k < to && k < n; k++) {
      sum += bins[k];
      count++;
    }
    if (!count) return 0;
    const raw = sum / count / 255;
    const lifted = Math.max(0, raw - FLOOR) / (1 - FLOOR);
    return Math.min(1, Math.pow(lifted, GAMMA) * GAIN);
  };

  /** 圆角矩形；roundRect 不存在时用 arcTo 手搓等价形状 */
  const roundRect = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
    const rad = Math.min(r, w / 2, h / 2);
    if (rad <= 0.5) {
      c.rect(x, y, w, h);
      return;
    }
    if (typeof c.roundRect === 'function') {
      c.beginPath();
      c.roundRect(x, y, w, h, rad);
      c.fill();
      return;
    }
    c.beginPath();
    c.moveTo(x + rad, y);
    c.arcTo(x + w, y, x + w, y + h, rad);
    c.arcTo(x + w, y + h, x, y + h, rad);
    c.arcTo(x, y + h, x, y, rad);
    c.arcTo(x, y, x + w, y, rad);
    c.closePath();
    c.fill();
  };

  const draw = () => {
    animId = requestAnimationFrame(draw);
    const c = ctx;
    if (!c) return;

    shownIntensity += (intensity - shownIntensity) * 0.06;

    if (analyser && bins.length) analyser.getByteFrequencyData(bins);

    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, cssW, cssH);

    // 铺满整个屏幕宽度：左右各贴边，不留内边距
    const gap = 3;
    const slot = cssW / bars;
    const barW = Math.max(3, slot - gap);
    const x0 = 0;
    const baseY = cssH; // 从底部向上生长
    const maxH = cssH * 0.6; // 留出上边距，别顶着画面顶边
    const idle = performance.now() / 1000;
    const gain = 0.85 + 0.5 * shownIntensity;

    for (let i = 0; i < bars; i++) {
      let target = sample(i);
      if (!analyser || bins.length === 0) {
        // 无音频时的静态呼吸波形，保证画面不空
        const w = Math.sin(idle * 1.6 + i * 0.4) * 0.5 + 0.5;
        const shape = Math.sin((i / (bars - 1)) * Math.PI);
        target = (0.1 + 0.22 * w) * shape;
      }
      // 快攻击、缓释放：鼓点立刻顶上去，回落拖出余韵
      const prev = env[i] ?? 0;
      env[i] = target > prev ? prev + (target - prev) * 0.62 : prev * 0.87 + target * 0.13;

      const h = Math.max(barW, env[i] * maxH * gain);
      const x = x0 + i * (barW + gap);
      const y = baseY - h;
      // 外层低透明加宽 = 辉光；内层亮芯（比 shadowBlur 便宜得多），整体压成半透明衬托
      c.fillStyle = `rgba(255, 255, 255, ${0.05 + 0.07 * shownIntensity})`;
      roundRect(c, x - 1.5, y - 2, barW + 3, h + 2, barW / 2 + 1.5);
      c.fillStyle = `rgba(255, 255, 255, ${0.2 + 0.22 * shownIntensity})`;
      roundRect(c, x, y, barW, h, barW / 2);
    }

    // 底部地面光带：把柱子"焊"在画面下沿，避免悬空感
    const floor = c.createLinearGradient(0, cssH - 2, 0, cssH);
    floor.addColorStop(0, 'rgba(255,255,255,0)');
    floor.addColorStop(1, `rgba(255,255,255,${0.06 + 0.09 * shownIntensity})`);
    c.fillStyle = floor;
    c.fillRect(0, cssH - 2, cssW, 2);
  };

  onMount(() => {
    disabled = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    resize();
    window.addEventListener('resize', resize);
    if (disabled) {
      draw();
      cancelAnimationFrame(animId);
      return () => window.removeEventListener('resize', resize);
    }
    animId = requestAnimationFrame(draw);
    return () => window.removeEventListener('resize', resize);
  });

  // analyser 是父组件在音频起播后才创建的：晚到时补一次 resize 以匹配分桶数
  $: if (canvas && analyser && bins.length !== analyser.frequencyBinCount) {
    resize();
  }

  onDestroy(() => cancelAnimationFrame(animId));
</script>

{#if !disabled}
  <canvas class="spectrum" bind:this={canvas} aria-hidden="true"></canvas>
{/if}

<style>
  .spectrum {
    position: absolute;
    left: 0;
    bottom: 0;
    z-index: 12;
    pointer-events: none;
    opacity: 0.9;
    animation: spectrum-in 1.2s ease both;
  }

  @keyframes spectrum-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 0.9;
    }
  }
</style>
