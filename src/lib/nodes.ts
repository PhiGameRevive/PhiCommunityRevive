/**
 * 部署节点选择。
 *
 * 本体分别部署在默认站点、Cloudflare Pages、Vercel、EdgeOne Pages 上，
 * 域名通过 .env 的 VITE_SITE_* 配置（未配置的节点不会出现在选择页）。
 *
 * 跨节点跳转会换域名，而 localStorage 按域名隔离：直接跳过去会被当成
 * 全新用户（重做界面缩放、开场不可跳过）。因此跳转时把已有设置放进
 * URL 查询参数，落地后由 applyInheritedParams() 写入新域名的 localStorage
 * 并用 replaceState 清掉参数。
 */
import { clampUiScale } from './uiScale';
import { INTRO_STYLES, type IntroStyle } from './introStyle';

export type NodeId = 'default' | 'cf' | 'vercel' | 'eo';

export interface DeployNode {
  id: NodeId;
  label: string;
  /** 部署地址；.env 未配置时为空字符串，该节点不展示 */
  origin: string;
  description: string;
}

const NODE_DEFS: { id: NodeId; label: string; origin: string; description: string }[] = [
  {
    id: 'default',
    label: '默认节点',
    origin: import.meta.env.VITE_SITE_DEFAULT ?? '',
    description: '主站，直连源站',
  },
  {
    id: 'cf',
    label: 'Cloudflare',
    origin: import.meta.env.VITE_SITE_CF ?? '',
    description: 'Cloudflare Pages 全球加速',
  },
  {
    id: 'vercel',
    label: 'Vercel',
    origin: import.meta.env.VITE_SITE_VERCEL ?? '',
    description: 'Vercel Edge Network',
  },
  {
    id: 'eo',
    label: 'EdgeOne',
    origin: import.meta.env.VITE_SITE_EO ?? '',
    description: '腾讯 EdgeOne，中国大陆优化',
  },
];

/** 已在 .env 中配置地址的节点 */
export const DEPLOY_NODES: DeployNode[] = NODE_DEFS.filter((n) => !!n.origin) as DeployNode[];

const normalizeHost = (origin: string): string => {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return '';
  }
};

/**
 * 当前正在访问的节点。按 hostname 精确匹配已配置节点；
 * 本地开发或未配置的域名下返回 null（选择页仍可用，只是没有"当前"高亮）。
 */
export const getCurrentNode = (): DeployNode | null => {
  const host = window.location.hostname.toLowerCase();
  return DEPLOY_NODES.find((n) => normalizeHost(n.origin) === host) ?? null;
};

/* ---------------- 跨节点设置继承 ---------------- */

const PARAM_NODE = 'node';
const PARAM_SCALE = 'scale';
const PARAM_ONBOARDED = 'onboarded';
const PARAM_INTRO = 'intro';

/** 跳转到目标节点，并把当前设置作为查询参数带过去 */
export const gotoNode = (node: DeployNode, settings: { scale: number; onboarded: boolean; intro: IntroStyle }): void => {
  const url = new URL(node.origin);
  url.pathname = '/';
  url.searchParams.set(PARAM_NODE, node.id);
  url.searchParams.set(PARAM_SCALE, String(clampUiScale(settings.scale)));
  url.searchParams.set(PARAM_INTRO, settings.intro);
  if (settings.onboarded) url.searchParams.set(PARAM_ONBOARDED, '1');
  window.location.href = url.href;
};

export interface InheritedParams {
  /** 跳转来源指定的节点 id（用于在选择页预选中） */
  node: NodeId | null;
  /** 是否携带了继承参数（携带则说明是跨节点跳转落地，不是真正的首次启动） */
  inherited: boolean;
}

/**
 * 消费 URL 上的继承参数：写入本域名的 localStorage，随后从地址栏抹掉。
 * 无参数时直接返回 { node: null, inherited: false }。
 */
export const applyInheritedParams = (): InheritedParams => {
  let params: URLSearchParams;
  try {
    params = new URL(window.location.href).searchParams;
  } catch {
    return { node: null, inherited: false };
  }

  const rawNode = params.get(PARAM_NODE);
  const rawScale = params.get(PARAM_SCALE);
  const rawIntro = params.get(PARAM_INTRO);
  const onboarded = params.get(PARAM_ONBOARDED) === '1';
  const hasAny = rawNode !== null || rawScale !== null || rawIntro !== null || onboarded;
  if (!hasAny) return { node: null, inherited: false };

  try {
    if (rawScale !== null && Number.isFinite(Number(rawScale))) {
      localStorage.setItem('phiUiScale', String(clampUiScale(Number(rawScale))));
    }
    if (rawIntro !== null && (INTRO_STYLES as readonly string[]).includes(rawIntro)) {
      localStorage.setItem('phiIntroStyle', rawIntro);
    }
    // 继承"已完成引导"标记：跨节点跳转后开场动画保持可跳过
    if (onboarded) localStorage.setItem('phiIntroSeen', 'true');
  } catch {
    /* 存储不可用时仅本次会话生效 */
  }

  // 清理地址栏，避免刷新/分享时重复继承
  try {
    const clean = new URL(window.location.href);
    [PARAM_NODE, PARAM_SCALE, PARAM_ONBOARDED, PARAM_INTRO].forEach((k) => clean.searchParams.delete(k));
    history.replaceState(null, '', `${clean.pathname}${clean.search}${clean.hash}`);
  } catch {
    /* 忽略 */
  }

  const node = NODE_DEFS.some((n) => n.id === rawNode) ? (rawNode as NodeId) : null;
  return { node, inherited: true };
};

/* ---------------- 延迟探测 ---------------- */

/**
 * 探测节点响应耗时。用 favicon 发 no-cors 请求：跨域下拿不到状态码，
 * 但只要连接建立成功 fetch 就会 resolve，足够反映网络往返耗时。
 * 超时或失败返回 null（选择页展示为「超时」）。
 */
export const probeNode = async (node: DeployNode, timeoutMs = 6000): Promise<number | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = performance.now();
  try {
    await fetch(`${node.origin}/favicon.ico?_probe=${Date.now()}`, {
      mode: 'no-cors',
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
    });
    return Math.round(performance.now() - start);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};
