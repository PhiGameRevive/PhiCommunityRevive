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
import {
  isChartArchive,
  isFont,
  isImage,
  isShader,
  isVideo,
  parseArchiveDifficulty,
  resolveChartArchive,
  unzipArchive,
  type ResolvedArchive,
} from '$lib/chartArchive';
import { fetchPzChartAssets } from '$lib/phizone';
import { fetchSongs, type ChartSourceId } from '$lib/sources';
import {
  applyModsToPreferences,
  isAutoplay,
  isBlackout,
  isHidden,
  isLowLife,
  isNoFail,
  isNoLines,
  isPerfect,
  isPractice,
  isResurrect,
  isSudden,
  isSuddenDeath,
  loadMods,
  type ModId,
} from '$lib/mods';
import type { Config, PhiraExtra, Preferences } from '$lib/types';
import { clamp, inferLevelType } from '$lib/utils';

export type PlaySourceKind = 'phi' | 'ptc' | 'pz' | 'local';

export interface PlaySourceLevel {
  chart: string;
  rank?: number;
  charter?: string;
  /** 原始难度名（PhiTogether 的自定义难度，如 "Color"） */
  levelName?: string;
}

/** 选歌页的歌曲条目中，准备游玩所需的那部分信息。 */
export interface PlaySource {
  source: PlaySourceKind;
  codename: string;
  /** PhiZone 源：具体谱面（chart）的 id，用于拉取附加资源 */
  chartId?: string;
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
  /** 取消当前资源准备，供选歌页的取消按钮使用。 */
  signal?: AbortSignal;
  /** 本次游玩启用的模组；不传时读取已保存的选择。 */
  mods?: ModId[];
  /** 回放查看时注入的回放文件 */
  replay?: import('$lib/types').ReplayFile;
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
const downloadBlob = async (
  url: string,
  label: string,
  task?: ProgressTask,
  signal?: AbortSignal,
): Promise<Blob> => {
  const res = await fetch(url, { signal });
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

/** 本地谱面的附加资源：遍历包内全部文件，把谱面/音乐/曲绘之外的故事板素材
 *  （判定线贴图、立绘、shader、字体、视频、extra.json、line.csv）按类型交给引擎。
 *  谱面 JSON 的 judgeLine.Texture / note.hitsound、extra.json 的 videos 与 shader
 *  均按文件名引用这些资源，缺一个就会静默回退默认贴图或跳过特效（故事板不显示）。
 *  与在线谱面包的 buildArchiveResources 对齐。 */
const buildLocalAssets = (
  local: LocalChart,
  useVideoBg: boolean,
  videoAlpha: number,
  track: (url: string) => string,
): AssetBundle => {
  const bundle: AssetBundle = { assetNames: [], assetTypes: [], assets: [] };
  const consumed = new Set(
    [local.musicFile, local.illustration, ...Object.values(local.chartFiles)].filter(
      Boolean,
    ) as string[],
  );

  for (const file of local.files) {
    if (consumed.has(file.name)) continue;
    let type: number;
    if (file.name === 'extra.json' || file.name === 'line.csv') type = ASSET_TYPE.config;
    else if (isShader(file.name)) type = ASSET_TYPE.shader;
    else if (isFont(file.name)) type = ASSET_TYPE.font;
    else if (isImage(file.name)) type = ASSET_TYPE.image;
    else if (isVideo(file.name)) {
      // 有真实 extra.json 时视频作为 asset 供 videos[].path（asset- 前缀）引用；
      // 无 extra.json 时由下方 pushSyntheticBga 以 URL 直连播放，这里跳过避免重复加载
      if (!local.extraJson || !useVideoBg) continue;
      type = ASSET_TYPE.video;
    } else continue; // info.txt / info.yml / meta.json 等元数据无需交给引擎

    bundle.assetNames.push(file.name);
    bundle.assetTypes.push(type);
    bundle.assets.push(track(URL.createObjectURL(file.blob)));
  }

  // 带视频文件但没有 extra.json → 用第一个视频作为 BGA（整曲播放）
  if (useVideoBg && !local.extraJson) {
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

  // PhiZone 谱面：附加资源（判定线贴图 / 打击音效 / shader 等）按文件名被谱面引用，
  // 必须一并交给引擎（资源 URL 直连，与 extra.json / BGA 一致走流式加载）
  if (source.source === 'pz' && source.chartId) {
    const pzAssets = await fetchPzChartAssets(source.chartId);
    for (const a of pzAssets) {
      if (bundle.assetNames.includes(a.name)) continue;
      const type =
        a.type >= 0 && a.type <= 5
          ? a.type
          : isShader(a.name)
            ? ASSET_TYPE.shader
            : isFont(a.name)
              ? ASSET_TYPE.font
              : isImage(a.name)
                ? ASSET_TYPE.image
                : isVideo(a.name)
                  ? ASSET_TYPE.video
                  : ASSET_TYPE.ignore;
      if (type === ASSET_TYPE.ignore) continue;
      bundle.assetNames.push(a.name);
      bundle.assetTypes.push(type);
      bundle.assets.push(a.file);
    }
  }

  return bundle;
};

/* ---------------- 压缩包谱面（zip / pez） ---------------- */

/**
 * 引擎的 assetTypes 约定（见 player/scenes/Game.ts 的 preload）：
 * 0=图片 1=音频 2=视频 3=配置（extra.json / line.csv） 4=shader 5=字体 6=忽略
 */
const ASSET_TYPE = {
  image: 0,
  audio: 1,
  video: 2,
  config: 3,
  shader: 4,
  font: 5,
  ignore: 6,
} as const;

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.json': 'application/json',
};

const guessMime = (name: string): string | undefined => {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? undefined : MIME_BY_EXT[name.slice(dot).toLowerCase()];
};

/**
 * 把压缩包内的条目转成引擎可消费的资源。
 * 谱面 / 音乐 / 曲绘走 resources 三个固定字段，其余（判定线贴图、BGA、shader、字体、
 * extra.json、line.csv）进入 assets 列表；asset 名保持包内文件名，谱面与 line.csv
 * 引用贴图时用的正是文件名。
 */
const buildArchiveResources = (
  archive: ResolvedArchive,
  preferences: Preferences,
  track: (url: string) => string,
): { resources: Config['resources']; songIsVideo: boolean } => {
  const bundle: AssetBundle = { assetNames: [], assetTypes: [], assets: [] };
  const toUrl = (name: string): string => {
    const entry = archive.entries.find((e) => e.name === name)!;
    const mime = guessMime(name);
    // Uint8Array 需要拷贝出独立 buffer，fflate 的输出可能共享底层内存
    const bytes = new Uint8Array(entry.data);
    return track(URL.createObjectURL(new Blob([bytes], mime ? { type: mime } : undefined)));
  };

  const consumed = new Set(
    [archive.chart, archive.music, archive.illustration].filter(Boolean) as string[],
  );

  for (const entry of archive.entries) {
    if (consumed.has(entry.name)) continue;
    let type: number;
    if (entry.name === archive.extraJson || entry.name === archive.lineCsv)
      type = ASSET_TYPE.config;
    else if (isShader(entry.name)) type = ASSET_TYPE.shader;
    else if (isFont(entry.name)) type = ASSET_TYPE.font;
    else if (isImage(entry.name)) type = ASSET_TYPE.image;
    else if (isVideo(entry.name)) {
      if (!preferences.useVideoBackground) continue;
      type = ASSET_TYPE.video;
    } else continue; // info.csv / info.txt / meta.json 等元数据无需交给引擎

    bundle.assetNames.push(entry.name);
    bundle.assetTypes.push(type);
    bundle.assets.push(toUrl(entry.name));
  }

  const songIsVideo = !!archive.music && isVideo(archive.music);

  return {
    resources: {
      chart: toUrl(archive.chart),
      song: archive.music ? toUrl(archive.music) : '',
      illustration: archive.illustration ? toUrl(archive.illustration) : '/banner.png',
      ...bundle,
    },
    songIsVideo,
  };
};

/* ---------------- Config 组装 ---------------- */

const makeConfig = (params: {
  title: string;
  composer: string;
  charter: string;
  illustrator: string | null;
  levelType: Level;
  /** 难度展示前缀，如 "IN" 或压缩包里的 "Color" */
  levelName: string;
  /** 定数；未知时传 null，引擎会只显示难度名 */
  difficulty: number | null;
  resources: Config['resources'];
  preferences: Preferences;
  songIsVideo: boolean;
  /** 本次游玩启用的模组（AT 会开启引擎的 autoplay） */
  mods: ModId[];
  replay?: import('$lib/types').ReplayFile;
}): Config => ({
  resources: params.resources,
  metadata: {
    title: params.title,
    composer: params.composer,
    charter: params.charter,
    illustrator: params.illustrator,
    levelType: inferLevelType(params.levelType.toUpperCase()),
    // 引擎会自行拼成 `${level}  Lv.${difficulty}`，这里只给难度名，避免出现 "IN Lv.15  Lv.15"
    level: params.levelName,
    difficulty: params.difficulty,
  },
  // 模组效果（判定窗口 / 倍速 / 翻转）在此叠加，不污染玩家保存的偏好
  preferences: applyModsToPreferences(params.preferences, params.mods),
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
  autoplay: isAutoplay(params.mods),
  practice: isPractice(params.mods),
  noFail: isNoFail(params.mods),
  hidden: isHidden(params.mods),
  perfectFail: isPerfect(params.mods),
  suddenDeath: isSuddenDeath(params.mods),
  sudden: isSudden(params.mods),
  noLines: isNoLines(params.mods),
  blackout: isBlackout(params.mods),
  lowLife: isLowLife(params.mods),
  resurrect: isResurrect(params.mods),
  replay: params.replay,
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
  const mods = options.mods ?? loadMods();

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
          levelType: level,
          levelName: level.toUpperCase(),
          difficulty: null,
          resources: { song, chart, illustration: illustration ?? '/banner.png', ...bundle },
          preferences,
          songIsVideo: false,
          mods,
          replay: options.replay,
        }),
        release,
      };
    }

    const lv = source.levels[level];
    if (!lv?.chart) throw new Error(`该曲目没有 ${level.toUpperCase()} 难度谱面`);

    // PhiTogether 等源的部分谱面把整个谱面包（zip / pez）作为 chart 字段：
    // 下载后在线解压，包内的谱面、音乐、曲绘与附加资源全部转成 blob 交给引擎。
    if (isChartArchive(lv.chart)) {
      progress.setDetail('下载谱面包');
      const archiveBlob = await downloadBlob(lv.chart, '谱面包', progress.task(), options.signal);
      if (archiveBlob.type.includes('html') || archiveBlob.size === 0) {
        throw new Error('谱面包无效（服务器返回的不是压缩包）');
      }

      progress.setDetail('解压谱面包');
      // 让进度条先渲染出「解压中」，再做同步解压（大包解压会占住主线程）
      await new Promise((resolve) => setTimeout(resolve, 0));
      const entries = unzipArchive(new Uint8Array(await archiveBlob.arrayBuffer()));
      const archive = resolveChartArchive(entries, level.toUpperCase());
      const { resources, songIsVideo } = buildArchiveResources(archive, preferences, track);

      // 包内没有音乐时回落到源列表提供的独立音频（pez 常见：song.mp3 在包外）
      if (!resources.song) {
        if (!source.songUrl) throw new Error('谱面包内没有音乐文件');
        progress.setDetail('下载音乐');
        const songBlob = await downloadBlob(source.songUrl, '音乐', progress.task(), options.signal);
        resources.song = track(URL.createObjectURL(songBlob));
      }

      const levelText = archive.metadata.level ?? lv.levelName ?? level.toUpperCase();
      progress.done();
      return {
        config: makeConfig({
          title: archive.metadata.name ?? source.name,
          composer: archive.metadata.composer ?? source.artist,
          charter: archive.metadata.charter ?? lv.charter ?? 'Unknown',
          illustrator: archive.metadata.illustrator ?? null,
          levelType: level,
          // "IN Lv.15" → "IN"；"Color Lv.?" → "Color"
          levelName: levelText.replace(/\s*lv\.?.*$/i, '').trim() || level.toUpperCase(),
          difficulty: parseArchiveDifficulty(levelText) ?? lv.rank ?? null,
          resources,
          preferences,
          songIsVideo,
          mods,
          replay: options.replay,
        }),
        release,
      };
    }

    let chart = lv.chart;
    let illustration = source.illustrationUrl;
    let song = source.songUrl;

    if (options.preloadResources) {
      progress.setDetail('下载谱面资源');
      const chartTask = progress.task();
      const illustrationTask = progress.task();
      // 视频音乐也完整下载：牺牲加载时间，避免游玩过程中网络抖动造成音画卡顿。
      const songTask = progress.task();

      const [chartBlob, illustrationBlob, songBlob] = await Promise.all([
        downloadBlob(chart, '谱面', chartTask, options.signal),
        downloadBlob(illustration, '曲绘', illustrationTask, options.signal),
        downloadBlob(song, source.songIsVideo ? '视频音乐' : '音乐', songTask, options.signal),
      ]);

      // 部分 CDN 对不存在的文件返回 200 + HTML 页面，这里提前拦住，避免进游玩页才报错
      if (chartBlob.type.includes('html') || chartBlob.size === 0) {
        throw new Error('谱面文件无效（服务器返回的不是谱面内容）');
      }

      chart = track(URL.createObjectURL(chartBlob));
      illustration = track(URL.createObjectURL(illustrationBlob));
      song = track(URL.createObjectURL(songBlob));
    }

    progress.setDetail('检查附加资源');
    // songIsVideo 时使用刚下载完成的 Blob URL 合成 BGA，音频轨和背景视频都不再访问远程地址。
    const bundle = await buildOnlineAssets({ ...source, songUrl: song }, lv.chart, preferences, track);

    progress.done();
    return {
      config: makeConfig({
        title: source.name,
        composer: source.artist,
        charter: lv.charter ?? 'Unknown',
        illustrator: null,
        levelType: level,
        levelName: lv.levelName ?? level.toUpperCase(),
        difficulty: lv.rank ?? null,
        resources: { song, chart, illustration, ...bundle },
        preferences,
        songIsVideo: source.songIsVideo === true,
          mods,
          replay: options.replay,
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

  const parsed = codename.match(/^(phi|ptc|pz)-(.+)$/);
  if (!parsed) throw new Error('无效的游玩链接');
  const sourceId = parsed[1] as ChartSourceId;
  const rawCodename = parsed[2];

  // 直链访问时 sessionStorage 不一定存在。按 URL 中的源重新拉取目录，
  // 找回 PTC/PhiZone 等源的完整资源地址，再交给统一的下载流程。
  if (sourceId !== 'phi') {
    const songs = await fetchSongs(sourceId);
    const item = songs.find((song) => song.id === rawCodename);
    const chart = item?.levels[level];
    if (!item || !chart?.chart) throw new Error(`找不到该${sourceId.toUpperCase()}谱面或难度`);
    return {
      source: sourceId,
      codename,
      name: item.name,
      artist: item.artist,
      illustrationUrl: item.illustration,
      songUrl: item.song,
      levels: { [level]: chart },
      backgroundAnimation: item.backgroundAnimation,
      songIsVideo: item.songIsVideo,
    };
  }

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
