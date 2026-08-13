/**
 * 谱面源抽象：PhiCommunity 官方仓库 / PhiTogether（PTC-pub）等。
 */
import { chartSource } from './chartSource';
import { fetchMeta, chartUrl, songUrl, getChartDesigner, getChartFile, getChartRanking, type Level } from './meta';
import { fetchPzSongs, PZ_LEVEL_TYPE } from './phizone';

export type ChartSourceId = 'phi' | 'ptc' | 'pz';

export const SOURCE_LABELS: Record<ChartSourceId, string> = {
  phi: 'PhiCommunity',
  ptc: 'PhiTogether',
  pz: 'PhiZone',
};

export interface SourceLevel {
  chart: string;
  rank?: number;
  charter?: string;
}

export interface SourceSong {
  id: string;
  source: ChartSourceId;
  name: string;
  artist: string;
  illustration: string;
  song: string;
  levels: Partial<Record<Level, SourceLevel>>;
  /** 背景视频文件名（PhiCommunity 仓库 backgroundAnimation 字段） */
  backgroundAnimation?: string;
  /** song 本身是视频文件（phitogether 部分谱面用 bga.mp4 当音乐） */
  songIsVideo?: boolean;
}

export const sourcePrefix = (source: ChartSourceId) => `${source}-`;

export function parseSongId(codename: string): { source: ChartSourceId; id: string } | null {
  for (const s of ['phi', 'ptc', 'pz'] as ChartSourceId[]) {
    if (codename.startsWith(`${s}-`)) return { source: s, id: codename.slice(s.length + 1) };
  }
  return null;
}

/** PhiCommunity 官方谱面源 */
async function fetchPhiSongs(): Promise<SourceSong[]> {
  const EXCLUDED = /.github|README\.md|CNAME|_headers|content|edgeone/;
  const res = await fetch(`${chartSource}/content.json`);
  if (!res.ok) throw new Error(`content.json HTTP ${res.status}`);
  const list = (await res.json()) as { name: string }[];
  const codenames = list.map((i) => i.name).filter((n) => !EXCLUDED.test(n));
  const songs: SourceSong[] = [];
  await Promise.all(
    codenames.map(async (codename) => {
      try {
        const meta = await fetchMeta(codename);
        const levels: SourceSong['levels'] = {};
        for (const lv of ['ez', 'hd', 'in', 'at', 'sp'] as Level[]) {
          const file = getChartFile(meta, lv);
          if (file) {
            levels[lv] = {
              chart: chartUrl(meta.codename, file),
              rank: getChartRanking(meta, lv),
              charter: getChartDesigner(meta, lv),
            };
          }
        }
        songs.push({
          id: meta.codename,
          source: 'phi',
          name: meta.name,
          artist: meta.artist,
          illustration: chartUrl(meta.codename, meta.illustration),
          song: songUrl(meta.codename, meta.musicFile),
          levels,
          backgroundAnimation: meta.backgroundAnimation,
          songIsVideo: /\.(mp4|webm|mov)$/i.test(meta.musicFile ?? ''),
        });
      } catch (e) {
        console.error(`Failed to load ${codename}`, e);
      }
    }),
  );
  return songs;
}

/** PhiTogether（ptc.focalors.ltd）谱面源 */
async function fetchPtcSongs(): Promise<SourceSong[]> {
  const chaptersRes = await fetch('https://ptc.focalors.ltd/chapters.json');
  if (!chaptersRes.ok) throw new Error(`chapters.json HTTP ${chaptersRes.status}`);
  const chapters = (await chaptersRes.json()) as {
    songsListUrls: string[];
  }[];
  const urls = chapters.flatMap((c) => c.songsListUrls ?? []);
  const songs: SourceSong[] = [];
  const seen = new Set<string>();

  for (const baseUrl of urls) {
    let url: string | null = baseUrl;
    while (url) {
      const res = await fetch(url);
      if (!res.ok) break;
      const page = (await res.json()) as {
        next: string | null;
        results: {
          id: string;
          name: string;
          composer: string;
          illustration: string;
          song: string;
          charts: { charter: string; chart: string; level: string; difficulty?: string }[];
        }[];
      };
      for (const item of page.results) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        const levels: SourceSong['levels'] = {};
        for (const c of item.charts ?? []) {
          const lv = c.level?.toLowerCase() as Level | undefined;
          if (lv && ['ez', 'hd', 'in', 'at', 'sp'].includes(lv) && c.chart) {
            levels[lv] = {
              chart: c.chart,
              rank: c.difficulty && c.difficulty !== '?' ? Number(c.difficulty) : undefined,
              charter: c.charter,
            };
          }
        }
        const songIsVideo = /\.(mp4|webm|mov|m4v)$/i.test(item.song ?? '');
        songs.push({
          id: item.id,
          source: 'ptc',
          name: item.name,
          artist: item.composer,
          illustration: item.illustration,
          song: item.song,
          levels,
          // phitogether 部分谱面用 bga.mp4 当音乐：既是背景视频也是音频源
          backgroundAnimation: songIsVideo ? (item.song.split('/').pop() ?? undefined) : undefined,
          songIsVideo,
        });
      }
      url = page.next;
    }
  }
  return songs;
}

/** PhiZone 官方谱面源（列表公开；谱面文件需登录） */
async function fetchPzSongsSource(): Promise<SourceSong[]> {
  const list = await fetchPzSongs();
  return list.map((s) => {
    const levels: SourceSong['levels'] = {};
    for (const cl of s.chartLevels ?? []) {
      const lv = PZ_LEVEL_TYPE[cl.levelType];
      if (lv && cl.count > 0) {
        levels[lv] = { chart: '', rank: undefined, charter: undefined };
      }
    }
    return {
      id: s.id,
      source: 'pz',
      name: s.title,
      artist: s.authorName,
      illustration: s.illustration,
      song: s.file,
      levels,
    };
  });
}

/** 按源拉取歌曲列表 */
export async function fetchSongs(source: ChartSourceId): Promise<SourceSong[]> {
  if (source === 'phi') return fetchPhiSongs();
  if (source === 'ptc') return fetchPtcSongs();
  if (source === 'pz') return fetchPzSongsSource();
  return [];
}