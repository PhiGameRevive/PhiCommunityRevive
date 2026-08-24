<script lang="ts">
  /**
   * Phigros 风格 LOADING 画布：横向扫动的 XOR 文字 + 真实进度条 + 可选详情行。
   * 由 PhigrosLoading（全屏加载界面）与开场预载阶段共用。
   *
   * 以逻辑像素绘制，backing store 放大 DPR 倍保证文字锐利。
   */
  import { onDestroy, onMount } from 'svelte';

  /** 0~1 进度 */
  export let progress = 0;
  /** 进度条下方的一行说明（如"下载游玩素材 12/46"），留空则不绘制 */
  export let detail = '';

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
    if (detail) {
      ctx.font = '16px "Courier New", ui-monospace, monospace';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
      ctx.fillText(detail, W / 2, barY + 22);
    }
    animId = requestAnimationFrame(draw);
  };

  onMount(() => {
    animStart = performance.now();
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(draw);
  });

  onDestroy(() => cancelAnimationFrame(animId));
</script>

<canvas class="loading-canvas" bind:this={canvas} width={W * DPR} height={H * DPR}></canvas>

<style>
  .loading-canvas {
    flex-shrink: 0;
    width: 280px;
    height: 132px;
    animation: lc-in 0.3s ease;
  }

  @media (max-width: 860px) {
    .loading-canvas {
      width: 210px;
      height: 99px;
    }
  }

  @keyframes lc-in {
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
