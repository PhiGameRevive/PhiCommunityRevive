<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import start from './main';
  import { EventBus } from './EventBus';
  import { GameStatus, type Config } from '$lib/types';
  import { clamp } from '$lib/utils';
  import { convertTime } from './utils';
  import { getMod, type ModId } from '$lib/mods';
  import type { Game as GameScene } from './scenes/Game';

  export let config: Config | null = null;
  export let currentActiveScene: (scene: GameScene) => void | undefined = () => {};
  export let gameRef: {
    game: import('phaser').Game | null;
    scene: GameScene | null;
  } = { game: null, scene: null };
  // 结算信息：页面层在 'finished' 时计算后传入
  export let isNewBest = false;
  export let rankingScore = 0;
  export let accuracy = 0;
  /** 本次启用的模组与分数倍率（结算面板展示用） */
  export let mods: ModId[] = [];
  export let scoreMultiplier = 1;
  export let recorded = true;

  let loadingProgress = 0;
  let loadingDetail = '';

  let status = GameStatus.LOADING;
  let duration = 0;
  let timeSec = 0;

  let title: string | null = config?.metadata.title ?? null;
  let level: string | null = config?.metadata.level ?? null;
  let credits: string[] = [];

  let showStart = false;
  let showAudioStart = false;
  let showPause = false;
  let keyboardSeeking = false;
  let allowSeek = false;
  let progressBarHeld = false;
  let pausedByBar = false;
  let fastSeeking = false;
  let seekTarget = 0;
  /** 恢复播放进行中（回退 + 倒计时），防止重复点击继续 */
  let resuming = false;
  let persistentSeekBar = false;
  let countdown = 0;
  let counter: ReturnType<typeof setInterval> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let stillLoading = false;

  /* ---- 练习模式：A/B 点循环 ---- */
  let practice = false;
  let loopA: number | null = null;
  let loopB: number | null = null;

  /* ---- 失败演出 ---- */
  /** 失败流程已开始（红光渐现、音频减速中） */
  let failing = false;
  /** 减速结束，展示仅含重开/退出的失败界面 */
  let showFailed = false;
  /** 复活（RS 模组）：生命耗尽后半血续命，短暂提示 */
  let resurrected = false;
  let resurrectTimer: ReturnType<typeof setTimeout> | undefined;

  const setLoopA = () => {
    const scene = gameRef.scene;
    if (!scene) return;
    scene.setLoopA(timeSec);
    loopA = scene.loopA;
    loopB = scene.loopB;
  };

  const setLoopB = () => {
    const scene = gameRef.scene;
    if (!scene) return;
    scene.setLoopB(timeSec);
    loopA = scene.loopA;
    loopB = scene.loopB;
  };

  const clearLoop = () => {
    const scene = gameRef.scene;
    if (!scene) return;
    scene.clearLoop();
    loopA = null;
    loopB = null;
  };

  const handleContextMenu = (e: PointerEvent) => {
    e.preventDefault();
  };

  const handleWheel = (e: WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
    }
  };

  onMount(async () => {
    // AT/回放常驻进度条默认关闭，玩家可在设置中主动开启
    persistentSeekBar = localStorage.getItem('persistentSeekBar') === 'true';
    if (!config) return;
    gameRef.game = await start('player', config);
    timeout = setTimeout(() => {
      stillLoading = true;
    }, 10000);

    addEventListener('contextmenu', handleContextMenu, { passive: false });
    addEventListener('wheel', handleWheel, { passive: false });

    EventBus.on('loading', (p: number) => {
      loadingProgress = p;
    });

    EventBus.on('loading-detail', (p: string) => {
      loadingDetail = p;
    });

    EventBus.on('current-scene-ready', (scene: GameScene) => {
      clearTimeout(timeout);
      stillLoading = false;
      gameRef.scene = scene;
      status = scene.status;
      duration = scene.song.duration;
      showStart = showAudioStart || (!config?.autostart && status === GameStatus.READY);
      allowSeek = (scene.autoplay || scene.practice || !!scene.replay) && !scene.render;
      practice = scene.practice && !scene.render;
      const metadata = scene.metadata;
      title = metadata.title;
      level = metadata.level;
      [metadata.composer, metadata.charter, metadata.illustrator].forEach((credit) => {
        credits.push(credit ?? '');
      });
      if (currentActiveScene) {
        currentActiveScene(scene);
      }
    });

    EventBus.on('update', (t: number) => {
      if (t !== timeSec) {
        timeSec = t;
      }
    });

    EventBus.on('paused', (emittedBySpace: boolean) => {
      status = GameStatus.PAUSED;
      showPause = !emittedBySpace;
      keyboardSeeking = emittedBySpace;
    });

    EventBus.on('started', () => {
      status = GameStatus.PLAYING;
      keyboardSeeking = false;
      stillLoading = false;
    });

    EventBus.on('audio-blocked', () => {
      showAudioStart = true;
      showStart = true;
      status = GameStatus.READY;
    });

    EventBus.on('error', () => {
      stillLoading = true;
    });

    EventBus.on('finished', () => {
      status = GameStatus.FINISHED;
    });

    // 失败演出开始：音频减速的同时红光渐现
    EventBus.on('failing', () => {
      status = GameStatus.FAILED;
      failing = true;
      showPause = false;
    });

    // 减速结束：展示仅含重开/退出的失败界面
    EventBus.on('failed', () => {
      status = GameStatus.FAILED;
      failing = true;
      showFailed = true;
    });

    // 复活（RS 模组）：半血续命成功，短暂提示后继续游玩
    EventBus.on('resurrected', () => {
      resurrected = true;
      clearTimeout(resurrectTimer);
      resurrectTimer = setTimeout(() => {
        resurrected = false;
      }, 1400);
    });
  });

  onDestroy(async () => {
    // 倒计时进行中退出页面：停止计时器并释放暂停锁，避免残留状态
    clearInterval(counter);
    clearTimeout(resurrectTimer);
    if (gameRef.scene) gameRef.scene.resumeLock = false;
    // 先停掉所有声音，避免 Phaser 销毁不彻底导致音乐残留叠加
    gameRef.game?.sound?.stopAll?.();
    gameRef.scene?.destroy();
    gameRef.game?.destroy(true);
    removeEventListener('contextmenu', handleContextMenu);
    removeEventListener('wheel', handleWheel);
  });

  const exit = () => {
    // 浮窗模式（MW/WW）：页面运行在 window.open 的小窗中，退出直接关窗而非跳转
    try {
      if (new URLSearchParams(window.location.search).has('pop')) {
        window.close();
        return;
      }
    } catch {
      /* 忽略 */
    }
    goto('/songs');
  };

  const resume = () => {
    // 防止重复触发：倒计时进行中忽略再次点击继续/暂停
    if (resuming) return;
    resuming = true;
    setTimeout(() => {
      showPause = false;
    }, 500);
    if (gameRef.scene?.autoplay) {
      status = GameStatus.PLAYING;
      gameRef.scene?.resume();
      resuming = false;
    } else {
      // 普通游玩/回放/练习：回退 3 秒后立即播放，显示 3/2/1 作为视觉提示。
      // 已判定或已 Miss 的 note 在回退区间内保持原状态，不会重新出现。
      status = GameStatus.PLAYING;
      void gameRef.scene?.resumeWithRewind(3);
      countdown = 3;
      clearInterval(counter);
      counter = setInterval(() => {
        countdown--;
        if (countdown <= 0) {
          clearInterval(counter);
          countdown = 0;
          resuming = false;
          if (gameRef.scene) gameRef.scene.resumeLock = false;
        }
      }, 1000);
    }
  };
  const restart = () => {
    setTimeout(() => {
      showPause = false;
      showFailed = false;
    }, 500);
    failing = false;
    status = GameStatus.LOADING;
    gameRef.scene?.restart();
  };

  const isFastSeekMode = () => !!gameRef.scene && (gameRef.scene.autoplay || !!gameRef.scene.replay);

  const beginSeek = () => {
    if (!isFastSeekMode() || status !== GameStatus.PLAYING) return;
    fastSeeking = true;
    seekTarget = timeSec;
    if (!gameRef.scene?.cancelFastForward()) gameRef.scene?.pause(true);
  };

  const finishSeek = () => {
    if (!fastSeeking) return;
    fastSeeking = false;
    pausedByBar = false;
    void gameRef.scene?.fastForwardTo(seekTarget, true);
  };
</script>

<svelte:head>
  <title>{title && level ? `${title} [${level}] | PhiCommunity` : '游玩 - PhiCommunity'}</title>
</svelte:head>

<!-- 失败红光：屏幕四周渐现的红色晕影 -->
<div class="fail-vignette" class:on={failing} aria-hidden="true"></div>

<!-- 复活（RS 模组）提示 -->
<div class="resurrected-cue" class:visible={resurrected} aria-hidden="true">复活！</div>

<div class="countdown-layer">
  <div class="countdown" class:visible={countdown > 0 && status === GameStatus.PLAYING}>
    <span>{countdown}</span>
  </div>
</div>

<div
  class="overlay"
  class:overlay-hidden={status === GameStatus.LOADING ||
    status === GameStatus.PLAYING ||
    status === GameStatus.FINISHED ||
    (status === GameStatus.FAILED && !showFailed) ||
    progressBarHeld ||
    keyboardSeeking}
  class:overlay-passive={status === GameStatus.LOADING ||
    status === GameStatus.PLAYING ||
    status === GameStatus.FINISHED ||
    (status === GameStatus.FAILED && !showFailed) ||
    keyboardSeeking}
>
  {#if showStart}
    <div class="overlay-card">
      {#if title && level}
        <div class="start-info">
          <h2 class="start-title">{title}</h2>
          <h4 class="start-level">{level}</h4>
          {#if credits.length > 0}
            <div class="start-credits">
              {#each credits as credit, i}
                {#if credit}
                  <span class="badge" title={['曲师', '谱师', '画师'][i]}>{credit}</span>
                {/if}
              {/each}
            </div>
          {/if}
        </div>
      {/if}
      <button
        class="btn btn-start"
        onclick={async () => {
          const started = (await gameRef.scene?.start()) === true;
          if (started) {
            showStart = false;
            showAudioStart = false;
          }
        }}
      >
        {showAudioStart ? '点击播放' : '开始'}
      </button>
    </div>
  {:else if showPause}
    <div class="overlay-card">
      <h2 class="pause-title" class:practice>{practice ? '练习模式 · 已暂停' : '已暂停'}</h2>

      {#if practice}
        <!-- A/B 点循环：设置两点后播放越过 B 会自动跳回 A -->
        <div class="loop-panel">
          <span class="loop-label">A / B 循环</span>
          <div class="loop-rows">
            <div class="loop-row">
              <button class="btn btn-loop" onclick={setLoopA}>设 A 点</button>
              <span class="loop-value" class:set={loopA !== null}>
                {loopA === null ? '未设置' : convertTime(loopA, true)}
              </span>
            </div>
            <div class="loop-row">
              <button class="btn btn-loop" onclick={setLoopB}>设 B 点</button>
              <span class="loop-value" class:set={loopB !== null}>
                {loopB === null ? '未设置' : convertTime(loopB, true)}
              </span>
            </div>
          </div>
          <div class="loop-foot">
            {#if loopA !== null && loopB !== null}
              <span class="loop-active">循环中 · {convertTime(loopA, true)} → {convertTime(loopB, true)}</span>
            {:else}
              <span class="loop-hint">在当前进度设置 A、B 两点即开始循环</span>
            {/if}
            <button class="btn btn-loop" onclick={clearLoop} disabled={loopA === null && loopB === null}>
              清除
            </button>
          </div>
        </div>
      {/if}

      <div class="pause-actions">
        <button class="btn btn-round" title="退出" onclick={exit}>✕</button>
        <button class="btn btn-wide" onclick={restart}>重新开始</button>
        <button class="btn btn-wide" onclick={resume}>继续</button>
      </div>
    </div>
  {:else if showFailed}
    <!-- 失败：只提供重新开始与退出，不能继续 -->
    <div class="overlay-card">
      <h2 class="fail-title">FAILED</h2>
      <p class="fail-hint">失误过多，本次游玩已结束</p>
      <div class="pause-actions">
        <button class="btn btn-round" title="退出" onclick={exit}>✕</button>
        <button class="btn btn-wide" onclick={restart}>重新开始</button>
      </div>
    </div>
  {/if}
</div>

{#if allowSeek}
  <div
    class="seek-bar"
    class:seek-bar-visible={keyboardSeeking || showPause || (persistentSeekBar && isFastSeekMode())}
    class:seek-bar-passive={!keyboardSeeking && !showPause && !(persistentSeekBar && isFastSeekMode())}
  >
    <span class="seek-time">{convertTime(timeSec, true)}</span>
    <input
      type="range"
      min="0"
      max={duration}
      value={timeSec}
      step="0.001"
      disabled={(!keyboardSeeking && !showPause && !isFastSeekMode()) ||
        status === GameStatus.LOADING ||
        status === GameStatus.READY ||
        status === GameStatus.PLAYING ||
        status === GameStatus.FINISHED ||
        status === GameStatus.FAILED ||
        timeSec === duration}
      onpointerdown={() => {
        progressBarHeld = true;
        beginSeek();
        if (!keyboardSeeking && !showPause) {
          pausedByBar = true;
          gameRef.scene?.pause(true);
        }
      }}
      onpointerup={() => {
        progressBarHeld = false;
        if (fastSeeking) {
          finishSeek();
        } else if (pausedByBar) {
          pausedByBar = false;
          gameRef.scene?.resume();
        }
      }}
      oninput={(e) => {
        seekTarget = Math.max(0, parseFloat(e.currentTarget.value));
    if (!fastSeeking) gameRef.scene?.setSeek(seekTarget);
      }}
    />
    <span class="seek-time seek-time-right">{convertTime(duration, true)}</span>
  </div>
{/if}

{#if status === GameStatus.FINISHED && !config?.render}
  <div class="finished-info">
    {#if isNewBest}
      <div class="new-best">NEW BEST</div>
    {/if}
    {#if rankingScore > 0}
      <div class="rks">RKS {rankingScore.toFixed(2)}</div>
    {/if}
    <div class="acc">{(accuracy * 100).toFixed(2)}%</div>
    {#if mods.length > 0}
      <div class="mods-row">
        {#each mods as id}
          {@const def = getMod(id)}
          {#if def}
            <span
              class="mod-badge"
              class:reduction={def.category === 'reduction'}
              class:increase={def.category === 'increase'}
              class:auto={def.category === 'auto'}
            >
              {def.short}
            </span>
          {/if}
        {/each}
        {#if !recorded}
          <span class="mods-note">成绩不记录</span>
        {:else if scoreMultiplier !== 1}
          <span class="mods-note">分数 ×{scoreMultiplier.toFixed(2)}</span>
        {/if}
      </div>
    {/if}
  </div>
  <div class="finished-actions">
    <button class="btn btn-round" title="重新开始" onclick={restart}>⟳</button>
    <button class="btn btn-round" title="返回选歌" onclick={exit}>✕</button>
  </div>
{/if}

<div id="player" class="player-root"></div>

<style>
  .player-root {
    position: absolute;
    inset: 0;
  }

  :global(canvas) {
    touch-action: none;
  }

  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 4px;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(24px);
    transition: opacity 0.3s cubic-bezier(0.165, 0.84, 0.44, 1);
    z-index: 20;
  }

  .overlay-hidden {
    opacity: 0;
    pointer-events: none;
  }

  .overlay-passive {
    pointer-events: none;
  }

  .overlay-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 20px;
  }

  .start-info {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin: 16px;
    white-space: pre;
  }

  .start-title {
    font-size: 3.75rem;
    font-weight: bold;
    margin: 0;
  }

  .start-level {
    font-size: 1.875rem;
    opacity: 0.7;
    margin: 0;
  }

  .start-credits {
    display: flex;
    gap: 4px;
    margin: 16px 0;
  }

  .badge {
    padding: 4px 12px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.1);
    font-size: 0.875rem;
    opacity: 0.7;
  }

  .pause-title {
    font-size: 3.75rem;
    font-weight: bold;
    text-transform: uppercase;
    margin: 0;
  }

  /* ---- 失败 ---- */
  .fail-title {
    margin: 0;
    font-size: clamp(2.6rem, 9vw, 4.5rem);
    font-weight: 900;
    letter-spacing: 0.16em;
    color: #ffb4b4;
    text-shadow: 0 0 36px rgba(255, 70, 70, 0.55);
    animation: fail-in 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .fail-hint {
    margin: 0;
    color: rgba(255, 255, 255, 0.6);
    font-size: 0.9rem;
    letter-spacing: 0.08em;
  }

  @keyframes fail-in {
    from {
      opacity: 0;
      transform: scale(1.12);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  /* 屏幕四周渐现的红色晕影；只动 opacity，走合成器 */
  .fail-vignette {
    position: fixed;
    inset: 0;
    z-index: 15;
    pointer-events: none;
    opacity: 0;
    transition: opacity 1.2s ease;
    background:
      radial-gradient(
        ellipse at center,
        rgba(255, 0, 0, 0) 38%,
        rgba(200, 0, 0, 0.32) 78%,
        rgba(150, 0, 0, 0.62) 100%
      );
  }

  .fail-vignette.on {
    opacity: 1;
  }

  /* 复活（RS 模组）提示：屏幕中央的短暂文字 */
  .resurrected-cue {
    position: fixed;
    left: 50%;
    top: 42%;
    z-index: 16;
    pointer-events: none;
    transform: translate(-50%, -50%) scale(0.85);
    opacity: 0;
    color: #fff;
    font-size: clamp(2rem, 6vw, 3.4rem);
    font-weight: 800;
    letter-spacing: 0.18em;
    text-shadow: 0 4px 18px rgba(0, 0, 0, 0.7), 0 0 42px rgba(120, 200, 255, 0.45);
    transition:
      opacity 240ms ease,
      transform 240ms ease;
  }

  .resurrected-cue.visible {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }

  /* 练习模式的标题更长（含"练习模式"前缀），缩小避免窄屏溢出 */
  .pause-title.practice {
    font-size: clamp(1.5rem, 5vw, 2.4rem);
    letter-spacing: 0.04em;
  }

  /* ---- 练习模式：A/B 循环面板 ---- */
  .loop-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: min(420px, 82vw);
    padding: 14px 16px;
    border: 1px solid rgba(255, 255, 255, 0.24);
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.42);
    backdrop-filter: blur(8px);
  }

  .loop-label {
    color: rgba(255, 255, 255, 0.5);
    font-family: 'Courier New', ui-monospace, monospace;
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.2em;
  }

  .loop-rows {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .loop-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .loop-value {
    color: rgba(255, 255, 255, 0.42);
    font-family: 'Courier New', ui-monospace, monospace;
    font-size: 0.86rem;
    font-variant-numeric: tabular-nums;
  }

  .loop-value.set {
    color: #fff;
  }

  .loop-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding-top: 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.14);
  }

  .loop-hint {
    color: rgba(255, 255, 255, 0.38);
    font-size: 0.72rem;
  }

  .loop-active {
    color: #9fe0ac;
    font-family: 'Courier New', ui-monospace, monospace;
    font-size: 0.74rem;
    font-variant-numeric: tabular-nums;
  }

  .btn-loop {
    flex-shrink: 0;
    padding: 6px 14px;
    border-width: 1px;
    border-radius: 3px;
    font-size: 0.8rem;
  }

  .btn-loop:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .btn-loop:disabled:hover {
    background: transparent;
  }

  .pause-actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .btn {
    border: 2px solid rgba(255, 255, 255, 0.5);
    background: transparent;
    color: #fff;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.165, 0.84, 0.44, 1);
    font-size: 1rem;
  }

  .btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .btn-start {
    padding: 12px 48px;
    border-radius: 999px;
    font-size: 1.5rem;
  }

  .btn-wide {
    padding: 12px 32px;
    border-radius: 999px;
    font-size: 1.25rem;
  }

  .btn-round {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    font-size: 1.25rem;
  }

  .countdown-layer {
    position: fixed;
    inset: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    pointer-events: none;
    z-index: 30;
  }

  .countdown {
    width: 112px;
    height: 112px;
    display: flex;
    justify-content: center;
    align-items: center;
    border-radius: 24px;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(20px);
    opacity: 0;
    transition: opacity 0.3s;
    z-index: 30;
  }

  .countdown.visible {
    opacity: 1;
  }

  .countdown span {
    font-size: 4.375rem;
    font-weight: bold;
  }

  .seek-bar {
    position: absolute;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    width: 75vw;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 8px 16px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(12px);
    opacity: 0;
    transition: opacity 0.3s, background 0.3s;
    z-index: 20;
  }

  .seek-bar-visible {
    opacity: 0.5;
  }

  .seek-bar-passive {
    pointer-events: none;
  }

  .seek-time {
    font-size: 1.25rem;
    min-width: 96px;
  }

  .seek-time-right {
    text-align: right;
  }

  .seek-bar input[type='range'] {
    flex: 1;
  }

  .finished-actions {
    position: absolute;
    bottom: 20px;
    right: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    z-index: 20;
  }

  .finished-info {
    position: absolute;
    top: 20px;
    right: 20px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
    z-index: 20;
    pointer-events: none;
  }

  .new-best {
    padding: 4px 16px;
    border-radius: 999px;
    background: #ffd700;
    color: #000;
    font-weight: bold;
    font-size: 1.25rem;
    animation: pop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  }

  @keyframes pop {
    from {
      transform: scale(0.5);
      opacity: 0;
    }
    to {
      transform: scale(1);
      opacity: 1;
    }
  }

  .rks,
  .acc {
    padding: 4px 16px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(8px);
    font-size: 1rem;
  }

  /* 结算面板的模组徽章 */
  .mods-row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: flex-end;
    max-width: 60vw;
  }

  .mod-badge {
    padding: 3px 9px;
    border: 1px solid rgba(255, 255, 255, 0.45);
    border-radius: 2px;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(8px);
    font-family: 'Courier New', ui-monospace, monospace;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.1em;
  }

  /* 降低难度偏冷色、提升难度偏暖色、自动曲偏紫，与选歌页的模组面板一致 */
  .mod-badge.reduction {
    border-color: rgba(150, 210, 255, 0.7);
    color: #bfe1ff;
  }

  .mod-badge.increase {
    border-color: rgba(255, 180, 150, 0.7);
    color: #ffd0bd;
  }

  .mod-badge.auto {
    border-color: rgba(201, 176, 240, 0.7);
    color: #ddccf7;
  }

  .mods-note {
    padding: 3px 10px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(8px);
    color: rgba(255, 255, 255, 0.75);
    font-family: 'Courier New', ui-monospace, monospace;
    font-size: 0.7rem;
    letter-spacing: 0.06em;
  }
</style>
