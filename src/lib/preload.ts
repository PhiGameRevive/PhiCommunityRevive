/**
 * 开场动画期间的资源预加载：
 *  - 谱面列表（三个源）在开场时并行拉取，选歌页直接消费，避免进入选歌页后再转圈等待
 *  - Phaser 引擎包（约 2MB）后台预热，首次点击游玩时无需再等引擎 chunk 下载
 */
import { fetchSongs, type SourceSong } from './sources';

export interface PreloadedSongLists {
  phi: SourceSong[];
  ptc: SourceSong[];
  pz: SourceSong[];
}

let lists: PreloadedSongLists | null = null;
let warming = false;

/**
 * 并行拉取三个谱面源。单个源失败不影响其他源（与选歌页现有容错一致）。
 * 并发调用只执行一次。
 */
export const preloadSongLists = async (): Promise<PreloadedSongLists> => {
  if (lists) return lists;
  const [phi, ptc, pz] = await Promise.all([
    fetchSongs('phi').catch((e) => {
      console.error('preload phi source failed', e);
      return [] as SourceSong[];
    }),
    fetchSongs('ptc').catch((e) => {
      console.error('preload ptc source failed', e);
      return [] as SourceSong[];
    }),
    fetchSongs('pz').catch((e) => {
      console.error('preload pz source failed', e);
      return [] as SourceSong[];
    }),
  ]);
  lists = { phi, ptc, pz };
  return lists;
};

/** 选歌页取出预载结果（取后清空，避免二次进入选歌页复用过期数据） */
export const takePreloadedSongLists = (): PreloadedSongLists | null => {
  const result = lists;
  lists = null;
  return result;
};

/**
 * 后台预热 Phaser 引擎包。模块导入本身无副作用（game 实例由 start() 按需创建）。
 * 幂等：同一时刻只预热一次。
 */
export const warmPlayerBundle = (): void => {
  if (warming) return;
  warming = true;
  // 延迟到空闲时再加载，避免与谱面列表下载争抢带宽
  const run = () => {
    import('$lib/player/main').catch((e) => {
      console.warn('warm player bundle failed', e);
    });
  };
  if ('requestIdleCallback' in window) {
    (window as Window & { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(run);
  } else {
    setTimeout(run, 500);
  }
};