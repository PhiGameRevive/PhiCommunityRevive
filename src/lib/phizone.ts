/**
 * PhiZone 官方 API 封装（api.phizone.cn）。
 * 列表元数据公开可拉取；谱面文件需登录（用户名/密码 → token）。
 */
import type { Level } from './meta';

const API = 'https://api.phizone.cn';
const CLIENT_ID = 'regular';
const CLIENT_SECRET = 'c29b1587-80f9-475f-b97b-dca1884eb0e3';
const TOKEN_KEY = 'phizoneToken';

/** levelType 映射到我们的难度（0=EZ, 1=HD, 2=IN, 3=AT, 4=SP） */
export const PZ_LEVEL_TYPE: Record<number, Level> = {
  0: 'ez',
  1: 'hd',
  2: 'in',
  3: 'at',
  4: 'sp',
};

export interface PzSong {
  id: string;
  title: string;
  authorName: string;
  file: string;
  illustration: string;
  chartLevels: { levelType: number; count: number }[];
  isHidden?: boolean;
  isLocked?: boolean;
}

export interface PzChart {
  id: string;
  levelType: number;
  level: string;
  difficulty: number;
  format: number;
  file: string | null;
  authorName: string;
}

/** PhiZone 谱面附加资源（判定线贴图 / 打击音效 / shader 等；与 Phigros 资产类型一致） */
export interface PzAsset {
  id: string;
  /** 0=image 1=audio 2=video 3=json 4=shader 5=font */
  type: number;
  name: string;
  file: string;
}

async function api(path: string, token?: string): Promise<any> {
  const headers: Record<string, string> = {
    'User-Agent': 'PhiZoneRegularAccess',
  };
  // 不手动设置 Origin（浏览器自动附带；手动设置可能触发额外 CORS 预检）
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + path, { headers });
  if (!res.ok) throw new Error(`PhiZone API ${res.status}`);
  const json = await res.json();
  if (json.status !== 0 || json.code !== 'Ok') throw new Error(json.message ?? 'PhiZone API error');
  return json;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function login(username: string, password: string): Promise<string> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'password',
    username,
    password,
  });
  const res = await fetch(API + '/auth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!json.access_token) {
    throw new Error(json.error_description ?? json.error ?? '登录失败');
  }
  setToken(json.access_token);
  return json.access_token as string;
}

/** 拉取歌曲列表（公开；首页拿总页数后并行拉取，单页失败容错） */
export async function fetchPzSongs(): Promise<PzSong[]> {
  const songs: PzSong[] = [];
  const pushSong = (s: PzSong) => {
    if (!s.isHidden && !s.isLocked) songs.push(s);
  };
  // /songs/ 的响应为 { total, perPage, ..., data: [...] }：数组直接在 data 下
  const first = await api('/songs/?PerPage=32&Page=1').catch(() => null);
  const firstPage = Array.isArray(first?.data) ? (first.data as PzSong[]) : [];
  if (firstPage.length === 0) return songs;
  firstPage.forEach(pushSong);
  const total = (first?.total as number) ?? firstPage.length;
  const totalPages = Math.min(20, Math.ceil(total / 32) || 1);
  const rest = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, i) =>
      api(`/songs/?PerPage=32&Page=${i + 2}`).catch(() => null),
    ),
  );
  for (const json of rest) {
    if (Array.isArray(json?.data)) (json.data as PzSong[]).forEach(pushSong);
  }
  return songs;
}

/** 拉取歌曲的 charts 元数据（公开） */
export async function fetchPzCharts(songId: string): Promise<PzChart[]> {
  const json = await api(`/songs/${songId}/charts?Order=difficulty&PerPage=114514`);
  const data = json.data;
  return Array.isArray(data) ? (data as PzChart[]) : ((data?.data as PzChart[]) ?? []);
}

/** 获取 chart 文件 URL（需登录） */
export async function fetchPzChartFile(chartId: string, token?: string): Promise<string> {
  const tk = token ?? getToken();
  if (!tk) throw new Error('需要登录 PhiZone 才能下载谱面');
  const json = await api(`/charts/${chartId}`, tk);
  const chart = (json.data ?? json) as PzChart;
  if (!chart.file) throw new Error('PhiZone 谱面文件不可用（可能需要账号权限）');
  return chart.file as string;
}

/**
 * 拉取谱面附加资源列表（公开接口；返回的资源 URL 可直接下载）。
 * 谱面 JSON 里按文件名引用这些资源（判定线贴图、打击音效、shader 等），
 * 需要一并下载并交给引擎才能完整渲染。
 */
export async function fetchPzChartAssets(chartId: string): Promise<PzAsset[]> {
  const json = await api(`/charts/${chartId}/assets`).catch(() => null);
  const data = json?.data;
  if (!Array.isArray(data)) return [];
  return (data as PzAsset[]).filter((a) => a?.name && a?.file);
}