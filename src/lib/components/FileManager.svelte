<script lang="ts">
  /**
   * 文件管理浮窗（指向设置侧边栏）。
   *
   * 集中查看 / 清除各类本地存储：
   *  - 本地谱面（IndexedDB `localCharts`）：上传的谱面与在线自动缓存副本
   *  - 游玩成绩 / 回放（IndexedDB）
   *  - PWA 运行时缓存（CacheStorage）
   *  - 首选项（localStorage）
   *
   * 外观与 CalibratePreview 一致：fixed 居中偏侧边栏一侧，带小三角指向侧边栏。
   */
  import { onMount } from 'svelte';
  import { scale } from 'svelte/transition';
  import { confirm as confirmModal } from '$lib/modal';
  import {
    getAllLocalCharts,
    deleteLocalChart,
    clearLocalCharts,
    getAllResults,
    clearResults,
    getAllReplays,
    clearReplays,
    LOCAL_PREFIX,
    type LocalChart,
  } from '$lib/db';

  export let side: 'left' | 'right' = 'right';
  export let onclose: (() => void) | undefined = undefined;

  interface CacheInfo {
    name: string;
    size: number;
    count: number;
  }

  interface ChartInfo {
    codename: string;
    name: string;
    artist: string;
    size: number;
    /** 由在线谱面自动缓存而来（codename 形如 local-<源>-<id>） */
    cached: boolean;
  }

  let loading = true;
  let cachesInfo: CacheInfo[] = [];
  let charts: ChartInfo[] = [];
  let resultCount = 0;
  let resultSize = 0;
  let replayCount = 0;
  let replaySize = 0;
  let localStorageSize = 0;
  let localStorageKeys = 0;
  let busy = false;

  const bytesToMb = (bytes: number) => (bytes / 1024 / 1024).toFixed(2);

  const chartSize = (chart: LocalChart): number => {
    let size = 0;
    for (const file of chart.files ?? []) size += file.blob?.size ?? 0;
    return size;
  };

  const jsonSize = (value: unknown): number => {
    try {
      return new Blob([JSON.stringify(value)]).size;
    } catch {
      return 0;
    }
  };

  const loadCacheStorage = async (): Promise<CacheInfo[]> => {
    if (!('caches' in window)) return [];
    const names = await caches.keys();
    return Promise.all(
      names.map(async (name) => {
        const cache = await caches.open(name);
        const keys = await cache.keys();
        let size = 0;
        for (const key of keys) {
          const res = await cache.match(key);
          if (res) size += (await res.blob()).size;
        }
        return { name, size, count: keys.length };
      }),
    );
  };

  const refresh = async () => {
    loading = true;
    const [cacheInfo, localCharts, results, replays] = await Promise.all([
      loadCacheStorage().catch(() => []),
      getAllLocalCharts().catch(() => []),
      getAllResults().catch(() => []),
      getAllReplays().catch(() => []),
    ]);
    cachesInfo = cacheInfo;
    charts = localCharts.map((chart) => ({
      codename: chart.codename,
      name: chart.name,
      artist: chart.artist,
      size: chartSize(chart),
      cached: chart.codename.startsWith(LOCAL_PREFIX) && /^local-(phi|ptc|pz)-/.test(chart.codename),
    }));
    resultCount = results.length;
    resultSize = results.reduce((sum, r) => sum + jsonSize(r), 0);
    replayCount = replays.length;
    replaySize = replays.reduce((sum, r) => sum + jsonSize(r), 0);
    try {
      localStorageSize = new Blob(Object.values(localStorage)).size;
      localStorageKeys = localStorage.length;
    } catch {
      localStorageSize = 0;
    }
    loading = false;
  };

  onMount(() => {
    void refresh();
  });

  const removeChart = async (codename: string) => {
    busy = true;
    try {
      await deleteLocalChart(codename);
      await refresh();
    } finally {
      busy = false;
    }
  };

  const clearAllCharts = async () => {
    if (!(await confirmModal(`确定删除全部本地谱面（${charts.length} 个）？`))) return;
    busy = true;
    try {
      await clearLocalCharts();
      await refresh();
    } finally {
      busy = false;
    }
  };

  const clearAllResults = async () => {
    if (!(await confirmModal(`确定清除全部成绩（${resultCount} 条）？`))) return;
    await clearResults();
    await refresh();
  };

  const clearAllReplays = async () => {
    if (!(await confirmModal(`确定清除全部回放（${replayCount} 个）？`))) return;
    await clearReplays();
    await refresh();
  };

  const clearCache = async (name: string) => {
    await caches.delete(name);
    await refresh();
  };

  const clearAllCaches = async () => {
    if (!(await confirmModal('确定清除全部 PWA 缓存？'))) return;
    const names = await caches.keys();
    await Promise.all(names.map((name) => caches.delete(name)));
    await refresh();
  };

  const clearLocalStorage = async () => {
    if (!(await confirmModal(`确定清除全部首选项（${localStorageKeys} 项）？\n将同时重置昵称、界面缩放等设置。`))) return;
    localStorage.clear();
    await refresh();
  };

  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onclose?.();
    }
  };
</script>

<svelte:window onkeydown={onKeydown} />

<!-- 浮窗：与校准一致的定位与箭头，指向设置侧边栏 -->
<div class="file-popover {side}" transition:scale={{ duration: 180, start: 0.94 }}>
  <div class="popover-arrow {side}"></div>

  <header class="popover-head">
    <div class="popover-title">
      <span class="popover-label">STORAGE MANAGER</span>
      <strong>文件管理</strong>
    </div>
    <button class="popover-close" onclick={() => onclose?.()} aria-label="关闭文件管理"></button>
  </header>

  <div class="popover-body">
    {#if loading}
      <p class="empty">加载中…</p>
    {:else}
      <!-- 本地谱面 -->
      <section class="group">
        <div class="group-head">
          <h2 class="group-title">本地谱面（{charts.length}）</h2>
          {#if charts.length > 0}
            <button class="flat-btn danger" disabled={busy} onclick={clearAllCharts}>全部删除</button>
          {/if}
        </div>
        {#if charts.length === 0}
          <p class="empty">暂无本地谱面。上传谱面或在线选中曲目后会自动缓存到这里。</p>
        {:else}
          {#each charts as chart}
            <div class="row">
              <div class="row-text">
                <span class="row-name">{chart.name}</span>
                <span class="row-meta">
                  {chart.artist} · {bytesToMb(chart.size)} MB
                  {#if chart.cached}<em class="tag">在线缓存</em>{/if}
                </span>
              </div>
              <button class="flat-btn danger" disabled={busy} onclick={() => removeChart(chart.codename)}>删除</button>
            </div>
          {/each}
        {/if}
      </section>

      <!-- 游玩数据 -->
      <section class="group">
        <h2 class="group-title">游玩数据</h2>
        <div class="row">
          <div class="row-text">
            <span class="row-name">成绩记录</span>
            <span class="row-meta">{resultCount} 条 · {bytesToMb(resultSize)} MB</span>
          </div>
          <button class="flat-btn danger" disabled={resultCount === 0} onclick={clearAllResults}>清除</button>
        </div>
        <div class="row">
          <div class="row-text">
            <span class="row-name">回放</span>
            <span class="row-meta">{replayCount} 个 · {bytesToMb(replaySize)} MB</span>
          </div>
          <button class="flat-btn danger" disabled={replayCount === 0} onclick={clearAllReplays}>清除</button>
        </div>
      </section>

      <!-- PWA 缓存 -->
      <section class="group">
        <div class="group-head">
          <h2 class="group-title">PWA 缓存</h2>
          {#if cachesInfo.length > 0}
            <button class="flat-btn danger" onclick={clearAllCaches}>全部清除</button>
          {/if}
        </div>
        {#if cachesInfo.length === 0}
          <p class="empty">当前没有 PWA 缓存（开发模式下 Service Worker 未启用）。</p>
        {:else}
          {#each cachesInfo as cache}
            <div class="row">
              <div class="row-text">
                <span class="row-name">{cache.name}</span>
                <span class="row-meta">{cache.count} 项 · {bytesToMb(cache.size)} MB</span>
              </div>
              <button class="flat-btn danger" onclick={() => clearCache(cache.name)}>清除</button>
            </div>
          {/each}
        {/if}
      </section>

      <!-- 首选项 -->
      <section class="group">
        <h2 class="group-title">首选项</h2>
        <div class="row">
          <div class="row-text">
            <span class="row-name">localStorage</span>
            <span class="row-meta">{localStorageKeys} 项 · {(localStorageSize / 1024).toFixed(1)} KB</span>
          </div>
          <button class="flat-btn danger" disabled={localStorageKeys === 0} onclick={clearLocalStorage}>清除</button>
        </div>
      </section>
    {/if}
  </div>

  <footer class="popover-foot">
    <button class="flat-btn done-btn" onclick={() => onclose?.()}>关闭</button>
  </footer>
</div>

<style>
  .file-popover {
    position: fixed;
    top: 50%;
    z-index: 450;
    display: flex;
    flex-direction: column;
    width: min(560px, 62vw);
    max-height: 88vh;
    background: rgba(11, 11, 18, 0.97);
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 4px;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    box-shadow: 0 0 48px rgba(0, 0, 0, 0.65);
  }

  /* 侧边栏在右：浮窗中心左移半个侧边栏宽，箭头在右缘指向侧边栏 */
  .file-popover.right {
    left: calc(50% - var(--sidebar-w, 560px) / 2);
    transform: translate(-50%, -50%);
  }

  /* 侧边栏在左：浮窗中心右移半个侧边栏宽，箭头在左缘指向侧边栏 */
  .file-popover.left {
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
    padding: 16px 18px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
    flex-shrink: 0;
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

  .popover-body {
    flex: 1;
    overflow-y: auto;
    padding: 12px 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .popover-foot {
    flex-shrink: 0;
    padding: 12px 18px 16px;
    border-top: 1px solid rgba(255, 255, 255, 0.12);
  }

  .group {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 2px;
    padding: 6px 16px;
  }

  .group-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .group-title {
    margin: 10px 0 4px;
    font-size: 0.72rem;
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
    padding: 10px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .row:last-child {
    border-bottom: none;
  }

  .row-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .row-name {
    font-size: 0.9rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-meta {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.5);
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .tag {
    font-style: normal;
    font-size: 0.66rem;
    padding: 1px 6px;
    border: 1px solid rgba(255, 255, 255, 0.35);
    border-radius: 2px;
    color: rgba(255, 255, 255, 0.7);
  }

  .empty {
    margin: 10px 0;
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.4);
  }

  .flat-btn {
    background: transparent;
    border: 1.5px solid #fff;
    color: #fff;
    border-radius: 2px;
    padding: 6px 14px;
    font-weight: 700;
    font-size: 0.82rem;
    cursor: pointer;
    transition: background 0.2s, color 0.2s;
    flex-shrink: 0;
  }

  .flat-btn:hover:not(:disabled) {
    background: #fff;
    color: #0b0b12;
  }

  .flat-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .flat-btn.danger {
    border-color: rgba(255, 255, 255, 0.5);
    color: rgba(255, 255, 255, 0.75);
  }

  .flat-btn.danger:hover:not(:disabled) {
    background: #fff;
    color: #0b0b12;
  }

  .done-btn {
    width: 100%;
    padding: 11px;
    font-size: 0.95rem;
    letter-spacing: 0.2em;
    border-radius: 2px;
  }

  @media (max-width: 900px) {
    .file-popover {
      width: min(560px, 90vw);
    }

    .file-popover.right {
      left: calc(50% - 5vw);
    }

    .file-popover.left {
      left: calc(50% + 5vw);
    }
  }
</style>
