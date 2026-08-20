<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import start from './main';
  import { EventBus } from './EventBus';
  import { GameStatus, type Config } from '$lib/types';
  import { clamp } from '$lib/utils';
  import { convertTime } from './utils';
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
  let countdown = 0;
  let counter: ReturnType<typeof setInterval> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let stillLoading = false;

  const handleContextMenu = (e: PointerEvent) => {
    e.preventDefault();
  };

  const handleWheel = (e: WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
    }
  };

  onMount(async () => {
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
      allowSeek = (scene.autoplay || scene.practice) && !scene.render;
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
  });

  onDestroy(async () => {
    // 先停掉所有声音，避免 Phaser 销毁不彻底导致音乐残留叠加
    gameRef.game?.sound?.stopAll?.();
    gameRef.scene?.destroy();
    gameRef.game?.destroy(true);
    removeEventListener('contextmenu', handleContextMenu);
    removeEventListener('wheel', handleWheel);
  });

  const exit = () => {
    goto('/songs');
  };

  const resume = () => {
    setTimeout(() => {
      showPause = false;
    }, 500);
    status = GameStatus.PLAYING;
    if (gameRef.scene?.autoplay) {
      gameRef.scene?.resume();
    } else {
      countdown = 3;
      counter = setInterval(() => {
        countdown--;
        if (countdown === 0) {
          clearInterval(counter);
          gameRef.scene?.resume();
        }
      }, 1000);
    }
  };
</script>

<svelte:head>
  <title>{title && level ? `${title} [${level}] | PhiCommunity` : '游玩 - PhiCommunity'}</title>
</svelte:head>

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
    progressBarHeld ||
    keyboardSeeking}
  class:overlay-passive={status === GameStatus.LOADING ||
    status === GameStatus.PLAYING ||
    status === GameStatus.FINISHED ||
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
      <h2 class="pause-title">已暂停</h2>
      <div class="pause-actions">
        <button class="btn btn-round" title="退出" onclick={exit}>✕</button>
        <button
          class="btn btn-wide"
          onclick={() => {
            setTimeout(() => {
              showPause = false;
            }, 500);
            status = GameStatus.LOADING;
            gameRef.scene?.restart();
          }}
        >
          重新开始
        </button>
        <button class="btn btn-wide" onclick={resume}>继续</button>
      </div>
    </div>
  {/if}
</div>

{#if allowSeek}
  <div
    class="seek-bar"
    class:seek-bar-visible={keyboardSeeking || showPause}
    class:seek-bar-passive={!keyboardSeeking && !showPause}
  >
    <span class="seek-time">{convertTime(timeSec, true)}</span>
    <input
      type="range"
      min="0"
      max={duration}
      value={timeSec}
      step="0.001"
      disabled={(!keyboardSeeking && !showPause) ||
        status === GameStatus.LOADING ||
        status === GameStatus.READY ||
        status === GameStatus.PLAYING ||
        status === GameStatus.FINISHED ||
        timeSec === duration}
      onpointerdown={() => {
        progressBarHeld = true;
        if (!keyboardSeeking && !showPause) {
          pausedByBar = true;
          gameRef.scene?.pause(true);
        }
      }}
      onpointerup={() => {
        progressBarHeld = false;
        if (pausedByBar) {
          pausedByBar = false;
          gameRef.scene?.resume();
        }
      }}
      oninput={(e) => {
        gameRef.scene?.setSeek(Math.max(0, parseFloat(e.currentTarget.value)));
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
  </div>
  <div class="finished-actions">
    <button
      class="btn btn-round"
      title="重新开始"
      onclick={() => {
        status = GameStatus.LOADING;
        gameRef.scene?.restart();
      }}
    >
      ⟳
    </button>
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
</style>
