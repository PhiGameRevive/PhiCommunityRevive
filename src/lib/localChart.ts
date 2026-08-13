/**
 * 本地谱面导入：解析 zip / pez / 文件夹上传的谱面包。
 */
import { unzipSync } from 'fflate';
import { LOCAL_PREFIX, type LocalChart } from './db';
import type { Level } from './meta';

export interface InputFile {
  name: string;
  blob: Blob;
}

const LEVEL_ORDER: Level[] = ['ez', 'hd', 'in', 'at', 'sp'];

/** 解压 zip / pez（pez 是 Phira 的谱面打包格式，本质为 zip） */
export async function readZipFile(file: File): Promise<InputFile[]> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const entries = unzipSync(buf);
  return Object.entries(entries).map(([name, data]) => ({
    name: name.replace(/\\/g, '/'),
    blob: new Blob([data]),
  }));
}

/** 文件夹上传（webkitdirectory） */
export function readDirFiles(files: FileList): InputFile[] {
  return Array.from(files).map((f) => ({
    name: ((f as File & { webkitRelativePath?: string }).webkitRelativePath ?? f.name).replace(/\\/g, '/'),
    blob: f,
  }));
}

/** 如果所有文件都在同一个顶层目录下，去掉该层 */
function stripRootDir(files: InputFile[]): InputFile[] {
  const roots = new Set(files.map((f) => f.name.split('/')[0]));
  if (roots.size === 1 && files.some((f) => f.name.includes('/'))) {
    return files.map((f) => ({ ...f, name: f.name.slice(f.name.indexOf('/') + 1) }));
  }
  return files;
}

async function tryParseMeta(metaFile?: InputFile): Promise<Record<string, unknown> | null> {
  if (!metaFile) return null;
  try {
    const obj = JSON.parse(await metaFile.blob.text());
    return typeof obj === 'object' && obj !== null ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function readText(file: InputFile): Promise<string> {
  try {
    return await file.blob.text();
  } catch {
    return '';
  }
}

/** 识别谱面文件与难度归属 */
async function detectCharts(files: InputFile[], meta: Record<string, unknown> | null): Promise<Partial<Record<Level, string>>> {
  const charts: Partial<Record<Level, string>> = {};
  const byName = new Map(files.map((f) => [f.name.toLowerCase(), f.name]));

  // 1) meta.json 显式字段（PhiCommunity 仓库格式）
  const metaKeys: [Level, string][] = [
    ['ez', 'chartEZ'],
    ['hd', 'chartHARD'],
    ['in', 'chartIN'],
    ['at', 'chartAT'],
    ['sp', 'chartSP'],
  ];
  for (const [lv, key] of metaKeys) {
    const v = meta?.[key];
    if (typeof v === 'string' && byName.has(v.toLowerCase())) charts[lv] = v;
  }

  // 2) 常见命名：ez.json / ez.pec / EZ.json 等
  for (const lv of LEVEL_ORDER) {
    if (charts[lv]) continue;
    for (const name of files.map((f) => f.name)) {
      const base = name.split('/').pop()?.toLowerCase() ?? '';
      if (base === `${lv}.json` || base === `${lv}.pec` || base === `chart_${lv}.json` || base === `${lv}_chart.json`) {
        charts[lv] = name;
        break;
      }
    }
  }

  // 3) 目录结构：ez/、hd/ 目录下的 chart.json（Phira 风格）
  const dirCharts = new Map<Level, string[]>();
  for (const f of files) {
    const parts = f.name.split('/');
    if (parts.length >= 2 && /^(ez|hd|in|at|sp)$/i.test(parts[parts.length - 2] ?? '')) {
      const dir = (parts[parts.length - 2] ?? '').toLowerCase() as Level;
      const base = (parts[parts.length - 1] ?? '').toLowerCase();
      if (base === 'chart.json' || base.endsWith('.json') || base.endsWith('.pec')) {
        dirCharts.set(dir, [...(dirCharts.get(dir) ?? []), f.name]);
      }
    }
  }
  for (const [lv, names] of dirCharts) {
    if (!charts[lv] && names.length > 0) charts[lv] = names[0];
  }

  // 4) 兜底：任何含 judgeLineList/META 的 JSON 或 .pec 文件，按文件名难度关键词
  if (Object.keys(charts).length === 0) {
    for (const f of files) {
      if (!/\.(json|pec)$/i.test(f.name)) continue;
      const isPec = /\.pec$/i.test(f.name);
      const text = await readText(f).catch(() => '');
      if (isPec || text.includes('judgeLineList') || text.includes('META')) {
        const lower = f.name.toLowerCase();
        const hit = LEVEL_ORDER.find((lv) => lower.includes(`${lv}.`) || lower.includes(`-${lv}`) || lower.includes(`/${lv}/`) || lower.includes(`_${lv}`));
        const lv = hit ?? 'ez';
        if (!charts[lv]) charts[lv] = f.name;
      }
    }
  }

  return charts;
}

/** 按扩展名挑选文件；无 info/meta 指定时选体积最大的（曲绘/主曲通常最大） */
function pickByExt(files: InputFile[], exts: string[], exclude: RegExp): string | undefined {
  let best: InputFile | undefined;
  for (const f of files) {
    const base = f.name.split('/').pop() ?? '';
    if (exclude.test(f.name)) continue;
    if (!exts.some((ext) => base.toLowerCase().endsWith(ext))) continue;
    if (!best || f.blob.size > best.blob.size) best = f;
  }
  return best?.name;
}

/** 解析 Phira 谱面包的 info.txt */
function parseInfoTxt(text: string): Record<string, string> {
  const info: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (m) info[m[1].trim().toLowerCase()] = m[2].trim();
  }
  return info;
}

/** 从 "SP Lv.15" / "AT Lv.16" 解析难度 */
function parseLevelString(level: string): Level | undefined {
  const m = level.trim().match(/^(ez|hd|in|at|sp)\b/i);
  return m ? (m[1].toLowerCase() as Level) : undefined;
}

/** 从 chart JSON 的 META 提取难度 */
function levelFromChartMeta(metaText: string): Level | undefined {
  try {
    const obj = JSON.parse(metaText);
    const level: unknown = obj?.META?.level ?? obj?.meta?.level;
    if (typeof level === 'string') return parseLevelString(level);
  } catch {
    /* ignore */
  }
  return undefined;
}

/** 解析上传文件列表为 LocalChart */
export async function parseChartFiles(rawFiles: InputFile[]): Promise<LocalChart> {
  const files = stripRootDir(rawFiles);
  const byName = new Map(files.map((f) => [f.name.toLowerCase(), f]));

  // 1) 元数据：meta.json（PhiCommunity 格式）或 info.txt（Phira/Phitogether 格式）
  const meta = await tryParseMeta(byName.get('meta.json'));
  const infoFile = byName.get('info.txt');
  const info = infoFile ? parseInfoTxt(await readText(infoFile).catch(() => '')) : null;

  const metaName = typeof meta?.name === 'string' ? meta.name : undefined;
  const metaArtist = typeof meta?.artist === 'string' ? meta.artist : undefined;

  const charts = await detectCharts(files, meta);

  // 2) 音乐 / 曲绘
  const musicFile =
    info?.song ??
    (typeof meta?.musicFile === 'string' ? meta.musicFile : undefined) ??
    pickByExt(files, ['.mp3', '.ogg', '.wav', '.flac', '.m4a'], /note|hit|voice|hitsound|tap|flick|drag|hold/i);

  const illustration =
    info?.picture ??
    (typeof meta?.illustration === 'string' ? meta.illustration : undefined) ??
    pickByExt(
      files,
      ['.png', '.jpg', '.jpeg', '.webp'],
      /note|\.fnt|hit|bga|video|tap|flick|drag|hold|line|skin|fangge|square|circle|\.d\.|_d\.|small/i,
    );

  const extraJson = byName.has('extra.json') ? await readText(byName.get('extra.json')!).catch(() => '') : undefined;
  const lineCsv = byName.has('line.csv') ? await readText(byName.get('line.csv')!).catch(() => '') : undefined;

  // 3) 名称 / 艺术家 / 谱师：info.txt > chart META > meta.json > 文件名
  let name = info?.name ?? metaName ?? 'Unknown';
  let artist = info?.composer ?? metaArtist ?? 'Unknown';
  let charter = info?.charter ?? (typeof meta?.chartDesigner === 'string' ? meta.chartDesigner : undefined);

  // 4) 难度归属：info.txt 的 Level 优先；否则从第一个谱面文件的 META 推断
  const infoLevel = info?.level ? parseLevelString(info.level) : undefined;
  if (infoLevel && !charts[infoLevel]) {
    const chartName = Object.values(charts)[0];
    if (chartName) {
      const oldKey = Object.keys(charts)[0] as Level;
      if (oldKey !== infoLevel) delete charts[oldKey];
      charts[infoLevel] = chartName;
    }
  }
  if (!infoLevel && Object.keys(charts).length === 1) {
    const onlyFile = Object.values(charts)[0];
    const only = files.find((f) => f.name === onlyFile);
    if (only) {
      const lv = levelFromChartMeta(await readText(only).catch(() => ''));
      if (lv && !charts[lv]) {
        const old = charts[Object.keys(charts)[0] as Level];
        delete charts[Object.keys(charts)[0] as Level];
        charts[lv] = old!;
      }
      // 从 META 提取名称
      try {
        const obj = JSON.parse(await readText(only));
        if (!name || name === 'Unknown') name = obj?.META?.name ?? info?.name ?? metaName ?? 'Unknown';
        if (!artist || artist === 'Unknown') artist = obj?.META?.composer ?? info?.composer ?? metaArtist ?? 'Unknown';
        charter = charter ?? obj?.META?.charter;
      } catch {
        /* ignore */
      }
    }
  }

  const codename = LOCAL_PREFIX + ((typeof meta?.codename === 'string' ? meta.codename : '') || info?.path || Date.now().toString(36));

  if (Object.keys(charts).length === 0) {
    throw new Error('未找到谱面文件（需要包含 judgeLineList 的 JSON 或 PEC 文件）');
  }

  return {
    codename,
    name: name || 'Unknown',
    artist: artist || 'Unknown',
    illustration,
    musicFile,
    chartFiles: charts,
    extraJson,
    lineCsv,
    files,
  };
}