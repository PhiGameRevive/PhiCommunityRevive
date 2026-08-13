<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { writable } from 'svelte/store';
  import { page } from '$app/state';
  import Player from '$lib/player/Player.svelte';
  import type { Config } from '$lib/types';
  import { DEFAULT_RESOURCE_PACK } from '$lib/player/constants';
  import {
    chartUrl,
    songUrl,
    fetchMeta,
    getChartDesigner,
    getChartFile,
    getChartRanking,
    type ChartMeta,
    type Level,
  } from '$lib/meta';
  import { loadPreferences } from '$lib/preferences';
  import { recordPlayResult } from '$lib/record';
  import { EventBus } from '$lib/player/EventBus';
  import { inferLevelType } from '$lib/utils';
  import type { PhiraExtra } from '$lib/types';
  import {
    getLocalChart,
    LOCAL_PREFIX,
    type LocalChart,
  } from '$lib/db';

  const codename = page.params.codename ?? '';
  const level = (page.params.level ?? 'ez') as Level;
  const isLocal = codename.startsWith(LOCAL_PREFIX);

  let config: Config | null = null;
  let error = '';

  const resultStore = writable({ isNewBest: false, rankingScore: 0, accuracy: 0 });

  let gameRef: {
    game: import('phaser').Game | null;
    scene: import('$lib/player/scenes/Game').Game | null;
  } = { game: null, scene: null };

  // 本地谱面：从文件列表取 blob URL
  const localBlobUrl = (local: LocalChart, name?: string): string | undefined => {
    if (!name) return undefined;
    const file = local.files.find((f) => f.name === name);
    return file ? URL.createObjectURL(file.blob) : undefined;
  };

  // 探测视频文件是否存在（Range 请求；严格校验 content-type 为 video/*，
  // 避免某些 CDN 对不存在的文件也返回 200 HTML 页面导致误判）
  const probeVideo = async (url: string): Promise<boolean> => {
    try {
      const res = await fetch(url, { headers: { Range: 'bytes=0-0' } });
      if (!res.ok && res.status !== 206) return false;
      const type = res.headers.get('content-type') ?? '';
      return type.includes('video');
    } catch {
      return false;
    }
  };

  // 探测 JSON 文件（校验 content-type，排除通配 HTML 响应）
  const fetchJsonOk = async (url: string): Promise<boolean> => {
    try {
      const res = await fetch(url);
      if (!res.ok) return false;
      const type = res.headers.get('content-type') ?? '';
      return type.includes('json');
    } catch {
      return false;
    }
  };

  // 合成一个最小 extra.json，让引擎的 Phira 视频系统整曲播放单个背景视频
  const pushSyntheticBga = (
    assetNames: string[],
    assetTypes: number[],
    assets: string[],
    videoUrl: string,
    alpha?: number,
  ) => {
    // 合成 extra.json 的 videos[].path 直接用完整 URL → Video.ts 流式加载（无需 Phaser load.video 预加载大文件）
    const videoAlpha = alpha ?? loadPreferences().videoBackgroundAlpha;
    const synthetic: PhiraExtra = {
      videos: [
        {
          path: videoUrl,
          time: [0, 0, 0],
          startTimeSec: 0,
          endTimeSec: 0,
          scale: 'cropCenter',
          alpha: videoAlpha,
          dim: 0.25 * videoAlpha,
          zIndex: 1,
        },
      ],
    };
    const blobUrl = URL.createObjectURL(
      new Blob([JSON.stringify(synthetic)], { type: 'application/json' }),
    );
    assetNames.push('extra.json');
    assetTypes.push(3);
    assets.push(blobUrl);
  };

  // 组装资产列表：曲绘/谱面外的附加资源（BGA 视频、extra.json、shader 等）
  const buildAssets = async (meta: ChartMeta, local?: LocalChart, useVideoBg = true) => {
    const assetNames: string[] = [];
    const assetTypes: number[] = [];
    const assets: string[] = [];

    if (local) {
      // 本地谱面：extra.json 直接内嵌
      if (local.extraJson) {
        const blobUrl = URL.createObjectURL(
          new Blob([local.extraJson], { type: 'application/json' }),
        );
        assetNames.push('extra.json');
        assetTypes.push(3);
        assets.push(blobUrl);
      }
      // 本地谱面的视频资源（extra.json 里 videos 引用的文件）——仅当开启视频背景
      if (local.extraJson && useVideoBg) {
        try {
          const extra = JSON.parse(local.extraJson) as PhiraExtra;
          extra.videos?.forEach((v) => {
            const url = localBlobUrl(local, v.path);
            if (url && !assetNames.includes(v.path)) {
              assetNames.push(v.path);
              assetTypes.push(2);
              assets.push(url);
            }
          });
        } catch {
          /* 忽略解析失败 */
        }
      }
      // 本地谱面带视频文件但没有 extra.json → 用第一个视频作为 BGA（直接 blob URL 流式播放）
      if (useVideoBg && !local.extraJson) {
        const video = local.files.find((f) => /\.(mp4|webm|mov)$/i.test(f.name));
        if (video) {
          const url = URL.createObjectURL(video.blob);
          pushSyntheticBga(assetNames, assetTypes, assets, url);
        }
      }
      return { assetNames, assetTypes, assets };
    }

    // 1) 尝试探测谱面目录的 extra.json（Phira 故事板：videos/effects）
    // 注意：meta.codename 可能带源前缀（phi-/ptc-），chartUrl 需要原始 codename
    const rawCodename = meta.codename.replace(/^(phi|ptc|pz)-/, '');
    let hasRealExtra = false;
    const extraUrl = chartUrl(rawCodename, 'extra.json');
    if (await fetchJsonOk(extraUrl)) {
      hasRealExtra = true;
      assetNames.push('extra.json');
      assetTypes.push(3);
      assets.push(extraUrl);
    }

    // 2) 老谱面仓库的 backgroundAnimation 字段（单个背景视频）——仅当开启"以视频作为背景"，且谱面没有自带 extra.json（避免覆盖）
    if (useVideoBg && meta.backgroundAnimation && !hasRealExtra) {
      const videoUrl = chartUrl(rawCodename, meta.backgroundAnimation);
      // 直接以完整 URL 流式播放，不预加载大文件
      pushSyntheticBga(assetNames, assetTypes, assets, videoUrl);
    }

    return { assetNames, assetTypes, assets };
  };

  // 组装 Config（在线 / 本地共用）
  const makeConfig = (
    meta: ChartMeta,
    resources: Config['resources'],
    preferences: Config['preferences'],
    levelRanking: number,
    charter: string,
    songIsVideo = false,
  ): Config => ({
    resources,
    metadata: {
      title: meta.name,
      composer: meta.artist,
      charter,
      illustrator: meta.illustrator ?? null,
      levelType: inferLevelType(level.toUpperCase()),
      level: `${level.toUpperCase()} Lv.${levelRanking}`,
      difficulty: levelRanking,
    },
    preferences,
    mediaOptions: {
      frameRate: 60,
      overrideResolution: null,
      resultsLoopsToRender: 1,
      videoCodec: 'h264',
      videoBitrate: 16_000_000,
      audioBitrate: 320_000,
      vsync: false,
    },
    resourcePack: DEFAULT_RESOURCE_PACK,
    autoplay: localStorage.getItem('autoplay') === 'true',
    practice: false,
    adjustOffset: false,
    render: false,
    autostart: true,
    newTab: false,
    inApp: 0,
    automate: false,
    songIsVideo,
  });

  onMount(async () => {
    try {
      const preferences = loadPreferences();

      if (isLocal) {
        const local = await getLocalChart(codename);
        if (!local) throw new Error('本地谱面不存在或已删除');
        const chartFile = local.chartFiles[level];
        if (!chartFile) throw new Error(`该曲目没有 ${level.toUpperCase()} 难度谱面`);
        const song = localBlobUrl(local, local.musicFile);
        const chart = localBlobUrl(local, chartFile);
        const illustration = localBlobUrl(local, local.illustration);
        if (!song || !chart) throw new Error('本地谱面文件不完整（缺少音乐或谱面）');
        const { assetNames, assetTypes, assets } = await buildAssets({ codename } as ChartMeta, local, preferences.useVideoBackground);
        config = makeConfig(
          {
            codename,
            name: local.name,
            artist: local.artist,
            illustration: local.illustration ?? '',
            musicFile: local.musicFile ?? '',
            chartDesigner: 'Local',
          },
          {
            song,
            chart,
            illustration: illustration ?? '/banner.png',
            assetNames,
            assetTypes,
            assets,
          },
          preferences,
          0,
          'Local',
          false,
        );
      } else {
        // 在线谱面：优先使用选歌页预加载时存入 sessionStorage 的数据
        const cached = sessionStorage.getItem('currentSong');
        if (cached) {
          try {
            const item = JSON.parse(cached) as {
              codename: string;
              name: string;
              artist: string;
              illustrationUrl: string;
              songUrl: string;
              levels: Record<string, { chart: string; rank?: number; charter?: string }>;
              backgroundAnimation?: string;
              songIsVideo?: boolean;
            };
            if (item.codename === codename) {
              const lv = item.levels[level];
              if (!lv?.chart) throw new Error(`该曲目没有 ${level.toUpperCase()} 难度谱面`);
              let assetNames: string[] = [];
              let assetTypes: number[] = [];
              let assets: string[] = [];
              if (item.codename.startsWith('phi-')) {
                // phi 源：backgroundAnimation 背景视频（song 本身是视频时也作为背景）
                const metaLike = {
                  codename,
                  name: item.name,
                  artist: item.artist,
                  illustration: '',
                  musicFile: '',
                  backgroundAnimation: item.backgroundAnimation,
                } as unknown as ChartMeta;
                ({ assetNames, assetTypes, assets } = await buildAssets(metaLike, undefined, preferences.useVideoBackground));
              } else {
                // ptc 源：song 本身是视频（bga.mp4 当音乐）→ 同时作为背景视频（流式，不预加载）
                if (item.songIsVideo && preferences.useVideoBackground) {
                  pushSyntheticBga(assetNames, assetTypes, assets, item.songUrl);
                }
                // 探测 chart 同目录的 extra.json（BGA / 特效；严格校验 JSON content-type）
                const baseDir = lv.chart.slice(0, lv.chart.lastIndexOf('/')) + '/';
                let hasRealExtra = false;
                const extraUrl = baseDir + 'extra.json';
                if (await fetchJsonOk(extraUrl)) {
                  hasRealExtra = true;
                  if (!assetNames.includes('extra.json')) {
                    assetNames.push('extra.json');
                    assetTypes.push(3);
                    assets.push(extraUrl);
                  }
                }
                // 没有 extra.json 时，探测常见 BGA 视频文件名（ptc.focalors.ltd / realtvop 等所有 ptc 源）。
                // probeVideo 严格校验 video/* content-type，不会误判通配 HTML 响应。
                if (!hasRealExtra && !item.songIsVideo && preferences.useVideoBackground) {
                  const songId = item.codename.replace(/^ptc-/, '');
                  for (const name of ['bg.mp4', `${songId}.mp4`]) {
                    const videoUrl = baseDir + name;
                    if (await probeVideo(videoUrl)) {
                      pushSyntheticBga(assetNames, assetTypes, assets, videoUrl);
                      break;
                    }
                  }
                }
              }
              config = makeConfig(
                {
                  codename,
                  name: item.name,
                  artist: item.artist,
                  illustration: '',
                  musicFile: '',
                  chartDesigner: lv.charter ?? 'Unknown',
                },
                {
                  song: item.songUrl,
                  chart: lv.chart,
                  illustration: item.illustrationUrl,
                  assetNames,
                  assetTypes,
                  assets,
                },
                preferences,
                lv.rank ?? 0,
                lv.charter ?? 'Unknown',
                item.songIsVideo === true,
              );
              sessionStorage.removeItem('currentSong');
            }
          } catch {
            /* 缓存数据异常则走常规加载 */
          }
        }
        if (!config) {
          // 常规加载：meta.codename 去源前缀（仅 phi 源走此路径）
          const rawCodename = codename.replace(/^(phi|ptc|pz)-/, '');
          const meta = await fetchMeta(rawCodename);
          const chartFile = getChartFile(meta, level);
          if (!chartFile) {
            throw new Error(`该曲目没有 ${level.toUpperCase()} 难度谱面`);
          }
          const levelRanking = getChartRanking(meta, level);
          const { assetNames, assetTypes, assets } = await buildAssets(meta, undefined, preferences.useVideoBackground);
          config = makeConfig(
            meta,
            {
              song: songUrl(meta.codename, meta.musicFile),
              chart: chartUrl(meta.codename, chartFile),
              illustration: chartUrl(meta.codename, meta.illustration),
              assetNames,
              assetTypes,
              assets,
            },
            preferences,
            levelRanking,
            getChartDesigner(meta, level),
            /\.(mp4|webm|mov|m4v)$/i.test(meta.musicFile ?? ''),
          );
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    EventBus.on('finished', handleFinished);
  });

  onDestroy(() => {
    EventBus.off('finished', handleFinished);
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