<script lang="ts">
  import { goto } from '$app/navigation';
  import { onDestroy, onMount } from 'svelte';
  import { preloadSongLists, warmPlayerBundle, type PreloadedSongLists } from '$lib/preload';
  import PhigrosLoading from '$lib/components/PhigrosLoading.svelte';
  import { randomTip } from '$lib/loadingTips';

  /**
   * 开场流程（legacy tapToStart 体验）：
   *   boot(黑屏) → warning(光敏性癫痫警告) → 点击解锁音频(TapToStart.mp3 循环+渐入)
   *   → 黑屏上播完制作组/原作者/PhiZone图标(8.5s 前) → 播放 8.5s → tap(Tap To Start 页)
   *   → 点击 → 黑屏 → 全屏加载界面(共享 PhigrosLoading 组件，等谱面列表就绪) → /songs
   * 期间并行预载三个谱面源列表并预热 Phaser 引擎包，保证进入选歌页零等待。
   */
  type Stage = 'boot' | 'warning' | 'playing' | 'tap' | 'loading' | 'exit';

  let stage: Stage = 'boot';
  let version = 'v2.0.0';

  let actx: AudioContext | null = null;
  let audioBufferPromise: Promise<AudioBuffer | null> = Promise.resolve(null);
  let audioSource: AudioBufferSourceNode | null = null;
  let audioGain: GainNode | null = null;
  let sourceStarted = false;

  const AUDIO_URL = '/audio/TapToStart.mp3';

  let clearTimers: () => void = () => {};
  let skipTimer = 0;
  let skipAt = 0;
  let iconOnTimer = 0;
  let iconOffTimer = 0;
  let iconsOn = false;
  let disclaimerTimer = 0;
  let disclaimerOn = false;
  let skipDone = false;
  let exitTimer = 0;

  let listsPromise: Promise<PreloadedSongLists> = Promise.resolve({
    phi: [],
    ptc: [],
    pz: [],
  });

  // ---- 全屏加载界面：进度由计时推进，绘制交给共享 PhigrosLoading 组件 ----
  const MIN_LOADING_MS = 900;

  let loadingStart = 0;
  let loadingDone = false;
  let leavingLoading = false;
  let loadProgress = 0;
  let progressTimer = 0;

  let tipText = '';
  let coverUrl = '/ui/ElementSqare.webp';

  onMount(() => {
    // 1) 后台预载：谱面列表就绪后再预热引擎包（避免争抢带宽）
    //    保存列表 Promise，进入加载界面时等待它完成再跳转选歌页
    listsPromise = preloadSongLists().then((l) => {
      warmPlayerBundle();
      return l;
    });

    // 2) 预取开场音频并解码（fetch/decode 无需用户手势，点击时即刻开播）
    try {
      actx = new (window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!)();
      audioBufferPromise = fetch(AUDIO_URL)
        .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`HTTP ${res.status}`))))
        .then((buf) => actx!.decodeAudioData(buf))
        .catch((e) => {
          console.warn('TapToStart audio decode failed', e);
          return null;
        });
    } catch (e) {
      console.warn('AudioContext unavailable', e);
    }

    const timers = [
      // 黑屏停留片刻 → 直接进入光敏性癫痫警告（图标移到音乐播放阶段展示）
      setTimeout(() => (stage = 'warning'), 600),
    ];
    clearTimers = () => {
      timers.forEach((t) => clearTimeout(t));
      clearTimeout(skipTimer);
      clearTimeout(iconOnTimer);
      clearTimeout(iconOffTimer);
      clearTimeout(disclaimerTimer);
      clearTimeout(exitTimer);
      clearInterval(progressTimer);
    };
  });

  onDestroy(() => {
    clearTimers();
    if (actx && actx.state !== 'closed') void actx.close();
  });

  /** 点击警告页按钮：浏览器手势解锁 AudioContext 并开始循环播放（带 1.5s 渐入） */
  const startAudio = async () => {
    try {
      const buffer = await audioBufferPromise;
      if (!actx || !buffer || sourceStarted) return;
      await actx.resume();
      sourceStarted = true;
      const source = actx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = actx.createGain();
      const now = actx.currentTime;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.9, now + 1.5);
      source.connect(gain);
      gain.connect(actx.destination);
      source.start();
      audioSource = source;
      audioGain = gain;
    } catch (e) {
      console.warn('TapToStart playback failed', e);
    }
  };

  /** 跳过前摇时把音乐直接推进到指定秒数（旧源停、新源从 offset 起播，复用已渐入的增益节点） */
  const seekAudio = (offset: number) => {
    if (!actx || !audioSource || !audioGain) return;
    try {
      const buffer = audioSource.buffer;
      if (!buffer) return;
      const t = actx.currentTime;
      audioSource.stop(t);
      const source = actx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(audioGain);
      source.start(t, offset);
      audioSource = source;
    } catch (e) {
      console.warn('TapToStart seek failed', e);
    }
  };

  const begin = () => {
    if (stage !== 'warning') return;
    stage = 'playing';
    // 音乐渐入的同时，在黑屏上展示制作组图标（8.5s 前播完，与警告淡出交叉）
    iconOnTimer = window.setTimeout(() => (iconsOn = true), 0);
    iconOffTimer = window.setTimeout(() => (iconsOn = false), 4400);
    // 图标渐出后，黑屏上渐入文字免责声明（读到 8.5s，被 Tap To Start 取代）
    disclaimerTimer = window.setTimeout(() => (disclaimerOn = true), 5400);
    // 播放 8~9 秒后显现 Tap To Start 页面（解码失败也照常推进，不卡死流程）
    void startAudio().finally(() => {
      skipTimer = window.setTimeout(() => (stage = 'tap'), 8500);
    });
  };

  /** playing 阶段点击 = 跳过前摇直达 Tap To Start；tap 阶段点击 = 进入选歌页 */
  const skipOrExit = () => {
    if (stage === 'playing') {
      clearTimeout(skipTimer);
      clearTimeout(iconOnTimer);
      clearTimeout(iconOffTimer);
      clearTimeout(disclaimerTimer);
      iconsOn = false;
      disclaimerOn = false;
      skipDone = true; // 跳过 = 直达终态：禁用一切渐入过渡
      stage = 'tap';
      skipAt = performance.now();
      // 音乐一并跳到 8.5 秒处，与"正常等到 8~9 秒"的听感一致
      seekAudio(8.5);
      return;
    }
    if (stage === 'tap') {
      // 刚跳过后的瞬间忽略，防止"跳过 + 误触退出"连发
      if (performance.now() - skipAt < 350) return;
      exit();
    }
  };

  const exit = () => {
    if (stage !== 'tap') return;
    // 跳过时锁死的过渡恢复：Tap To Start → 黑屏的渐出重新生效
    skipDone = false;
    stage = 'exit';
    clearTimeout(exitTimer);
    // 黑屏遮罩淡入(0.5s)后，接全屏加载界面，等谱面列表就绪再进选歌页
    exitTimer = window.setTimeout(() => {
      stage = 'loading';
      startLoading();
      // 首次用户先完成基础设置；设置页返回时再自动进入 PTC 新手教程。
      if (!localStorage.getItem('phiOnboardingDone')) {
        sessionStorage.setItem('firstUserSetupReturn', 'tutorial');
        window.setTimeout(() => goto('/settings'), 500);
        return;
      }
      // 随机一条左下角 Tip
      tipText = randomTip();
      // 谱面列表就绪后，随机挑一首歌的曲绘当加载背景（列表未就绪时用默认图兜底）
      void listsPromise.then((lists) => {
        const songs = [...lists.phi, ...lists.ptc, ...lists.pz].filter((s) => s.illustration);
        if (songs.length > 0) {
          coverUrl = songs[Math.floor(Math.random() * songs.length)].illustration;
        }
      });
      void Promise.all([listsPromise, waitForMinimumLoading()]).then(() => {
        loadingDone = true;
        loadProgress = 1;
        clearInterval(progressTimer);
        // 进度条走满一帧后，黑屏渐出再跳转选歌页
        window.setTimeout(() => {
          leavingLoading = true;
          window.setTimeout(() => goto('/songs'), 500);
        }, 120);
      });
    }, 500);
  };

  /** 进入加载界面：进度条随经过时间推进，绘制由共享组件逐帧完成 */
  const startLoading = () => {
    loadingStart = performance.now();
    loadingDone = false;
    loadProgress = 0;
    clearInterval(progressTimer);
    progressTimer = window.setInterval(() => {
      loadProgress = Math.min((performance.now() - loadingStart) / MIN_LOADING_MS, 0.98);
    }, 60);
  };

  /** LOADING 动画最短展示时长，避免列表命中缓存时一闪而过。 */
  const waitForMinimumLoading = async () => {
    const elapsed = performance.now() - loadingStart;
    if (elapsed < MIN_LOADING_MS) {
      await new Promise((resolve) => setTimeout(resolve, MIN_LOADING_MS - elapsed));
    }
  };
</script>

<svelte:head>
  <title>PhiCommunity</title>
  <!-- 提前缓存 Tap To Start 页的背景大图，避免显现时闪白 -->
  <link rel="preload" as="image" href="/ui/ElementSqare.webp" />
</svelte:head>

<!-- svelte-ignore a11y_no_noninteractive_tabindex a11y_no_noninteractive_element_interactions -->
<div class="boot" class:skipping={skipDone} role="application" tabindex="0">
  <!-- 背景（tap 阶段才揭晓，8.5s 前保持纯黑；缓慢淡入避免闪光） -->
  <div class="bg" class:on={stage === 'tap'}></div>
  <div class="bg-dim" class:reveal={stage === 'tap'}></div>
  <div class="scanlines" class:on={stage === 'tap'}></div>

  <!-- ① 制作组名称 + 原作者 + PhiZone player 图标（音乐播放阶段黑屏上展示，图标横向排列） -->
  <div class="credits" class:on={iconsOn}>
    <div class="credits-icons">
      <img class="phizone-logo" src="/ui/phizone-icon.png" alt="PhiZone Player" />
      <img class="title-logo" src="/ui/Title.svg" alt="PhiCommunity" />
    </div>
    <div class="credits-line">
      <span class="credits-label">原作者</span>
      <span class="credits-name">yuameshi</span>
    </div>
  </div>

  <!-- ①b 文字免责声明（图标渐出后渐入，读到 8.5s 被 Tap To Start 取代） -->
  <div class="disclaimer" class:on={disclaimerOn && stage === 'playing'}>
    <p>本作为 Phigros 同人社区作品，与厦门鸽游网络有限公司无关。</p>
    <p>全部谱面、音乐与美术资源版权归原作者所有。</p>
    <p>仅供学习交流，请勿用于商业用途。</p>
  </div>

  <!-- ② 光敏性癫痫警告（点击按钮 = 解锁音频的手势） -->
  <div class="warning" class:on={stage === 'warning' || stage === 'playing'} class:leaving={stage === 'playing'}>
    <h2 class="warning-title">光敏性癫痫警告</h2>
    <p class="warning-text">
      本游戏包含快速闪烁的画面与高对比度特效，可能诱发光敏性癫痫发作。
      如果你或家人有癫痫病史，请在游玩前咨询医生。
      若出现头晕、视力模糊、眼部或肌肉抽搐等症状，请立即停止游玩。
    </p>
    <button class="warning-btn" onclick={begin}>点按继续</button>
  </div>

  <!-- ③ Tap To Start 页 -->
  <div class="tap" class:on={stage === 'tap'}>
    <img class="title-logo big" src="/ui/Title.svg" alt="PhiCommunity" />
    <div class="tap-to-start">
      <span class="dot">▮</span>
      TAP TO START
      <span class="dot">▮</span>
    </div>
  </div>

  <div class="info" class:on={stage === 'tap'}>
    <span class="ver">PhiCommunity Revive {version}</span>
    <span class="disclaimer">
      本项目与厦门鸽游网络有限公司（Xiamen Pigeon Games Network Co., Ltd.）没有任何关系
    </span>
  </div>

  <!-- 黑屏遮罩（退出时盖住全部，加载界面在其上叠出） -->
  <div class="fade-overlay" class:on={stage === 'exit' || stage === 'loading'}></div>

  <!-- 全屏加载界面：共享 PhigrosLoading 组件（全屏曲绘 + 底部毛玻璃：左 Tip / 右 LOADING），
      谱面列表就绪后黑屏渐出再跳转选歌页 -->
  {#if stage === 'loading'}
    <PhigrosLoading cover={coverUrl} tip={tipText} progress={loadProgress} />
    <div class="loading-exit" class:on={leavingLoading}></div>
  {/if}

  <!-- 点击命中区：playing 阶段点击跳过前摇，tap 阶段整屏可点进入 -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="hit-zone"
    class:on={stage === 'playing' || stage === 'tap'}
    role="button"
    tabindex="0"
    onclick={skipOrExit}
    onkeydown={(e) => (e.key === ' ' || e.key === 'Enter') && skipOrExit()}
  ></div>
</div>

<style>
  .boot {
    position: fixed;
    inset: 0;
    overflow: hidden;
    background: #000;
    user-select: none;
    cursor: pointer;
    outline: none;
  }

  /* ---- 背景 ---- */
  .bg {
    position: absolute;
    inset: -20px;
    background: url('/ui/ElementSqare.webp') center center no-repeat fixed;
    background-size: cover;
    /* 终态亮度固定为 legacy 同款 brightness(0.5)，只过渡 opacity，避免每帧重跑模糊 */
    filter: blur(12px) brightness(0.5) contrast(0.9) grayscale(0.25);
    transform: scale(1.1);
    opacity: 0;
    transition: opacity 1.2s ease;
    pointer-events: none;
  }

  .bg.on {
    opacity: 1;
  }

  /* 黑色压暗层：tap 阶段与背景同步 1.6s 揭晓（只动 opacity，合成器友好），
     避免"黑屏 → 整页内容+背景"同时硬切造成闪光 */
  .bg-dim {
    position: absolute;
    inset: 0;
    background: #000;
    opacity: 1;
    transition: opacity 1.6s ease;
    pointer-events: none;
  }

  .bg-dim.reveal {
    opacity: 0;
  }

  /* 极客风扫描线 */
  .scanlines {
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(
      0deg,
      rgba(255, 255, 255, 0.028) 0px,
      rgba(255, 255, 255, 0.028) 1px,
      transparent 1px,
      transparent 3px
    );
    opacity: 0;
    transition: opacity 0.8s ease;
    pointer-events: none;
  }

  .scanlines.on {
    opacity: 1;
  }

  /* ---- 通用舞台 ---- */
  .credits,
  .warning,
  .tap {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    opacity: 0;
    transition: opacity 0.9s ease;
    pointer-events: none;
  }

  .credits.on,
  .tap.on {
    opacity: 1;
  }

  /* 警告页需要接收按钮点击，其余舞台元素只做展示 */
  .warning.on {
    opacity: 1;
    pointer-events: auto;
  }

  .warning.leaving {
    opacity: 0;
    pointer-events: none;
  }

  /* ---- ① 制作组 ---- */
  .credits-icons {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 32px;
    padding: 0 24px;
  }

  /* PhiZone 横向 logo（带文字），按高度缩放 */
  .phizone-logo {
    height: 72px;
    width: auto;
    max-width: 46vw;
    object-fit: contain;
    filter: drop-shadow(0 0 14px rgba(255, 255, 255, 0.2));
  }

  .title-logo {
    height: 64px;
    width: auto;
    max-width: 78vw;
    object-fit: scale-down;
    filter: drop-shadow(0 0 14px rgba(255, 255, 255, 0.22));
  }

  .credits-line {
    display: flex;
    align-items: baseline;
    gap: 14px;
    margin-top: 26px;
    font-family: 'Courier New', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    letter-spacing: 0.18em;
  }

  .credits-label {
    color: rgba(255, 255, 255, 0.5);
    font-size: 0.85rem;
  }

  .credits-name {
    color: #fff;
    font-size: 1.25rem;
    font-weight: 700;
    text-shadow: 0 0 18px rgba(255, 255, 255, 0.35);
  }

  /* ---- ①b 文字免责声明 ---- */
  .disclaimer {
    position: absolute;
    left: 0;
    right: 0;
    top: 56%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 0 28px;
    color: rgba(255, 255, 255, 0.55);
    font-family: 'Courier New', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-size: clamp(0.72rem, 1.8vw, 0.92rem);
    letter-spacing: 0.14em;
    line-height: 1.7;
    text-align: center;
    opacity: 0;
    transition: opacity 0.9s ease;
    pointer-events: none;
  }

  .disclaimer p {
    margin: 0;
  }

  .disclaimer.on {
    opacity: 1;
  }

  /* ---- ② 光敏性癫痫警告 ---- */
  .warning {
    padding: 0 24px;
    text-align: center;
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
    margin: 0 0 34px;
    max-width: 640px;
    color: rgba(255, 255, 255, 0.82);
    font-size: clamp(0.88rem, 2.2vw, 1.05rem);
    line-height: 2;
    letter-spacing: 0.04em;
  }

  .warning-btn {
    position: relative;
    outline: none;
    border: 1.5px solid #e8e8e8;
    background: transparent;
    color: #e8e8e8;
    padding: 15px 56px;
    font-size: 1.05rem;
    font-weight: 800;
    letter-spacing: 0.35em;
    text-indent: 0.35em;
    cursor: pointer;
    border-radius: 2px;
    transition:
      background 0.18s ease,
      color 0.18s ease,
      transform 0.1s ease;
  }

  .warning-btn:hover {
    background: #e8e8e8;
    color: #000;
  }

  .warning-btn:active {
    transform: scale(0.97);
  }

  /* 呼吸环：只动 transform/opacity，走合成器，避免 box-shadow 每帧主线程重绘掉帧 */
  .warning-btn::after {
    content: '';
    position: absolute;
    inset: -7px;
    border: 1.5px solid rgba(255, 255, 255, 0.55);
    border-radius: 4px;
    opacity: 0;
    transform: scale(0.94);
    animation: warn-ring 2.4s ease-in-out infinite;
    pointer-events: none;
  }

  .warning.leaving .warning-btn::after {
    animation: none;
    opacity: 0;
  }

  @keyframes warn-ring {
    0%,
    100% {
      opacity: 0;
      transform: scale(0.94);
    }
    50% {
      opacity: 0.9;
      transform: scale(1.05);
    }
  }

  /* ---- ③ Tap To Start ---- */
  .title-logo.big {
    height: clamp(72px, 15vh, 120px);
    margin-bottom: 40px;
  }

  .tap-to-start {
    color: #e8e8e8;
    font-family: 'Courier New', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    /* 与底部 "PhiCommunity Revive v2.0.0" 接近的大小 */
    font-size: clamp(0.72rem, 1.7vw, 0.85rem);
    font-weight: 700;
    letter-spacing: 0.45em;
    text-indent: 0.45em;
    text-shadow: 0 0 24px rgba(255, 255, 255, 0.25);
    animation: flash 2.4s ease-in-out infinite;
    display: flex;
    align-items: center;
    gap: 0.5em;
  }

  .dot {
    font-size: 0.7em;
    animation: blink 1.2s steps(1) infinite;
  }

  .dot:last-child {
    animation-delay: 0.6s;
  }

  @keyframes flash {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.35;
    }
  }

  @keyframes blink {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0;
    }
  }

  /* ---- 底部信息 ---- */
  .info {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 22px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: rgba(255, 255, 255, 0.4);
    font-family: 'Courier New', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 0.72rem;
    letter-spacing: 0.12em;
    text-align: center;
    padding: 0 16px;
    opacity: 0;
    transition: opacity 0.9s ease;
    pointer-events: none;
  }

  .info.on {
    opacity: 1;
  }

  .ver {
    color: rgba(255, 255, 255, 0.6);
  }

  /* ---- 加载完成后的黑屏渐出遮罩（盖在共享 PhigrosLoading 组件上方） ---- */
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

  /* ---- 退出黑屏遮罩 ---- */
  .fade-overlay {
    position: absolute;
    inset: 0;
    background: #000;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.5s ease;
    z-index: 30;
  }

  .fade-overlay.on {
    opacity: 1;
    pointer-events: auto;
  }

  /* ---- 跳过（点击直达终态，禁用一切渐入过渡）---- */
  .boot.skipping .bg,
  .boot.skipping .bg-dim,
  .boot.skipping .scanlines,
  .boot.skipping .warning,
  .boot.skipping .credits,
  .boot.skipping .disclaimer,
  .boot.skipping .tap,
  .boot.skipping .info {
    transition: none;
  }

  /* ---- Tap To Start 整屏点击区 ---- */
  .hit-zone {
    position: absolute;
    inset: 0;
    z-index: 20;
    opacity: 0;
    pointer-events: none;
  }

  .hit-zone.on {
    pointer-events: auto;
  }
</style>
