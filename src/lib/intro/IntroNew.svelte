<script lang="ts">
  /**
   * 新版开场动画（15 秒时间轴，配 intro3plex.mp3）。
   *
   * 音乐高潮位于第 15 秒：15.0s 处画面同步炸开——背景揭晓 + 白色音频频谱拉满
   * + Title + TAP TO START + 花瓣飘落。高潮之前是一串有信息量的卡片：
   * logo/原作者 → 操作指引 → 免责声明 → 版本/技术栈 → 特别鸣谢 → 谱面来源，
   * 14.3~15.0s 刻意留白到纯黑，让高潮命中时冲击最大化。
   *
   * 顶部常驻"章节标签 + 进度条"，让玩家知道自己在整段片头的哪一段。
   *
   * 频谱：音频链 source → analyser → gain → destination，AnalyserNode 交给
   * SpectrumField 实时绘制白色镜像柱状频谱（前摇低强度、高潮拉满）。
   *
   * 音频由父组件在"节点选择页点击"这一用户手势中解锁并解码后传入，
   * 本组件只负责起播、频谱接线与（跳过时的）快进。
   */
  import { onDestroy, onMount } from 'svelte';
  import PetalField from '$lib/components/PetalField.svelte';
  import SpectrumField from './SpectrumField.svelte';

  /** 已解锁的 AudioContext 与已解码的音频；任一为空时动画照常走，只是没有声音 */
  export let actx: AudioContext | null = null;
  export let buffer: AudioBuffer | null = null;
  /** 首次启动不允许跳过前摇 */
  export let canSkip = false;
  /** 已被上层界面完全遮住（如加载界面）：停掉花瓣/频谱绘制，省下无意义的 GPU 开销 */
  export let occluded = false;
  export let version = 'v2.0.0';
  /** 当前部署节点名，显示在版本卡片上 */
  export let nodeLabel = '';
  /** 玩家在 TAP TO START 页点击后回调（父组件负责后续黑屏与跳转） */
  export let onDone: () => void = () => {};

  /* ---------------- 时间轴（秒）：高潮固定在 15.0 ---------------- */
  const T = {
    scanlines: 0.3,
    logoIn: 0.9,
    logoOut: 3.4,
    howtoIn: 3.6,
    howtoOut: 6.0,
    disclaimerIn: 6.2,
    disclaimerOut: 8.4,
    versionIn: 8.6,
    versionOut: 10.8,
    thanksIn: 11.0,
    thanksOut: 13.2,
    sourcesIn: 13.4,
    sourcesOut: 14.3,
    /** 音乐高潮命中：一切揭晓（第 15 秒） */
    climax: 15.0,
  };

  /** 顶部进度条的章节刻度（与上表保持一致，用于显示当前所处段落） */
  const CHAPTERS: { at: number; label: string }[] = [
    { at: 0.9, label: 'CREDITS' },
    { at: 3.6, label: 'HOW TO PLAY' },
    { at: 6.2, label: 'NOTICE' },
    { at: 8.6, label: 'BUILD' },
    { at: 11.0, label: 'THANKS' },
    { at: 13.4, label: 'CHARTS' },
    { at: 15.0, label: 'TAP TO START' },
  ];

  /** 特别鸣谢：逐条错开出现（各自的 at 为出现时刻） */
  const THANKS: { at: number; name: string; role: string }[] = [
    { at: 11.3, name: 'PhiCommunity', role: '原版项目 · yuameshi' },
    { at: 11.8, name: 'PhiZone', role: 'Player 引擎, 谱面资源' },
    { at: 12.3, name: 'PhiTogether', role: '谱面资源' },
    { at: 12.8, name: 'OSU!Lazer', role: '灵感设计' },
  ];

  /** 操作指引：键位与实际引擎行为一致（见 KeyboardHandler / Player.svelte） */
  const KEYS: { keys: string; label: string }[] = [
    { keys: '任意键 / 触屏', label: '击打音符' },
    { keys: 'SPACE', label: '暂停 / 继续' },
    { keys: 'ESC', label: '退出游玩' },
    { keys: '← →', label: '练习模式调速' },
  ];

  /** 谱面来源：与 sources.ts 的三路聚合对应 */
  const SOURCES: { code: string; label: string }[] = [
    { code: 'phi', label: 'PhiCommunity Charts' },
    { code: 'ptc', label: 'PhiTogether' },
    { code: 'pz', label: 'PhiZone' },
  ];

  let elapsed = 0;
  let animId = 0;
  let startPerf = 0;
  /** 跳过时把时间轴整体前移的偏移量 */
  let baseOffset = 0;
  let skipped = false;
  let finished = false;

  let source: AudioBufferSourceNode | null = null;
  let gain: GainNode | null = null;
  /** 频谱分析节点：source → analyser → gain → destination */
  let analyser: AnalyserNode | null = null;
  /** 起播时刻的 AudioContext 时间；有音频时以音频时钟驱动时间轴 */
  let audioStartTime = 0;
  let audioPlaying = false;

  /** 起播（offset 为音频内起始秒数，跳过时从高潮处开始） */
  const playAudio = (offset: number) => {
    if (!actx || !buffer) return;
    try {
      const now = actx.currentTime;
      if (source) {
        source.onended = null;
        source.stop(now);
      }
      if (!gain) {
        gain = actx.createGain();
        // 1.5s 渐入，避免音乐硬切入耳
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.9, now + 1.5);
        gain.connect(actx.destination);
        // analyser 挂在 gain 之前，保证频谱跟随实际播放信号
        analyser = actx.createAnalyser();
        analyser.fftSize = 512; // 低频分辨率更高，鼓点有峰可抓
        analyser.smoothingTimeConstant = 0.62; // 跟手，不要被过度平滑拖掉冲击
        analyser.connect(gain);
      }
      const s = actx.createBufferSource();
      s.buffer = buffer;
      s.loop = true;
      s.connect(analyser ?? gain);
      s.start(now, Math.min(offset, buffer.duration - 0.05));
      source = s;
      // 记录"音频时间 0 对应的时间轴位置"，用于后续以音频时钟对齐画面
      audioStartTime = now - offset;
      audioPlaying = true;
    } catch (e) {
      console.warn('intro audio playback failed', e);
      audioPlaying = false;
    }
  };

  /**
   * 时间轴时钟：有音频时以 AudioContext.currentTime 为准，
   * 保证 15 秒的高潮命中与音乐严格同步（切后台再回来也不会错位）。
   * 没有音频时退回 performance.now。
   */
  const tick = () => {
    elapsed =
      audioPlaying && actx
        ? actx.currentTime - audioStartTime
        : baseOffset + (performance.now() - startPerf) / 1000;
    // 已确认进入选歌页：时间轴不再有用（画面停在终态），停掉逐帧计算
    if (finished) return;
    animId = requestAnimationFrame(tick);
  };

  onMount(() => {
    startPerf = performance.now();
    playAudio(0);
    animId = requestAnimationFrame(tick);
  });

  onDestroy(() => {
    cancelAnimationFrame(animId);
    try {
      if (source) {
        source.onended = null;
        source.stop();
      }
    } catch {
      /* 已停止 */
    }
    source = null;
    gain = null;
    analyser = null;
    audioPlaying = false;
  });

  /** 前摇阶段点击 = 跳过（首启禁用）；高潮之后点击 = 进入选歌页 */
  const onTap = () => {
    if (finished) return;
    if (elapsed < T.climax) {
      if (!canSkip) return;
      skipped = true;
      baseOffset = T.climax;
      startPerf = performance.now();
      elapsed = T.climax;
      playAudio(T.climax);
      return;
    }
    // 刚跳过的瞬间忽略，防止"跳过 + 误触进入"连发
    if (skipped && elapsed - T.climax < 0.35) return;
    finished = true;
    onDone();
  };

  // 各段可见性（跳过后 elapsed 直接等于 climax，前摇元素自然全部隐藏）
  $: showScanlines = elapsed >= T.scanlines;
  $: showLogo = elapsed >= T.logoIn && elapsed < T.logoOut;
  $: showHowto = elapsed >= T.howtoIn && elapsed < T.howtoOut;
  $: showDisclaimer = elapsed >= T.disclaimerIn && elapsed < T.disclaimerOut;
  $: showVersion = elapsed >= T.versionIn && elapsed < T.versionOut;
  $: showThanks = elapsed >= T.thanksIn && elapsed < T.thanksOut;
  $: showSources = elapsed >= T.sourcesIn && elapsed < T.sourcesOut;
  $: climax = elapsed >= T.climax;
  /** 收拢留白：来源段淡出到高潮之间保持纯黑 */
  $: showSkipHint = canSkip && !climax && elapsed >= T.logoIn;
  /** 频谱强度：前摇低亮，高潮瞬间拉满 */
  $: spectrumIntensity = climax ? 1 : 0.55;
  /** 顶部进度：整段片头走完即为 1（跳过后直接满格） */
  $: progress = Math.max(0, Math.min(1, elapsed / T.climax));
  /** 当前章节名：取 at 已到、at 最大的一节 */
  $: chapterLabel = (CHAPTERS.filter((c) => elapsed >= c.at).pop() ?? CHAPTERS[0]).label;
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex a11y_no_noninteractive_element_interactions a11y_click_events_have_key_events -->
<div
  class="intro"
  class:instant={skipped}
  role="button"
  tabindex="0"
  onclick={onTap}
  onkeydown={(e) => (e.key === ' ' || e.key === 'Enter') && onTap()}
>
  <!-- 背景与压暗层：高潮时揭晓 -->
  <div class="bg" class:on={climax}></div>
  <div class="bg-dim" class:reveal={climax}></div>
  <div class="scanlines" class:on={showScanlines}></div>

  <!-- 顶部章节标签 + 进度条：始终告诉玩家"这是片头的第几段" -->
  <div class="hud">
    <span class="hud-label">{chapterLabel}</span>
    <div class="hud-track">
      {#each CHAPTERS as c}
        <span class="hud-tick" style:left={`${(c.at / T.climax) * 100}%`}></span>
      {/each}
      <span class="hud-fill" style:width={`${progress * 100}%`}></span>
    </div>
  </div>

  <!-- ① logo + 原作者 -->
  <div class="stage credits" class:on={showLogo}>
    <div class="credits-icons">
      <img class="phizone-logo" src="/ui/phizone-icon.png" alt="PhiZone Player" />
      <img class="title-logo" src="/ui/Title.svg" alt="PhiCommunity" />
    </div>
    <div class="credits-line">
      <span class="credits-label">原作者</span>
      <span class="credits-name">yuameshi</span>
    </div>
    <div class="credits-tag">网页复刻 · 浏览器直接开玩</div>
  </div>

  <!-- ② 操作指引 -->
  <div class="stage howto" class:on={showHowto}>
    <span class="card-label">HOW TO PLAY</span>
    <div class="key-list">
      {#each KEYS as k}
        <div class="key-row">
          <kbd>{k.keys}</kbd>
          <span class="key-label">{k.label}</span>
        </div>
      {/each}
    </div>
  </div>

  <!-- ③ 免责声明 -->
  <div class="stage disclaimer-stage" class:on={showDisclaimer}>
    <span class="card-label">NOTICE</span>
    <p>本作为 Phigros 同人社区作品，与厦门鸽游网络有限公司无关。</p>
    <p>全部谱面、音乐与美术资源版权归原作者所有。</p>
    <p>仅供学习交流，请勿用于商业用途。</p>
  </div>

  <!-- ④ 版本卡片 + 技术栈 -->
  <div class="stage version-card" class:on={showVersion}>
    <span class="vc-label">PHICOMMUNITY REVIVE</span>
    <strong class="vc-version">{version}</strong>
    {#if nodeLabel}
      <span class="vc-node">NODE · {nodeLabel}</span>
    {/if}
    <div class="vc-stack">
      <span>SvelteKit</span>
      <span>Phaser 4</span>
      <span>WebGL</span>
    </div>
  </div>

  <!-- ⑤ 特别鸣谢：逐条浮现，随后整体淡出留白，接下一段 -->
  <div class="stage thanks" class:on={showThanks}>
    <span class="thanks-label">特别鸣谢</span>
    <div class="thanks-list">
      {#each THANKS as item}
        <div class="thanks-item" class:on={showThanks && elapsed >= item.at}>
          <strong>{item.name}</strong>
          <small>{item.role}</small>
        </div>
      {/each}
    </div>
  </div>

  <!-- ⑥ 谱面来源 -->
  <div class="stage sources" class:on={showSources}>
    <span class="card-label">CHART SOURCES</span>
    <div class="source-list">
      {#each SOURCES as s}
        <div class="source-item">
          <span class="source-code">{s.code}</span>
          <span class="source-name">{s.label}</span>
        </div>
      {/each}
    </div>
    <span class="sources-hint">选歌页可切换来源，本地谱面直接拖入</span>
  </div>

  <!-- ⑦ 高潮：TAP TO START + 花瓣 + 白色频谱 -->
  {#if climax && !occluded}
    <PetalField />
  {/if}
  {#if !occluded}
    <SpectrumField {analyser} intensity={spectrumIntensity} heightVh={24} />
  {/if}

  <div class="stage tap" class:on={climax}>
    <img class="title-logo big" src="/ui/Title.svg" alt="PhiCommunity" />
    <div class="tap-to-start">
      TAP TO START
    </div>
  </div>

  <div class="info" class:on={climax}>
    <span class="ver">PhiCommunity Revive {version}{nodeLabel ? ` · ${nodeLabel}` : ''}</span>
    <span class="info-disclaimer">
      本项目与厦门鸽游网络有限公司（Xiamen Pigeon Games Network Co., Ltd.）没有任何关系
    </span>
  </div>

  <!-- 可跳过提示（首次启动不显示） -->
  <div class="skip-hint" class:on={showSkipHint}>点按以跳过</div>
</div>

<style>
  .intro {
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
    background: url('/ui/ElementSqare.webp') center center no-repeat;
    background-size: cover;
    filter: blur(14px) brightness(0.42) contrast(0.95) saturate(1.15);
    transform: scale(1.1);
    opacity: 0;
    transition: opacity 1.2s ease;
    pointer-events: none;
  }

  .bg.on {
    opacity: 1;
  }

  .bg-dim {
    position: absolute;
    inset: 0;
    background: radial-gradient(120% 90% at 50% 50%, transparent 40%, rgba(0, 0, 0, 0.4) 100%);
    opacity: 1;
    transition: opacity 1.6s ease;
    pointer-events: none;
  }

  .bg-dim.reveal {
    opacity: 0;
  }

  .scanlines {
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(
      0deg,
      rgba(255, 255, 255, 0.02) 0px,
      rgba(255, 255, 255, 0.02) 1px,
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

  /* ---- 顶部 HUD：章节标签 + 进度条 ---- */
  .hud {
    position: absolute;
    top: calc(18px + env(safe-area-inset-top, 0px));
    left: 24px;
    right: 24px;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 14px;
    opacity: 0;
    animation: hud-in 1s ease 0.5s both;
    pointer-events: none;
  }

  @keyframes hud-in {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .hud-label {
    flex-shrink: 0;
    min-width: 108px;
    color: #fff;
    font-family: var(--phi-mono);
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.22em;
    text-shadow: 0 0 12px rgba(255, 255, 255, 0.35);
  }

  .hud-track {
    position: relative;
    flex: 1;
    height: 2px;
    border-radius: var(--phi-radius-full);
    background: rgba(255, 255, 255, 0.14);
    overflow: visible;
  }

  .hud-fill {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    border-radius: var(--phi-radius-full);
    background: #fff;
  }

  .hud-tick {
    position: absolute;
    top: -2px;
    width: 1px;
    height: 6px;
    background: rgba(255, 255, 255, 0.28);
  }

  /* ---- 通用舞台 ---- */
  .stage {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    opacity: 0;
    transform: scale(0.985);
    transition:
      opacity 0.9s ease,
      transform 1.1s cubic-bezier(0.22, 1, 0.36, 1);
    pointer-events: none;
  }

  .stage.on {
    opacity: 1;
    transform: scale(1);
  }

  /* 卡片通用标题 */
  .card-label {
    color: rgba(255, 255, 255, 0.7);
    font-family: var(--phi-mono);
    font-size: clamp(0.6rem, 1.4vw, 0.72rem);
    font-weight: 700;
    letter-spacing: 0.34em;
    margin-bottom: 22px;
  }

  /* ---- ① logo ---- */
  .credits-icons {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 32px;
    padding: 0 24px;
  }

  .phizone-logo {
    height: 72px;
    width: auto;
    max-width: 46vw;
    object-fit: contain;
    filter: drop-shadow(0 0 18px rgba(255, 255, 255, 0.18));
  }

  .title-logo {
    height: 64px;
    width: auto;
    max-width: 78vw;
    object-fit: scale-down;
    filter: drop-shadow(0 0 16px rgba(255, 255, 255, 0.22));
  }

  .credits-line {
    display: flex;
    align-items: baseline;
    gap: 14px;
    margin-top: 26px;
    font-family: var(--phi-mono);
    letter-spacing: 0.18em;
  }

  .credits-label {
    color: var(--phi-text-dim);
    font-size: 0.85rem;
  }

  .credits-name {
    color: #fff;
    font-size: 1.25rem;
    font-weight: 700;
    text-shadow: 0 0 18px rgba(255, 255, 255, 0.35);
  }

  .credits-tag {
    margin-top: 14px;
    color: var(--phi-text-faint);
    font-family: var(--phi-mono);
    font-size: 0.7rem;
    letter-spacing: 0.28em;
  }

  /* ---- ② 操作指引 ---- */
  .howto {
    padding: 0 24px;
  }

  .key-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px 46px;
  }

  .key-row {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 92px;
    padding: 7px 14px;
    border: 1px solid rgba(255, 255, 255, 0.6);
    border-radius: 2px;
    background: transparent;
    color: #fff;
    font-family: var(--phi-mono);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    white-space: nowrap;
  }

  .key-label {
    color: var(--phi-text);
    font-size: 0.88rem;
    letter-spacing: 0.06em;
  }

  /* ---- ③ 免责声明 ---- */
  .disclaimer-stage {
    gap: 10px;
    padding: 0 28px;
    color: var(--phi-text-dim);
    font-family: var(--phi-mono);
    font-size: clamp(0.72rem, 1.8vw, 0.92rem);
    letter-spacing: 0.14em;
    line-height: 1.7;
    text-align: center;
  }

  .disclaimer-stage p {
    margin: 0;
  }

  /* ---- ④ 版本卡片 ---- */
  .version-card {
    gap: 12px;
    font-family: var(--phi-mono);
    text-align: center;
    padding: 26px 44px;
    border: 1px solid rgba(255, 255, 255, 0.5);
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.03);
  }

  .vc-label {
    color: rgba(255, 255, 255, 0.7);
    font-size: clamp(0.6rem, 1.4vw, 0.72rem);
    font-weight: 700;
    letter-spacing: 0.3em;
  }

  /* 版本号：纯白实体字，不再做渐变 */
  .vc-version {
    font-size: clamp(2rem, 6vw, 3.4rem);
    font-weight: 800;
    letter-spacing: 0.06em;
    font-family: var(--phi-font-display);
    color: #fff;
    text-shadow: 0 0 24px rgba(255, 255, 255, 0.3);
  }

  .vc-node {
    padding: 5px 16px;
    border: 1px solid rgba(255, 255, 255, 0.5);
    border-radius: 2px;
    color: #fff;
    font-size: clamp(0.58rem, 1.3vw, 0.7rem);
    letter-spacing: 0.22em;
  }

  .vc-stack {
    display: flex;
    gap: 8px;
    margin-top: 6px;
    flex-wrap: wrap;
    justify-content: center;
  }

  .vc-stack span {
    padding: 4px 12px;
    border-radius: 2px;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.3);
    color: rgba(255, 255, 255, 0.7);
    font-size: clamp(0.56rem, 1.2vw, 0.66rem);
    letter-spacing: 0.16em;
  }

  /* ---- ⑤ 特别鸣谢 ---- */
  .thanks {
    gap: 22px;
    text-align: center;
  }

  .thanks-label {
    color: rgba(255, 255, 255, 0.7);
    font-family: var(--phi-mono);
    font-size: clamp(0.6rem, 1.4vw, 0.72rem);
    font-weight: 700;
    letter-spacing: 0.34em;
  }

  .thanks-list {
    display: flex;
    flex-direction: column;
    gap: 18px;
    align-items: center;
  }

  .thanks-item {
    display: flex;
    flex-direction: column;
    gap: 3px;
    opacity: 0;
    transform: translateY(10px);
    transition:
      opacity 0.7s ease,
      transform 0.7s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .thanks-item.on {
    opacity: 1;
    transform: translateY(0);
  }

  .thanks-item strong {
    font-size: clamp(1.2rem, 3vw, 1.8rem);
    font-weight: 800;
    letter-spacing: 0.05em;
    font-family: var(--phi-font-display);
    color: #fff;
    text-shadow: 0 0 22px rgba(255, 255, 255, 0.3);
  }

  .thanks-item small {
    color: var(--phi-text-dim);
    font-family: var(--phi-mono);
    font-size: clamp(0.58rem, 1.3vw, 0.7rem);
    letter-spacing: 0.16em;
  }

  /* ---- ⑥ 谱面来源 ---- */
  .sources {
    padding: 0 24px;
  }

  .source-list {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    justify-content: center;
  }

  .source-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 18px 8px 10px;
    border: 1px solid rgba(255, 255, 255, 0.35);
    border-radius: 2px;
    background: transparent;
  }

  .source-code {
    padding: 3px 12px;
    border-radius: 2px;
    background: #fff;
    color: #0a0a0c;
    font-family: var(--phi-mono);
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.1em;
  }

  .source-name {
    color: var(--phi-text);
    font-size: 0.82rem;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  .sources-hint {
    margin-top: 20px;
    color: var(--phi-text-faint);
    font-family: var(--phi-mono);
    font-size: 0.68rem;
    letter-spacing: 0.18em;
  }

  /* ---- ⑦ TAP TO START ---- */
  .tap {
    z-index: 18;
  }

  .title-logo.big {
    height: clamp(72px, 15vh, 120px);
    margin-bottom: 40px;
    filter: drop-shadow(0 0 30px rgba(255, 255, 255, 0.35));
  }

  .tap-to-start {
    color: #fff;
    font-family: var(--phi-font-display);
    font-size: clamp(0.78rem, 1.8vw, 0.95rem);
    font-weight: 700;
    letter-spacing: 0.5em;
    text-indent: 0.5em;
    text-shadow: 0 0 24px rgba(255, 255, 255, 0.45);
    animation: flash 2.4s ease-in-out infinite;
    display: flex;
    align-items: center;
    gap: 0.6em;
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

  /* ---- 底部信息 ---- */
  .info {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(22px + env(safe-area-inset-bottom, 0px));
    z-index: 18;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: var(--phi-text-faint);
    font-family: var(--phi-mono);
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
    color: var(--phi-text-dim);
  }

  /* ---- 跳过提示 ---- */
  .skip-hint {
    position: absolute;
    right: 24px;
    bottom: calc(20px + env(safe-area-inset-bottom, 0px));
    z-index: 18;
    color: var(--phi-text-faint);
    font-family: var(--phi-mono);
    font-size: 0.66rem;
    letter-spacing: 0.24em;
    opacity: 0;
    transition: opacity 0.8s ease;
    pointer-events: none;
  }

  .skip-hint.on {
    opacity: 1;
  }

  /* 跳过：直达终态，禁用一切渐入过渡 */
  .intro.instant .bg,
  .intro.instant .bg-dim,
  .intro.instant .stage,
  .intro.instant .info {
    transition: none;
  }

  @media (max-width: 560px) {
    .key-list {
      grid-template-columns: minmax(0, 1fr);
      gap: 10px;
    }

    .hud {
      left: 16px;
      right: 16px;
    }

    .hud-label {
      min-width: 84px;
      font-size: 0.58rem;
      letter-spacing: 0.16em;
    }
  }
</style>
