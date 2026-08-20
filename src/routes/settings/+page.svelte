<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import type { Preferences } from '$lib/types';
  import { loadPreferences, savePreferences, DEFAULT_PREFERENCES } from '$lib/preferences';
  import { confirm as confirmModal, prompt as promptModal } from '$lib/modal';

  let prefs: Preferences = { ...DEFAULT_PREFERENCES };
  let autoplay = false;
  let playerName = '';

  onMount(() => {
    prefs = loadPreferences();
    autoplay = localStorage.getItem('autoplay') === 'true';
    playerName = localStorage.getItem('playerName') ?? 'GUEST';
  });

  const update = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    prefs = { ...prefs, [key]: value };
    savePreferences(prefs);
  };

  const updateAutoplay = (v: boolean) => {
    autoplay = v;
    localStorage.setItem('autoplay', String(v));
  };

  const leaveSettings = () => {
    const firstUserFlow = sessionStorage.getItem('firstUserSetupReturn') === 'tutorial';
    if (firstUserFlow) {
      sessionStorage.removeItem('firstUserSetupReturn');
      localStorage.setItem('phiOnboardingDone', 'true');
      void goto('/play/ptc-r-intro/hd');
      return;
    }
    void goto('/songs');
  };

  const ASPECT_RATIOS: Record<string, [number, number]> = {
    '5:4': [5, 4],
    '4:3': [4, 3],
    '10:7': [10, 7],
    '19:13': [19, 13],
    '8:5': [8, 5],
    '5:3': [5, 3],
    '22:13': [22, 13],
    '16:9': [16, 9],
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

  <!-- 游戏 -->
  <section class="group">
    <h2 class="group-title">游戏</h2>
    <div class="row">
      <span class="label">谱面延时</span>
      <span class="value">{prefs.chartOffset} ms</span>
      <input
        type="range"
        class="slider"
        min="-500"
        max="500"
        step="5"
        value={prefs.chartOffset}
        oninput={(e) => update('chartOffset', Number(e.currentTarget.value))}
      />
    </div>
    <div class="row">
      <span class="label">谱面倍速</span>
      <span class="value">{Math.round(prefs.timeScale * 100)}%</span>
      <input
        type="range"
        class="slider"
        min="0.7"
        max="1.5"
        step="0.05"
        value={prefs.timeScale}
        oninput={(e) => update('timeScale', Number(e.currentTarget.value))}
      />
    </div>
    <div class="row">
      <span class="label">根据声音调整偏移</span>
      <button class="flat-btn" onclick={() => goto('/calibrate')}>校准</button>
    </div>
    <div class="row">
      <span class="label">观看教学</span>
      <button class="flat-btn" onclick={() => goto('/play/ptc-r-intro/hd')}>进入</button>
    </div>
  </section>

  <!-- 界面 -->
  <section class="group">
    <h2 class="group-title">界面</h2>
    <div class="row">
      <span class="label">按键缩放</span>
      <span class="value">{Math.round(prefs.noteSize * 100)}%</span>
      <input
        type="range"
        class="slider"
        min="0.5"
        max="1.5"
        step="0.05"
        value={prefs.noteSize}
        oninput={(e) => update('noteSize', Number(e.currentTarget.value))}
      />
    </div>
    <div class="row">
      <span class="label">背景模糊</span>
      <span class="value">{prefs.backgroundBlur.toFixed(1)}</span>
      <input
        type="range"
        class="slider"
        min="0"
        max="3"
        step="0.1"
        value={prefs.backgroundBlur}
        oninput={(e) => update('backgroundBlur', Number(e.currentTarget.value))}
      />
    </div>
    <div class="row">
      <span class="label">背景亮度</span>
      <span class="value">{Math.round(prefs.backgroundLuminance * 100)}%</span>
      <input
        type="range"
        class="slider"
        min="0"
        max="1"
        step="0.05"
        value={prefs.backgroundLuminance}
        oninput={(e) => update('backgroundLuminance', Number(e.currentTarget.value))}
      />
    </div>
    <div class="row">
      <span class="label">多押辅助</span>
      <button
        class="toggle"
        class:on={prefs.simultaneousNoteHint}
        onclick={() => update('simultaneousNoteHint', !prefs.simultaneousNoteHint)}
        aria-label="多押辅助"
      ></button>
    </div>
    <div class="row">
      <span class="label">以视频作为背景</span>
      <button
        class="toggle"
        class:on={prefs.useVideoBackground}
        onclick={() => update('useVideoBackground', !prefs.useVideoBackground)}
        aria-label="以视频作为背景"
      ></button>
    </div>
    <div class="row">
      <span class="label">视频背景透明度</span>
      <span class="value">{Math.round(prefs.videoBackgroundAlpha * 100)}%</span>
      <input
        type="range"
        class="slider"
        min="0"
        max="1"
        step="0.05"
        value={prefs.videoBackgroundAlpha}
        oninput={(e) => update('videoBackgroundAlpha', Number(e.currentTarget.value))}
      />
    </div>
    <div class="row">
      <span class="label">FC/AP 指示器</span>
      <button
        class="toggle"
        class:on={prefs.fcApIndicator}
        onclick={() => update('fcApIndicator', !prefs.fcApIndicator)}
        aria-label="FC/AP 指示器"
      ></button>
    </div>
    <div class="row">
      <span class="label">界面宽高比</span>
      <select
        class="flat-select"
        value={prefs.aspectRatio ? `${prefs.aspectRatio[0]}:${prefs.aspectRatio[1]}` : '16:9'}
        onchange={(e) => {
          const ratio = ASPECT_RATIOS[e.currentTarget.value];
          update('aspectRatio', ratio ?? null);
        }}
      >
        {#each Object.keys(ASPECT_RATIOS) as ratio}
          <option value={ratio}>{ratio}</option>
        {/each}
      </select>
    </div>
  </section>

  <!-- 音频 -->
  <section class="group">
    <h2 class="group-title">音频</h2>
    <div class="row">
      <span class="label">音乐音量</span>
      <span class="value">{Math.round(prefs.musicVolume * 100)}%</span>
      <input
        type="range"
        class="slider"
        min="0"
        max="1"
        step="0.05"
        value={prefs.musicVolume}
        oninput={(e) => update('musicVolume', Number(e.currentTarget.value))}
      />
    </div>
    <div class="row">
      <span class="label">打击音效</span>
      <span class="value">{Math.round(prefs.hitSoundVolume * 100)}%</span>
      <input
        type="range"
        class="slider"
        min="0"
        max="1"
        step="0.05"
        value={prefs.hitSoundVolume}
        oninput={(e) => update('hitSoundVolume', Number(e.currentTarget.value))}
      />
    </div>
  </section>

  <!-- 其他 -->
  <section class="group">
    <h2 class="group-title">其他</h2>
    <div class="row">
      <span class="label">AutoPlay</span>
      <button
        class="toggle"
        class:on={autoplay}
        onclick={() => updateAutoplay(!autoplay)}
        aria-label="AutoPlay"
      ></button>
    </div>
    <div class="row">
      <span class="label">玩家昵称</span>
      <button
        class="flat-btn"
        onclick={async () => {
          const name = await promptModal('输入昵称', playerName);
          if (name && name !== '') {
            localStorage.setItem('playerName', name);
            playerName = name;
          }
        }}
      >
        {playerName}
      </button>
    </div>
    <div class="row">
      <span class="label">清除全部数据</span>
      <button
        class="flat-btn danger"
        onclick={async () => {
          if (await confirmModal('确定清除全部本地数据？')) {
            localStorage.clear();
            location.href = '/';
          }
        }}
      >
        清除
      </button>
    </div>
  </section>

  <button class="flat-btn done-btn" onclick={leaveSettings}>完成</button>
</div>

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

  .group {
    width: min(640px, 100%);
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 2px;
    padding: 8px 20px;
  }

  .group-title {
    margin: 14px 0 4px;
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.15em;
    color: rgba(255, 255, 255, 0.45);
    text-transform: uppercase;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .row:last-child {
    border-bottom: none;
  }

  .label {
    font-size: 0.95rem;
    font-weight: 600;
    flex-shrink: 0;
  }

  .value {
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.55);
    min-width: 52px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .slider {
    flex: 1;
    min-width: 120px;
    accent-color: #fff;
  }

  /* 扁平黑白按钮 */
  .flat-btn {
    background: transparent;
    border: 1.5px solid #fff;
    color: #fff;
    border-radius: 2px;
    padding: 8px 22px;
    font-weight: 700;
    font-size: 0.9rem;
    cursor: pointer;
    transition: background 0.2s, color 0.2s;
    flex-shrink: 0;
  }

  .flat-btn:hover {
    background: #fff;
    color: #0b0b12;
  }

  .flat-btn.danger {
    border-color: rgba(255, 255, 255, 0.5);
    color: rgba(255, 255, 255, 0.7);
  }

  .flat-btn.danger:hover {
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

  /* 黑白 toggle */
  .toggle {
    width: 52px;
    height: 28px;
    border-radius: 2px;
    border: 1.5px solid rgba(255, 255, 255, 0.4);
    background: transparent;
    position: relative;
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
    transition: background 0.25s, border-color 0.25s;
  }

  .toggle::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 20px;
    height: 20px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.6);
    transition: transform 0.25s, background 0.25s;
  }

  .toggle.on {
    background: #fff;
    border-color: #fff;
  }

  .toggle.on::after {
    transform: translateX(24px);
    background: #0b0b12;
  }

  .flat-select {
    background: transparent;
    border: 1.5px solid #fff;
    color: #fff;
    border-radius: 2px;
    padding: 7px 14px;
    font-weight: 600;
    cursor: pointer;
    flex-shrink: 0;
  }

  .flat-select option {
    background: #12121c;
    color: #fff;
  }
</style>
