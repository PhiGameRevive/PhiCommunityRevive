<script lang="ts">
  /**
   * 延迟校准浮窗（指向设置侧边栏）。
   *
   * 在屏幕中间偏侧边栏一侧弹出，带一个小三角指向侧边栏；中间是一个精简的
   * Phaser「半个游玩界面」：判定线在下方，音符随校准音频的重拍
   * （1.5 / 3.5 / 5.5 / 7.5s）落到判定线上并爆开。点击按钮或按空格记录偏移，
   * 四次取平均后写入谱面延时。
   *
   * 浮窗用 fixed 定位脱离侧边栏的滚动容器，保证 Phaser 画布拿到真实尺寸；
   * 箭头方向由 `side` 决定（侧边栏在右 → 箭头在浮窗右缘指向右侧）。
   */
  import { onDestroy, onMount } from 'svelte';
  import { scale } from 'svelte/transition';
  import { loadPreferences, savePreferences } from '$lib/preferences';
  import { confirm as confirmModal } from '$lib/modal';
  import { createCalibrateGame, type CalibrateEvent, type CalibrateHandle } from '$lib/player/calibrate/CalibrateScene';

  export let side: 'left' | 'right' = 'right';
  export let onclose: (() => void) | undefined = undefined;

  /** 容器 id 唯一化：避免多个实例冲突 */
  const CONTAINER_ID = `calibrate-preview-${Math.random().toString(36).slice(2, 8)}`;

  let ready = false;
  let running = false;
  let results: (number | undefined)[] = [undefined, undefined, undefined, undefined];
  let error = '';
  let currentOffset = 0;
  /** 本轮收到的有效点击次数（用于反馈「点击是否送达」） */
  let hits = 0;

  let handle: CalibrateHandle | null = null;

  /**
   * 用 `$:` 派生而非函数调用：Svelte legacy 模式下编译器追踪不到
   * 函数体内的变量依赖，模板里写 `hasAnyResult()` 不会随 `results` 更新而重算，
   * 会导致「结果已记录但确认按钮不出现」。派生变量则是直接依赖，必然刷新。
   */
  $: recorded = results.filter((r): r is number => r !== undefined);
  $: hasAnyResult = recorded.length > 0;
  $: average =
    recorded.length === 0
      ? 0
      : Math.round(recorded.reduce((sum, value) => sum + value, 0) / recorded.length);

  const onEvent = (event: CalibrateEvent) => {
    if (event.type === 'ready') ready = true;
    else if (event.type === 'error') error = event.message;
    else if (event.type === 'started') {
      running = true;
      results = [undefined, undefined, undefined, undefined];
    } else if (event.type === 'ended') {
      running = false;
    } else if (event.type === 'result') {
      results = results.map((value, index) => (index === event.stage - 1 ? event.offset : value));
      // 四次记录齐全：停止本轮并自动进入应用流程
      // （这里直接判断刚写入的 results，不用 $: 派生变量——它在下一个微任务才更新）
      if (results.every((value) => value !== undefined)) {
        stop();
        void finish();
      }
    }
  };

  const start = () => {
    if (!handle || running) return;
    // 立即置为运行中，不依赖场景 started 事件回传（避免事件丢失时点击热区被禁用）
    running = true;
    hits = 0;
    results = [undefined, undefined, undefined, undefined];
    handle.start();
  };

  const hit = () => {
    if (!handle || !running) return;
    hits += 1;
    handle.hit();
  };

  /** 结束当前校准：停止音频与场景，但保留已记录结果（若有）以便确认应用 */
  const stop = () => {
    handle?.stop();
    running = false;
  };

  const finish = async () => {
    // 用当前 results 直接判断，避免依赖尚未刷新的 $: 派生变量
    const values = results.filter((r): r is number => r !== undefined);
    if (values.length === 0) return;
    const value = Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
    if (await confirmModal(`谱面延时即将被设置为 ${value} ms，是否确认？`)) {
      const prefs = loadPreferences();
      savePreferences({ ...prefs, chartOffset: value });
      currentOffset = value;
      onclose?.();
    }
  };

  const onKeydown = (e: KeyboardEvent) => {
    if (e.code === 'Space' || e.key === ' ') {
      const tag = (e.target as HTMLElement | null)?.tagName ?? '';
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return;
      e.preventDefault();
      hit();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      onclose?.();
    }
  };

  onMount(() => {
    currentOffset = loadPreferences().chartOffset;
    handle = createCalibrateGame(CONTAINER_ID, onEvent);
  });

  onDestroy(() => {
    handle?.destroy();
    handle = null;
  });
</script>

<svelte:window onkeydown={onKeydown} />

<!-- 浮窗：fixed 居中偏一侧，带指向侧边栏的小三角 -->
<div class="calibrate-popover {side}" transition:scale={{ duration: 180, start: 0.94 }}>
  <div class="popover-arrow {side}"></div>

  <header class="popover-head">
    <div class="popover-title">
      <span class="popover-label">OFFSET CALIBRATION</span>
      <strong>延迟校准</strong>
    </div>
    <button class="popover-close" onclick={() => onclose?.()} aria-label="关闭校准"></button>
  </header>

  <p class="hint">
    {#if error}
      {error}
    {:else if running}
      在每次音符落到判定线时点击预览或按空格（已点击 {hits} 次 · 已记录 {recorded.length}/4）
    {:else if hasAnyResult}
      已记录 {recorded.length}/4 次，可随时确认应用或继续校准
    {:else}
      听节拍，在每个第三拍（重拍）点击预览或按空格
    {/if}
  </p>

  <div class="preview" class:running>
    <div id={CONTAINER_ID} class="preview-canvas"></div>
    <!--
      点击热区：用 div + pointerdown（比 disabled button 的 click 更可靠，
      按钮被禁用时不会派发 click，容易出现「点了没反应」）。
      用 role/tabindex 保留可访问性。
    -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_no_static_element_interactions -->
    <div
      class="preview-hit"
      role="button"
      tabindex="0"
      aria-label="记录偏移"
      onpointerdown={(e) => {
        e.preventDefault();
        hit();
      }}
    ></div>
  </div>

  <div class="results">
    {#each [0, 1, 2, 3] as i}
      <div class="result-card" class:filled={results[i] !== undefined}>
        <span>第 {i + 1} 次</span>
        <span class="result-value">{results[i] !== undefined ? `${results[i]} ms` : '…'}</span>
      </div>
    {/each}
  </div>

  <div class="actions">
    {#if hasAnyResult}
      <!-- 只要已有记录就始终提供确认入口：不依赖音频是否播完（onended 在后台标签页可能不触发） -->
      <button class="flat-btn primary" onclick={finish}>
        确认应用（{average} ms{recorded.length < 4 ? ` · ${recorded.length}/4` : ''}）
      </button>
      <button class="flat-btn" onclick={start} disabled={running}>重新校准</button>
      <button class="flat-btn ghost" onclick={stop}>{running ? '结束' : '取消'}</button>
    {:else if running}
      <button class="flat-btn" disabled>校准中…（0/4）</button>
      <button class="flat-btn ghost" onclick={stop}>结束</button>
    {:else}
      <button class="flat-btn" disabled={!ready || !!error} onclick={start}>
        {error ? '不可用' : ready ? '开始校准' : '加载中…'}
      </button>
      <button class="flat-btn ghost" onclick={() => onclose?.()}>取消</button>
    {/if}
  </div>

  <p class="current">当前谱面延时：<b>{currentOffset} ms</b></p>
</div>

<style>
  .calibrate-popover {
    position: fixed;
    top: 50%;
    transform: translateY(-50%);
    z-index: 450;
    width: min(560px, 62vw);
    max-height: 88vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 18px 20px 20px;
    background: rgba(11, 11, 18, 0.97);
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 4px;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    box-shadow: 0 0 48px rgba(0, 0, 0, 0.65);
  }

  /*
   * 浮窗落在屏幕中间、并相对侧边栏反向偏移，使它的「近侧边栏边缘」贴近侧边栏。
   * --sidebar-w 由内联变量传入（默认 560px，与 SettingsSidebar 宽度一致）。
   */
  .calibrate-popover.right {
    /* 侧边栏在右：浮窗中心左移半个侧边栏宽，箭头在右缘指向侧边栏 */
    left: calc(50% - var(--sidebar-w, 560px) / 2);
    transform: translate(-50%, -50%);
  }

  .calibrate-popover.left {
    /* 侧边栏在左：浮窗中心右移半个侧边栏宽，箭头在左缘指向侧边栏 */
    left: calc(50% + var(--sidebar-w, 560px) / 2);
    transform: translate(-50%, -50%);
  }

  .popover-arrow {
    position: absolute;
    top: 50%;
    width: 16px;
    height: 16px;
    margin-top: -8px;
    background: rgba(11, 11, 18, 0.97);
    transform: rotate(45deg);
  }

  .popover-arrow.right {
    right: -8px;
    border-top: 1px solid rgba(255, 255, 255, 0.16);
    border-right: 1px solid rgba(255, 255, 255, 0.16);
  }

  .popover-arrow.left {
    left: -8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.16);
    border-left: 1px solid rgba(255, 255, 255, 0.16);
  }

  .popover-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .popover-title {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .popover-label {
    font-size: 0.66rem;
    letter-spacing: 0.18em;
    color: rgba(255, 255, 255, 0.4);
  }

  .popover-title strong {
    font-size: 1.15rem;
    font-weight: 900;
    letter-spacing: 0.08em;
  }

  .popover-close {
    width: 34px;
    height: 34px;
    flex-shrink: 0;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.25);
    cursor: pointer;
    padding: 0;
    position: relative;
  }

  .popover-close:hover {
    background: rgba(255, 255, 255, 0.18);
  }

  .popover-close::before,
  .popover-close::after {
    content: '';
    position: absolute;
    left: 16px;
    top: 8px;
    width: 2px;
    height: 16px;
    background: #fff;
  }

  .popover-close::before {
    transform: rotate(45deg);
  }

  .popover-close::after {
    transform: rotate(-45deg);
  }

  .hint {
    margin: 0;
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.55);
    line-height: 1.5;
  }

  .preview {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 7;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 2px;
    overflow: hidden;
    background: #0a0a0c;
  }

  .preview-canvas {
    position: absolute;
    inset: 0;
  }

  .preview-canvas :global(canvas) {
    display: block;
    width: 100% !important;
    height: 100% !important;
  }

  .preview-hit {
    position: absolute;
    inset: 0;
    z-index: 2;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
    touch-action: manipulation;
  }

  /* 未校准时热区不响应，避免误触；校准时才显示可点击手势 */
  .preview-hit {
    pointer-events: none;
  }

  .preview.running .preview-hit {
    pointer-events: auto;
  }

  .results {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }

  .result-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 10px 6px;
    font-size: 0.72rem;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.04);
    color: rgba(255, 255, 255, 0.6);
  }

  .result-card.filled {
    border-color: rgba(255, 255, 255, 0.5);
    color: #fff;
  }

  .result-value {
    font-size: 0.95rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .actions {
    display: flex;
    gap: 8px;
  }

  .flat-btn {
    flex: 1;
    background: transparent;
    border: 1.5px solid #fff;
    color: #fff;
    border-radius: 2px;
    padding: 10px;
    font-weight: 700;
    font-size: 0.9rem;
    cursor: pointer;
    transition: background 0.2s, color 0.2s;
  }

  .flat-btn:hover:not(:disabled) {
    background: #fff;
    color: #0b0b12;
  }

  .flat-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  /* 主操作：确认应用。反白实心，最醒目 */
  .flat-btn.primary {
    flex: 1.4;
    background: #fff;
    color: #0b0b12;
    border-color: #fff;
  }

  .flat-btn.primary:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.85);
    color: #0b0b12;
  }

  /* 次要操作：取消。弱化边框 */
  .flat-btn.ghost {
    flex: 0.8;
    border-color: rgba(255, 255, 255, 0.4);
    color: rgba(255, 255, 255, 0.7);
    font-weight: 600;
  }

  .current {
    margin: 0;
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.45);
  }

  .current b {
    color: rgba(255, 255, 255, 0.85);
    font-variant-numeric: tabular-nums;
  }

  /* 窄屏：浮窗占满中间区域，箭头仍保留指向 */
  @media (max-width: 900px) {
    .calibrate-popover {
      width: min(560px, 90vw);
    }

    .calibrate-popover.right {
      right: 5vw;
    }

    .calibrate-popover.left {
      left: 5vw;
    }
  }
</style>
