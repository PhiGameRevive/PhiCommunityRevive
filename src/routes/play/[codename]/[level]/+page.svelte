<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { writable } from 'svelte/store';
  import { page } from '$app/state';
  import Player from '$lib/player/Player.svelte';
  import type { Config } from '$lib/types';
  import { fetchMeta, type ChartMeta, type Level } from '$lib/meta';
  import { loadPreferences } from '$lib/preferences';
  import { recordPlayResult } from '$lib/record';
  import { EventBus } from '$lib/player/EventBus';
  import {
    preparePlay,
    resolvePlaySource,
    takePendingPlay,
    type PreparedPlay,
  } from '$lib/playLoader';
  import { getLocalChart, LOCAL_PREFIX } from '$lib/db';

  const codename = page.params.codename ?? '';
  const level = (page.params.level ?? 'ez') as Level;
  const isLocal = codename.startsWith(LOCAL_PREFIX);

  let config: Config | null = null;
  let error = '';
  let prepared: PreparedPlay | null = null;

  const resultStore = writable({ isNewBest: false, rankingScore: 0, accuracy: 0 });

  let gameRef: {
    game: import('phaser').Game | null;
    scene: import('$lib/player/scenes/Game').Game | null;
  } = { game: null, scene: null };

  onMount(async () => {
    try {
      // 选歌页已完成预加载：直接取走准备好的 Config（资源都是本地 blob）
      prepared = takePendingPlay(codename, level);
      if (!prepared) {
        // 直接进入本页（刷新 / 书签 / 外链）：在此补做一次加载
        const source = await resolvePlaySource(codename, level);
        prepared = await preparePlay(source, level, loadPreferences(), {
          preloadResources: source.source !== 'local',
        });
      }
      config = prepared.config;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    EventBus.on('finished', handleFinished);
  });

  onDestroy(() => {
    EventBus.off('finished', handleFinished);
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
    resultStore.update((r) => ({ ...r, accuracy: stats.accuracy }));
    // autoplay 成绩不记录
    const autoplay = localStorage.getItem('autoplay') === 'true';
    if (autoplay) {
      resultStore.update(() => ({
        isNewBest: false,
        rankingScore: 0,
        accuracy: stats.accuracy,
      }));
      return;
    }
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
      return fetchMeta(codename);
    };
    recordMeta()
      .then(async (meta) => {
        const outcome = await recordPlayResult(meta, level, stats.score, stats.accuracy);
        resultStore.update(() => ({
          isNewBest: outcome.isNewBest,
          rankingScore: outcome.rankingScore,
          accuracy: stats.accuracy,
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
  <div class="phi-page">
    <p class="phi-hint">正在加载…</p>
  </div>
{/if}

<style>
  .player-wrap {
    width: 100%;
    height: 100vh;
    overflow: hidden;
  }
</style>