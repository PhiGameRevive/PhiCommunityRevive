import type { ReplayFile, ReplayInputEvent, ReplaySourceSnapshot } from './types';

export const isReplayFile = (value: unknown): value is ReplayFile => {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<ReplayFile>;
  return r.format === 'PhiCommunityReplay' && r.version === 1 && typeof r.id === 'string' &&
    !!r.source && typeof r.source.codename === 'string' && Array.isArray(r.events);
};

export const createReplay = (params: {
  source: ReplaySourceSnapshot;
  level: ReplayFile['level'];
  mods: string[];
  duration: number;
  events: ReplayInputEvent[];
  result: ReplayFile['result'];
}): ReplayFile => ({
  format: 'PhiCommunityReplay',
  version: 1,
  id: `${params.source.codename}-${params.level}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  createdAt: Date.now(),
  ...params,
});

export const downloadReplay = (replay: ReplayFile): void => {
  const blob = new Blob([JSON.stringify(replay, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${replay.source.name}-${replay.level}-${new Date(replay.createdAt).toISOString().replace(/[:.]/g, '-')}.phireplay`;
  a.click();
  URL.revokeObjectURL(url);
};

export const readReplayFile = async (file: File): Promise<ReplayFile> => {
  const value = JSON.parse(await file.text()) as unknown;
  if (!isReplayFile(value)) throw new Error('不是有效的 PhiCommunity 回放文件');
  return value;
};
