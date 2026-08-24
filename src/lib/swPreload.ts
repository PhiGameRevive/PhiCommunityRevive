/**
 * Service Worker 桥接：
 * 把远程资源（主要是歌曲封面）列表交给 SW 后台串行预热到 Cache Storage。
 * 二次访问选歌页时封面直接命中缓存秒显示，离线也能正常渲染。
 */

/** 首次访问时 SW 尚未接管页面，先攒起来等 controllerchange 再补发一次 */
let pending: string[] = [];

const flushPending = () => {
  const urls = pending;
  pending = [];
  if (urls.length > 0) navigator.serviceWorker.controller?.postMessage({ type: 'PRECACHE_URLS', urls });
};

/**
 * 把 URL 列表推给 Service Worker 预热（只接受 http/https，blob:/data: 会被忽略）。
 * SW 未接管页面前（首次访问、开发模式）静默降级为空操作，不影响页面功能。
 */
export const swPrecacheUrls = (urls: string[]): void => {
  const sw = navigator.serviceWorker;
  if (!sw) return;
  const list = [...new Set(urls.filter((u) => /^https?:\/\//i.test(u)))];
  if (list.length === 0) return;
  if (sw.controller) {
    sw.controller.postMessage({ type: 'PRECACHE_URLS', urls: list });
    return;
  }
  // 开发模式没有 SW（devOptions.enabled 为 false），不要无限堆积
  if (import.meta.env.DEV) return;
  pending = [...new Set([...pending, ...list])];
  sw.removeEventListener('controllerchange', flushPending);
  sw.addEventListener('controllerchange', flushPending, { once: true });
};
