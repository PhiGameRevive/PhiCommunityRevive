/**
 * 谱面压缩包（zip / pez）解析。
 *
 * pez 是 Phira 的谱面打包格式，本质就是 zip。PhiTogether 源里少量谱面的 chart 字段
 * 直接指向 .pez / .zip，需要下载后在线解压，从包内取出谱面、音乐、曲绘与附加资源。
 *
 * 包内元数据有三种常见形式：
 *   - info.csv：pez 常用，首行表头 + 数据行（Chart,Music,Image,...,Name,Level,Illustrator,Designer）
 *   - info.txt：Phira 风格的 `Key: Value` 列表
 *   - meta.json：PhiCommunity 谱面仓库格式
 */
import { unzipSync } from 'fflate';

export interface ArchiveEntry {
  /** 去掉统一顶层目录后的相对路径 */
  name: string;
  data: Uint8Array;
}

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.apng', '.bmp'];
const AUDIO_EXTS = ['.mp3', '.ogg', '.wav', '.flac', '.m4a', '.aac'];
const VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.m4v'];
const FONT_EXTS = ['.ttf', '.otf', '.woff', '.woff2'];
/** 包内的元数据/配置文件，不参与「谱面 / 曲绘 / 音乐」的自动挑选 */
const RESERVED_NAMES = new Set(['extra.json', 'line.csv', 'info.txt', 'info.csv', 'meta.json']);
/** 明显不是曲绘的图片（判定线贴图、note 皮肤等） */
const NON_ILLUSTRATION =
  /note|hit|tap|flick|drag|hold|line|skin|\.fnt|bga|video|square|circle|small|\bqm\d/i;

export const hasExt = (name: string, exts: string[]): boolean => {
  const lower = name.toLowerCase();
  return exts.some((ext) => lower.endsWith(ext));
};

export const isImage = (name: string) => hasExt(name, IMAGE_EXTS);
export const isAudio = (name: string) => hasExt(name, AUDIO_EXTS);
export const isVideo = (name: string) => hasExt(name, VIDEO_EXTS);
export const isFont = (name: string) => hasExt(name, FONT_EXTS);
export const isShader = (name: string) => hasExt(name, ['.glsl']);

/** chart 字段是否指向压缩包而非裸谱面文件。 */
export const isChartArchive = (url: string): boolean => /\.(zip|pez)$/i.test(url.split(/[?#]/)[0]);

const basename = (name: string) => name.split('/').pop() ?? name;

const decodeText = (data: Uint8Array): string => new TextDecoder('utf-8').decode(data);

/** 如果所有条目都在同一个顶层目录下，去掉该层。 */
const stripRootDir = (entries: ArchiveEntry[]): ArchiveEntry[] => {
  const roots = new Set(entries.map((e) => e.name.split('/')[0]));
  if (roots.size === 1 && entries.some((e) => e.name.includes('/'))) {
    return entries.map((e) => ({ ...e, name: e.name.slice(e.name.indexOf('/') + 1) }));
  }
  return entries;
};

/**
 * 解压为条目列表。目录项会被剔除，路径分隔符统一为 `/`。
 * 若包内文件名互不重复，则统一用文件名（不含目录）作为条目名——包内 line.csv /
 * 谱面里引用贴图时用的都是文件名。
 */
export const unzipArchive = (buffer: Uint8Array): ArchiveEntry[] => {
  const unzipped = unzipSync(buffer);
  const entries: ArchiveEntry[] = [];
  for (const [rawName, data] of Object.entries(unzipped)) {
    const name = rawName.replace(/\\/g, '/');
    if (name.endsWith('/') || data.length === 0) continue; // 目录项
    entries.push({ name, data });
  }

  const stripped = stripRootDir(entries);
  const bases = stripped.map((e) => basename(e.name));
  const unique = new Set(bases).size === bases.length;
  return unique ? stripped.map((e, i) => ({ ...e, name: bases[i] })) : stripped;
};

/** 解析 Phira 风格的 info.txt（`Key: Value`）。 */
export const parseInfoTxt = (text: string): Record<string, string> => {
  const info: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (m) info[m[1].trim().toLowerCase()] = m[2].trim();
  }
  return info;
};

/**
 * 解析 pez 的 info.csv：首行表头，之后取第一行「列数与表头一致且 Chart 列非空」的数据行。
 * 实际文件里表头与数据之间可能夹着一行中文说明，因此不能直接取第二行。
 */
export const parseInfoCsv = (text: string): Record<string, string> => {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(',').map((cell) => cell.trim()));
  if (rows.length < 2) return {};

  const header = rows[0].map((h) => h.toLowerCase());
  const chartIndex = header.indexOf('chart');
  for (const row of rows.slice(1)) {
    if (row.length !== header.length) continue;
    // 说明行的 Chart 列不会是文件名
    if (chartIndex >= 0 && !/\.(json|pec)$/i.test(row[chartIndex])) continue;
    const info: Record<string, string> = {};
    header.forEach((key, i) => {
      if (row[i]) info[key] = row[i];
    });
    return info;
  }
  return {};
};

export interface ArchiveMetadata {
  name?: string;
  composer?: string;
  charter?: string;
  illustrator?: string;
  level?: string;
}

export interface ResolvedArchive {
  entries: ArchiveEntry[];
  /** 谱面文件条目名 */
  chart: string;
  music?: string;
  illustration?: string;
  extraJson?: string;
  lineCsv?: string;
  metadata: ArchiveMetadata;
}

const findEntry = (entries: ArchiveEntry[], name: string | undefined): string | undefined => {
  if (!name) return undefined;
  const target = name.replace(/\\/g, '/').toLowerCase();
  const targetBase = basename(target);
  const hit =
    entries.find((e) => e.name.toLowerCase() === target) ??
    entries.find((e) => basename(e.name).toLowerCase() === targetBase);
  return hit?.name;
};

/** 体积最大的条目（曲绘与主曲通常是包内最大的图片/音频）。 */
const largest = (
  entries: ArchiveEntry[],
  predicate: (entry: ArchiveEntry) => boolean,
): string | undefined => {
  let best: ArchiveEntry | undefined;
  for (const entry of entries) {
    if (RESERVED_NAMES.has(basename(entry.name).toLowerCase())) continue;
    if (!predicate(entry)) continue;
    if (!best || entry.data.length > best.data.length) best = entry;
  }
  return best?.name;
};

/** 挑选谱面文件：优先包内元数据指定，其次按内容判断。 */
const pickChart = (entries: ArchiveEntry[], declared: string | undefined): string | undefined => {
  const fromMeta = findEntry(entries, declared);
  if (fromMeta) return fromMeta;

  // PEC 一定是谱面
  const pec = largest(entries, (e) => hasExt(e.name, ['.pec']));
  if (pec) return pec;

  // JSON：排除元数据文件，按内容确认是谱面
  const candidates = entries.filter(
    (e) => hasExt(e.name, ['.json']) && !RESERVED_NAMES.has(basename(e.name).toLowerCase()),
  );
  const charts = candidates.filter((e) => {
    // 谱面动辄数 MB，只解码头部足够判断
    const head = decodeText(e.data.subarray(0, 4096));
    return (
      head.includes('judgeLineList') || head.includes('formatVersion') || head.includes('META')
    );
  });
  const pool = charts.length > 0 ? charts : candidates;
  let best: ArchiveEntry | undefined;
  for (const entry of pool) {
    if (!best || entry.data.length > best.data.length) best = entry;
  }
  return best?.name;
};

/**
 * 收集被谱面引用为判定线贴图的图片文件名。
 * 这些图片可能比真曲绘还大（例如整屏的云层素材），单靠体积或文件名都会误判。
 *   - RPE JSON：判定线的 `Texture` 字段
 *   - PEC：贴图在 line.csv 的第 3 列
 */
const collectLineTextures = (
  entries: ArchiveEntry[],
  chart: string,
  lineCsv: string | undefined,
): Set<string> => {
  const textures = new Set<string>();
  const add = (value: string | undefined) => {
    const name = value?.trim().replace(/\\/g, '/');
    if (name) textures.add(basename(name).toLowerCase());
  };

  const chartEntry = entries.find((e) => e.name === chart);
  if (chartEntry && hasExt(chart, ['.json'])) {
    const text = decodeText(chartEntry.data);
    for (const m of text.matchAll(/"Texture"\s*:\s*"([^"]*)"/g)) add(m[1]);
  }

  const csvEntry = lineCsv ? entries.find((e) => e.name === lineCsv) : undefined;
  if (csvEntry) {
    const rows = decodeText(csvEntry.data)
      .split(/\r?\n/)
      .map((line) => line.split(',').map((cell) => cell.trim()));
    const header = rows[0]?.map((h) => h.toLowerCase()) ?? [];
    const imageIndex = header.indexOf('image');
    if (imageIndex >= 0) rows.slice(1).forEach((row) => add(row[imageIndex]));
  }

  return textures;
};

/**
 * 定位压缩包内的各类资源。找不到谱面时抛错。
 * @param declaredLevel 外部（谱面源列表）已知的难度，用于在包内元数据缺失时补全展示信息
 */
export const resolveChartArchive = (
  rawEntries: ArchiveEntry[],
  declaredLevel?: string,
): ResolvedArchive => {
  const entries = rawEntries;
  const read = (name: string): string | undefined => {
    const hit = findEntry(entries, name);
    if (!hit) return undefined;
    return decodeText(entries.find((e) => e.name === hit)!.data);
  };

  const infoCsv = read('info.csv');
  const infoTxt = read('info.txt');
  const metaJson = read('meta.json');

  const csv = infoCsv ? parseInfoCsv(infoCsv) : {};
  const txt = infoTxt ? parseInfoTxt(infoTxt) : {};
  let meta: Record<string, unknown> = {};
  if (metaJson) {
    try {
      const parsed = JSON.parse(metaJson);
      if (parsed && typeof parsed === 'object') meta = parsed as Record<string, unknown>;
    } catch {
      /* meta.json 损坏则忽略 */
    }
  }
  const metaString = (key: string): string | undefined =>
    typeof meta[key] === 'string' ? (meta[key] as string) : undefined;

  const chart = pickChart(entries, csv.chart ?? txt.chart ?? undefined);
  if (!chart) {
    throw new Error('压缩包内没有找到谱面文件');
  }

  const music =
    findEntry(entries, csv.music ?? txt.song ?? metaString('musicFile')) ??
    largest(entries, (e) => isAudio(e.name)) ??
    largest(entries, (e) => isVideo(e.name));

  const lineCsv = findEntry(entries, 'line.csv');
  const lineTextures = collectLineTextures(entries, chart, lineCsv);
  const isLineTexture = (name: string) => lineTextures.has(basename(name).toLowerCase());

  const illustration =
    findEntry(entries, csv.image ?? txt.picture ?? metaString('illustration')) ??
    largest(
      entries,
      (e) => isImage(e.name) && !isLineTexture(e.name) && !NON_ILLUSTRATION.test(e.name),
    ) ??
    largest(entries, (e) => isImage(e.name) && !isLineTexture(e.name)) ??
    largest(entries, (e) => isImage(e.name));

  return {
    entries,
    chart,
    music,
    illustration,
    extraJson: findEntry(entries, 'extra.json'),
    lineCsv,
    metadata: {
      name: csv.name ?? txt.name ?? metaString('name'),
      composer: csv.composer ?? txt.composer ?? metaString('artist'),
      charter: csv.designer ?? csv.charter ?? txt.charter ?? metaString('chartDesigner'),
      illustrator: csv.illustrator ?? txt.illustrator ?? metaString('illustrator'),
      level: csv.level ?? txt.level ?? declaredLevel,
    },
  };
};

/** 从 "IN Lv.15" / "Color Lv.?" 中取出定数，取不到返回 undefined。 */
export const parseArchiveDifficulty = (level: string | undefined): number | undefined => {
  const m = level?.match(/lv\.?\s*([\d.]+)/i);
  const value = m ? Number.parseFloat(m[1]) : NaN;
  return Number.isFinite(value) ? value : undefined;
};
