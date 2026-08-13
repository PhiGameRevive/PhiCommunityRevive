<script lang="ts">
  import { goto } from '$app/navigation';

  let version = 'v2.0.0';
  let fading = false;

  const start = () => {
    if (fading) return;
    fading = true;
    // 渐黑动画完成后跳转选歌页
    setTimeout(() => goto('/songs'), 520);
  };
</script>

<svelte:head>
  <title>PhiCommunity</title>
</svelte:head>

<!-- svelte-ignore a11y_no_noninteractive_tabindex a11y_no_noninteractive_element_interactions -->
<div class="boot" role="application" tabindex="0" onclick={start} onkeydown={(e) => (e.key === ' ' || e.key === 'Enter') && start()}>
  <div class="bg" class:dim={fading}></div>
  <div class="scanlines" class:dim={fading}></div>

  <div class="center">
    <div class="tap-to-start" class:fade-out={fading}>
      <span class="dot">▮</span>
      TAP TO START
      <span class="dot">▮</span>
    </div>
  </div>

  <div class="info" class:fade-out={fading}>
    <span class="ver">PhiCommunity Revive {version}</span>
    <span class="disclaimer">
      本项目与厦门鸽游网络有限公司（Xiamen Pigeon Games Network Co., Ltd.）没有任何关系
    </span>
  </div>

  <!-- 渐黑遮罩 -->
  <div class="fade-overlay" class:on={fading}></div>
</div>

<style>
  .boot {
    position: fixed;
    inset: 0;
    overflow: hidden;
    background: #0a0a0c;
    user-select: none;
    cursor: pointer;
    outline: none;
  }

  .bg {
    position: absolute;
    inset: -20px;
    background: url('/ui/ElementSqare.webp') center center no-repeat fixed;
    background-size: cover;
    filter: blur(12px) brightness(0.28) contrast(0.9) grayscale(0.25);
    transform: scale(1.1);
  }

  /* 极客风扫描线 */
  .scanlines {
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(
      0deg,
      rgba(255, 255, 255, 0.028) 0px,
      rgba(255, 255, 255, 0.028) 1px,
      transparent 1px,
      transparent 3px
    );
    pointer-events: none;
    transition: opacity 0.5s ease;
  }

  .bg.dim {
    filter: blur(12px) brightness(0.12) contrast(0.9) grayscale(0.25);
    transition: filter 0.5s ease;
  }

  .scanlines.dim {
    opacity: 0;
  }

  /* 渐黑遮罩 */
  .fade-overlay {
    position: absolute;
    inset: 0;
    background: #000;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.5s ease;
    z-index: 20;
  }

  .fade-overlay.on {
    opacity: 1;
    pointer-events: auto;
  }

  .fade-out {
    opacity: 0;
    transition: opacity 0.4s ease;
  }

  .center {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .tap-to-start {
    color: #e8e8e8;
    font-family: 'Courier New', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-size: clamp(1.3rem, 3.6vw, 2.2rem);
    font-weight: 700;
    letter-spacing: 0.45em;
    text-indent: 0.45em;
    text-shadow: 0 0 24px rgba(255, 255, 255, 0.25);
    animation: flash 2.4s ease-in-out infinite;
    display: flex;
    align-items: center;
    gap: 0.5em;
  }

  .dot {
    font-size: 0.7em;
    animation: blink 1.2s steps(1) infinite;
  }

  .dot:last-child {
    animation-delay: 0.6s;
  }

  @keyframes flash {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.35;
    }
  }

  @keyframes blink {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0;
    }
  }

  .info {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 22px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: rgba(255, 255, 255, 0.4);
    font-family: 'Courier New', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 0.72rem;
    letter-spacing: 0.12em;
    text-align: center;
    padding: 0 16px;
  }

  .ver {
    color: rgba(255, 255, 255, 0.6);
  }
</style>