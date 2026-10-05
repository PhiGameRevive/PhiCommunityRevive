<script lang="ts">
  /**
   * 设置面板内容（游戏 / 界面 / 音频 / 其他）。
   *
   * 同一份内容同时用于：
   * - `/settings` 独立页面（`variant="page"`）
   * - 选歌页内联侧边栏（`SettingsSidebar.svelte`，`variant="sidebar"`）
   *
   * 状态直接读写 localStorage，改动即时生效（界面缩放会广播给 +layout）。
   * 需要跳转的项（校准 / 观看教学 / 清除数据）由父组件通过回调接管，
   * 因为侧边栏内跳转通常需要先关闭侧边栏。
   */
  import { onMount } from 'svelte';
  import type { Preferences } from '$lib/types';
  import { loadPreferences, savePreferences, DEFAULT_PREFERENCES } from '$lib/preferences';
  import { confirm as confirmModal, prompt as promptModal } from '$lib/modal';
  import {
    DEFAULT_UI_SCALE,
    MAX_UI_SCALE,
    MIN_UI_SCALE,
    UI_SCALE_STEP,
    commitUiScale,
    loadUiScale,
  } from '$lib/uiScale';
  import { loadIntroStyle, saveIntroStyle, type IntroStyle } from '$lib/introStyle';

  export let variant: 'page' | 'sidebar' = 'page';
  /** 点击「校准」：由父组件打开校准浮窗 */
  export let onCalibrate: (() => void) | undefined = undefined;
  /** 点击「观看教学」 */
  export let onTutorial: (() => void) | undefined = undefined;
  /** 点击「文件管理」：由父组件跳转 / 打开文件管理页 */
  export let onOpenFiles: (() => void) | undefined = undefined;
  /** 清除全部数据（默认实现：清 localStorage 并回到主页） */
  export let onClearData: (() => void) | undefined = undefined;

  let prefs: Preferences = { ...DEFAULT_PREFERENCES };
  let playerName = '';
  let uiScale = DEFAULT_UI_SCALE;
  let introStyle: IntroStyle = 'new';
  let persistentSeekBar = false;

  onMount(() => {
    prefs = loadPreferences();
    playerName = localStorage.getItem('playerName') ?? 'GUEST';
    uiScale = loadUiScale();
    introStyle = loadIntroStyle();
    persistentSeekBar = localStorage.getItem('persistentSeekBar') === 'true';
    // AutoPlay 已迁移为选歌页的 AT 模组；清理旧开关，避免残留值造成困惑
    localStorage.removeItem('autoplay');
  });

  const update = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    prefs = { ...prefs, [key]: value };
    savePreferences(prefs);
  };

  /** 界面缩放：写入 localStorage 并立即把 zoom 应用到 <html>，所见即所得 */
  const updateUiScale = (value: number) => {
    uiScale = commitUiScale(value);
  };

  const updateIntroStyle = (style: IntroStyle) => {
    introStyle = style;
    saveIntroStyle(style);
  };

  const updatePersistentSeekBar = (value: boolean) => {
    persistentSeekBar = value;
    localStorage.setItem('persistentSeekBar', String(value));
  };

  const handleCalibrate = () => onCalibrate?.();
  const handleTutorial = () => onTutorial?.();
  const handleOpenFiles = () => onOpenFiles?.();
  const handleClearData = async () => {
    if (onClearData) {
      onClearData();
      return;
    }
    if (await confirmModal('确定清除全部本地数据？')) {
      localStorage.clear();
      location.href = '/';
    }
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

  /**
   * 把当前值换算成已填充百分比，写入 `--fill` 供自定义轨道渐变使用。
   * WebKit 无法用 `::-moz-range-progress` 那类伪元素（移动端一律 WebKit），
   * 只能用 `linear-gradient` + 变量模拟填充段。
   */
  const fillStyle = (value: number, min: number, max: number): string => {
    const ratio = max === min ? 0 : (value - min) / (max - min);
    return `--fill: ${Math.min(Math.max(ratio, 0), 1) * 100}%`;
  };
</script>

<div class="settings-panel" class:sidebar={variant === 'sidebar'}>
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
        style={fillStyle(prefs.chartOffset, -500, 500)}
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
        style={fillStyle(prefs.timeScale, 0.7, 1.5)}
        oninput={(e) => update('timeScale', Number(e.currentTarget.value))}
      />
    </div>
    <div class="row">
      <span class="label">根据声音调整偏移</span>
      <button class="flat-btn" onclick={handleCalibrate}>校准</button>
    </div>
    <div class="row">
      <span class="label">观看教学</span>
      <button class="flat-btn" onclick={handleTutorial}>进入</button>
    </div>
    <div class="row">
      <span class="label">提前结算</span>
      <button
        class="toggle"
        class:on={prefs.earlyFinish}
        onclick={() => update('earlyFinish', !prefs.earlyFinish)}
        aria-label="提前结算"
      ></button>
    </div>
  </section>

  <!-- 界面 -->
  <section class="group">
    <h2 class="group-title">界面</h2>
    <div class="row">
      <span class="label">界面大小</span>
      <span class="value">{Math.round(uiScale * 100)}%</span>
      <input
        type="range"
        class="slider"
        min={MIN_UI_SCALE}
        max={MAX_UI_SCALE}
        step={UI_SCALE_STEP}
        value={uiScale}
        style={fillStyle(uiScale, MIN_UI_SCALE, MAX_UI_SCALE)}
        oninput={(e) => updateUiScale(Number(e.currentTarget.value))}
      />
    </div>
    <div class="row">
      <span class="label">开场动画</span>
      <select
        class="flat-select"
        value={introStyle}
        onchange={(e) => updateIntroStyle(e.currentTarget.value as IntroStyle)}
      >
        <option value="new">新版</option>
        <option value="legacy">旧版</option>
      </select>
    </div>
    <div class="row">
      <span class="label">AT / 回放常驻进度条</span>
      <button
        class="toggle"
        class:on={persistentSeekBar}
        onclick={() => updatePersistentSeekBar(!persistentSeekBar)}
        aria-label="AT / 回放常驻进度条"
      ></button>
    </div>
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
        style={fillStyle(prefs.noteSize, 0.5, 1.5)}
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
        style={fillStyle(prefs.backgroundBlur, 0, 3)}
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
        style={fillStyle(prefs.backgroundLuminance, 0, 1)}
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
        style={fillStyle(prefs.videoBackgroundAlpha, 0, 1)}
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
        style={fillStyle(prefs.musicVolume, 0, 1)}
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
        style={fillStyle(prefs.hitSoundVolume, 0, 1)}
        oninput={(e) => update('hitSoundVolume', Number(e.currentTarget.value))}
      />
    </div>
  </section>

  <!-- 其他 -->
  <section class="group">
    <h2 class="group-title">其他</h2>
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
      <span class="label">文件管理</span>
      <button class="flat-btn" onclick={handleOpenFiles}>打开</button>
    </div>
    <div class="row">
      <span class="label">清除全部数据</span>
      <button class="flat-btn danger" onclick={handleClearData}>清除</button>
    </div>
  </section>
</div>

<style>
  .settings-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
  }

  /* 侧边栏内：填满容器宽度，不再限制 640px */
  .settings-panel.sidebar {
    align-items: stretch;
    gap: 16px;
  }

  .group {
    width: min(640px, 100%);
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 2px;
    padding: 8px 20px;
  }

  .settings-panel.sidebar .group {
    width: 100%;
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

  /* 自定义滑条：细轨 + 圆点拖块，已填充段为白色
     （原生 accent-color 的粗圆角观感与项目扁平黑白风格不符）
     轨道用 --fill 做两段渐变模拟进度；Firefox 走 ::-moz-range-progress 分支 */
  .slider {
    flex: 1;
    min-width: 120px;
    height: 22px;
    margin: 0;
    padding: 0;
    appearance: none;
    -webkit-appearance: none;
    background: transparent;
    cursor: pointer;
  }

  .slider::-webkit-slider-runnable-track {
    height: 3px;
    border-radius: 999px;
    background: linear-gradient(
      to right,
      #fff 0 var(--fill, 0%),
      rgba(255, 255, 255, 0.22) var(--fill, 0%) 100%
    );
  }

  .slider::-webkit-slider-thumb {
    appearance: none;
    -webkit-appearance: none;
    width: 14px;
    height: 14px;
    margin-top: -5.5px;
    border: 0;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.12);
    transition: transform 0.15s ease, box-shadow 0.15s ease;
  }

  .slider:hover::-webkit-slider-thumb {
    transform: scale(1.15);
    box-shadow: 0 0 0 5px rgba(255, 255, 255, 0.18);
  }

  .slider:active::-webkit-slider-thumb {
    transform: scale(1.05);
  }

  .slider:focus-visible {
    outline: none;
  }

  .slider:focus-visible::-webkit-slider-thumb {
    box-shadow: 0 0 0 5px rgba(255, 255, 255, 0.28);
  }

  .slider::-moz-range-track {
    height: 3px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.22);
  }

  .slider::-moz-range-progress {
    height: 3px;
    border-radius: 999px;
    background: #fff;
  }

  .slider::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border: 0;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.12);
    transition: transform 0.15s ease, box-shadow 0.15s ease;
  }

  .slider:hover::-moz-range-thumb {
    transform: scale(1.15);
    box-shadow: 0 0 0 5px rgba(255, 255, 255, 0.18);
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

  /* 侧边栏较窄：标签与控件换行，避免挤压 */
  .settings-panel.sidebar .row {
    flex-wrap: wrap;
    gap: 8px 12px;
  }

  .settings-panel.sidebar .label {
    flex: 1 1 auto;
  }

  .settings-panel.sidebar .slider {
    flex: 1 1 100%;
    min-width: 0;
  }
</style>
