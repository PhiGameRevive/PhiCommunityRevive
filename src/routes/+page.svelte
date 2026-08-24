<script lang="ts">
  /**
   * 启动流程编排：
   *   ① 界面缩放（仅首次启动）
   *   ② 节点选择（每次启动；此处的点击同时作为解锁 AudioContext 的用户手势）
   *   ③ 光敏性癫痫警告（无按钮，5 秒自动推进，可点击加速）
   *   ④ 预载（谱面列表 + 游玩素材 + 引擎包 + 开场音频解码，带真实进度条）
   *   ⑤ 开场动画（新版 19 秒 / 旧版 8.5 秒，由设置切换；首次启动不可跳过）
   *   ⑥ 黑屏 → 全屏加载界面 → /songs
   *
   * 音频必须在用户手势内 resume()，因此 ② 的点击是整个流程的音频解锁点；
   * 跨节点跳转会换域名（等于新页面），届时新域名同样先展示 ② ，手势不会丢失。
   */
  import { goto } from '$app/navigation';
  import { onDestroy, onMount } from 'svelte';
  import { preloadSongLists, warmPlayerBundle, type PreloadedSongLists } from '$lib/preload';
  import { preloadGameAssets } from '$lib/preloadAssets';
  import PhigrosLoading from '$lib/components/PhigrosLoading.svelte';
  import LoadingCanvas from '$lib/components/LoadingCanvas.svelte';
  import IntroNew from '$lib/intro/IntroNew.svelte';
  import IntroLegacy from '$lib/intro/IntroLegacy.svelte';
  import { randomTip } from '$lib/loadingTips';
  import {
    DEPLOY_NODES,
    applyInheritedParams,
    getCurrentNode,
    gotoNode,
    probeNode,
    type DeployNode,
  } from '$lib/nodes';
  import {
    DEFAULT_UI_SCALE,
    MAX_UI_SCALE,
    MIN_UI_SCALE,
    UI_SCALE_STEP,
    commitUiScale,
    hasUiScalePreference,
    loadUiScale,
  } from '$lib/uiScale';
  import { hasSeenIntro, loadIntroStyle, markIntroSeen, type IntroStyle } from '$lib/introStyle';

  type Stage = 'boot' | 'scale' | 'node' | 'warning' | 'preload' | 'intro' | 'exit' | 'loading';

  let stage: Stage = 'boot';
  const version = 'v2.0.0';

  let introStyle: IntroStyle = 'new';
  /** 首次启动（未完整看过开场）时禁止跳过前摇 */
  let canSkipIntro = false;

  /* ---------------- ① 界面缩放 ---------------- */
  let uiScale = DEFAULT_UI_SCALE;

  const applyScalePreview = (value: number) => {
    // commitUiScale 会把 zoom 直接写到 <html>，整个面板随之缩放 —— 这就是实时预览
    uiScale = commitUiScale(value);
  };

  /* ---------------- ② 节点选择 ---------------- */
  let currentNode: DeployNode | null = null;
  let selectedNodeId: string | null = null;
  let latencies: Record<string, number | null | undefined> = {};

  const probeAll = () => {
    DEPLOY_NODES.forEach(async (node) => {
      latencies = { ...latencies, [node.id]: undefined };
      const ms = await probeNode(node);
      latencies = { ...latencies, [node.id]: ms };
    });
  };

  /** 选择节点：当前节点原地继续（并解锁音频），其他节点带着设置跳过去 */
  const chooseNode = (node: DeployNode) => {
    if (stage !== 'node') return;
    selectedNodeId = node.id;
    // 已在该节点上 → 原地继续；否则跳转（含当前域名未配置的情况，如本地开发）
    if (currentNode?.id === node.id) {
      void unlockAudio();
      stage = 'warning';
      startWarningCountdown();
      return;
    }
    gotoNode(node, { scale: uiScale, onboarded: canSkipIntro, intro: introStyle });
  };

  /** 无可用节点配置时（.env 全空 / 本地开发）跳过选择，但仍需一次点击解锁音频 */
  const continueWithoutNode = () => {
    if (stage !== 'node') return;
    void unlockAudio();
    stage = 'warning';
    startWarningCountdown();
  };

  /* ---------------- ③ 光敏性警告 ---------------- */
  const WARNING_MS = 5000;
  let warningCountdown = Math.ceil(WARNING_MS / 1000);
  let warningTimer = 0;
  let warningTicker = 0;

  const startWarningCountdown = () => {
    clearTimeout(warningTimer);
    clearInterval(warningTicker);
    warningCountdown = Math.ceil(WARNING_MS / 1000);
    warningTimer = window.setTimeout(leaveWarning, WARNING_MS);
    warningTicker = window.setInterval(() => {
      warningCountdown = Math.max(0, warningCountdown - 1);
    }, 1000);
  };

  const leaveWarning = () => {
    if (stage !== 'warning') return;
    clearTimeout(warningTimer);
    clearInterval(warningTicker);
    stage = 'preload';
    startPreload();
  };

  /* ---------------- ④ 预载 ---------------- */
  /** 权重：素材文件数最多耗时也最长，谱面列表次之 */
  const PRELOAD_WEIGHTS = { assets: 0.5, lists: 0.3, audio: 0.2 };

  let preloadProgress = 0;
  let preloadDetail = '';
  let assetRatio = 0;
  let listsRatio = 0;
  let audioRatio = 0;
  let preloadController: AbortController | null = null;
  /** 首次启动才提示"需要预载配置"（二次启动素材多已命中缓存，很快过去） */
  let firstBoot = true;

  const recomputeProgress = () => {
    preloadProgress =
      assetRatio * PRELOAD_WEIGHTS.assets +
      listsRatio * PRELOAD_WEIGHTS.lists +
      audioRatio * PRELOAD_WEIGHTS.audio;
  };

  let listsPromise: Promise<PreloadedSongLists> = Promise.resolve({ phi: [], ptc: [], pz: [] });

  const startPreload = () => {
    const controller = new AbortController();
    preloadController = controller;

    // 谱面列表（三个源并行；单源失败不影响其他源）
    listsPromise = preloadSongLists().then((l) => {
      listsRatio = 1;
      recomputeProgress();
      // 列表就绪后再预热引擎包，避免与素材下载争抢带宽
      warmPlayerBundle();
      return l;
    });
    listsPromise.catch(() => {
      listsRatio = 1;
      recomputeProgress();
    });

    // 游玩素材（note 贴图 / 打击音效 / 判定特效 / 评级图 / 结算音 / shader / Outfit 字体）
    const assetsPromise = preloadGameAssets((ratio) => {
      assetRatio = ratio;
      preloadDetail = `游玩素材 ${Math.round(ratio * 100)}%`;
      recomputeProgress();
    }, controller.signal);

    // 开场音频：解码完成才起播，避免动画与音乐错位
    const audioPromise = decodeIntroAudio().then((ok) => {
      audioRatio = 1;
      recomputeProgress();
      return ok;
    });

    void Promise.all([listsPromise.catch(() => null), assetsPromise, audioPromise]).then(() => {
      if (controller.signal.aborted) return;
      preloadProgress = 1;
      preloadDetail = '准备完成';
      // 让进度条走满的那一帧被看见，再进入开场动画
      window.setTimeout(() => {
        if (controller.signal.aborted) return;
        stage = 'intro';
      }, 260);
    });
  };

  /* ---------------- 音频 ---------------- */
  let actx: AudioContext | null = null;
  let introBuffer: AudioBuffer | null = null;

  const audioUrl = (style: IntroStyle) =>
    style === 'new' ? '/audio/TapToStartNew.mp3' : '/audio/TapToStart.mp3';

  /** 在用户手势内创建并 resume AudioContext（解码可以晚一点做） */
  const unlockAudio = async () => {
    try {
      if (!actx) {
        const Ctor =
          window.AudioContext ??
          (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        actx = new Ctor();
      }
      if (actx.state === 'suspended') await actx.resume();
    } catch (e) {
      console.warn('AudioContext unlock failed', e);
    }
  };

  /** 下载并解码开场音频；失败时返回 false，动画照常进行（只是没有声音） */
  const decodeIntroAudio = async (): Promise<boolean> => {
    if (!actx) return false;
    try {
      const res = await fetch(audioUrl(introStyle), { credentials: 'omit' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get('content-length')) || 0;
      // 有 content-length 时按字节汇报进度，否则只在完成时跳到 100%
      const buf = total && res.body ? await readWithProgress(res.body, total) : await res.arrayBuffer();
      introBuffer = await actx.decodeAudioData(buf);
      return true;
    } catch (e) {
      console.warn('intro audio decode failed', e);
      return false;
    }
  };

  const readWithProgress = async (
    body: ReadableStream<Uint8Array>,
    total: number,
  ): Promise<ArrayBuffer> => {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      audioRatio = Math.min(received / total, 1);
      recomputeProgress();
    }
    const merged = new Uint8Array(received);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }
    return merged.buffer;
  };

  /* ---------------- ⑥ 退出到选歌页 ---------------- */
  const MIN_LOADING_MS = 900;

  let loadingStart = 0;
  let leavingLoading = false;
  let loadProgress = 0;
  let progressTimer = 0;
  let tipText = '';
  let coverUrl = '/ui/ElementSqare.webp';
  let exitTimer = 0;

  const finishIntro = () => {
    if (stage !== 'intro') return;
    markIntroSeen();
    stage = 'exit';
    clearTimeout(exitTimer);
    exitTimer = window.setTimeout(() => {
      stage = 'loading';
      startLoading();
      // 首次用户先完成基础设置；设置页返回时再自动进入 PTC 新手教程
      if (!localStorage.getItem('phiOnboardingDone')) {
        sessionStorage.setItem('firstUserSetupReturn', 'tutorial');
        window.setTimeout(() => goto('/settings'), 500);
        return;
      }
      tipText = randomTip();
      // 谱面列表就绪后随机挑一首曲绘当加载背景（未就绪时用默认图兜底）
      void listsPromise.then((lists) => {
        const songs = [...lists.phi, ...lists.ptc, ...lists.pz].filter((s) => s.illustration);
        if (songs.length > 0) {
          coverUrl = songs[Math.floor(Math.random() * songs.length)].illustration;
        }
      });
      void Promise.all([listsPromise.catch(() => null), waitForMinimumLoading()]).then(() => {
        loadProgress = 1;
        clearInterval(progressTimer);
        window.setTimeout(() => {
          leavingLoading = true;
          window.setTimeout(() => goto('/songs'), 500);
        }, 120);
      });
    }, 500);
  };

  const startLoading = () => {
    loadingStart = performance.now();
    loadProgress = 0;
    clearInterval(progressTimer);
    progressTimer = window.setInterval(() => {
      loadProgress = Math.min((performance.now() - loadingStart) / MIN_LOADING_MS, 0.98);
    }, 60);
  };

  const waitForMinimumLoading = async () => {
    const elapsed = performance.now() - loadingStart;
    if (elapsed < MIN_LOADING_MS) {
      await new Promise((resolve) => setTimeout(resolve, MIN_LOADING_MS - elapsed));
    }
  };

  /* ---------------- 生命周期 ---------------- */
  onMount(() => {
    // 跨节点跳转落地：先消费 URL 上继承过来的设置，再判断是否首次启动
    const inherited = applyInheritedParams();
    uiScale = loadUiScale();
    introStyle = loadIntroStyle();
    canSkipIntro = hasSeenIntro();
    firstBoot = !canSkipIntro;
    currentNode = getCurrentNode();
    selectedNodeId = inherited.node ?? currentNode?.id ?? null;

    // 已设置过缩放（含继承）则跳过缩放页，直接进入节点选择
    const needScale = !hasUiScalePreference();
    window.setTimeout(() => {
      stage = needScale ? 'scale' : 'node';
      if (!needScale) probeAll();
    }, 400);
  });

  onDestroy(() => {
    clearTimeout(warningTimer);
    clearInterval(warningTicker);
    clearTimeout(exitTimer);
    clearInterval(progressTimer);
    preloadController?.abort();
    if (actx && actx.state !== 'closed') void actx.close();
  });
</script>

<svelte:head>
  <title>PhiCommunity</title>
  <!-- 提前缓存开场背景大图，避免高潮命中时闪白 -->
  <link rel="preload" as="image" href="/ui/ElementSqare.webp" />
</svelte:head>

<div class="boot-root">
  <!-- ① 界面缩放（仅首次启动）：zoom 作用在 <html> 上，整个面板即所见即所得的预览 -->
  {#if stage === 'scale'}
    <div class="panel-screen">
      <div class="panel">
        <span class="panel-label">STEP 1 / 2</span>
        <h1 class="panel-title">调整界面大小</h1>
        <p class="panel-hint">
          拖动滑块，整个界面会随之放大或缩小，直到看起来舒适为止。之后可在「设置 → 界面」随时修改。
        </p>

        <div class="scale-preview">
          <div class="preview-card">
            <span class="preview-name">Introduction</span>
            <span class="preview-artist">PhiCommunity</span>
            <div class="preview-levels">
              <span>EZ</span><span>HD</span><span class="active">IN</span><span>AT</span>
            </div>
          </div>
        </div>

        <div class="scale-control">
          <button class="step-btn" onclick={() => applyScalePreview(uiScale - UI_SCALE_STEP)} aria-label="缩小">−</button>
          <input
            type="range"
            min={MIN_UI_SCALE}
            max={MAX_UI_SCALE}
            step={UI_SCALE_STEP}
            value={uiScale}
            oninput={(e) => applyScalePreview(Number(e.currentTarget.value))}
            aria-label="界面大小"
          />
          <button class="step-btn" onclick={() => applyScalePreview(uiScale + UI_SCALE_STEP)} aria-label="放大">+</button>
          <span class="scale-value">{Math.round(uiScale * 100)}%</span>
        </div>

        <div class="panel-actions">
          <button class="ghost-btn" onclick={() => applyScalePreview(DEFAULT_UI_SCALE)}>重置</button>
          <button
            class="primary-btn"
            onclick={() => {
              applyScalePreview(uiScale);
              stage = 'node';
              probeAll();
            }}
          >
            下一步
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- ② 节点选择（每次启动；点击即解锁音频） -->
  {#if stage === 'node'}
    <div class="panel-screen">
      <div class="panel">
        <span class="panel-label">SELECT NODE</span>
        <h1 class="panel-title">选择线路</h1>
        <p class="panel-hint">选择延迟较低的线路以获得更快的加载速度。</p>

        {#if DEPLOY_NODES.length > 0}
          <div class="node-list">
            {#each DEPLOY_NODES as node}
              {@const ms = latencies[node.id]}
              <button
                class="node-item"
                class:current={currentNode?.id === node.id}
                class:selected={selectedNodeId === node.id}
                onclick={() => chooseNode(node)}
              >
                <span class="node-main">
                  <strong>{node.label}</strong>
                  <small>{node.description}</small>
                </span>
                <span class="node-meta">
                  {#if currentNode?.id === node.id}
                    <em class="node-tag">当前</em>
                  {/if}
                  {#if ms === undefined}
                    <span class="node-ping probing">探测中</span>
                  {:else if ms === null}
                    <span class="node-ping bad">超时</span>
                  {:else}
                    <span class="node-ping" class:good={ms < 300}>{ms} ms</span>
                  {/if}
                </span>
              </button>
            {/each}
          </div>
          <div class="panel-actions">
            <button class="ghost-btn" onclick={probeAll}>重新探测</button>
            {#if !currentNode}
              <!-- 当前域名不在已配置节点内（本地开发 / 自定义域名）：允许留在此处 -->
              <button class="primary-btn" onclick={continueWithoutNode}>留在当前站点</button>
            {/if}
          </div>
        {:else}
          <p class="panel-hint">未配置任何节点地址（.env 的 VITE_SITE_*），将使用当前站点。</p>
          <button class="primary-btn wide" onclick={continueWithoutNode}>继续</button>
        {/if}
      </div>
    </div>
  {/if}

  <!-- ③ 光敏性癫痫警告：无按钮，倒计时自动推进，点击可加速 -->
  {#if stage === 'warning'}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
    <div
      class="warning-screen"
      role="button"
      tabindex="0"
      onclick={leaveWarning}
      onkeydown={(e) => (e.key === ' ' || e.key === 'Enter') && leaveWarning()}
    >
      <h2 class="warning-title">光敏性癫痫警告</h2>
      <p class="warning-text">
        本游戏包含快速闪烁的画面与高对比度特效，可能诱发光敏性癫痫发作。
        如果你或家人有癫痫病史，请在游玩前咨询医生。
        若出现头晕、视力模糊、眼部或肌肉抽搐等症状，请立即停止游玩。
      </p>
      <div class="warning-progress" style={`--warn-ms: ${WARNING_MS}ms`}></div>
      <span class="warning-count">{warningCountdown} 秒后继续 · 点按加速</span>
    </div>
  {/if}

  <!-- ④ 预载：LOADING 进度条 + 首次启动提示 -->
  {#if stage === 'preload'}
    <div class="preload-screen">
      <LoadingCanvas progress={preloadProgress} detail={preloadDetail} />
      <p class="preload-hint">
        {#if firstBoot}
          首次启动需要预载配置，请稍等
        {:else}
          正在准备资源，请稍等
        {/if}
      </p>
    </div>
  {/if}

  <!-- ⑤ 开场动画
       exit / loading 阶段仍保持挂载：
        - 黑屏遮罩要盖在 TAP TO START 画面上渐入（提前卸载会让画面硬切到黑屏）
        - 音乐持续播放到跳转选歌页，不在加载界面出现时突然断掉
       occluded 在被完全遮住后停掉花瓣，避免白费 GPU。 -->
  {#if stage === 'intro' || stage === 'exit' || stage === 'loading'}
    {#if introStyle === 'legacy'}
      <IntroLegacy
        {actx}
        buffer={introBuffer}
        canSkip={canSkipIntro}
        {version}
        nodeLabel={currentNode?.label ?? ''}
        onDone={finishIntro}
      />
    {:else}
      <IntroNew
        {actx}
        buffer={introBuffer}
        canSkip={canSkipIntro}
        occluded={stage === 'loading'}
        {version}
        nodeLabel={currentNode?.label ?? ''}
        onDone={finishIntro}
      />
    {/if}
  {/if}

  <!-- 退出黑屏遮罩 -->
  <div class="fade-overlay" class:on={stage === 'exit' || stage === 'loading'}></div>

  <!-- ⑥ 全屏加载界面 → /songs -->
  {#if stage === 'loading'}
    <PhigrosLoading cover={coverUrl} tip={tipText} progress={loadProgress} />
    <div class="loading-exit" class:on={leavingLoading}></div>
  {/if}
</div>

<style>
  .boot-root {
    position: fixed;
    inset: 0;
    overflow: hidden;
    background: #000;
    user-select: none;
  }

  /* ---- ①② 通用面板 ---- */
  .panel-screen {
    position: absolute;
    inset: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    overflow-y: auto;
    animation: panel-in 0.45s ease;
  }

  @keyframes panel-in {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .panel {
    width: min(560px, 100%);
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 28px clamp(20px, 4vw, 36px) 26px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 3px;
    background: rgba(12, 12, 16, 0.86);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
  }

  .panel-label {
    color: rgba(255, 255, 255, 0.4);
    font-family: var(--phi-mono);
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.26em;
  }

  .panel-title {
    margin: 0;
    font-size: clamp(1.4rem, 3.4vw, 1.9rem);
    font-weight: 900;
    letter-spacing: 0.08em;
  }

  .panel-hint {
    margin: 0;
    color: rgba(255, 255, 255, 0.55);
    font-size: 0.85rem;
    line-height: 1.8;
  }

  .panel-actions {
    display: flex;
    gap: 10px;
    margin-top: 6px;
  }

  .primary-btn {
    flex: 1;
    border: 1.5px solid #fff;
    background: #fff;
    color: #0a0a0c;
    padding: 13px 24px;
    font-size: 0.95rem;
    font-weight: 800;
    letter-spacing: 0.2em;
    border-radius: 2px;
    cursor: pointer;
  }

  .primary-btn:hover {
    background: rgba(255, 255, 255, 0.86);
    color: #0a0a0c;
  }

  .ghost-btn {
    border: 1.5px solid rgba(255, 255, 255, 0.35);
    background: transparent;
    color: rgba(255, 255, 255, 0.75);
    padding: 13px 22px;
    font-size: 0.88rem;
    font-weight: 700;
    letter-spacing: 0.14em;
    border-radius: 2px;
    cursor: pointer;
  }

  .primary-btn.wide {
    width: 100%;
  }

  /* ---- ① 缩放预览 ---- */
  .scale-preview {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 132px;
    padding: 16px;
    border: 1px dashed rgba(255, 255, 255, 0.2);
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.03);
    overflow: hidden;
  }

  .preview-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 16px;
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.06);
  }

  .preview-name {
    font-size: 0.95rem;
    font-weight: 800;
  }

  .preview-artist {
    color: rgba(255, 255, 255, 0.5);
    font-size: 0.76rem;
  }

  .preview-levels {
    display: flex;
    gap: 4px;
    margin-top: 2px;
  }

  .preview-levels span {
    padding: 1px 5px;
    border: 1px solid rgba(255, 255, 255, 0.3);
    color: rgba(255, 255, 255, 0.55);
    font-size: 0.6rem;
    font-weight: 700;
  }

  .preview-levels span.active {
    background: #fff;
    color: #0a0a0c;
  }

  .scale-control {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .scale-control input[type='range'] {
    flex: 1;
    min-width: 0;
    accent-color: #fff;
  }

  .step-btn {
    width: 34px;
    height: 34px;
    flex-shrink: 0;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.35);
    background: transparent;
    color: #fff;
    font-size: 1rem;
    font-weight: 700;
    border-radius: 2px;
    cursor: pointer;
  }

  .scale-value {
    flex-shrink: 0;
    min-width: 52px;
    text-align: right;
    color: rgba(255, 255, 255, 0.7);
    font-family: var(--phi-mono);
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
  }

  /* ---- ② 节点列表 ---- */
  .node-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .node-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    padding: 13px 16px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.04);
    color: #e8e8e8;
    text-align: left;
    cursor: pointer;
    transition:
      background 0.16s ease,
      border-color 0.16s ease;
  }

  .node-item:hover {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.5);
    color: #fff;
  }

  .node-item.selected {
    border-color: #fff;
  }

  .node-main {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .node-main strong {
    font-size: 0.95rem;
    font-weight: 800;
    letter-spacing: 0.04em;
  }

  .node-main small {
    color: rgba(255, 255, 255, 0.45);
    font-size: 0.72rem;
  }

  .node-item:hover .node-main small {
    color: rgba(255, 255, 255, 0.7);
  }

  .node-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .node-tag {
    padding: 2px 7px;
    border: 1px solid rgba(255, 255, 255, 0.4);
    color: rgba(255, 255, 255, 0.7);
    font-family: var(--phi-mono);
    font-size: 0.6rem;
    font-style: normal;
    letter-spacing: 0.12em;
  }

  .node-ping {
    min-width: 62px;
    text-align: right;
    color: rgba(255, 255, 255, 0.6);
    font-family: var(--phi-mono);
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
  }

  .node-ping.good {
    color: #9fe0ac;
  }

  .node-ping.bad {
    color: rgba(255, 160, 160, 0.8);
  }

  .node-ping.probing {
    color: rgba(255, 255, 255, 0.35);
  }

  /* ---- ③ 光敏性警告 ---- */
  .warning-screen {
    position: absolute;
    inset: 0;
    z-index: 10;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 0 24px;
    text-align: center;
    cursor: pointer;
    outline: none;
    animation: panel-in 0.5s ease;
  }

  .warning-title {
    margin: 0 0 18px;
    font-size: clamp(1.3rem, 3.4vw, 1.9rem);
    font-weight: 900;
    letter-spacing: 0.12em;
    color: #ffd9d9;
    text-shadow: 0 0 24px rgba(255, 120, 120, 0.3);
  }

  .warning-text {
    margin: 0 0 30px;
    max-width: 640px;
    color: rgba(255, 255, 255, 0.82);
    font-size: clamp(0.88rem, 2.2vw, 1.05rem);
    line-height: 2;
    letter-spacing: 0.04em;
  }

  /* 倒计时进度条：只动 transform，走合成器 */
  .warning-progress {
    width: min(260px, 60vw);
    height: 2px;
    background: rgba(255, 255, 255, 0.18);
    overflow: hidden;
  }

  .warning-progress::after {
    content: '';
    display: block;
    width: 100%;
    height: 100%;
    background: #fff;
    transform-origin: left center;
    animation: warn-fill var(--warn-ms) linear forwards;
  }

  @keyframes warn-fill {
    from {
      transform: scaleX(0);
    }
    to {
      transform: scaleX(1);
    }
  }

  .warning-count {
    margin-top: 12px;
    color: rgba(255, 255, 255, 0.42);
    font-family: var(--phi-mono);
    font-size: 0.7rem;
    letter-spacing: 0.18em;
  }

  /* ---- ④ 预载 ---- */
  .preload-screen {
    position: absolute;
    inset: 0;
    z-index: 10;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    animation: panel-in 0.4s ease;
  }

  .preload-hint {
    margin: 0;
    color: rgba(255, 255, 255, 0.55);
    font-family: var(--phi-mono);
    font-size: clamp(0.72rem, 1.8vw, 0.85rem);
    letter-spacing: 0.14em;
    text-align: center;
    padding: 0 20px;
  }

  /* ---- 遮罩 ---- */
  .fade-overlay {
    position: absolute;
    inset: 0;
    z-index: 30;
    background: #000;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.5s ease;
  }

  .fade-overlay.on {
    opacity: 1;
    pointer-events: auto;
  }

  .loading-exit {
    position: absolute;
    inset: 0;
    z-index: 70;
    background: #000;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.5s ease;
  }

  .loading-exit.on {
    opacity: 1;
    pointer-events: auto;
  }
</style>
