/**
 * PhiCommunity Service Worker（vite-plugin-pwa injectManifest 策略，构建时注入 self.__WB_MANIFEST）。
 *
 * 分层缓存策略：
 *  - 预缓存（__WB_MANIFEST）：构建产物 JS/CSS/HTML 与少量静态文件，保证断网时应用壳可用；
 *  - 运行时缓存：
 *    - phi-pages  导航 HTML：网络优先，离线时回退已访问过的页面或预缓存的首页；
 *    - phi-static 同源静态资源（贴图/字体/音效/shader 等，超过预缓存大小限制的部分首次使用后落盘）；
 *    - phi-covers 歌曲封面：缓存优先 + 条目淘汰（选歌页会把封面列表推过来后台串行预热）；
 *    - phi-data   谱面列表/元数据 JSON 与源站 API：先回缓存、后台刷新（慢网络下列表秒开）；
 *    - phi-media  音频/视频/谱面包（游玩时已下载过的大文件，重玩同一首几乎零等待）。
 *
 * 页面通过 postMessage({ type: 'PRECACHE_URLS', urls }) 触发远程资源预热，
 * 串行下载以免挤占正常浏览流量；{ type: 'SKIP_WAITING' } 用于立即激活新版本。
 */
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

self.skipWaiting();
clientsClaim();

const PAGES_CACHE = 'phi-pages-v1';
const STATIC_CACHE = 'phi-static-v1';
const COVER_CACHE = 'phi-covers-v1';
const DATA_CACHE = 'phi-data-v1';
const MEDIA_CACHE = 'phi-media-v1';

/**
 * 应用壳 HTML。
 *
 * 注意：这些文件不在 __WB_MANIFEST 里 —— vite-plugin-pwa 在 Vite 构建阶段生成 SW，
 * 而 SvelteKit 的 adapter-static 要等 Vite 结束后才写出 HTML，所以注入清单扫不到它们。
 * 因此在 install 阶段主动抓一次，保证首次安装后即可离线打开。
 */
const SHELL_URLS = ['/', '/404.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PAGES_CACHE);
      await Promise.all(
        SHELL_URLS.map(async (url) => {
          try {
            const res = await fetch(new Request(url, { cache: 'reload' }));
            if (res.ok) await cache.put(url, res);
          } catch {
            /* 安装期离线时忽略，后续导航会补缓存 */
          }
        }),
      );
    })(),
  );
});

/** 各运行时缓存的条目上限，超出后按写入顺序淘汰最旧的（媒体为游玩历史，封面覆盖全曲库） */
const CACHE_LIMITS = {
  [COVER_CACHE]: 400,
  [DATA_CACHE]: 800,
  [MEDIA_CACHE]: 8,
};

const trimCache = async (name) => {
  const max = CACHE_LIMITS[name];
  if (!max) return;
  try {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
  } catch {
    /* 清理失败不影响正常服务 */
  }
};

/** 缓存更新后触发的容量裁剪插件 */
const limitPlugin = (name) => ({
  cacheDidUpdate: async () => {
    await trimCache(name);
  },
});

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg|avif|apng|bmp|ico)(\?|#|$)/i;
const MEDIA_EXT = /\.(mp3|ogg|oga|opus|wav|flac|m4a|aac|mp4|m4v|webm|mov|zip|pez)(\?|#|$)/i;
/** 已知谱面源主机：PTC / PhiCommunity 图床（focalors.ltd 系）与 PhiZone */
const SOURCE_HOST = /(^|\.)focalors\.ltd$|(^|\.)phizone\.org$/i;

/** 带鉴权头（PhiZone 登录文件）或 Range（音视频流式拖动）的请求一律不进运行时缓存 */
const isCacheable = (request) =>
  request.method === 'GET' &&
  !request.headers.has('range') &&
  !request.headers.has('authorization');

// ---- 导航请求：网络优先，离线回退已访问页面，最后回落应用壳 ----
registerRoute(
  ({ request }) => request.mode === 'navigate',
  async ({ event }) => {
    const cache = await caches.open(PAGES_CACHE);
    try {
      const fresh = await fetch(event.request);
      if (fresh.ok) cache.put(event.request, fresh.clone());
      return fresh;
    } catch (offlineError) {
      const cached =
        (await cache.match(event.request, { ignoreSearch: true })) ??
        (await cache.match('/', { ignoreSearch: true })) ??
        (await cache.match('/404.html'));
      if (cached) return cached;
      throw offlineError;
    }
  },
);

// ---- 同源静态资源：缓存优先。预缓存没覆盖到的贴图/字体/音效在首次使用后落盘，支撑离线游玩 ----
registerRoute(
  ({ url }) =>
    url.origin === self.location.origin &&
    /\.(png|jpe?g|webp|gif|svg|ttf|otf|woff2?|mp3|ogg|wav|glsl|fnt)(\?|#|$)/i.test(url.pathname),
  new CacheFirst({ cacheName: STATIC_CACHE }),
);

// ---- 音频/视频/谱面包：缓存优先（游玩时下载过即缓存，重玩秒加载）----
registerRoute(
  ({ url, request }) =>
    isCacheable(request) &&
    (MEDIA_EXT.test(url.pathname) || request.destination === 'audio' || request.destination === 'video'),
  new CacheFirst({ cacheName: MEDIA_CACHE, plugins: [limitPlugin(MEDIA_CACHE)] }),
);

// ---- 封面等图片：缓存优先 + 容量淘汰 ----
registerRoute(
  ({ url, request }) =>
    isCacheable(request) && (IMAGE_EXT.test(url.pathname) || request.destination === 'image'),
  new CacheFirst({ cacheName: COVER_CACHE, plugins: [limitPlugin(COVER_CACHE)] }),
);

// ---- 数据类请求：先回缓存再后台刷新（SWR）。慢网络下谱面列表/元数据秒开，后台静默更新 ----
registerRoute(
  ({ url, request }) => {
    if (!isCacheable(request)) return false;
    if (/\.json(\?|#|$)/i.test(url.pathname)) return true;
    return SOURCE_HOST.test(url.hostname);
  },
  new StaleWhileRevalidate({ cacheName: DATA_CACHE, plugins: [limitPlugin(DATA_CACHE)] }),
);

self.addEventListener('message', (event) => {
  const data = event.data ?? {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (data.type === 'PRECACHE_URLS' && Array.isArray(data.urls)) {
    event.waitUntil(precacheUrls(data.urls));
  }
});

/** 批量预热远程资源（以封面为主）。逐个串行下载，避免挤占页面正在进行的加载。 */
const precacheUrls = async (urls) => {
  const targets = [];
  for (const raw of urls) {
    if (typeof raw !== 'string' || !/^https?:\/\//i.test(raw)) continue;
    let url;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (IMAGE_EXT.test(url.pathname)) targets.push([COVER_CACHE, url.href]);
    else if (MEDIA_EXT.test(url.pathname)) targets.push([MEDIA_CACHE, url.href]);
  }
  for (const [cacheName, href] of targets) {
    try {
      const cache = await caches.open(cacheName);
      if (await cache.match(href)) continue;
      // 优先带 CORS 请求；服务器不支持 CORS 时退回 no-cors 存 opaque 响应（仅用于展示无影响）
      let res = await fetch(new Request(href, { mode: 'cors', credentials: 'omit' })).catch(() => null);
      if (!res || (!res.ok && res.type !== 'opaque')) {
        res = await fetch(new Request(href, { mode: 'no-cors', credentials: 'omit' })).catch(() => null);
      }
      if (res && (res.ok || res.type === 'opaque')) await cache.put(href, res);
    } catch {
      /* 单个失败不影响其余 */
    }
  }
  await trimCache(COVER_CACHE);
  await trimCache(MEDIA_CACHE);
};
