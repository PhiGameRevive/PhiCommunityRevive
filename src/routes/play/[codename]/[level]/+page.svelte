<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { writable } from 'svelte/store';
  import { page } from '$app/state';
  import Player from '$lib/player/Player.svelte';
  import PhigrosLoading from '$lib/components/PhigrosLoading.svelte';
  import { randomTip } from '$lib/loadingTips';
  import type { Config } from '$lib/types';
  import { fetchMeta, type ChartMeta, type Level } from '$lib/meta';
  import { loadPreferences } from '$lib/preferences';
  import { recordPlayResult } from '$lib/record';
  import {
    preparePlay,
    resolvePlaySource,
    takePendingPlay,
    type PlaySource,
    type PreparedPlay,
  } from '$lib/playLoader';
  import { parseSongId } from '$lib/sources';
  import { getLocalChart, LOCAL_PREFIX } from '$lib/db';
  import { saveReplay } from '$lib/db';
  import { createReplay } from '$lib/replay';
  import { EventBus } from '$lib/player/EventBus';
  import { loadMods, isRecordable, type ModId } from '$lib/mods';

  const codename = page.params.codename ?? '';
  const level = (page.params.level ?? 'ez') as Level;
  const isLocal = codename.startsWith(LOCAL_PREFIX);
  /** 本次游玩启用的模组（选歌页写入 localStorage，游玩页与结算共用同一份） */
  const mods: ModId[] = loadMods();
  let replayEvents: import('$lib/types').ReplayInputEvent[] = [];
  let replayRecording = false;

  let config: Config | null = null;
  let error = '';
  let prepared: PreparedPlay | null = null;
  let loadingProgress = 0;
  let loadingDetail = '准备谱面资源';
  let loadingCover = '/ui/ElementSqare.webp';
  let loadingTip = '';

  const resultStore = writable({
    isNewBest: false,
    rankingScore: 0,
    accuracy: 0,
    scoreMultiplier: 1,
    recorded: true,
    mods,
  });

  let gameRef: {
    game: import('phaser').Game | null;
    scene: import('$lib/player/scenes/Game').Game | null;
  } = { game: null, scene: null };

  onMount(async () => {
    const onReplayInput = (event: import('$lib/types').ReplayInputEvent) => {
      if (!replayRecording) return;
      replayEvents.push(event);
    };
    EventBus.on('replay-input', onReplayInput);
    try {
      let replay: import('$lib/types').ReplayFile | undefined;
      const replayRaw = sessionStorage.getItem('pendingReplay');
      if (replayRaw) {
        try {
          const parsed = JSON.parse(replayRaw) as import('$lib/types').ReplayFile;
          if (parsed.format === 'PhiCommunityReplay' && parsed.source.codename === codename && parsed.level === level) {
            replay = parsed;
            sessionStorage.removeItem('pendingReplay');
          }
        } catch {
          sessionStorage.removeItem('pendingReplay');
        }
      }
      // 选歌页已完成预加载：直接取走准备好的 Config（资源都是本地 blob）
      prepared = replay ? null : takePendingPlay(codename, level);
      if (!prepared) {
        // 直接进入本页（刷新 / 书签 / 外链）：在此补做一次加载
        const source = replay ? (replay.source as PlaySource) : await resolvePlaySource(codename, level);
        if (replay && source.source === 'local' && !(await getLocalChart(source.codename))) {
          throw new Error('该回放需要原本地谱面，但原谱面已不存在，请先重新导入原谱面');
        }
        loadingCover = source.illustrationUrl || loadingCover;
        loadingDetail = '下载谱面资源';
        prepared = await preparePlay(source, level, loadPreferences(), {
          preloadResources: source.source !== 'local',
          mods: replay ? (replay.mods as ModId[]) : mods,
          replay,
          onProgress: (progress, detail) => {
            loadingProgress = progress;
            loadingDetail = detail;
          },
        });
      }
      config = prepared.config;
      replayEvents = [];
      replayRecording = !config.replay;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    EventBus.on('finished', handleFinished);
  });

  loadingTip = randomTip();

  onDestroy(() => {
    EventBus.off('finished', handleFinished);
    EventBus.off('replay-input');
    // 延后释放 blob URL：Svelte 父组件的 onDestroy 先于子组件，
    // 立即 revoke 会让仍在销毁中的 Phaser / 音频元素读到已失效的 URL。
    const toRelease = prepared;
    prepared = null;
    if (toRelease) setTimeout(() => toRelease.release(), 1000);
  });

  const handleFinished = () => {
    const scene = gameRef.scene;
    if (!scene) return;
    const stats = scene.statistics.stats;
    // AT / PR / 0 倍率模组不进入游玩记录；回放查看也不生成新回放。
    if (config && !config.replay && isRecordable(mods)) {
      const raw = sessionStorage.getItem('currentSong');
      if (raw) {
        try {
          const source = JSON.parse(raw) as import('$lib/types').ReplaySourceSnapshot;
          void saveReplay(createReplay({
            source,
            level,
            mods,
            duration: scene.song.duration,
            events: replayEvents,
            result: {
              score: stats.score,
              accuracy: stats.accuracy,
              maxCombo: stats.maxCombo,
              perfect: stats.perfect,
              goodEarly: stats.goodEarly,
              goodLate: stats.goodLate,
              bad: stats.bad,
              miss: stats.miss,
            },
          }));
        } catch {
          /* 回放保存失败不影响结算 */
        }
      }
    }
    // 回放查看只展示结果，不产生新的成绩或 NEW BEST
    if (config?.replay || !isRecordable(mods)) return;
    resultStore.update((r) => ({ ...r, accuracy: stats.accuracy }));
    // AT（自动游玩）等倍率为 0 的模组不记录成绩；判断交给 recordPlayResult 内部统一处理
    if (!isRecordable(mods)) {
      resultStore.update((r) => ({
        ...r,
        isNewBest: false,
        rankingScore: 0,
        accuracy: stats.accuracy,
        scoreMultiplier: 0,
        recorded: false,
      }));
      return;
    }
    // 在线谱面的歌曲数据：优先取选歌页写入 sessionStorage 的条目（含定数），
    // 避免用带源前缀的 codename（phi-xxx / ptc-xxx / pz-xxx）去请求不存在的 meta.json
    const readCachedSong = (): PlaySource | null => {
      try {
        const raw = sessionStorage.getItem('currentSong');
        if (!raw) return null;
        const item = JSON.parse(raw) as PlaySource;
        return item?.codename === codename ? item : null;
      } catch {
        return null;
      }
    };

    // 本地谱面成绩记录（定数为 0，RKS 不产生）
    const recordMeta = async (): Promise<ChartMeta> => {
      if (isLocal) {
        const local = await getLocalChart(codename);
        return {
          codename,
          name: local?.name ?? codename,
          artist: local?.artist ?? 'Unknown',
          illustration: local?.illustration ?? '',
          musicFile: local?.musicFile ?? '',
          chartDesigner: 'Local',
        };
      }
      // 外链/刷新直接进入 phi 谱面且无缓存：meta.json 在原始 codename 下
      const rawId = codename.replace(/^(phi|ptc|pz)-/, '');
      const cached = readCachedSong();
      if (!cached && parseSongId(codename)?.source === 'phi') {
        const meta = await fetchMeta(rawId);
        return { ...meta, codename };
      }
      const meta: ChartMeta = {
        codename,
        name: cached?.name ?? codename,
        artist: cached?.artist ?? 'Unknown',
        illustration: cached?.illustrationUrl ?? '',
        musicFile: cached?.songUrl ?? '',
        chartDesigner: cached?.levels?.[level]?.charter ?? 'Unknown',
      };
      // 定数（RKS 计算用）；sp 槽位无定数概念
      const rank = cached?.levels?.[level]?.rank;
      if (rank != null && level !== 'sp') {
        (meta as unknown as Record<string, unknown>)[`${level}Ranking`] = rank;
      }
      return meta;
    };
    recordMeta()
      .then(async (meta) => {
        const outcome = await recordPlayResult(meta, level, stats.score, stats.accuracy, mods);
        resultStore.update((r) => ({
          ...r,
          isNewBest: outcome.isNewBest,
          rankingScore: outcome.rankingScore,
          accuracy: stats.accuracy,
          scoreMultiplier: outcome.scoreMultiplier,
          recorded: outcome.recorded,
        }));
      })
      .catch((e) => console.error('Failed to record result', e));
  };
</script>

<svelte:head>
  <title>{config?.metadata.title ?? '游玩'} - PhiCommunity</title>
</svelte:head>

{#if error}
  <div class="phi-page">
    <h1 class="phi-title">加载失败</h1>
    <p class="phi-hint">{error}</p>
    <button onclick={() => (location.href = '/songs')}>返回选歌</button>
  </div>
{:else if config}
  <div class="player-wrap">
    <Player bind:gameRef {config} {...$resultStore} />
  </div>
{:else}
  <PhigrosLoading cover={loadingCover} tip={`${loadingTip}${loadingDetail ? ` · ${loadingDetail}` : ''}`} progress={loadingProgress} />
{/if}

<style>
  .player-wrap {
    width: 100%;
    height: 100vh;
    overflow: hidden;
  }
</style>
