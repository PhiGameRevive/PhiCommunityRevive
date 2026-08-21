<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { fly } from 'svelte/transition';
  import { goto } from '$app/navigation';
  import { getResult, getAllResults, getAllLocalCharts, type LocalChart } from '$lib/db';
  import { getRank, type Level, type Rank } from '$lib/meta';
  import { fetchSongs, SOURCE_LABELS, type ChartSourceId, type SourceSong } from '$lib/sources';
  import { fetchPzCharts, fetchPzChartFile, getToken, login, setToken, PZ_LEVEL_TYPE } from '$lib/phizone';
  import { alert as alertModal, prompt as pzPrompt } from '$lib/modal';
  import { loadPreferences, savePreferences } from '$lib/preferences';
  import { preparePlay, setPendingPlay, type PlaySource } from '$lib/playLoader';
  import { takePreloadedSongLists, peekPreloadedSongLists } from '$lib/preload';
  import PhigrosLoading from '$lib/components/PhigrosLoading.svelte';
  import { randomTip } from '$lib/loadingTips';

  const LEVELS: Level[] = ['ez', 'hd', 'in', 'at', 'sp'];
  const LEVEL_LABELS: Record<Level, string> = {
    ez: 'EZ',
    hd: 'HD',
    in: 'IN',
    at: 'AT',
    sp: 'SP',
  };
  const SOURCES: ChartSourceId[] = ['phi', 'ptc', 'pz'];

  type SongItem = {
    codename: string;
    id?: string;
    source: 'phi' | 'ptc' | 'pz' | 'local';
    name: string;
    artist: string;
    illustrationUrl: string;
    songUrl: string;
    levels: Partial<Record<Level, { chart: string; rank?: number; charter?: string; levelName?: string }>>;
    /** PhiZone 源：具体谱面（chart）id，用于拉取附加资源 */
    chartId?: string;
    backgroundAnimation?: string;
    songIsVideo?: boolean;
    local?: LocalChart;
  };

  let songsBySource: Record<ChartSourceId, SongItem[]> = { phi: [], ptc: [], pz: [] };
  let localSongs: SongItem[] = [];
  let activeSource: ChartSourceId | 'local' = 'phi';
  let error = '';
  let loaded = false;
  let pzLoggedIn = false;
  let pzSourceError = '';

  let level: Level = 'ez';
  let current = 0;
  let scores = new Map<string, { score: number; accuracy: number }>();
  let rks = 0;
  let playerName = 'GUEST';

  let starting = false;
  let showOverview = false;
  let loadProgress = 0;
  let loadDetail = '';
  let previewAudio: HTMLMediaElement | null = null;
  let previewUrl = '';
  let previewRequest = 0;
  let previewPlaying = false;
  let showPreviewList = false;
  let previewTime = 0;
  let previewDuration = 0;
  let loadingController: AbortController | null = null;
  let loadingPrepared: import('$lib/playLoader').PreparedPlay | null = null;
  let loadingRun = 0;
  let readyCountdown = 0;
  let readyTimer = 0;
  let readyCountdownTimer = 0;
  let readyResolve: (() => void) | null = null;
  let settingsHover = false;
  let settingsPressed = false;
  let loadingPreferences = loadPreferences();
  let previewContext: AudioContext | null = null;
  let previewSource: MediaElementAudioSourceNode | null = null;
  let previewFilter: BiquadFilterNode | null = null;
  let previewGain: GainNode | null = null;

  const stopPreview = () => {
    previewRequest++;
    previewSource?.disconnect();
    previewFilter?.disconnect();
    previewGain?.disconnect();
    previewSource = null;
    previewFilter = null;
    previewGain = null;
    if (previewContext && previewContext.state !== 'closed') void previewContext.close();
    previewContext = null;
    if (previewAudio) {
      previewAudio.pause();
      previewAudio.removeAttribute('src');
      previewAudio.load();
      previewAudio = null;
    }
    previewPlaying = false;
    previewTime = 0;
    previewDuration = 0;
    if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    previewUrl = '';
  };

  const setPreviewMuffled = async (muffled: boolean) => {
    const audio = previewAudio;
    if (!audio) return;
    try {
      if (!previewContext) {
        previewContext = new AudioContext();
        previewSource = previewContext.createMediaElementSource(audio);
        previewFilter = previewContext.createBiquadFilter();
        previewFilter.type = 'lowpass';
        previewFilter.Q.value = 1.25;
        previewGain = previewContext.createGain();
        previewGain.gain.value = 0.35;
        audio.volume = 1;
        previewSource.connect(previewFilter).connect(previewGain).connect(previewContext.destination);
      }
      if (previewContext.state === 'suspended') await previewContext.resume();
      // 首次自动播放可能被浏览器拦截；这里处于“开始游玩”的用户点击手势中，
      // 必须再次主动 play，否则只接上滤波链并不会让暂停中的音频开始播放。
      if (audio.paused) await audio.play();
      const now = previewContext.currentTime;
      const frequency = previewFilter!.frequency;
      frequency.cancelScheduledValues(now);
      frequency.setValueAtTime(Math.max(frequency.value, 20), now);
      frequency.exponentialRampToValueAtTime(muffled ? 650 : 18000, now + 0.45);
    } catch (error) {
      // 不支持 Web Audio / CORS 不允许接管音频时保留原始预览，不能阻断谱面加载。
      console.warn('无法应用预览低通滤波', error);
      audio.volume = 0.35;
      if (audio.paused) {
        try {
          await audio.play();
        } catch (playError) {
          console.info('歌曲预览仍被浏览器阻止', playError);
        }
      }
    }
  };

  const getPreviewUrl = (item: SongItem): string => {
    if (item.source !== 'local') return item.songUrl;
    const file = item.local?.files.find((f) => f.name === item.local?.musicFile);
    return file ? URL.createObjectURL(file.blob) : '';
  };

  const playPreview = (item: SongItem | null) => {
    stopPreview();
    if (!item || !item.songUrl && !item.local) return;
    const url = getPreviewUrl(item);
    if (!url) return;
    const request = previewRequest;
    previewUrl = url;
    // 视频作为音乐时用 video 元素解码音轨；部分浏览器用 Audio 打开 MP4/WebM
    // 会成功加载却没有声音。普通歌曲仍使用轻量的 Audio 元素。
    previewAudio = item.songIsVideo ? document.createElement('video') : new Audio();
    // MediaElementAudioSource 接管远程音频时需要在设置 src 前声明 CORS，
    // 否则部分浏览器不会报错，却会让滤波链输出静音。
    previewAudio.crossOrigin = 'anonymous';
    previewAudio.preload = 'auto';
    if (previewAudio instanceof HTMLVideoElement) {
      previewAudio.muted = false;
      previewAudio.controls = false;
      previewAudio.playsInline = true;
      previewAudio.setAttribute('aria-hidden', 'true');
      previewAudio.style.display = 'none';
    }
    previewAudio.src = url;
    previewAudio.loop = false;
    previewAudio.volume = 0.35;
    previewAudio.onplay = () => (previewPlaying = true);
    previewAudio.onpause = () => (previewPlaying = false);
    previewAudio.ontimeupdate = () => {
      if (previewAudio) previewTime = previewAudio.currentTime;
    };
    previewAudio.ondurationchange = () => {
      previewDuration = previewAudio && Number.isFinite(previewAudio.duration) ? previewAudio.duration : 0;
    };
    previewAudio.onended = () => shiftPreview(1);
    void previewAudio.play().catch((error) => {
      // 首次打开页面时浏览器可能阻止自动播放；用户点击选歌后会再次尝试。
      if (request === previewRequest) console.info('歌曲预览需要用户手势才能播放', error);
    });
  };

  const shiftPreview = (delta: number) => {
    const list = currentList();
    if (list.length === 0) return;
    selectSong((current + delta + list.length) % list.length);
  };

  const togglePreview = () => {
    if (!previewAudio) {
      playPreview(song());
      return;
    }
    if (previewAudio.paused) {
      if (previewContext?.state === 'suspended') void previewContext.resume();
      void previewAudio.play().catch((error) => console.info('歌曲预览需要用户手势才能播放', error));
    } else {
      previewAudio.pause();
    }
  };

  const seekPreview = (value: number) => {
    if (!previewAudio || !Number.isFinite(value)) return;
    previewAudio.currentTime = Math.min(Math.max(value, 0), previewDuration || 0);
    previewTime = previewAudio.currentTime;
  };

  // ---- 搜索 ----
  let query = '';
  const onSearchInput = () => {
    current = 0;
    const first = currentList()[0];
    if (first) {
      const lp = LEVELS.find((l) => first.levels[l]);
      if (lp) level = lp;
    }
    playPreview(currentList()[0] ?? null);
  };
  const clearSearch = () => {
    query = '';
    onSearchInput();
  };

  // ---- 进入页面时的全屏加载界面（开场/结算/设置/中途退出回到选歌页时统一展示）----
  const MIN_PAGE_LOADING_MS = 700;
  let pageLoadingStart = 0;
  let pageProgress = 0;
  let pageProgressTimer = 0;
  let pageTip = '';
  let pageCover = '/ui/ElementSqare.webp';
  let pageReveal = false; // 加载界面淡出完成，才允许移除浮层

  // ---- 加载界面封面池：直接访问/刷新时也能立即随机显示歌曲封面 ----
  const COVER_POOL_KEY = 'songCoverPool';
  let coverPool: string[] = [];
  const pickCover = () => {
    if (coverPool.length > 0) {
      pageCover = coverPool[Math.floor(Math.random() * coverPool.length)];
    }
  };
  const saveCoverPool = (urls: string[]) => {
    try {
      localStorage.setItem(COVER_POOL_KEY, JSON.stringify(urls));
    } catch {
      /* 配额/隐私模式等忽略 */
    }
  };
  const loadCoverPool = (): string[] => {
    try {
      const cached = localStorage.getItem(COVER_POOL_KEY);
      if (!cached) return [];
      const arr = JSON.parse(cached) as unknown;
      return Array.isArray(arr) ? arr.filter((u): u is string => typeof u === 'string') : [];
    } catch {
      return [];
    }
  };

  // ---- Phigros loading 动画（复刻 ploading.js）----
  // 以逻辑像素绘制，backing store 放大 LOADING_DPR 倍保证文字锐利
  const LOADING_W = 340;
  const LOADING_H = 160;
  const LOADING_DPR = 2;

  let loadingCanvas: HTMLCanvasElement | undefined;
  let animId = 0;
  let animStart = 0;

  const drawLoading = (now: number) => {
    const canvas = loadingCanvas;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      // canvas 尚未挂载（starting 刚置位）→ 下一帧重试，否则动画永远不会开始
      if (starting) animId = requestAnimationFrame(drawLoading);
      return;
    }
    const w = LOADING_W;
    const h = LOADING_H;
    ctx.setTransform(LOADING_DPR, 0, 0, LOADING_DPR, 0, 0);
    const t = (now - animStart) / 15;
    ctx.clearRect(0, 0, w, h);
    ctx.font = '34px "Courier New", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    const msg = 'LOADING';
    const dxs = ctx.measureText(msg).width;
    ctx.globalCompositeOperation = 'xor';
    const hw = 26 + dxs / 2;
    ctx.fillRect(
      Math.sin(t / 20) < 0 ? Math.cos(t / 20) * hw + w / 2 : w / 2 - hw,
      h / 2 - 33,
      -Math.cos(t / 20) * hw + hw,
      66,
    );
    ctx.fillText(msg, w / 2, h / 2);
    ctx.globalCompositeOperation = 'source-over';
    // 真实下载进度条（位于 LOADING 字样下方）
    const barW = hw * 2;
    const barX = w / 2 - hw;
    const barY = h / 2 + 45;
    const barH = 5;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(barX, barY, barW * loadProgress, barH);
    if (loadDetail) {
      ctx.font = '16px "Courier New", ui-monospace, monospace';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
      ctx.fillText(loadDetail, w / 2, barY + 22);
    }
    animId = requestAnimationFrame(drawLoading);
  };

  const startLoadingAnimation = () => {
    starting = true;
    loadProgress = 0;
    loadDetail = '';
    animStart = performance.now();
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(drawLoading);
  };

  const stopLoadingAnimation = () => {
    cancelAnimationFrame(animId);
    animId = 0;
    starting = false;
    loadProgress = 0;
    loadDetail = '';
  };

  const clearReadyCountdown = () => {
    clearTimeout(readyTimer);
    clearInterval(readyCountdownTimer);
    readyTimer = 0;
    readyCountdownTimer = 0;
  };

  const scheduleReadyCountdown = () => {
    clearReadyCountdown();
    if (settingsHover || settingsPressed || !readyResolve) return;
    readyCountdown = 3;
    readyTimer = window.setTimeout(() => {
      const resolve = readyResolve;
      readyResolve = null;
      clearReadyCountdown();
      resolve?.();
    }, 3000);
    readyCountdownTimer = window.setInterval(() => {
      readyCountdown = Math.max(1, readyCountdown - 1);
    }, 1000);
  };

  const waitForReadyIdle = () =>
    new Promise<void>((resolve) => {
      readyResolve = resolve;
      scheduleReadyCountdown();
    });

  const resetReadyCountdown = () => {
    if (readyResolve) scheduleReadyCountdown();
  };

  const updateLoadingPreference = <K extends keyof typeof loadingPreferences>(
    key: K,
    value: (typeof loadingPreferences)[K],
  ) => {
    loadingPreferences = { ...loadingPreferences, [key]: value };
    savePreferences(loadingPreferences);
    if (loadingPrepared) loadingPrepared.config.preferences = loadingPreferences;
    resetReadyCountdown();
  };

  const cancelSongLoading = () => {
    if (!starting) return;
    loadingRun++;
    loadingController?.abort();
    loadingController = null;
    loadingPrepared?.release();
    loadingPrepared = null;
    clearReadyCountdown();
    const resolve = readyResolve;
    readyResolve = null;
    resolve?.();
    readyCountdown = 0;
    stopLoadingAnimation();
    void setPreviewMuffled(false);
  };

  /** LOADING 动画的最短展示时长，避免资源命中缓存时一闪而过。 */
  const MIN_LOADING_MS = 900;

  const waitForMinimumLoading = async () => {
    const elapsed = performance.now() - animStart;
    if (elapsed < MIN_LOADING_MS) {
      await new Promise((resolve) => setTimeout(resolve, MIN_LOADING_MS - elapsed));
    }
  };

  /** 当前源歌曲列表（应用搜索过滤：歌名 / 艺术家 / 谱师 / id，空格分隔的多个词需全部命中） */
  const currentList = (): SongItem[] => {
    const list = activeSource === 'local' ? localSongs : songsBySource[activeSource];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((s) => {
      const haystack = [s.name, s.artist, s.id ?? '', ...Object.values(s.levels).map((l) => l?.charter ?? '')]
        .join(' ')
        .toLowerCase();
      return q.split(/\s+/).every((part) => haystack.includes(part));
    });
  };

  const song = () => currentList()[current] ?? null;
  const chartFile = () => {
    const s = song();
    return s?.levels[level]?.chart;
  };
  const chartRank = () => {
    const s = song();
    return s?.levels[level]?.rank ?? 0;
  };
  const charter = () => {
    const s = song();
    return s?.levels[level]?.charter;
  };
  const best = () => {
    const s = song();
    return s ? scores.get(`${s.codename}-${level}`) : undefined;
  };

  const localIllustrationUrl = (l: LocalChart): string => {
    if (!l.illustration) return '/banner.png';
    const file = l.files.find((f) => f.name === l.illustration);
    return file ? URL.createObjectURL(file.blob) : '/banner.png';
  };

  const localToItem = (l: LocalChart): SongItem => {
    const levels: SongItem['levels'] = {};
    for (const lv of LEVELS) {
      const file = l.chartFiles[lv];
      if (file) levels[lv] = { chart: file, rank: 0, charter: 'Local' };
    }
    return {
      codename: l.codename,
      source: 'local',
      name: l.name,
      artist: l.artist,
      illustrationUrl: localIllustrationUrl(l),
      songUrl: '',
      levels,
      local: l,
    };
  };

  onMount(async () => {
    playerName = localStorage.getItem('playerName') ?? 'GUEST';
    pzLoggedIn = !!getToken();
    // 进入加载界面即随机选一张歌曲封面并固定显示（与开场页一致，不轮播）：
    // 优先用开场页预载的列表，直接访问/刷新时用上次缓存的封面池
    coverPool = loadCoverPool();
    const peek = peekPreloadedSongLists();
    if (peek) {
      const peekUrls = [...peek.phi, ...peek.ptc, ...peek.pz]
        .map((s) => s.illustration)
        .filter((u): u is string => Boolean(u));
      if (peekUrls.length > 0) coverPool = peekUrls;
    }
    pickCover();
    // 进入页面即展示加载界面：进度条随经过时间推进，数据就绪后走满
    pageLoadingStart = performance.now();
    pageTip = randomTip();
    pageProgressTimer = window.setInterval(() => {
      pageProgress = Math.min((performance.now() - pageLoadingStart) / MIN_PAGE_LOADING_MS, 0.9);
    }, 60);
    try {
      // 开场动画期间已预载三个谱面源列表，命中则直接使用（跳过重复的网络请求）
      const pre = takePreloadedSongLists();
      const [phi, ptc, pz, locals] = pre
        ? [pre.phi, pre.ptc, pre.pz, await getAllLocalCharts()]
        : await Promise.all([
            fetchSongs('phi').catch((e) => {
              console.error('phi source failed', e);
              return [];
            }),
            fetchSongs('ptc').catch((e) => {
              console.error('ptc source failed', e);
              return [];
            }),
            fetchSongs('pz').catch((e) => {
              console.error('pz source failed', e);
              pzSourceError = e instanceof Error ? e.message : String(e);
              return [];
            }),
            getAllLocalCharts(),
          ]);
      songsBySource.phi = phi.map((s) => ({
        codename: `phi-${s.id}`,
        source: 'phi',
        name: s.name,
        artist: s.artist,
        illustrationUrl: s.illustration,
        songUrl: s.song,
        levels: s.levels,
        backgroundAnimation: s.backgroundAnimation,
        songIsVideo: s.songIsVideo,
      }));
      songsBySource.ptc = ptc.map((s) => ({
        codename: `ptc-${s.id}`,
        source: 'ptc',
        name: s.name,
        artist: s.artist,
        illustrationUrl: s.illustration,
        songUrl: s.song,
        levels: s.levels,
        backgroundAnimation: s.backgroundAnimation,
        songIsVideo: s.songIsVideo,
      }));
      songsBySource.pz = pz.map((s) => ({
        codename: `pz-${s.id}`,
        id: s.id,
        source: 'pz',
        name: s.name,
        artist: s.artist,
        illustrationUrl: s.illustration,
        songUrl: s.song,
        levels: s.levels,
      }));
      localSongs = locals.map(localToItem);

      // 成绩（兼容旧项目：历史记录以无源前缀的原始 codename 为 key，未命中时回退）
      const allSongs = [...localSongs, ...songsBySource.phi, ...songsBySource.ptc, ...songsBySource.pz];
      const scoreEntries = await Promise.all(
        allSongs.flatMap((s) =>
          LEVELS.map(async (l) => {
            const rawId = s.codename.replace(/^(phi|ptc|pz)-/, '');
            const r =
              (await getResult(`${s.codename}-${l}`)) ??
              (rawId !== s.codename ? await getResult(`${rawId}-${l}`) : undefined);
            return [r ? `${s.codename}-${l}` : '', r ? { score: r.score, accuracy: r.accuracy } : null] as const;
          }),
        ),
      );
      scoreEntries.forEach(([k, v]) => {
        if (k && v) scores.set(k, v);
      });
      const all = await getAllResults();
      rks = all.reduce((max, r) => Math.max(max, r.rankingScore), 0);

      // 自动选择最低可玩难度
      const first = currentList()[0];
      if (first) {
        const lp = LEVELS.find((l) => first.levels[l]);
        if (lp) level = lp;
      }
      loaded = true;
      playPreview(currentList()[0] ?? null);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      loaded = true;
    }

    // 加载界面收尾：进度走满，更新封面池（供下次直接访问/刷新时立即随机）。
    // 封面保持进入时随机的那张不动；仅首次冷启动（无缓存池无预载）时补随机一张
    clearInterval(pageProgressTimer);
    pageProgress = 1;
    const all = [...localSongs, ...songsBySource.phi, ...songsBySource.ptc, ...songsBySource.pz].filter(
      (s) => s.illustrationUrl,
    );
    const urls = all.map((s) => s.illustrationUrl);
    if (urls.length > 0) {
      coverPool = urls;
      // 本地谱面封面是 blob URL，跨刷新失效，只缓存远程 URL
      saveCoverPool(urls.filter((u) => !u.startsWith('blob:')));
      if (pageCover === '/ui/ElementSqare.webp') pickCover();
    }
    window.setTimeout(() => {
      pageReveal = true;
    }, 500);

    // 全局监听拖拽移动/释放（指针离开列表项后仍能跟随）
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  });

  onDestroy(() => {
    cancelAnimationFrame(animId);
    clearInterval(pageProgressTimer);
    clearReadyCountdown();
    readyResolve = null;
    loadingController?.abort();
    loadingPrepared?.release();
    stopPreview();
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
  });

  const switchSource = (s: ChartSourceId | 'local') => {
    if (starting) return;
    activeSource = s;
    current = 0;
    const first = currentList()[0];
    if (first) {
      const lp = LEVELS.find((l) => first.levels[l]);
      if (lp) level = lp;
    }
    playPreview(first ?? null);
  };

  const selectSong = (i: number) => {
    if (starting) return;
    current = i;
    const s = currentList()[i];
    if (s) {
      const lp = LEVELS.find((l) => s.levels[l]);
      if (lp) level = lp;
    }
    playPreview(s);
  };

  // ---- 左栏拖拽选歌（pointer 事件，避免浏览器默认图片拖拽/下载）----
  let dragIndex: number | null = null;
  let dragActive = false;
  let ghostX = 0;
  let ghostY = 0;
  let dragStartX = 0;
  let dragStartY = 0;
  let dropActive = false;
  let detailEl: HTMLDivElement | undefined;

  const inDetailZone = (x: number, y: number): boolean => {
    if (!detailEl) return false;
    const r = detailEl.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };

  const onPointerDown = (e: PointerEvent, i: number) => {
    if (starting || e.button !== 0) return;
    dragIndex = i;
    dragActive = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dropActive = false;
  };

  const onPointerMove = (e: PointerEvent) => {
    if (dragIndex === null) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    if (!dragActive && Math.hypot(dx, dy) > 8) {
      dragActive = true;
    }
    if (dragActive) {
      ghostX = e.clientX;
      ghostY = e.clientY;
      dropActive = inDetailZone(e.clientX, e.clientY);
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    if (dragIndex === null) return;
    const wasDrag = dragActive;
    const idx = dragIndex;
    dragIndex = null;
    dragActive = false;
    dropActive = false;
    if (wasDrag && inDetailZone(e.clientX, e.clientY)) {
      selectSong(idx);
    }
  };

  /** 写入 sessionStorage 供刷新/直接进入 /play 时还原（剔除不可序列化的本地 Blob）。 */
  const rememberSong = (item: SongItem) => {
    const { local: _local, ...serializable } = item;
    sessionStorage.setItem('currentSong', JSON.stringify(serializable));
    sessionStorage.setItem('currentLevel', level);
  };

  /**
   * 预加载并跳转：在选歌页的 LOADING 动画期间把谱面、曲绘、音频下载完毕，
   * 组装好 Config 寄存给游玩页，再跳转。这样游玩页拿到的都是本地 blob，不再有网络等待。
   */
  const loadAndPlay = async (item: SongItem) => {
    await setPreviewMuffled(true);
    loadingPreferences = loadPreferences();
    startLoadingAnimation();
    const run = ++loadingRun;
    const controller = new AbortController();
    loadingController = controller;
    try {
      const prepared = await preparePlay(item as PlaySource, level, loadingPreferences, {
        preloadResources: item.source !== 'local',
        onProgress: (progress, detail) => {
          loadProgress = progress;
          loadDetail = detail;
        },
        signal: controller.signal,
      });
      if (run !== loadingRun || controller.signal.aborted) {
        prepared.release();
        return;
      }
      loadingPrepared = prepared;
      prepared.config.preferences = loadingPreferences;
      rememberSong(item);
      loadProgress = 1;
      loadDetail = '准备完成，等待操作';
      await Promise.all([
        waitForMinimumLoading(),
        waitForReadyIdle(),
      ]);
      clearReadyCountdown();
      if (run !== loadingRun || controller.signal.aborted) return;
      loadingPrepared = null;
      setPendingPlay(item.codename, level, prepared);
      stopPreview();
      loadingController = null;
      await goto(`/play/${encodeURIComponent(item.codename)}/${level}`);
    } catch (e) {
      if (controller.signal.aborted || run !== loadingRun) return;
      loadingController = null;
      loadingPrepared = null;
      clearReadyCountdown();
      stopLoadingAnimation();
      void setPreviewMuffled(false);
      await alertModal(e instanceof Error ? e.message : '谱面加载失败');
    }
  };

  const startPlay = async () => {
    const s = song();
    if (!s || starting) return;
    // PhiZone 源：需要登录后动态获取谱面文件
    if (s.source === 'pz') {
      let token = getToken();
      if (!token) {
        const user = await pzPrompt('请输入 PhiZone 用户名：');
        if (!user) return;
        const pass = await pzPrompt('请输入 PhiZone 密码：');
        if (!pass) return;
        try {
          await login(user, pass);
          token = getToken();
          pzLoggedIn = true;
        } catch (e) {
          await alertModal(e instanceof Error ? e.message : '登录失败');
          return;
        }
      }
      try {
        if (!s.id) throw new Error('无效的 PhiZone 谱面');
        const charts = await fetchPzCharts(s.id);
        // levelType 0-4 为标准难度；5+（如 WE 等）与选歌列表一致归入 sp 槽位
        const chart = charts.find((c) => (PZ_LEVEL_TYPE[c.levelType] ?? 'sp') === level);
        if (!chart) {
          await alertModal('该难度没有谱面');
          return;
        }
        const file = await fetchPzChartFile(chart.id, token ?? undefined);
        await loadAndPlay({
          ...s,
          // 附加资源（贴图/音效/shader）由 playLoader 按 chartId 拉取；levelName 展示真实难度名
          chartId: chart.id,
          levels: {
            ...s.levels,
            [level]: {
              chart: file,
              rank: chart.difficulty || undefined,
              charter: chart.authorName,
              levelName: chart.level,
            },
          },
        });
      } catch (e) {
        await alertModal(e instanceof Error ? e.message : '获取谱面失败');
      }
      return;
    }
    if (s.source !== 'local' && !s.levels[level]?.chart) return;
    await loadAndPlay(s);
  };

  const onKey = (e: KeyboardEvent) => {
    if (starting) return;
    // 搜索框内输入时不响应选歌快捷键（Enter/空格会误触开始）
    if (['INPUT', 'BUTTON', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement | null)?.tagName ?? '')) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') selectSong((current - 1 + currentList().length) % currentList().length);
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') selectSong((current + 1) % currentList().length);
    if (e.key === 'Enter' || e.key === ' ') startPlay();
  };
</script>

<svelte:head>
  <title>选歌 - PhiCommunity</title>
</svelte:head>

<!-- 全屏加载界面：数据拉取中显示，就绪后进度走满并淡出（结算/设置/中途退出回到本页同样展示） -->
{#if !pageReveal && !error}
  <div class="page-loading-mask" class:leaving={loaded}>
    <PhigrosLoading cover={pageCover} tip={pageTip} progress={loaded ? 1 : pageProgress} />
  </div>
{/if}

{#if !loaded && !error}
  <!-- 骨架屏 -->
  <div class="song-page">
    <div class="sk-top"></div>
    <div class="sk-body">
      <div class="sk-list">
        {#each Array(8) as _, i}
          <div class="sk-item" class:sk-odd={i % 2 === 1}></div>
        {/each}
      </div>
      <div class="sk-detail">
        <div class="sk-img"></div>
        <div class="sk-bar w-60"></div>
        <div class="sk-bar w-36"></div>
        <div class="sk-levels">
          <div class="sk-level"></div>
          <div class="sk-level"></div>
          <div class="sk-level"></div>
          <div class="sk-level"></div>
        </div>
      </div>
    </div>
  </div>
{:else if error}
  <div class="phi-page">
    <h1 class="phi-title">选歌</h1>
    <p class="phi-hint">加载失败：{error}</p>
    <button onclick={() => (location.href = '/')}>返回主页</button>
  </div>
{:else}
  {@const s = song()}
  {@const b = s ? best() : undefined}
  {@const rank: Rank | null = b ? getRank(b.accuracy) : null}

  <!-- svelte-ignore a11y_no_noninteractive_tabindex a11y_no_noninteractive_element_interactions -->
  <div class="song-page" role="application" tabindex="0" onkeydown={onKey}>
    <!-- 当前歌曲封面模糊背景 -->
    {#if s}
      <div class="page-bg" style="background-image: url('{s.illustrationUrl}')"></div>
      <div class="page-bg-shade"></div>
    {/if}

    <!-- 顶部：来源切换 + 工具按钮 -->
    <div class="top-bar" class:fade-out={starting}>
      <button class="icon-btn back-btn" onclick={() => goto('/')} aria-label="返回主页"></button>
      <div class="source-tabs">
        {#each SOURCES as src}
          <button
            class="source-tab"
            class:active={activeSource === src}
            onclick={() => switchSource(src)}
          >
            {SOURCE_LABELS[src]}
          </button>
        {/each}
        <button
          class="source-tab"
          class:active={activeSource === 'local'}
          onclick={() => switchSource('local')}
        >
          本地 ({localSongs.length})
        </button>
      </div>
      <div class="top-actions">
        <div class="preview-player">
          <button
            class="preview-info"
            onclick={() => (showPreviewList = !showPreviewList)}
            aria-expanded={showPreviewList}
            aria-label="查看预览播放列表"
          >
            <span class="preview-label">PREVIEW</span>
            <span class="preview-title">{s?.name ?? '暂无歌曲'}</span>
          </button>
          <div class="preview-controls">
            <button onclick={() => shiftPreview(-1)} aria-label="上一曲">◀</button>
            <button class="preview-toggle" onclick={togglePreview} aria-label={previewPlaying ? '暂停预览' : '播放预览'}>
              {previewPlaying ? 'Ⅱ' : '▶'}
            </button>
            <button onclick={() => shiftPreview(1)} aria-label="下一曲">▶</button>
            <button
              class:active={showPreviewList}
              onclick={() => (showPreviewList = !showPreviewList)}
              aria-label="播放列表"
            >☰</button>
          </div>
          <input
            class="preview-progress"
            type="range"
            min="0"
            max={previewDuration || 0}
            step="0.05"
            value={previewTime}
            disabled={previewDuration <= 0}
            style={`--preview-progress: ${previewDuration > 0 ? (previewTime / previewDuration) * 100 : 0}%`}
            aria-label="预览播放进度"
            oninput={(e) => seekPreview(Number(e.currentTarget.value))}
          />
          {#if showPreviewList}
            <div class="preview-playlist">
              <div class="preview-playlist-head">
                <span>播放列表</span>
                <span>{currentList().length}</span>
              </div>
              <div class="preview-playlist-body">
                {#each currentList() as item, i}
                  <button
                    class="preview-playlist-item"
                    class:active={i === current}
                    onclick={() => selectSong(i)}
                  >
                    <img src={item.illustrationUrl} alt="" />
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.artist}</small>
                    </span>
                    {#if i === current}<b>{previewPlaying ? '♪' : 'Ⅱ'}</b>{/if}
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        </div>
        <span class="player-rks">RKS {rks.toFixed(2)}</span>
        {#if activeSource === 'pz'}
          <button
            class="pz-login-btn"
            class:logged={pzLoggedIn}
            onclick={async () => {
              if (pzLoggedIn) {
                pzLoggedIn = false;
                setToken(null);
              } else {
                const user = await pzPrompt('请输入 PhiZone 用户名：');
                if (!user) return;
                const pass = await pzPrompt('请输入 PhiZone 密码：');
                if (!pass) return;
                try {
                  await login(user, pass);
                  pzLoggedIn = true;
                } catch (e) {
                  await alertModal(e instanceof Error ? e.message : '登录失败');
                }
              }
            }}
          >
            {pzLoggedIn ? 'PhiZone ✓' : 'PhiZone 登录'}
          </button>
        {/if}
        <button class="icon-btn upload-btn" onclick={() => goto('/upload')} aria-label="上传谱面"></button>
        <button class="icon-btn gear-btn" onclick={() => goto('/settings')} aria-label="设置"></button>
        <button class="icon-btn list-btn" onclick={() => (showOverview = true)} aria-label="谱面总览"></button>
      </div>
    </div>

    <!-- 主体：左列表 + 右详情 -->
    <div class="body">
      <!-- 左侧歌曲列表（开始动画时收起；可拖拽到中间选定） -->
      <div class="song-list" class:list-hidden={starting}>
        <div class="song-search">
          <input
            class="search-input"
            type="text"
            placeholder="搜索歌曲 / 艺术家 / 谱师…"
            bind:value={query}
            oninput={onSearchInput}
          />
          {#if query}
            <button class="search-clear" onclick={clearSearch} aria-label="清除搜索"></button>
          {/if}
        </div>
        {#each currentList() as item, i}
          <button
            class="song-item"
            class:active={i === current}
            class:dragging={i === dragIndex && dragActive}
            onpointerdown={(e) => onPointerDown(e, i)}
            onclick={() => selectSong(i)}
          >
            <img class="thumb" src={item.illustrationUrl} alt="" draggable="false" />
            <div class="item-text">
              <span class="item-name">{item.name}</span>
              <span class="item-artist">{item.artist}</span>
            </div>
            <div class="item-levels">
              {#each LEVELS as lv}
                {#if item.levels[lv]}
                  <span class="mini-level" class:mini-active={lv === level && i === current}>{item.levels[lv]?.levelName ?? LEVEL_LABELS[lv]}</span>
                {/if}
              {/each}
            </div>
          </button>
        {:else}
          {#if activeSource === 'pz' && pzSourceError}
            <p class="empty-hint">PhiZone 列表加载失败：{pzSourceError}</p>
          {:else if query.trim()}
            <p class="empty-hint">没有匹配「{query.trim()}」的谱面</p>
          {:else}
            <p class="empty-hint">该来源暂无谱面</p>
          {/if}
        {/each}
      </div>

      <!-- 右侧详情（拖放目标；开始动画时随列表收起移向中央） -->
      {#if s}
        <div
          class="detail"
          class:detail-center={starting}
          class:drop-target={dropActive}
          role="group"
          bind:this={detailEl}
        >
          {#key current}
            <img
              class="detail-img"
              src={s.illustrationUrl}
              alt=""
              draggable="false"
              transition:fly={{ y: 40, duration: 380 }}
            />
          {/key}
          <h1 class="detail-name">{s.name}</h1>
          <div class="detail-artist">{s.artist}</div>

          <!-- legacy 难度选择样式 -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div class="level-chooser">
            {#each LEVELS as lv}
              <div
                class="level-item {lv}"
                class:selected={level === lv}
                class:disabled={!s.levels[lv]}
                role="button"
                tabindex="-1"
                onclick={() => s.levels[lv] && (level = lv)}
              >
                <span class="level-txt">{s.levels[lv]?.levelName ?? LEVEL_LABELS[lv]}</span>
                {#if s.levels[lv]}
                  <span class="level-rank">Lv.{s.levels[lv]!.rank ?? '?'}</span>
                {/if}
              </div>
            {/each}
          </div>

          <div class="detail-meta">
            {#if s.source === 'pz'}
              <span class="meta-charter">PhiZone 谱面 {pzLoggedIn ? '· 已登录' : '· 需登录'}</span>
              {#if b}
                <span class="best-score">
                  {#if rank}
                    <img class="rank-img" src="/game/grades/{rank}.png" alt={rank} />
                  {/if}
                  {Math.round(b.score).toLocaleString()}
                </span>
              {:else}
                <span class="unplayed">未游玩</span>
              {/if}
            {:else if chartFile()}
              <span class="meta-charter">谱师 {charter() ?? 'Unknown'}</span>
              {#if b}
                <span class="best-score">
                  {#if rank}
                    <img class="rank-img" src="/game/grades/{rank}.png" alt={rank} />
                  {/if}
                  {Math.round(b.score).toLocaleString()}
                </span>
              {:else}
                <span class="unplayed">未游玩</span>
              {/if}
            {:else}
              <span class="locked-tag">该难度暂无谱面</span>
            {/if}
          </div>
        </div>
      {/if}
    </div>

    <!-- 右下角开始按钮（开始动画时淡出） -->
    <button
      class="play-btn"
      class:disabled={(s?.source !== 'pz' && !chartFile()) || starting}
      class:fade-out={starting}
      onclick={startPlay}
      aria-label="开始游玩"
    ></button>

    <!-- 歌曲加载界面：左侧曲绘/进度，右侧设置；设置交互会重置自动进入倒计时 -->
    {#if starting}
      <div class="loading-state-glow" style="background-image: url('{s?.illustrationUrl ?? pageCover}')"></div>
      <canvas
        class="loading-canvas"
        bind:this={loadingCanvas}
        width={LOADING_W * LOADING_DPR}
        height={LOADING_H * LOADING_DPR}
      ></canvas>
      <div class="song-loading-dock">
        <aside
          class="loading-settings"
          onpointerenter={() => {
            settingsHover = true;
            clearReadyCountdown();
          }}
          onpointerleave={() => {
            settingsHover = false;
            settingsPressed = false;
            resetReadyCountdown();
          }}
          onpointermove={resetReadyCountdown}
          onpointerdown={() => {
            settingsPressed = true;
            clearReadyCountdown();
          }}
          onpointerup={(e) => {
            settingsPressed = false;
            if (e.pointerType === 'touch') settingsHover = false;
            resetReadyCountdown();
          }}
          onpointercancel={(e) => {
            settingsPressed = false;
            if (e.pointerType === 'touch') settingsHover = false;
            resetReadyCountdown();
          }}
        >
          <div class="loading-settings-head">
            <div>
              <span>PLAY SETTINGS</span>
              <strong>游玩设置</strong>
            </div>
            {#if loadProgress >= 1}
              <small>{settingsHover || settingsPressed ? '等待操作结束' : `${readyCountdown} 秒后进入`}</small>
            {:else}
              <small>{Math.round(loadProgress * 100)}%</small>
            {/if}
          </div>
          <div class="loading-settings-body">
            <label class="loading-setting-row">
              <span>谱面延时 <b>{loadingPreferences.chartOffset} ms</b></span>
              <input type="range" min="-500" max="500" step="5" value={loadingPreferences.chartOffset} oninput={(e) => updateLoadingPreference('chartOffset', Number(e.currentTarget.value))} />
            </label>
            <label class="loading-setting-row">
              <span>谱面倍速 <b>{Math.round(loadingPreferences.timeScale * 100)}%</b></span>
              <input type="range" min="0.7" max="1.5" step="0.05" value={loadingPreferences.timeScale} oninput={(e) => updateLoadingPreference('timeScale', Number(e.currentTarget.value))} />
            </label>
            <label class="loading-setting-row">
              <span>按键缩放 <b>{Math.round(loadingPreferences.noteSize * 100)}%</b></span>
              <input type="range" min="0.5" max="1.5" step="0.05" value={loadingPreferences.noteSize} oninput={(e) => updateLoadingPreference('noteSize', Number(e.currentTarget.value))} />
            </label>
            <label class="loading-setting-row">
              <span>背景模糊 <b>{loadingPreferences.backgroundBlur.toFixed(1)}</b></span>
              <input type="range" min="0" max="3" step="0.1" value={loadingPreferences.backgroundBlur} oninput={(e) => updateLoadingPreference('backgroundBlur', Number(e.currentTarget.value))} />
            </label>
            <label class="loading-setting-row">
              <span>背景亮度 <b>{Math.round(loadingPreferences.backgroundLuminance * 100)}%</b></span>
              <input type="range" min="0" max="1" step="0.05" value={loadingPreferences.backgroundLuminance} oninput={(e) => updateLoadingPreference('backgroundLuminance', Number(e.currentTarget.value))} />
            </label>
            <label class="loading-setting-row">
              <span>音乐音量 <b>{Math.round(loadingPreferences.musicVolume * 100)}%</b></span>
              <input type="range" min="0" max="1" step="0.05" value={loadingPreferences.musicVolume} oninput={(e) => updateLoadingPreference('musicVolume', Number(e.currentTarget.value))} />
            </label>
            <label class="loading-setting-row">
              <span>打击音效 <b>{Math.round(loadingPreferences.hitSoundVolume * 100)}%</b></span>
              <input type="range" min="0" max="1" step="0.05" value={loadingPreferences.hitSoundVolume} oninput={(e) => updateLoadingPreference('hitSoundVolume', Number(e.currentTarget.value))} />
            </label>
            <button class="loading-setting-toggle" class:on={loadingPreferences.simultaneousNoteHint} onclick={() => updateLoadingPreference('simultaneousNoteHint', !loadingPreferences.simultaneousNoteHint)}><span>多押辅助</span><i></i></button>
            <button class="loading-setting-toggle" class:on={loadingPreferences.fcApIndicator} onclick={() => updateLoadingPreference('fcApIndicator', !loadingPreferences.fcApIndicator)}><span>FC/AP 指示器</span><i></i></button>
            <button class="loading-setting-toggle" class:on={loadingPreferences.useVideoBackground} onclick={() => updateLoadingPreference('useVideoBackground', !loadingPreferences.useVideoBackground)}><span>视频背景</span><i></i></button>
          </div>
          <button class="cancel-loading-btn" onclick={cancelSongLoading}>取消加载</button>
        </aside>
      </div>
    {/if}

    <!-- 拖拽幽灵浮层（跟随指针） -->
    {#if dragIndex !== null && dragActive && currentList()[dragIndex]}
      <div class="drag-ghost" style="left: {ghostX}px; top: {ghostY}px;">
        <img src={currentList()[dragIndex].illustrationUrl} alt="" draggable="false" />
        <span class="ghost-name">{currentList()[dragIndex].name}</span>
      </div>
    {/if}
  </div>

  <!-- 总览 -->
  {#if showOverview}
    <div class="overview-overlay" role="presentation" onclick={() => (showOverview = false)}>
      <div class="overview-panel" role="presentation" onclick={(e) => e.stopPropagation()}>
        <h2 class="overview-title">全部谱面（{currentList().length}）</h2>
        <div class="overview-grid">
          {#each currentList() as item, i}
            <button class="overview-item" class:active={i === current} onclick={() => { selectSong(i); showOverview = false; }}>
              <img class="overview-img" src={item.illustrationUrl} alt="" draggable="false" />
              <div class="overview-info">
                <span class="overview-name">{item.name}</span>
                <span class="overview-artist">{item.artist}</span>
              </div>
            </button>
          {/each}
        </div>
        <button class="overview-close" onclick={() => (showOverview = false)}>关闭</button>
      </div>
    </div>
  {/if}
{/if}

<style>
  .song-page {
    position: fixed;
    inset: 0;
    overflow: hidden;
    background: #0a0a0c;
    user-select: none;
    display: flex;
    flex-direction: column;
    outline: none;
  }

  /* 当前歌曲封面模糊背景 */
  .page-bg {
    position: absolute;
    inset: -40px;
    background-size: cover;
    background-position: center;
    filter: blur(28px) brightness(0.38) contrast(0.92) saturate(0.85);
    transform: scale(1.1);
    transition: background-image 0.5s ease;
    z-index: -1;
  }

  .page-bg-shade {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(8, 8, 12, 0.5) 0%, rgba(8, 8, 12, 0.35) 45%, rgba(8, 8, 12, 0.8) 100%);
    z-index: -1;
  }

  /* ---- 顶栏 ---- */
  .top-bar {
    height: 64px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 0 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
    z-index: 30;
  }

  .icon-btn {
    width: 38px;
    height: 38px;
    border-radius: 2px;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.3);
    cursor: pointer;
    padding: 0;
    position: relative;
    flex-shrink: 0;
  }

  .icon-btn:hover {
    background: #e8e8e8;
  }

  .back-btn::before {
    content: '';
    position: absolute;
    left: 13px;
    top: 13px;
    width: 11px;
    height: 11px;
    border-left: 2px solid currentColor;
    border-bottom: 2px solid currentColor;
    transform: rotate(45deg);
  }

  .gear-btn::before {
    content: '⚙';
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
  }

  .upload-btn::before {
    content: '+';
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.2rem;
  }

  .list-btn::before {
    content: '☰';
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.95rem;
  }

  .source-tabs {
    display: flex;
    gap: 8px;
  }

  .source-tab {
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: rgba(255, 255, 255, 0.55);
    font-size: 0.95rem;
    font-weight: 700;
    padding: 8px 14px;
    border-radius: 0;
    letter-spacing: 0.04em;
  }

  .source-tab:hover {
    background: transparent;
    color: #fff;
  }

  .source-tab.active {
    color: #fff;
    border-bottom-color: #fff;
  }

  .top-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .preview-player {
    position: relative;
    height: 34px;
    display: flex;
    align-items: stretch;
    background: rgba(8, 8, 12, 0.72);
    border: 1px solid rgba(255, 255, 255, 0.28);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
  }

  .preview-info {
    width: 108px;
    min-width: 0;
    padding: 4px 8px;
    border: 0;
    border-right: 1px solid rgba(255, 255, 255, 0.16);
    background: transparent;
    color: #fff;
    text-align: left;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .preview-label {
    color: rgba(255, 255, 255, 0.48);
    font: 600 0.58rem/1 'Courier New', ui-monospace, monospace;
    letter-spacing: 0.14em;
  }

  .preview-title {
    margin-top: 3px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.64rem;
    font-weight: 700;
  }

  .preview-controls {
    display: flex;
    align-items: stretch;
  }

  .preview-controls button {
    width: 26px;
    padding: 0;
    border: 0;
    border-left: 1px solid rgba(255, 255, 255, 0.12);
    background: transparent;
    color: rgba(255, 255, 255, 0.78);
    font-size: 0.6rem;
    cursor: pointer;
    transition: background 140ms ease, color 140ms ease, transform 100ms ease-out;
  }

  .preview-controls button:hover,
  .preview-controls button.active {
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
  }

  .preview-controls button:active {
    transform: scale(0.94);
  }

  .preview-controls .preview-toggle {
    width: 30px;
    color: #fff;
    font-size: 0.7rem;
  }

  .preview-progress {
    appearance: none;
    -webkit-appearance: none;
    position: absolute;
    left: -1px;
    right: -1px;
    bottom: -3px;
    width: calc(100% + 2px);
    height: 7px;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    cursor: pointer;
    z-index: 2;
  }

  .preview-progress::-webkit-slider-runnable-track {
    height: 2px;
    background: linear-gradient(
      to right,
      #fff 0 var(--preview-progress),
      rgba(255, 255, 255, 0.2) var(--preview-progress) 100%
    );
  }

  .preview-progress::-moz-range-track {
    height: 2px;
    background: rgba(255, 255, 255, 0.2);
  }

  .preview-progress::-moz-range-progress {
    height: 2px;
    background: #fff;
  }

  .preview-progress::-webkit-slider-thumb {
    appearance: none;
    -webkit-appearance: none;
    width: 7px;
    height: 7px;
    margin-top: -2.5px;
    border: 0;
    border-radius: 50%;
    background: #fff;
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .preview-progress::-moz-range-thumb {
    width: 7px;
    height: 7px;
    border: 0;
    border-radius: 50%;
    background: #fff;
    opacity: 0;
  }

  .preview-player:hover .preview-progress::-webkit-slider-thumb,
  .preview-progress:focus-visible::-webkit-slider-thumb,
  .preview-player:hover .preview-progress::-moz-range-thumb,
  .preview-progress:focus-visible::-moz-range-thumb {
    opacity: 1;
  }

  .preview-progress:disabled {
    cursor: default;
    opacity: 0.45;
  }

  .preview-playlist {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    width: min(340px, 82vw);
    max-height: min(440px, 68vh);
    display: flex;
    flex-direction: column;
    background: rgba(10, 10, 14, 0.96);
    border: 1px solid rgba(255, 255, 255, 0.28);
    box-shadow: 0 18px 60px rgba(0, 0, 0, 0.56);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
    z-index: 50;
  }

  .preview-playlist-head {
    flex-shrink: 0;
    display: flex;
    justify-content: space-between;
    padding: 11px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.14);
    color: rgba(255, 255, 255, 0.68);
    font: 700 0.7rem/1 'Courier New', ui-monospace, monospace;
    letter-spacing: 0.08em;
  }

  .preview-playlist-body {
    min-height: 0;
    overflow-y: auto;
  }

  .preview-playlist-item {
    width: 100%;
    min-height: 54px;
    padding: 7px 9px;
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr) 20px;
    align-items: center;
    gap: 9px;
    border: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    background: transparent;
    color: rgba(255, 255, 255, 0.72);
    text-align: left;
  }

  .preview-playlist-item:hover,
  .preview-playlist-item.active {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }

  .preview-playlist-item img {
    width: 42px;
    height: 42px;
    object-fit: cover;
  }

  .preview-playlist-item span {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .preview-playlist-item strong,
  .preview-playlist-item small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preview-playlist-item strong {
    font-size: 0.76rem;
  }

  .preview-playlist-item small {
    color: rgba(255, 255, 255, 0.45);
    font-size: 0.66rem;
  }

  .preview-playlist-item b {
    text-align: center;
    font-size: 0.8rem;
  }

  .player-rks {
    border: 1px solid rgba(255, 255, 255, 0.3);
    padding: 6px 12px;
    font-size: 0.8rem;
    font-weight: 700;
    font-family: 'Courier New', ui-monospace, monospace;
  }

  .pz-login-btn {
    border: 1px solid rgba(255, 255, 255, 0.3);
    padding: 7px 14px;
    font-size: 0.78rem;
    font-weight: 700;
    border-radius: 2px;
    color: rgba(255, 255, 255, 0.7);
    background: transparent;
    cursor: pointer;
    white-space: nowrap;
  }

  .pz-login-btn:hover {
    background: #e8e8e8;
    color: #0a0a0c;
  }

  .pz-login-btn.logged {
    border-color: #7ecb8f;
    color: #7ecb8f;
  }

  .pz-login-btn.logged:hover {
    background: #7ecb8f;
    color: #0a0a0c;
  }

  /* ---- 主体 ---- */
  .body {
    flex: 1;
    display: flex;
    min-height: 0;
  }

  /* 左侧列表 */
  .song-list {
    width: min(360px, 34vw);
    flex-shrink: 0;
    overflow-y: auto;
    border-right: 1px solid rgba(255, 255, 255, 0.12);
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
    transition:
      width 0.6s cubic-bezier(0.22, 1, 0.36, 1),
      opacity 0.4s ease,
      padding 0.6s cubic-bezier(0.22, 1, 0.36, 1),
      border-color 0.4s ease;
  }

  /* 开始动画：列表收起淡出 */
  .song-list.list-hidden {
    width: 0;
    padding: 0;
    opacity: 0;
    border-right-color: transparent;
    overflow: hidden;
  }

  /* 搜索框：吸附在列表顶部，随列表一起收起 */
  .song-search {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 2px 10px;
    position: sticky;
    top: 0;
    z-index: 2;
    background: linear-gradient(180deg, rgba(8, 8, 12, 0.92) 0%, rgba(8, 8, 12, 0.86) 65%, transparent 100%);
    backdrop-filter: blur(6px);
  }

  .search-input {
    flex: 1;
    min-width: 0;
    height: 32px;
    padding: 0 10px;
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.06);
    color: #fff;
    font-size: 0.85rem;
    outline: none;
    transition:
      border-color 0.2s ease,
      background 0.2s ease;
  }

  .search-input::placeholder {
    color: rgba(255, 255, 255, 0.4);
  }

  .search-input:focus {
    border-color: rgba(255, 255, 255, 0.6);
    background: rgba(255, 255, 255, 0.1);
  }

  .search-clear {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 2px;
    background: transparent;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    position: relative;
  }

  .search-clear::before,
  .search-clear::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    width: 12px;
    height: 2px;
    background: currentColor;
  }

  .search-clear::before {
    transform: translate(-50%, -50%) rotate(45deg);
  }

  .search-clear::after {
    transform: translate(-50%, -50%) rotate(-45deg);
  }

  .search-clear:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
  }

  .song-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border: none;
    border-radius: 2px;
    background: transparent;
    color: #e8e8e8;
    text-align: left;
    cursor: pointer;
    width: 100%;
  }

  .song-item:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  .song-item.active {
    background: rgba(255, 255, 255, 0.14);
    border-left: 3px solid #fff;
  }

  .song-item.dragging {
    opacity: 0.4;
  }

  /* 拖拽幽灵浮层 */
  .drag-ghost {
    position: fixed;
    transform: translate(-50%, -50%);
    pointer-events: none;
    z-index: 200;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    background: rgba(10, 10, 12, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.4);
    border-radius: 2px;
    padding: 6px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
  }

  .drag-ghost img {
    width: 96px;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    border-radius: 2px;
  }

  .ghost-name {
    font-size: 0.68rem;
    font-weight: 700;
    max-width: 120px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .thumb {
    width: 64px;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    border-radius: 2px;
    background: #1d1d24;
    flex-shrink: 0;
  }

  .item-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .item-name {
    font-weight: 700;
    font-size: 0.92rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item-artist {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.5);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item-levels {
    display: flex;
    gap: 3px;
    flex-shrink: 0;
  }

  .mini-level {
    font-size: 0.6rem;
    font-weight: 700;
    border: 1px solid rgba(255, 255, 255, 0.3);
    padding: 1px 4px;
    color: rgba(255, 255, 255, 0.55);
  }

  .mini-level.mini-active {
    background: #fff;
    color: #0a0a0c;
  }

  .empty-hint {
    color: rgba(255, 255, 255, 0.4);
    text-align: center;
    padding: 40px 0;
    font-size: 0.9rem;
  }

  /* 右侧详情 */
  .detail {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 24px;
    min-width: 0;
    position: relative;
    transition: opacity 0.45s ease, transform 0.65s cubic-bezier(0.22, 1, 0.36, 1);
  }

  /* 开始动画：列表收起后 detail 占据全宽，内容自然移向中央；曲绘非线性放大 */
  .detail.detail-center {
    opacity: 1;
    transform: translateX(-10vw);
  }

  /* 拖拽到中间的目标高亮 */
  .detail.drop-target::before {
    content: '松开以选定';
    position: absolute;
    top: 18px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 5;
    border: 1px dashed #fff;
    border-radius: 2px;
    padding: 6px 18px;
    font-size: 0.8rem;
    letter-spacing: 0.15em;
    color: #fff;
    background: rgba(10, 10, 12, 0.55);
    pointer-events: none;
  }

  .detail.drop-target {
    outline: 1.5px dashed rgba(255, 255, 255, 0.7);
    outline-offset: -6px;
  }

  .detail-img {
    width: min(560px, 44vw);
    aspect-ratio: 16 / 9;
    object-fit: cover;
    border-radius: 2px;
    background: #1d1d24;
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55);
    transition: transform 0.65s cubic-bezier(0.22, 1, 0.36, 1), width 0.65s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .detail.detail-center .detail-img {
    width: min(620px, 56vw);
    transform: scale(1.06);
  }

  .detail-name {
    margin: 8px 0 0;
    font-size: clamp(1.5rem, 3vw, 2.4rem);
    font-weight: 900;
    letter-spacing: 0.03em;
    text-align: center;
    max-width: 90%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .detail-artist {
    font-size: clamp(0.9rem, 1.4vw, 1.1rem);
    color: rgba(255, 255, 255, 0.65);
    max-width: 80%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* 扁平化难度选择 */
  .level-chooser {
    display: flex;
    gap: 8px;
    margin-top: 14px;
  }

  .level-item {
    min-width: 58px;
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 1px;
    cursor: pointer;
    border: 1px solid rgba(255, 255, 255, 0.35);
    border-radius: 2px;
    background: transparent;
    color: rgba(255, 255, 255, 0.65);
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }

  .level-item:hover {
    border-color: #fff;
    color: #fff;
  }

  .level-item.disabled {
    opacity: 0.3;
    cursor: default;
    pointer-events: none;
  }

  .level-item.selected {
    background: #fff;
    border-color: #fff;
    color: #0a0a0c;
  }

  .level-txt {
    font-weight: 900;
    font-size: 0.85rem;
    letter-spacing: 0.1em;
    line-height: 1;
  }

  .level-rank {
    font-size: 0.62rem;
    opacity: 0.8;
    line-height: 1.2;
  }

  .detail-meta {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-top: 6px;
    color: rgba(255, 255, 255, 0.8);
    font-size: 0.9rem;
  }

  .meta-charter {
    color: rgba(255, 255, 255, 0.6);
  }

  .best-score {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 700;
    color: #fff;
  }

  .rank-img {
    width: 28px;
    height: 28px;
    object-fit: contain;
  }

  .unplayed {
    color: rgba(255, 255, 255, 0.4);
  }

  .locked-tag {
    color: rgba(255, 255, 255, 0.5);
    font-style: italic;
  }

  /* 右下角开始按钮 */
  .play-btn {
    position: absolute;
    right: 28px;
    bottom: 28px;
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: #fff;
    border: none;
    cursor: pointer;
    z-index: 40;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  }

  .play-btn:hover {
    background: #fff;
    transform: scale(1.06);
  }

  .play-btn::before {
    content: '';
    width: 0;
    height: 0;
    margin-left: 5px;
    border-top: 12px solid transparent;
    border-bottom: 12px solid transparent;
    border-left: 20px solid #0a0a0c;
  }

  .play-btn.disabled {
    background: rgba(255, 255, 255, 0.25);
    pointer-events: none;
  }

  .play-btn.disabled::before {
    border-left-color: rgba(255, 255, 255, 0.45);
  }

  /* 右下角 Phigros loading 动画（复刻 ploading.js） */
  .loading-canvas {
    position: absolute;
    right: calc(min(360px, 31vw) + 28px);
    bottom: 22px;
    width: 340px;
    height: 160px;
    z-index: 80;
    animation: loading-in 0.3s ease;
  }

  /* 加载时保留选歌页本体；只在右侧嵌入设置 dock，不再覆盖成独立弹窗。 */
  .loading-state-glow {
    position: absolute;
    inset: 0;
    z-index: 35;
    pointer-events: none;
    background-position: center;
    background-size: cover;
    filter: blur(28px) brightness(0.28) saturate(0.8);
    opacity: 0.2;
    transform: scale(1.08);
    transition: opacity 420ms ease, filter 420ms ease;
  }

  .song-loading-dock {
    position: absolute;
    top: 64px;
    right: 0;
    bottom: 0;
    width: min(360px, 31vw);
    z-index: 76;
    padding: 18px 18px 22px;
    background: linear-gradient(90deg, rgba(8, 8, 12, 0.18), rgba(8, 8, 12, 0.88) 18%);
    pointer-events: none;
    animation: loading-dock-in 420ms cubic-bezier(0.23, 1, 0.32, 1);
  }

  .song-loading-dock .loading-settings {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    pointer-events: auto;
    padding: 20px 18px 16px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 3px;
    background: rgba(10, 10, 14, 0.78);
    box-shadow: -18px 14px 50px rgba(0, 0, 0, 0.28);
    backdrop-filter: blur(18px) saturate(1.2);
    -webkit-backdrop-filter: blur(18px) saturate(1.2);
  }

  @keyframes loading-dock-in {
    from {
      opacity: 0;
      transform: translateX(28px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  .song-loading-dock .loading-settings-head strong::after {
    content: ' · LOADING';
    color: rgba(255, 255, 255, 0.38);
    font: 600 0.62rem 'Courier New', ui-monospace, monospace;
    letter-spacing: 0.08em;
  }

  .loading-settings {
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding: 28px clamp(18px, 2.5vw, 42px) 22px;
    border-left: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(10, 10, 14, 0.97);
    color: #fff;
  }

  .loading-settings-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 18px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.14);
  }

  .loading-settings-head div {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .loading-settings-head span {
    color: rgba(255, 255, 255, 0.42);
    font: 700 0.62rem/1 'Courier New', ui-monospace, monospace;
    letter-spacing: 0.16em;
  }

  .loading-settings-head strong {
    font-size: 1.25rem;
  }

  .loading-settings-head small {
    max-width: 105px;
    color: rgba(255, 255, 255, 0.58);
    font: 600 0.65rem/1.4 'Courier New', ui-monospace, monospace;
    text-align: right;
  }

  .loading-settings-body {
    min-height: 0;
    flex: 1;
    overflow-y: auto;
    padding: 12px 2px 18px 0;
  }

  .loading-setting-row {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 0;
    color: rgba(255, 255, 255, 0.78);
    font-size: 0.76rem;
  }

  .loading-setting-row span {
    display: flex;
    justify-content: space-between;
    gap: 10px;
  }

  .loading-setting-row b {
    color: rgba(255, 255, 255, 0.48);
    font: 600 0.68rem 'Courier New', ui-monospace, monospace;
  }

  .loading-setting-row input {
    width: 100%;
    accent-color: #fff;
  }

  .loading-setting-toggle {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 0;
    border: 0;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    background: transparent;
    color: rgba(255, 255, 255, 0.7);
    font-size: 0.76rem;
    text-align: left;
  }

  .loading-setting-toggle i {
    width: 28px;
    height: 15px;
    position: relative;
    border: 1px solid rgba(255, 255, 255, 0.38);
    border-radius: 99px;
  }

  .loading-setting-toggle i::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.5);
    transition: transform 160ms ease-out, background 160ms ease-out;
  }

  .loading-setting-toggle.on i::after {
    transform: translateX(13px);
    background: #fff;
  }

  .loading-settings .cancel-loading-btn {
    position: static;
    flex-shrink: 0;
    width: 100%;
    margin-top: auto;
    padding: 11px 14px;
  }

  .cancel-loading-btn {
    position: absolute;
    right: 42px;
    bottom: 28px;
    z-index: 81;
    padding: 7px 14px;
    border: 1px solid rgba(255, 255, 255, 0.42);
    border-radius: 2px;
    background: rgba(8, 8, 12, 0.68);
    color: rgba(255, 255, 255, 0.76);
    font: 700 0.68rem/1 'Courier New', ui-monospace, monospace;
    letter-spacing: 0.08em;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    cursor: pointer;
    transition: background 140ms ease, color 140ms ease, transform 100ms ease-out;
  }

  .cancel-loading-btn:hover {
    background: #fff;
    color: #0a0a0c;
  }

  .cancel-loading-btn:active {
    transform: scale(0.96);
  }

  /* 窄屏按比例缩小，避免遮挡歌曲详情 */
  @media (max-width: 860px) {
    .detail.detail-center {
      transform: translateY(-12vh);
    }

    .song-loading-dock {
      top: auto;
      left: 12px;
      right: 12px;
      bottom: 12px;
      width: auto;
      height: min(52vh, 430px);
      padding: 0;
      background: none;
    }

    .song-loading-dock .loading-settings {
      padding: 14px 14px 12px;
    }

    .loading-settings {
      min-height: 0;
      padding: 16px 18px 14px;
    }

    .loading-settings-body {
      display: grid;
      grid-template-columns: 1fr 1fr;
      column-gap: 18px;
    }

    .loading-settings-head {
      padding-bottom: 10px;
    }

    .loading-setting-row {
      padding: 8px 0;
    }

    .loading-settings .cancel-loading-btn {
      margin-top: 6px;
    }

    .loading-canvas {
      right: 12px;
      bottom: 12px;
      width: 250px;
      height: 118px;
    }

    .cancel-loading-btn {
      right: 24px;
      bottom: 18px;
    }
  }

  @keyframes loading-in {
    from {
      opacity: 0;
      transform: scale(0.6);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  /* ---- 进入页面时的全屏加载界面浮层（盖过选歌 UI，数据就绪后淡出）---- */
  .page-loading-mask {
    position: fixed;
    inset: 0;
    z-index: 90;
    transition: opacity 0.5s ease;
  }

  .page-loading-mask.leaving {
    opacity: 0;
    pointer-events: none;
  }

  /* 通用淡出（顶栏等） */
  .fade-out {
    opacity: 0;
    pointer-events: none;
  }

  /* ---- 骨架屏 ---- */
  .sk-top {
    height: 64px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  }

  .sk-body {
    flex: 1;
    display: flex;
    min-height: 0;
  }

  .sk-list {
    width: min(360px, 34vw);
    border-right: 1px solid rgba(255, 255, 255, 0.12);
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .sk-item {
    height: 72px;
    border-radius: 2px;
    background: #16161b;
    animation: sk-pulse 1.4s ease-in-out infinite;
  }

  .sk-item.sk-odd {
    animation-delay: 0.2s;
  }

  .sk-detail {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
  }

  .sk-img {
    width: min(560px, 44vw);
    aspect-ratio: 16 / 9;
    background: #16161b;
    animation: sk-pulse 1.4s ease-in-out infinite;
  }

  .sk-bar {
    height: 16px;
    border-radius: 2px;
    background: #16161b;
    animation: sk-pulse 1.4s ease-in-out infinite;
  }

  .w-60 {
    width: 260px;
  }

  .w-36 {
    width: 140px;
  }

  .sk-levels {
    display: flex;
    gap: 8px;
  }

  .sk-level {
    width: 56px;
    height: 44px;
    background: #16161b;
    animation: sk-pulse 1.4s ease-in-out infinite;
    animation-delay: 0.3s;
  }

  @keyframes sk-pulse {
    0%,
    100% {
      background-color: #16161b;
    }
    50% {
      background-color: #1f1f26;
    }
  }

  /* ---- 总览 ---- */
  .overview-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(6px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .overview-panel {
    background: #12121c;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 2px;
    padding: 24px;
    width: min(860px, 92vw);
    max-height: 78vh;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .overview-title {
    margin: 0;
    font-size: 1.2rem;
    font-weight: 900;
  }

  .overview-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 10px;
    overflow-y: auto;
    padding: 4px;
  }

  .overview-item {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border-radius: 2px;
    border: 2px solid transparent;
    background: rgba(255, 255, 255, 0.05);
    cursor: pointer;
    text-align: left;
  }

  .overview-item:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .overview-item.active {
    border-color: #fff;
  }

  .overview-img {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    border-radius: 2px;
  }

  .overview-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .overview-name {
    font-weight: 800;
    font-size: 0.9rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .overview-artist {
    font-size: 0.72rem;
    color: rgba(255, 255, 255, 0.55);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .overview-close {
    align-self: center;
    background: transparent;
    border: 1px solid #fff;
    color: #fff;
    border-radius: 2px;
    padding: 9px 32px;
    font-weight: 700;
    cursor: pointer;
  }

  .overview-close:hover {
    background: #fff;
    color: #0a0a0c;
  }

  /* ---- 移动端 ---- */
  @media (max-width: 860px) {
    .song-list {
      width: 40vw;
    }

    .item-name {
      display: none;
    }

    .thumb {
      width: 100%;
    }

    .song-item {
      flex-direction: column;
      align-items: flex-start;
    }

    .source-tabs {
      display: none;
    }

    .top-bar {
      padding: 0 12px;
    }

    .preview-info,
    .player-rks {
      display: none;
    }

    .preview-player {
      height: 32px;
    }

    .preview-controls button {
      width: 25px;
    }
  }

  /* ---- 响应式收尾：平板 / 手机竖屏 / 手机横屏分别布局 ---- */
  @media (max-width: 1180px) and (min-width: 861px) {
    .top-bar {
      gap: 10px;
      padding: 0 14px;
    }

    .source-tabs {
      gap: 3px;
    }

    .source-tab {
      padding-inline: 8px;
      font-size: 0.78rem;
    }

    .preview-info,
    .player-rks {
      display: none;
    }

    .top-actions {
      gap: 6px;
    }

    .song-loading-dock {
      width: min(330px, 35vw);
      padding: 12px 12px 16px;
    }

    .loading-canvas {
      right: calc(min(330px, 35vw) + 12px);
      width: clamp(220px, 27vw, 300px);
      height: auto;
    }

    .detail.detail-center {
      transform: translateX(-13vw);
    }
  }

  @media (max-width: 860px) and (orientation: portrait) {
    .top-bar {
      height: 56px;
      gap: 6px;
    }

    .top-actions {
      gap: 5px;
    }

    .icon-btn {
      width: 34px;
      height: 34px;
    }

    .pz-login-btn {
      max-width: 84px;
      overflow: hidden;
      padding: 6px 8px;
      text-overflow: ellipsis;
    }

    .song-list {
      width: clamp(104px, 34vw, 150px);
      padding: 6px;
    }

    .song-search {
      padding-bottom: 6px;
    }

    .search-input {
      height: 32px;
      padding: 6px 8px;
      font-size: 0.66rem;
    }

    .song-item {
      gap: 4px;
      padding: 5px;
    }

    .item-levels {
      gap: 2px;
    }

    .mini-level {
      padding: 2px 4px;
      font-size: 0.54rem;
    }

    .detail {
      gap: 6px;
      padding: 12px 10px;
    }

    .detail-img {
      width: min(100%, 430px);
    }

    .detail-name {
      max-width: 96%;
      font-size: clamp(1rem, 5vw, 1.5rem);
    }

    .detail-artist {
      font-size: 0.72rem;
    }

    .detail.detail-center {
      padding-bottom: min(48dvh, 390px);
      transform: translateY(-3vh);
    }

    .detail.detail-center .detail-img {
      width: min(76vw, 410px);
      transform: scale(1.02);
    }

    .song-loading-dock {
      left: 8px;
      right: 8px;
      bottom: max(8px, env(safe-area-inset-bottom));
      width: auto;
      height: min(48dvh, 390px);
    }

    .song-loading-dock .loading-settings {
      padding: 12px 12px 10px;
    }

    .loading-settings-head strong {
      font-size: 0.95rem;
    }

    .loading-settings-head small {
      font-size: 0.58rem;
    }

    .loading-settings-body {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0 14px;
      padding-block: 5px 8px;
    }

    .loading-setting-row,
    .loading-setting-toggle {
      min-width: 0;
      padding: 6px 0;
      font-size: 0.66rem;
    }

    .loading-setting-row {
      gap: 3px;
    }

    .loading-setting-row b {
      font-size: 0.58rem;
    }

    .loading-settings .cancel-loading-btn {
      padding-block: 8px;
    }

    .loading-canvas {
      left: max(8px, calc(50% - 100px));
      right: auto;
      bottom: calc(min(48dvh, 390px) + 12px);
      width: clamp(150px, 46vw, 200px);
      height: auto;
    }
  }

  @media (max-width: 860px) and (orientation: landscape), (max-height: 560px) and (max-width: 1000px) {
    .top-bar {
      height: 52px;
    }

    .song-loading-dock {
      top: 52px;
      left: auto;
      right: 8px;
      bottom: 8px;
      width: min(390px, 44vw);
      height: auto;
    }

    .song-loading-dock .loading-settings {
      padding: 10px 12px;
    }

    .loading-settings-head {
      padding-bottom: 7px;
    }

    .loading-settings-body {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0 12px;
      padding-block: 4px;
    }

    .loading-setting-row,
    .loading-setting-toggle {
      padding: 4px 0;
      font-size: 0.62rem;
    }

    .detail.detail-center {
      padding-bottom: 0;
      transform: translateX(-20vw);
    }

    .detail.detail-center .detail-img {
      width: min(46vw, 470px);
      transform: scale(1.02);
    }

    .loading-canvas {
      left: 8px;
      right: auto;
      bottom: 6px;
      width: clamp(150px, 24vw, 210px);
      height: auto;
    }
  }

  @media (max-width: 520px) {
    .top-actions .upload-btn,
    .top-actions .list-btn {
      display: none;
    }

    .preview-controls button {
      width: 23px;
    }

    .song-list {
      width: 30vw;
      min-width: 96px;
    }

    .detail {
      padding-inline: 7px;
    }

    .level-btn {
      min-width: 42px;
      padding: 7px 8px;
    }

    .loading-settings-head span,
    .song-loading-dock .loading-settings-head strong::after {
      display: none;
    }

    .loading-setting-toggle i {
      flex-shrink: 0;
    }
  }
</style>
