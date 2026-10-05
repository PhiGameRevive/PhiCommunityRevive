/**
 * 在线谱面 → 本地缓存。
 *
 * 选歌页选中某个在线谱面时，后台把它的谱面文件、音乐、曲绘抓成 Blob 存进
 * IndexedDB 的 `localCharts`，之后即可在「本地」来源离线游玩。
 *
 * 缓存键稳定：`local-<source>-<原始 id>`，因此重复选中只会覆盖、不会累积。
 * 已缓存过（或正在缓存）的谱面会被跳过，避免每次切换都重复下载。
 */
import { saveLocalChart, getLocalChart, LOCAL_PREFIX, type LocalChart, type LocalChartFile } from './db';
import type { Level } from './meta';

/** 选中缓存的输入：只依赖选歌页已有的字段，避免再次请求目录 */
export interface CacheableSong {
  codename: string;
  source: 'phi' | 'ptc' | 'pz';
  name: string;
  artist: string;
  illustrationUrl: string;
  songUrl: string;
  levels: Partial<Record<Level, { chart: string; charter?: string }>>;
}

const CACHE_LEVELS: Level[] = ['ez', 'hd', 'in', 'at', 'sp'];

/** 从 codename（带源前缀）推导稳定的本地缓存键 */
export const localCodenameFor = (source: string, codename: string): string =>
  `${LOCAL_PREFIX}${codename.replace(/^(phi|ptc|pz)-/, `${source}-`)}`;

/** 正在进行中的缓存任务，避免同一谱面并发重复下载 */
const inFlight = new Map<string, Promise<LocalChart | null>>();

const fileFromUrl = async (url: string, name: string): Promise<LocalChartFile | null> => {
  if (!url) return null;
  try {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return { name, blob };
  } catch {
    return null;
  }
};

/** 从 URL 中取文件名（去掉查询串），失败时用回退名 */
const fileNameFromUrl = (url: string, fallback: string): string => {
  try {
    const path = new URL(url, location.href).pathname;
    const base = decodeURIComponent(path.split('/').pop() ?? '');
    return base || fallback;
  } catch {
    return fallback;
  }
};

/**
 * 把一首在线谱面缓存到本地。已缓存或正在缓存时直接返回当前记录。
 * 失败（网络/CORS）时抛出，由调用方决定是否提示。
 */
export const cacheOnlineSong = async (song: CacheableSong): Promise<LocalChart | null> => {
  const codename = localCodenameFor(song.source, song.codename);

  const existing = await getLocalChart(codename).catch(() => undefined);
  if (existing) return existing;

  const pending = inFlight.get(codename);
  if (pending) return pending;

  const task = (async (): Promise<LocalChart | null> => {
    const files: LocalChartFile[] = [];
    const chartFiles: Partial<Record<Level, string>> = {};

    // 曲绘
    let illustration: string | undefined;
    if (song.illustrationUrl) {
      const name = fileNameFromUrl(song.illustrationUrl, 'illustration.png');
      const file = await fileFromUrl(song.illustrationUrl, name);
      if (file) {
        files.push(file);
        illustration = name;
      }
    }

    // 音乐
    let musicFile: string | undefined;
    if (song.songUrl) {
      const name = fileNameFromUrl(song.songUrl, 'music.mp3');
      const file = await fileFromUrl(song.songUrl, name);
      if (file) {
        files.push(file);
        musicFile = name;
      }
    }

    // 各难度谱面文件
    for (const lv of CACHE_LEVELS) {
      const chartUrl = song.levels[lv]?.chart;
      if (!chartUrl) continue;
      const name = fileNameFromUrl(chartUrl, `${lv}.json`);
      const file = await fileFromUrl(chartUrl, name);
      if (file) {
        files.push(file);
        chartFiles[lv] = name;
      }
    }

    // 没有任何谱面文件则视为失败，不写入空记录
    if (Object.keys(chartFiles).length === 0) return null;

    const chart: LocalChart = {
      codename,
      name: song.name,
      artist: song.artist,
      illustration,
      musicFile,
      chartFiles,
      files,
    };
    await saveLocalChart(chart);
    return chart;
  })();

  inFlight.set(codename, task);
  try {
    return await task;
  } finally {
    inFlight.delete(codename);
  }
};
