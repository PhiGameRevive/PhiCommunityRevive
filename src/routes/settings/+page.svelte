<script lang="ts">
  import { goto } from '$app/navigation';
  import SettingsPanel from '$lib/components/SettingsPanel.svelte';
  import CalibratePreview from '$lib/components/CalibratePreview.svelte';
  import FileManager from '$lib/components/FileManager.svelte';

  let showCalibrate = false;
  let showFiles = false;

  const leaveSettings = () => {
    void goto('/songs');
  };
</script>

<svelte:head>
  <title>设置 - PhiCommunity</title>
</svelte:head>

<div class="page">
  <div class="header">
    <button class="icon-btn back-btn" onclick={leaveSettings} aria-label="返回"></button>
    <h1 class="title">设置</h1>
  </div>

  <SettingsPanel
    variant="page"
    onCalibrate={() => (showCalibrate = true)}
    onTutorial={() => goto('/play/ptc-r-intro/hd')}
    onOpenFiles={() => (showFiles = true)}
  />

  <button class="flat-btn done-btn" onclick={leaveSettings}>完成</button>
</div>

{#if showCalibrate}
  <!-- 独立设置页没有侧边栏，浮窗居中显示（side 仅决定箭头方向） -->
  <CalibratePreview side="right" onclose={() => (showCalibrate = false)} />
{/if}

{#if showFiles}
  <FileManager side="right" onclose={() => (showFiles = false)} />
{/if}

<style>
  .page {
    height: 100vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    padding: 24px 16px 48px;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 16px;
    width: min(640px, 100%);
  }

  .icon-btn {
    width: 40px;
    height: 40px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.25);
    cursor: pointer;
    padding: 0;
    position: relative;
  }

  .back-btn::before {
    content: '';
    position: absolute;
    left: 14px;
    top: 14px;
    width: 12px;
    height: 12px;
    border-left: 2.5px solid #fff;
    border-bottom: 2.5px solid #fff;
    transform: rotate(45deg);
  }

  .title {
    margin: 0;
    font-size: 1.6rem;
    font-weight: 900;
    letter-spacing: 0.08em;
  }

  .flat-btn {
    background: transparent;
    border: 1.5px solid #fff;
    color: #fff;
    border-radius: 2px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.2s, color 0.2s;
    flex-shrink: 0;
  }

  .flat-btn:hover {
    background: #fff;
    color: #0b0b12;
  }

  .done-btn {
    width: min(640px, 100%);
    padding: 14px;
    font-size: 1.05rem;
    letter-spacing: 0.2em;
    border-radius: 2px;
  }
</style>
