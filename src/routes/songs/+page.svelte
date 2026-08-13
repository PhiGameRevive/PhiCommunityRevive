<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { fly } from 'svelte/transition';
  import { goto } from '$app/navigation';
  import { getResult, getAllResults, getAllLocalCharts, type LocalChart } from '$lib/db';
  import { getRank, type Level, type Rank } from '$lib/meta';
  import { fetchSongs, SOURCE_LABELS, type ChartSourceId, type SourceSong } from '$lib/sources';
  import { fetchPzCharts, fetchPzChartFile, getToken, login, setToken, PZ_LEVEL_TYPE } from '$lib/phizone';
  import { alert as alertModal, prompt as pzPrompt } from '$lib/modal';

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
    levels: Partial<Record<Level, { chart: string; rank?: number; charter?: string }>>;
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

  // ---- Phigros loading 动画（复刻 ploading.js）----
  let loadingCanvas: HTMLCanvasElement | undefined;
  let animId = 0;
  let animStart = 0;

  const drawLoading = (now: number) => {
    const canvas = loadingCanvas;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const t = (now - animStart) / 15;
    ctx.clearRect(0, 0, w, h);
    ctx.font = '26px "Courier New", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    const msg = 'LOADING';
    const dxs = ctx.measureText(msg).width;
    ctx.globalCompositeOperation = 'xor';
    const hw = 20 + dxs / 2;
    ctx.fillRect(
      Math.sin(t / 20) < 0 ? Math.cos(t / 20) * hw + w / 2 : w / 2 - hw,
      h / 2 - 25,
      -Math.cos(t / 20) * hw + hw,
      50,
    );
    ctx.fillText(msg, w / 2, h / 2);
    ctx.globalCompositeOperation = 'source-over';
    animId = requestAnimationFrame(drawLoading);
  };

  const beginTransition = (target: string) => {
    if (starting) return;
    starting = true;
    animStart = performance.now();
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(drawLoading);
    // 延迟 2 秒加载完成后开始
    setTimeout(() => goto(target), 2000);
  };

  const currentList = (): SongItem[] =>
    activeSource === 'local' ? localSongs : songsBySource[activeSource];

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
    try {
      const [phi, ptc, pz, locals] = await Promise.all([
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

      // 成绩
      const allSongs = [...localSongs, ...songsBySource.phi, ...songsBySource.ptc, ...songsBySource.pz];
      const scoreEntries = await Promise.all(
        allSongs.flatMap((s) =>
          LEVELS.map(async (l) => {
            const r = await getResult(`${s.codename}-${l}`);
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
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      loaded = true;
    }

    // 全局监听拖拽移动/释放（指针离开列表项后仍能跟随）
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  });

  onDestroy(() => {
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
  };

  const selectSong = (i: number) => {
    if (starting) return;
    current = i;
    const s = currentList()[i];
    if (s) {
      const lp = LEVELS.find((l) => s.levels[l]);
      if (lp) level = lp;
    }
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
        const chart = charts.find((c) => PZ_LEVEL_TYPE[c.levelType] === level);
        if (!chart) {
          await alertModal('该难度没有谱面');
          return;
        }
        const file = await fetchPzChartFile(chart.id, token ?? undefined);
        const item: SongItem = {
          ...s,
          levels: { ...s.levels, [level]: { chart: file, rank: chart.difficulty || undefined, charter: chart.authorName } },
        };
        sessionStorage.setItem('currentSong', JSON.stringify(item));
        sessionStorage.setItem('currentLevel', level);
        beginTransition(`/play/${encodeURIComponent(item.codename)}/${level}`);
      } catch (e) {
        await alertModal(e instanceof Error ? e.message : '获取谱面失败');
      }
      return;
    }
    const lv = s.levels[level];
    if (!lv?.chart || starting) return;
    // 预加载谱面资源（写入 HTTP 缓存），不阻塞动画；视频音乐（大文件）不预加载，由流式播放
    try {
      const chart = s.source === 'local' ? '' : lv.chart;
      const targets = [chart, s.illustrationUrl];
      if (!s.songIsVideo) targets.push(s.songUrl);
      Promise.all(targets.filter(Boolean).map((url) => fetch(url, { cache: 'force-cache' }).catch(() => null)));
    } catch {
      /* 预加载失败不阻塞 */
    }
    // 传递当前歌曲数据给 play 页
    sessionStorage.setItem('currentSong', JSON.stringify(s));
    sessionStorage.setItem('currentLevel', level);
    beginTransition(`/play/${encodeURIComponent(s.codename)}/${level}`);
  };

  const onKey = (e: KeyboardEvent) => {
    if (starting) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') selectSong((current - 1 + currentList().length) % currentList().length);
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') selectSong((current + 1) % currentList().length);
    if (e.key === 'Enter' || e.key === ' ') startPlay();
  };
</script>

<svelte:head>
  <title>选歌 - PhiCommunity</title>
</svelte:head>

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
                  <span class="mini-level" class:mini-active={lv === level && i === current}>{LEVEL_LABELS[lv]}</span>
                {/if}
              {/each}
            </div>
          </button>
        {:else}
          {#if activeSource === 'pz' && pzSourceError}
            <p class="empty-hint">PhiZone 列表加载失败：{pzSourceError}</p>
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
                <span class="level-txt">{LEVEL_LABELS[lv]}</span>
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

    <!-- 右下角 Phigros loading 动画（复刻 ploading.js：文字 + xor 遮罩条横跳） -->
    {#if starting}
      <canvas
        class="loading-canvas"
        bind:this={loadingCanvas}
        width="520"
        height="240"
      ></canvas>
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
    transition: opacity 0.45s ease;
  }

  /* 开始动画：列表收起后 detail 占据全宽，内容自然移向中央；曲绘非线性放大 */
  .detail.detail-center {
    opacity: 1;
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
    right: 20px;
    bottom: 20px;
    width: 260px;
    height: 120px;
    z-index: 80;
    animation: loading-in 0.3s ease;
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
  }
</style>