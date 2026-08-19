<script lang="ts">
  /**
   * 全屏 Phigros 风格加载界面：全屏曲绘铺底 + 底部毛玻璃（左 Tip / 右 LOADING 进度条）。
   * 开场动画 → 选歌页、结算/设置/中途退出回到选歌页时共用。
   *
   * - cover/tip 由外部传入（数据未就绪时传默认图）
   * - progress 0~1 由外部驱动（真实下载进度或计时推进），组件内 rAF 逐帧绘制
   */
  import { onDestroy, onMount } from 'svelte';

  export let cover: string;
  export let tip: string;
  export let progress = 0;

  // 以逻辑像素绘制，backing store 放大 DPR 倍保证文字锐利
  const W = 340;
  const H = 160;
  const DPR = 2;

  let canvas: HTMLCanvasElement | undefined;
  let animId = 0;
  let animStart = 0;

  const draw = (now: number) => {
    const c = canvas;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) {
      // canvas 尚未挂载 → 下一帧重试
      animId = requestAnimationFrame(draw);
      return;
    }
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const t = (now - animStart) / 15;
    ctx.clearRect(0, 0, W, H);
    ctx.font = '34px "Courier New", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    const msg = 'LOADING';
    const dxs = ctx.measureText(msg).width;
    ctx.globalCompositeOperation = 'xor';
    const hw = 26 + dxs / 2;
    ctx.fillRect(
      Math.sin(t / 20) < 0 ? Math.cos(t / 20) * hw + W / 2 : W / 2 - hw,
      H / 2 - 33,
      -Math.cos(t / 20) * hw + hw,
      66,
    );
    ctx.fillText(msg, W / 2, H / 2);
    ctx.globalCompositeOperation = 'source-over';
    // 进度条（位于 LOADING 字样下方）
    const barW = hw * 2;
    const barX = W / 2 - hw;
    const barY = H / 2 + 45;
    const barH = 5;
    const p = Math.min(Math.max(progress, 0), 1);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(barX, barY, barW * p, barH);
    animId = requestAnimationFrame(draw);
  };

  onMount(() => {
    animStart = performance.now();
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(draw);
  });

  onDestroy(() => cancelAnimationFrame(animId));
</script>

<div class="pl-screen">
  <img class="pl-cover" src={cover} alt="" />
  <div class="pl-veil"></div>
  <div class="pl-glass">
    <p class="pl-tip">TIP {tip}</p>
    <canvas class="pl-canvas" bind:this={canvas} width={W * DPR} height={H * DPR}></canvas>
  </div>
</div>

<style>
  .pl-screen {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: #000;
    overflow: hidden;
    animation: pl-screen-in 0.4s ease;
  }

  /* 全屏曲绘铺底 */
  .pl-cover {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    animation: pl-cover-in 0.5s ease;
    pointer-events: none;
  }

  /* 曲绘上方柔暗渐变：让底部毛玻璃区域的文字更清晰 */
  .pl-veil {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      to top,
      rgba(0, 0, 0, 0.62) 0%,
      rgba(0, 0, 0, 0.14) 38%,
      rgba(0, 0, 0, 0.3) 100%
    );
    pointer-events: none;
  }

  /* 底部毛玻璃：左 Tip，右 LOADING */
  .pl-glass {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding: 14px 26px;
    background: rgba(10, 10, 14, 0.36);
    backdrop-filter: blur(18px) saturate(1.5);
    -webkit-backdrop-filter: blur(18px) saturate(1.5);
    border-top: 1px solid rgba(255, 255, 255, 0.14);
  }

  .pl-tip {
    margin: 0;
    max-width: min(420px, 44vw);
    color: rgba(255, 255, 255, 0.82);
    font-family: 'Courier New', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 0.8rem;
    letter-spacing: 0.06em;
    line-height: 1.7;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
    animation: pl-tip-in 0.6s ease;
    pointer-events: none;
  }

  /* 画布按逻辑像素绘制，CSS 尺寸缩小即可整体缩放 */
  .pl-canvas {
    flex-shrink: 0;
    width: 280px;
    height: 132px;
    animation: pl-in 0.3s ease;
  }

  /* 窄屏按比例缩小，避免遮挡 */
  @media (max-width: 860px) {
    .pl-glass {
      gap: 14px;
      padding: 10px 12px;
    }

    .pl-canvas {
      width: 210px;
      height: 99px;
    }

    .pl-tip {
      max-width: 40vw;
      font-size: 0.68rem;
    }
  }

  @keyframes pl-screen-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes pl-cover-in {
    from {
      opacity: 0;
      transform: scale(1.03);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  @keyframes pl-tip-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes pl-in {
    from {
      opacity: 0;
      transform: scale(0.6);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }
</style>