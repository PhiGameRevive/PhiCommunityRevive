/**
 * 游玩资源准备（选歌页 → 游玩页）。
 *
 * 设计目标：点击开始后，在选歌页的 LOADING 动画期间把谱面、曲绘、音频真正下载完毕，
 * 组装好完整的 Config（资源指向 blob URL），再跳转到游玩页。游玩页直接消费准备好的
 * Config，引擎读取的都是本地 blob，不再有网络等待。
 *
 * 这里刻意不引入 $lib/player/* 下的任何模块：那些模块会连带把 Phaser 打进选歌页的包里。
 * 谱面的解析/转换仍由引擎完成，本模块只负责把字节取到本地。
 */
import { DEFAULT_RESOURCE_PACK } from '$lib/player/constants';
import { getLocalChart, type LocalChart } from '$lib/db';
import {
  chartUrl,
  fetchMeta,
  getChartDesigner,
  getChartFile,
  getChartRanking,
  songUrl,
  type Level,
} from '$lib/meta';
import type { Config, PhiraExtra, Preferences } from '$lib/types';
import { clamp, inferLevelType } from '$lib/utils';

export type PlaySourceKind = 'phi' | 'ptc' | 'pz' | 'local';

export interface PlaySourceLevel {
  chart: string;
  rank?: number;
  charter?: string;
}

/** 选歌页的歌曲条目中，准备游玩所需的那部分信息。 */
export interface PlaySource {
  source: PlaySourceKind;
  codename: string;
  name: string;
  artist: string;
  illustrationUrl: string;
  songUrl: string;
  levels: Partial<Record<Level, PlaySourceLevel>>;
  backgroundAnimation?: string;
  songIsVideo?: boolean;
}

export interface PreparedPlay {
  config: Config;
  /** 释放本次准备过程中创建的所有 blob URL。 */
  release: () => void;
}

export interface PrepareOptions {
  /** 是否把谱面/曲绘/音频下载为 blob（选歌页预加载时为 true）。 */
  preloadResources?: boolean;
  onProgress?: (progress: number, detail: string) => void;
}

/* ---------------- 下载与进度 ---------------- */

interface ProgressTask {
  update: (loaded: number, total: number) => void;
  finish: () => void;
}

const createProgress = (onProgress?: PrepareOptions['onProgress']) => {
  const tasks: { loaded: number; total: number; done: boolean }[] = [];
  let detail = '';

  const emit = () => {
    if (!onProgress) return;
    const sized = tasks.filter((t) => t.total > 0);
    const totalBytes = sized.reduce((sum, t) => sum + t.total, 0);
    // 有 content-length 时按字节算；否则退化为「完成的任务数 / 总任务数」
    const progress = totalBytes
      ? sized.reduce((sum, t) => sum + t.loaded, 0) / totalBytes
      : tasks.length
        ? tasks.filter((t) => t.done).length / tasks.length
        : 0;
    onProgress(clamp(progress, 0, 1), detail);
  };

  return {
    setDetail(next: string) {
      detail = next;
      emit();
    },
    task(): ProgressTask {
      const task = { loaded: 0, total: 0, done: false };
      tasks.push(task);
      return {
        update(loaded, total) {
          task.loaded = loaded;
          task.total = total;
          emit();
        },
        finish() {
          task.done = true;
          // 无 content-length 的任务，完成时用实际字节数补齐，避免进度倒退
          if (task.total === 0) task.total = task.loaded;
          emit();
        },
      };
    },
    done() {
      tasks.forEach((t) => {
        t.done = true;
        if (t.total === 0) t.total = t.loaded;
      });
      emit();
    },
  };
};

/** 流式下载为 Blob，并向进度任务汇报字节数。 */
const downloadBlob = async (url: string, label: string, task?: ProgressTask): Promise<Blob> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${label}下载失败（HTTP ${res.status}）`);
  const contentType = res.headers.get('content-type') ?? '';
  const total = Number.parseInt(res.headers.get('content-length') ?? '') || 0;

  if (!res.body) {
    const blob = await res.blob();
    task?.update(blob.size, total || blob.size);
    task?.finish();
    return blob;
  }

  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value.slice().buffer as ArrayBuffer);
    loaded += value.length;
    task?.update(loaded, total);
  }
  task?.finish();
  return new Blob(chunks, contentType ? { type: contentType } : undefined);
};

/* ---------------- 附加资源探测（BGA / extra.json） ---------------- */

/**
 * 探测视频文件是否存在（Range 请求；严格校验 content-type 为 video/*，
 * 避免某些 CDN 对不存在的文件也返回 200 HTML 页面导致误判）。
 */
const probeVideo = async (url: string): Promise<boolean> => {
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    if (!res.ok && res.status !== 206) return false;
    return (res.headers.get('content-type') ?? '').includes('video');
  } catch {
    return false;
  }
};

/** 探测 JSON 文件（校验 content-type，排除通配 HTML 响应）。 */
const fetchJsonOk = async (url: string): Promise<boolean> => {
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    return (res.headers.get('content-type') ?? '').includes('json');
  } catch {
    return false;
  }
};

interface AssetBundle {
  assetNames: string[];
  assetTypes: number[];
  assets: string[];
}

/** 合成一个最小 extra.json，让引擎的 Phira 视频系统整曲播放单个背景视频。 */
const pushSyntheticBga = (
  bundle: AssetBundle,
  videoUrl: string,
  videoAlpha: number,
  track: (url: string) => string,
) => {
  // videos[].path 直接用完整 URL → Video.ts 流式加载（不预加载大文件）
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
  const blobUrl = track(
    URL.createObjectURL(new Blob([JSON.stringify(synthetic)], { type: 'application/json' })),
  );
  bundle.assetNames.push('extra.json');
  bundle.assetTypes.push(3);
  bundle.assets.push(blobUrl);
};

const localBlobUrl = (
  local: LocalChart,
  name: string | undefined,
  track: (url: string) => string,
): string | undefined => {
  if (!name) return undefined;
  const file = local.files.find((f) => f.name === name);
  return file ? track(URL.createObjectURL(file.blob)) : undefined;
};

/** 本地谱面的附加资源（extra.json 及其引用的视频文件）。 */
const buildLocalAssets = (
  local: LocalChart,
  useVideoBg: boolean,
  videoAlpha: number,
  track: (url: string) => string,
): AssetBundle => {
  const bundle: AssetBundle = { assetNames: [], assetTypes: [], assets: [] };

  if (local.extraJson) {
    const blobUrl = track(
      URL.createObjectURL(new Blob([local.extraJson], { type: 'application/json' })),
    );
    bundle.assetNames.push('extra.json');
    bundle.assetTypes.push(3);
    bundle.assets.push(blobUrl);

    if (useVideoBg) {
      try {
        const extra = JSON.parse(local.extraJson) as PhiraExtra;
        extra.videos?.forEach((v) => {
          const url = localBlobUrl(local, v.path, track);
          if (url && !bundle.assetNames.includes(v.path)) {
            bundle.assetNames.push(v.path);
            bundle.assetTypes.push(2);
            bundle.assets.push(url);
          }
        });
      } catch {
        /* 忽略解析失败 */
      }
    }
    return bundle;
  }

  // 带视频文件但没有 extra.json → 用第一个视频作为 BGA
  if (useVideoBg) {
    const video = local.files.find((f) => /\.(mp4|webm|mov)$/i.test(f.name));
    if (video) {
      pushSyntheticBga(bundle, track(URL.createObjectURL(video.blob)), videoAlpha, track);
    }
  }
  return bundle;
};

/** 在线谱面的附加资源探测。 */
const buildOnlineAssets = async (
  source: PlaySource,
  chartFileUrl: string,
  preferences: Preferences,
  track: (url: string) => string,
): Promise<AssetBundle> => {
  const bundle: AssetBundle = { assetNames: [], assetTypes: [], assets: [] };
  const useVideoBg = preferences.useVideoBackground;
  const videoAlpha = preferences.videoBackgroundAlpha;

  if (source.source === 'phi') {
    // phi 源：附加资源都在谱面目录下（codename 需去掉源前缀）
    const rawCodename = source.codename.replace(/^(phi|ptc|pz)-/, '');
    const extraUrl = chartUrl(rawCodename, 'extra.json');
    const hasRealExtra = await fetchJsonOk(extraUrl);
    if (hasRealExtra) {
      bundle.assetNames.push('extra.json');
      bundle.assetTypes.push(3);
      bundle.assets.push(extraUrl);
    }
    // 老谱面仓库的 backgroundAnimation 字段（单个背景视频），不覆盖谱面自带的 extra.json
    if (useVideoBg && source.backgroundAnimation && !hasRealExtra) {
      pushSyntheticBga(
        bundle,
        chartUrl(rawCodename, source.backgroundAnimation),
        videoAlpha,
        track,
      );
    }
    return bundle;
  }

  // ptc / pz 源：以谱面文件所在目录为基准探测
  if (source.songIsVideo && useVideoBg) {
    // song 本身就是视频（bga.mp4 当音乐）→ 同时作为背景视频（流式，不预加载）
    pushSyntheticBga(bundle, source.songUrl, videoAlpha, track);
  }

  const baseDir = chartFileUrl.slice(0, chartFileUrl.lastIndexOf('/') + 1);
  const extraUrl = baseDir + 'extra.json';
  const hasRealExtra = await fetchJsonOk(extraUrl);
  if (hasRealExtra && !bundle.assetNames.includes('extra.json')) {
    bundle.assetNames.push('extra.json');
    bundle.assetTypes.push(3);
    bundle.assets.push(extraUrl);
  }

  // 没有 extra.json 时探测常见 BGA 文件名（probeVideo 严格校验 video/*，不会误判 HTML 响应）
  if (!hasRealExtra && !source.songIsVideo && useVideoBg) {
    const songId = source.codename.replace(/^(phi|ptc|pz)-/, '');
    for (const name of ['bg.mp4', `${songId}.mp4`]) {
      const videoUrl = baseDir + name;
      if (await probeVideo(videoUrl)) {
        pushSyntheticBga(bundle, videoUrl, videoAlpha, track);
        break;
      }
    }
  }

  return bundle;
};

/* ---------------- Config 组装 ---------------- */

const makeConfig = (params: {
  title: string;
  composer: string;
  charter: string;
  illustrator: string | null;
  level: Level;
  levelRanking: number;
  resources: Config['resources'];
  preferences: Preferences;
  songIsVideo: boolean;
}): Config => ({
  resources: params.resources,
  metadata: {
    title: params.title,
    composer: params.composer,
    charter: params.charter,
    illustrator: params.illustrator,
    levelType: inferLevelType(params.level.toUpperCase()),
    level: `${params.level.toUpperCase()} Lv.${params.levelRanking}`,
    difficulty: params.levelRanking,
  },
  preferences: params.preferences,
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
  songIsVideo: params.songIsVideo,
});

/**
 * 准备一次游玩：探测附加资源、（可选）下载谱面/曲绘/音频，返回可直接交给引擎的 Config。
 * 失败时会自行释放已创建的 blob URL 后抛出。
 */
export const preparePlay = async (
  source: PlaySource,
  level: Level,
  preferences: Preferences,
  options: PrepareOptions = {},
): Promise<PreparedPlay> => {
  const created: string[] = [];
  const track = (url: string) => {
    created.push(url);
    return url;
  };
  const release = () => {
    created.forEach((url) => URL.revokeObjectURL(url));
    created.length = 0;
  };
  const progress = createProgress(options.onProgress);

  try {
    if (source.source === 'local') {
      progress.setDetail('读取本地谱面');
      const local = await getLocalChart(source.codename);
      if (!local) throw new Error('本地谱面不存在或已删除');
      const chartFile = local.chartFiles[level];
      if (!chartFile) throw new Error(`该曲目没有 ${level.toUpperCase()} 难度谱面`);
      const song = localBlobUrl(local, local.musicFile, track);
      const chart = localBlobUrl(local, chartFile, track);
      const illustration = localBlobUrl(local, local.illustration, track);
      if (!song || !chart) throw new Error('本地谱面文件不完整（缺少音乐或谱面）');

      const bundle = buildLocalAssets(
        local,
        preferences.useVideoBackground,
        preferences.videoBackgroundAlpha,
        track,
      );
      progress.done();
      return {
        config: makeConfig({
          title: local.name,
          composer: local.artist,
          charter: 'Local',
          illustrator: null,
          level,
          levelRanking: 0,
          resources: { song, chart, illustration: illustration ?? '/banner.png', ...bundle },
          preferences,
          songIsVideo: false,
        }),
        release,
      };
    }

    const lv = source.levels[level];
    if (!lv?.chart) throw new Error(`该曲目没有 ${level.toUpperCase()} 难度谱面`);

    progress.setDetail('检查附加资源');
    const bundle = await buildOnlineAssets(source, lv.chart, preferences, track);

    let chart = lv.chart;
    let illustration = source.illustrationUrl;
    let song = source.songUrl;

    if (options.preloadResources) {
      progress.setDetail('下载谱面资源');
      const chartTask = progress.task();
      const illustrationTask = progress.task();
      // 视频音乐（大文件）不预加载，交由引擎流式播放
      const songTask = source.songIsVideo ? undefined : progress.task();

      const [chartBlob, illustrationBlob, songBlob] = await Promise.all([
        downloadBlob(chart, '谱面', chartTask),
        downloadBlob(illustration, '曲绘', illustrationTask),
        songTask ? downloadBlob(song, '音乐', songTask) : Promise.resolve(null),
      ]);

      // 部分 CDN 对不存在的文件返回 200 + HTML 页面，这里提前拦住，避免进游玩页才报错
      if (chartBlob.type.includes('html') || chartBlob.size === 0) {
        throw new Error('谱面文件无效（服务器返回的不是谱面内容）');
      }

      chart = track(URL.createObjectURL(chartBlob));
      illustration = track(URL.createObjectURL(illustrationBlob));
      if (songBlob) song = track(URL.createObjectURL(songBlob));
    }

    progress.done();
    return {
      config: makeConfig({
        title: source.name,
        composer: source.artist,
        charter: lv.charter ?? 'Unknown',
        illustrator: null,
        level,
        levelRanking: lv.rank ?? 0,
        resources: { song, chart, illustration, ...bundle },
        preferences,
        songIsVideo: source.songIsVideo === true,
      }),
      release,
    };
  } catch (e) {
    release();
    throw e;
  }
};

/**
 * 直接进入 /play/... （刷新、书签、外链）时重建 PlaySource：
 * 本地谱面读 IndexedDB，在线谱面优先用选歌页写入的 sessionStorage，最后回落到 meta.json。
 */
export const resolvePlaySource = async (codename: string, level: Level): Promise<PlaySource> => {
  const cached = sessionStorage.getItem('currentSong');
  if (cached) {
    try {
      const item = JSON.parse(cached) as PlaySource;
      if (item?.codename === codename && item.levels?.[level]?.chart) return item;
    } catch {
      /* 缓存异常则走常规加载 */
    }
  }

  // 仅 phi 源可以只靠 codename 从 meta.json 还原
  const rawCodename = codename.replace(/^(phi|ptc|pz)-/, '');
  const meta = await fetchMeta(rawCodename);
  const chartFile = getChartFile(meta, level);
  if (!chartFile) throw new Error(`该曲目没有 ${level.toUpperCase()} 难度谱面`);

  return {
    source: 'phi',
    codename,
    name: meta.name,
    artist: meta.artist,
    illustrationUrl: chartUrl(meta.codename, meta.illustration),
    songUrl: songUrl(meta.codename, meta.musicFile),
    levels: {
      [level]: {
        chart: chartUrl(meta.codename, chartFile),
        rank: getChartRanking(meta, level),
        charter: getChartDesigner(meta, level),
      },
    },
    backgroundAnimation: meta.backgroundAnimation,
    songIsVideo: /\.(mp4|webm|mov|m4v)$/i.test(meta.musicFile ?? ''),
  };
};

/* ---------------- 选歌页 → 游玩页的移交 ---------------- */

let pending: { codename: string; level: Level; prepared: PreparedPlay } | null = null;

/** 选歌页预加载完成后寄存结果；同一 SPA 会话内由游玩页取走。 */
export const setPendingPlay = (codename: string, level: Level, prepared: PreparedPlay): void => {
  pending?.prepared.release();
  pending = { codename, level, prepared };
};

/** 游玩页取走预加载结果；codename / 难度不匹配的旧数据会被丢弃并释放。 */
export const takePendingPlay = (codename: string, level: Level): PreparedPlay | null => {
  if (!pending) return null;
  const current = pending;
  pending = null;
  if (current.codename === codename && current.level === level) return current.prepared;
  current.prepared.release();
  return null;
};

/** 放弃寄存的预加载结果（例如预加载后未能跳转）。 */
export const discardPendingPlay = (): void => {
  pending?.prepared.release();
  pending = null;
};
