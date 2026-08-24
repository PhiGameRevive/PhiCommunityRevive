/*
 * Derived from Team-PhiZone/player (https://github.com/Team-PhiZone/player).
 * SPDX-License-Identifier: MPL-2.0
 * Modified by PhiCommunity Revive for web-only usage.
 */
import { DEFAULT_RESOURCE_PACK } from './player/constants';
import type { Config, LevelType, MetadataEntry, RpeMeta, ResourcePack } from './types';

export const IS_TAURI = false;
export const IS_TAURI_LIKE: boolean = false;
export const IS_BROWSER_WITH_BACKEND = false;
export const IS_IOS = false;
export const IS_ANDROID_OR_IOS = false;
export const IS_IFRAME = window.self !== window.top;

export const isDebug = () => checkIfEnabled('debug');
export const showPerformance = () => checkIfEnabled('performance');
export const checkIfEnabled = (key: string) => localStorage.getItem(key) === 'true';

export const clamp = (num: number, lower: number, upper: number) => {
  return Math.min(upper, Math.max(lower, num));
};

export const haveSameKeys = (obj1: object, obj2: object): boolean => {
  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);
  return keys1.length === keys2.length && keys1.every((key) => key in obj2);
};

export const getLines = (text: string) =>
  text.split(/\r?\n/).filter((line) => line.trim().length > 0);

export const isPec = (pecCriteria: string[]) =>
  !isNaN(parseFloat(pecCriteria[0])) && /^bp \d+(\.\d+)? \d+(\.\d+)?$/.test(pecCriteria[1]);

export const readMetadataForChart = (text?: string, chartMeta?: RpeMeta): MetadataEntry => {
  const readFromText = (text: string = '') => {
    const lines = getLines(text);
    const fields = ['Name', 'Song', 'Picture', 'Chart', 'Composer', 'Charter', 'Level'];
    if (
      lines[0] === '#' &&
      fields.every((val) => lines.findIndex((line) => line.startsWith(val)) !== -1)
    ) {
      const info = fields.map(
        (field) =>
          lines
            .find((line) => line.startsWith(field))
            ?.slice(field.length + 1)
            .trim() ?? '',
      );
      return {
        name: info[0],
        song: info[1],
        picture: info[2],
        chart: info[3],
        composer: info[4],
        charter: info[5],
        illustration: '',
        level: info[6],
      };
    }
    const [_header, ...rows] = getLines(text);
    const data = rows.map((row) => row.split(','));
    if (data.length > 0 && data[0].length >= 10) {
      let i = data.length - 1;
      while (i > 0 && data[i].length < 10) i--;
      const [chart, song, picture, _aspectRatio, _scaleRatio, _globalAlpha, name, level, illustrator, designer] =
        data[i];
      return {
        name,
        song,
        picture,
        chart,
        composer: '',
        charter: designer,
        illustration: illustrator,
        level,
      };
    }
    console.debug('Chart metadata format not recognized:', text);
    return {
      name: '',
      song: '',
      picture: '',
      chart: '',
      composer: '',
      charter: '',
      illustration: '',
      level: '',
    };
  };

  let metadata = readFromText(text);
  if (chartMeta) {
    metadata = updateMetadata(metadata, chartMeta);
  }
  return metadata;
};

export const readMetadataForRespack = (text: string) => {
  try {
    const { id, ...rest } = JSON.parse(text) as ResourcePack<string> & { id?: string };
    const result = { id: id || crypto.randomUUID(), ...rest };
    return result;
  } catch (e) {
    console.debug('Failed to parse resource pack metadata:', e);
    return null;
  }
};

const updateMetadata = (metadata: MetadataEntry, chartMeta: RpeMeta): MetadataEntry => ({
  ...metadata,
  name: chartMeta.name || metadata.name,
  composer: chartMeta.composer || metadata.composer,
  charter: chartMeta.charter || metadata.charter,
  illustration: chartMeta.illustration || metadata.illustration,
  level: chartMeta.level || metadata.level,
});

export const inferLevelType = (level: string | null): LevelType => {
  if (!level) return 2;
  const lower = level.toLowerCase();
  const mapping: [string, LevelType][] = [
    ['ez', 0],
    ['hd', 1],
    ['in', 2],
    ['at', 3],
    ['sp', 4],
  ];
  for (const [suffix, type] of mapping) {
    if (lower.endsWith(suffix)) return type;
  }
  return 2;
};

export const fit = (
  width: number,
  height: number,
  containerWidth: number,
  containerHeight: number,
  contain = false,
) => {
  const isInside = width <= containerWidth && height <= containerHeight;
  const scale = contain
    ? Math.min(containerWidth / width, containerHeight / height)
    : Math.max(containerWidth / width, containerHeight / height);
  if (isInside && contain) {
    return { width, height };
  }
  return {
    width: width * scale,
    height: height * scale,
  };
};

export const triggerDownload = (blob: Blob, name: string, purpose?: string) => {
  if (purpose) {
    send({
      type: 'fileOutput',
      payload: {
        purpose,
        file: new File([blob], name),
      },
    });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};

/**
 * Parses the current URL parameters into a Config object.
 * Falls back to the 'player' item in localStorage when parameters are missing.
 */
export const getParams = (url?: string, loadFromStorage = true): Config | null => {
  const p = (url ? new URL(url) : new URL(window.location.href)).searchParams;
  const song = p.get('song');
  const chart = p.get('chart');
  const illustration = p.get('illustration');
  const assetNames = p
    .getAll('assetNames')
    .flatMap((v) => v.split(','))
    .map((v) => decodeURIComponent(v));
  const assetTypes = p
    .getAll('assetTypes')
    .flatMap((v) => v.split(','))
    .map((v) => parseInt(v));
  const assets = p.getAll('assets').flatMap((v) => v.split(','));

  const title = p.get('title');
  const composer = p.get('composer');
  const charter = p.get('charter');
  const illustrator = p.get('illustrator');
  const level = p.get('level');
  const levelType =
    (clamp(parseInt(p.get('levelType') ?? '2'), 0, 4) as LevelType) ?? inferLevelType(level);
  const difficulty = p.get('difficulty');

  const aspectRatio: number[] | null = p.getAll('aspectRatio').map((v) => parseInt(v));
  const backgroundBlur = parseFloat(p.get('backgroundBlur') ?? '1');
  const backgroundLuminance = parseFloat(p.get('backgroundLuminance') ?? '0.5');
  const chartFlipping = parseInt(p.get('chartFlipping') ?? '0');
  const chartOffset = parseInt(p.get('chartOffset') ?? '0');
  const fcApIndicator = ['1', 'true'].some((v) => v == (p.get('fcApIndicator') ?? '1'));
  const goodJudgment = parseInt(p.get('goodJudgment') ?? '160');
  const hitSoundVolume = parseFloat(p.get('hitSoundVolume') ?? '0.75');
  const lineThickness = parseFloat(p.get('lineThickness') ?? '1');
  const musicVolume = parseFloat(p.get('musicVolume') ?? '1');
  const noteSize = parseFloat(p.get('noteSize') ?? '1');
  const perfectJudgment = parseInt(p.get('perfectJudgment') ?? '80');
  const simultaneousNoteHint = ['1', 'true'].some(
    (v) => v == (p.get('simultaneousNoteHint') ?? '1'),
  );
  const timeScale = parseFloat(p.get('timeScale') ?? '1');

  const frameRate = parseFloat(p.get('frameRate') ?? '60');
  const overrideResolution: number[] | null = p
    .getAll('overrideResolution')
    .map((v) => parseInt(v));
  const resultsLoopsToRender = parseFloat(p.get('resultsLoopsToRender') ?? '1');
  const videoCodec = p.get('videoCodec') ?? 'libx264';
  const videoBitrate = parseInt(p.get('videoBitrate') ?? '6000');
  const audioBitrate = parseInt(p.get('audioBitrate') ?? '320');
  const vsync = ['1', 'true'].some((v) => v == (p.get('vsync') ?? '1'));
  const exportPath = p.get('exportPath') ?? undefined;

  const autoplay = ['1', 'true'].some((v) => v == p.get('autoplay'));
  const practice = ['1', 'true'].some((v) => v == p.get('practice'));
  const noFail = ['1', 'true'].some((v) => v == p.get('noFail'));
  const hidden = ['1', 'true'].some((v) => v == p.get('hidden'));
  const adjustOffset = ['1', 'true'].some((v) => v == p.get('adjustOffset'));
  const render = false;
  const autostart = ['1', 'true'].some((v) => v == p.get('autostart'));
  const newTab = ['1', 'true'].some((v) => v == p.get('newTab'));
  const inApp = parseInt(p.get('inApp') ?? '0');

  const automate = false;

  let resourcePack = DEFAULT_RESOURCE_PACK as ResourcePack<string>;
  const respackParam = p.get('resourcePack');
  if (respackParam) {
    try {
      resourcePack = JSON.parse(decodeURIComponent(respackParam)) as ResourcePack<string>;
    } catch (e) {
      console.error('Failed to parse resource pack: ', e);
    }
  }

  if (!song || !chart || !illustration || assetNames.length < assets.length) {
    if (!loadFromStorage) return null;
    const storageItem = localStorage.getItem('player');
    return storageItem ? JSON.parse(storageItem) : null;
  }
  return {
    resources: {
      song,
      chart,
      illustration,
      assetNames,
      assetTypes,
      assets,
    },
    metadata: {
      title,
      composer,
      charter,
      illustrator,
      levelType,
      level,
      difficulty: difficulty !== null ? parseFloat(difficulty) : null,
    },
    preferences: {
      aspectRatio: aspectRatio.length >= 2 ? [aspectRatio[0], aspectRatio[1]] : null,
      backgroundBlur,
      backgroundLuminance,
      chartFlipping,
      chartOffset,
      fcApIndicator,
      goodJudgment,
      hitSoundVolume,
      lineThickness,
      musicVolume,
      noteSize,
      perfectJudgment,
      simultaneousNoteHint,
      timeScale,
      useVideoBackground: true,
      videoBackgroundAlpha: 0.5,
      persistentSeekBar: false,
    },
    mediaOptions: {
      frameRate,
      overrideResolution:
        overrideResolution.length >= 2 ? [overrideResolution[0], overrideResolution[1]] : null,
      resultsLoopsToRender,
      videoCodec,
      videoBitrate,
      audioBitrate,
      vsync,
      exportPath,
    },
    resourcePack,
    autoplay,
    practice,
    noFail,
    hidden,
    adjustOffset,
    render,
    autostart,
    newTab,
    inApp,
    automate,
  };
};

export const send = (message: unknown) => parent.postMessage(message, '*');

export const versionCompare = (aString: string, bString: string) => {
  const a = aString.split('.').map((v) => parseInt(v));
  const b = bString.split('.').map((v) => parseInt(v));
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
};

export const fromRichText = (i: string) => i.replace(/<br\s*\/?>/g, '\n');

export const ensafeFilename = (filename: string) =>
  filename.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim();

export const notify = (message: string, _type: 'success' | 'error' = 'success', _onClick?: () => void) => {
  console.log(message);
};

export const alertError = (error?: Error, message?: string) => {
  console.error(message ?? error?.message ?? 'Unknown error', error);
};
