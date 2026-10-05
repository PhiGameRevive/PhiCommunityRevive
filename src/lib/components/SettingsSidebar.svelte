<script lang="ts">
  /**
   * 内联设置侧边栏：从屏幕左/右侧滑出，遮罩点击 / 退出按钮关闭。
   *
   * - 位置（左/右）持久化到 localStorage（`phiSettingsSide`）
   * - 内容复用 `SettingsPanel.svelte`
   * - 需要跳转的项（校准 / 观看教学）先关闭侧边栏再执行，避免侧边栏残留在新页面上
   *
   * 关闭时（遮罩 / 退出 / 完成）都会触发 `onClose`，由父组件决定是否弹新手教程提示。
   */
  import { createEventDispatcher, onMount } from 'svelte';
  import { fade, slide } from 'svelte/transition';
  import { goto } from '$app/navigation';
  import SettingsPanel from '$lib/components/SettingsPanel.svelte';
  import CalibratePreview from '$lib/components/CalibratePreview.svelte';
  import FileManager from '$lib/components/FileManager.svelte';

  export let open = false;

  const SIDE_KEY = 'phiSettingsSide';
  type Side = 'left' | 'right';

  /** 校准浮窗开关（浮窗锚定在侧边栏旁） */
  let showCalibrate = false;
  /** 文件管理浮窗开关 */
  let showFiles = false;

  const loadSide = (): Side => {
    try {
      return localStorage.getItem(SIDE_KEY) === 'left' ? 'left' : 'right';
    } catch {
      return 'right';
    }
  };

  let side: Side = 'right';

  const dispatch = createEventDispatcher<{ close: { navigate: boolean } }>();

  const setSide = (next: Side) => {
    side = next;
    try {
      localStorage.setItem(SIDE_KEY, next);
    } catch {
      /* 忽略 */
    }
  };

  const toggleSide = () => setSide(side === 'right' ? 'left' : 'right');

  onMount(() => {
    side = loadSide();
  });

  /** navigate=true 表示关闭后立即跳转（观看教学）：父组件应跳过新手教程询问 */
  const close = (navigate = false) => {
    showCalibrate = false;
    showFiles = false;
    dispatch('close', { navigate });
  };

  const handleKeydown = (e: KeyboardEvent) => {
    if (!open) return;
    // 浮窗自己处理 Esc（关闭浮窗而非整个侧边栏）
    if (e.key === 'Escape' && !showCalibrate && !showFiles) close();
  };
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!-- 遮罩：点击空白处关闭 -->
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="settings-scrim" transition:fade={{ duration: 180 }} onclick={() => close()}></div>

  <div
    class="settings-sidebar {side}"
    transition:slide={{ duration: 260, axis: 'x' }}
    role="dialog"
    aria-modal="true"
    aria-label="设置"
  >
    <header class="sidebar-head">
      <h1 class="sidebar-title">设置</h1>
      <div class="sidebar-actions">
        <button
          class="side-btn"
          onclick={toggleSide}
          aria-label={side === 'right' ? '移到左侧' : '移到右侧'}
          title={side === 'right' ? '移到左侧' : '移到右侧'}
        >
          {side === 'right' ? '⇤' : '⇥'}
        </button>
        <button class="side-btn close-btn" onclick={() => close()} aria-label="关闭设置"></button>
      </div>
    </header>

    <div class="sidebar-body">
      <SettingsPanel
        variant="sidebar"
        onCalibrate={() => (showCalibrate = true)}
        onTutorial={() => {
          close(true);
          void goto('/play/ptc-r-intro/hd');
        }}
        onOpenFiles={() => (showFiles = true)}
      />
    </div>

    <footer class="sidebar-foot">
      <button class="done-btn" onclick={() => close()}>完成</button>
    </footer>
  </div>

  <!-- 校准浮窗：从侧边栏旁弹出，小三角指向侧边栏 -->
  {#if showCalibrate}
    <CalibratePreview side={side} onclose={() => (showCalibrate = false)} />
  {/if}

  <!-- 文件管理浮窗：与校准一致的定位与箭头 -->
  {#if showFiles}
    <FileManager side={side} onclose={() => (showFiles = false)} />
  {/if}
{/if}

<style>
  .settings-scrim {
    position: fixed;
    inset: 0;
    z-index: 400;
    background: rgba(0, 0, 0, 0.5);
  }

  .settings-sidebar {
    position: fixed;
    top: 0;
    bottom: 0;
    z-index: 401;
    width: min(560px, 96vw);
    display: flex;
    flex-direction: column;
    background: rgba(11, 11, 18, 0.96);
    border: 1px solid rgba(255, 255, 255, 0.14);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    box-shadow: 0 0 48px rgba(0, 0, 0, 0.6);
  }

  .settings-sidebar.right {
    right: 0;
    border-right: none;
  }

  .settings-sidebar.left {
    left: 0;
    border-left: none;
  }

  .sidebar-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 16px 18px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
    flex-shrink: 0;
  }

  .sidebar-title {
    margin: 0;
    font-size: 1.3rem;
    font-weight: 900;
    letter-spacing: 0.1em;
  }

  .sidebar-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .side-btn {
    width: 38px;
    height: 38px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.25);
    color: #fff;
    font-size: 1.1rem;
    font-weight: 700;
    cursor: pointer;
    padding: 0;
    position: relative;
    transition: background 0.2s;
  }

  .side-btn:hover {
    background: rgba(255, 255, 255, 0.18);
  }

  .close-btn::before,
  .close-btn::after {
    content: '';
    position: absolute;
    left: 18px;
    top: 10px;
    width: 2px;
    height: 17px;
    background: #fff;
  }

  .close-btn::before {
    transform: rotate(45deg);
  }

  .close-btn::after {
    transform: rotate(-45deg);
  }

  .sidebar-body {
    flex: 1;
    overflow-y: auto;
    padding: 16px 18px 24px;
  }

  .sidebar-foot {
    flex-shrink: 0;
    padding: 12px 18px 18px;
    border-top: 1px solid rgba(255, 255, 255, 0.12);
  }

  .done-btn {
    width: 100%;
    background: transparent;
    border: 1.5px solid #fff;
    color: #fff;
    border-radius: 2px;
    padding: 13px;
    font-size: 1rem;
    font-weight: 800;
    letter-spacing: 0.2em;
    cursor: pointer;
    transition: background 0.2s, color 0.2s;
  }

  .done-btn:hover {
    background: #fff;
    color: #0b0b12;
  }
</style>
