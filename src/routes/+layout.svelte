<script lang="ts">
  import { onMount } from 'svelte';
  import { afterNavigate } from '$app/navigation';
  import { registerSW } from 'virtual:pwa-register';
  import '../app.css';
  import Modal from '$lib/Modal.svelte';
  import { UI_SCALE_EVENT, applyUiScale, loadUiScale } from '$lib/uiScale';

  let isMobile = false;
  let portrait = false;
  let isFullscreen = false;

  /**
   * 界面缩放作用在 <html> 上（等价于浏览器页面缩放），因此各页面的
   * `position: fixed; inset: 0` 全屏容器仍能正确铺满视口。
   *
   * 游玩页必须复位为 1：Phaser canvas 的判定坐标依赖真实视口尺寸，
   * 缩放会让触摸点与判定线错位。
   *
   * 用 afterNavigate 而非 `$:`：page 来自 $app/state，在本文件的
   * 传统响应式语法下不会被追踪，导航后不会重新求值。
   */
  const applyScaleForRoute = () => {
    const scale = window.location.pathname.startsWith('/play') ? 1 : loadUiScale();
    applyUiScale(scale);
  };

  const check = () => {
    isMobile =
      /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(navigator.userAgent) ||
      navigator.maxTouchPoints > 1;
    portrait = window.innerHeight > window.innerWidth;
  };

  const updateFullscreen = () => {
    isFullscreen = !!document.fullscreenElement;
  };

  const requestFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
      // 尝试锁定横屏（部分浏览器/系统支持）
      try {
        const orient = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
        await orient?.lock?.('landscape');
      } catch {
        /* 不支持则忽略 */
      }
      updateFullscreen();
    } catch (e) {
      console.warn('Fullscreen failed', e);
    }
  };

  onMount(() => {
    // 注册 PWA Service Worker（autoUpdate：新版本下载完成后自动激活）
    registerSW({ immediate: true });
    applyScaleForRoute();
    check();
    updateFullscreen();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    document.addEventListener('fullscreenchange', updateFullscreen);
    // 设置页/开场缩放页实时调整时广播该事件，无需刷新即可生效
    window.addEventListener(UI_SCALE_EVENT, applyScaleForRoute);
    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
      document.removeEventListener('fullscreenchange', updateFullscreen);
      window.removeEventListener(UI_SCALE_EVENT, applyScaleForRoute);
      applyUiScale(1);
    };
  });

  // 进入/离开游玩页时切换缩放
  afterNavigate(applyScaleForRoute);
</script>

<!-- 手机竖屏：每次启动（含开场流程）都提示横屏；旋转设备后自动消失 -->
{#if isMobile && portrait}
  <div class="rotate-overlay">
    <div class="rotate-icon"></div>
    <p class="rotate-title">请横屏游玩</p>
    <p class="rotate-hint">旋转设备至横向，获得最佳体验</p>
    <button class="fullscreen-btn" onclick={requestFullscreen}>
      {isFullscreen ? '已全屏 ✓' : '点击进入全屏'}
    </button>
  </div>
{/if}

<slot />

<Modal />

<style>
  .rotate-overlay {
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: #0a0a0c;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 24px;
    text-align: center;
  }

  .rotate-icon {
    width: 72px;
    height: 72px;
    border: 2px solid #fff;
    border-radius: 12px;
    position: relative;
    animation: rotate-phone 2s ease-in-out infinite;
  }

  .rotate-icon::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 22px;
    height: 22px;
    margin: -11px;
    border-top: 2.5px solid #fff;
    border-right: 2.5px solid #fff;
    animation: spin-arrow 2s ease-in-out infinite;
  }

  @keyframes rotate-phone {
    0%,
    20% {
      transform: rotate(0deg);
    }
    45%,
    70% {
      transform: rotate(90deg);
    }
    100% {
      transform: rotate(90deg);
    }
  }

  @keyframes spin-arrow {
    0%,
    20% {
      transform: rotate(0deg);
    }
    45%,
    100% {
      transform: rotate(90deg);
    }
  }

  .rotate-title {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 900;
    letter-spacing: 0.15em;
  }

  .rotate-hint {
    margin: 0;
    color: rgba(255, 255, 255, 0.55);
    font-size: 0.9rem;
    letter-spacing: 0.05em;
  }

  .fullscreen-btn {
    margin-top: 12px;
    background: transparent;
    border: 1.5px solid #fff;
    color: #fff;
    border-radius: 2px;
    padding: 14px 44px;
    font-size: 1rem;
    font-weight: 800;
    letter-spacing: 0.15em;
    cursor: pointer;
  }

  .fullscreen-btn:hover {
    background: #fff;
    color: #0a0a0c;
  }
</style>