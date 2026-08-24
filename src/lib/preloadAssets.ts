/**
 * 首次启动的游玩素材预载。
 *
 * 清单从 DEFAULT_RESOURCE_PACK 反推（note 贴图、打击音效、判定特效图集、
 * 评级图、结算音、字体），再补上 Game 场景直接 load 的散件（暂停图标、
 * 进度条、判定线、评级音效、shader）。这样以后调整资源包不会漏掉文件。
 *
 * 刻意排除 NotoSansSC.ttf（约 17MB）：中文字体只在真正进入游玩页时才需要，
 * 放进开场预载会把首启拖到几十秒。其余素材合计约 5MB。
 *
 * 这些都是同源请求，Service Worker 的 phi-static 运行时缓存会顺手落盘，
 * 第二次启动几乎瞬间完成。
 */
import { base } from '$app/paths';
import { DEFAULT_RESOURCE_PACK } from './player/constants';

/** Game 场景额外直接加载的散件（不在资源包描述里） */
const EXTRA_ASSETS = [
  `${base}/game/Pause.svg`,
  `${base}/game/Progress.png`,
  `${base}/game/line.png`,
  `${base}/game/ending/GradeHit.wav`,
];

/** 谱面 extra.json 可引用的内置着色器 */
const SHADERS = [
  'chromatic',
  'circleBlur',
  'fisheye',
  'glitch',
  'grayscale',
  'image_noise_pr',
  'noise',
  'pixel',
  'radialBlur',
  'shockwave',
  'vignette',
];

/** 体积过大、改为进入游玩页时按需加载的资源 */
const DEFERRED = /NotoSansSC/i;

/** 汇总需要预载的同源素材 URL（已去重、已剔除延后项） */
export const collectGameAssetUrls = (): string[] => {
  const pack = DEFAULT_RESOURCE_PACK;
  const urls: string[] = [
    ...pack.noteSkins.map((s) => s.file),
    ...pack.hitSounds.map((s) => s.file),
    // hitEffects 在 ResourcePack 类型里可选，默认包一定有值
    ...(pack.hitEffects ? [pack.hitEffects.spriteSheet] : []),
    ...pack.ending.grades.map((g) => g.file),
    ...pack.ending.music.map((m) => m.file),
    ...pack.fonts.flatMap((f) =>
      f.type === 'bitmap' ? [f.texture, f.descriptor] : [f.file],
    ),
    ...EXTRA_ASSETS,
    ...SHADERS.map((name) => `${base}/game/shaders/${name}.glsl`),
  ];
  return [...new Set(urls.filter((u): u is string => !!u && !DEFERRED.test(u)))];
};

/** 并发上限：太高会让慢网络下的首屏请求相互挤压 */
const CONCURRENCY = 6;

/**
 * 批量拉取素材，onProgress 以 0~1 汇报完成比例。
 * 单个文件失败只记日志不抛错——引擎届时会自行重试该资源，
 * 不能因为一张贴图 404 就卡住整个开场流程。
 */
export const preloadGameAssets = async (
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<void> => {
  const urls = collectGameAssetUrls();
  const total = urls.length;
  let done = 0;
  let cursor = 0;

  const worker = async () => {
    while (cursor < urls.length) {
      if (signal?.aborted) return;
      const url = urls[cursor++];
      try {
        const res = await fetch(url, { credentials: 'omit', signal });
        // 读完 body 才算真正落到 HTTP / SW 缓存里
        if (res.ok) await res.arrayBuffer();
        else console.warn(`preload asset HTTP ${res.status}: ${url}`);
      } catch (e) {
        if (signal?.aborted) return;
        console.warn(`preload asset failed: ${url}`, e);
      }
      done++;
      onProgress?.(done / total);
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker));
};
