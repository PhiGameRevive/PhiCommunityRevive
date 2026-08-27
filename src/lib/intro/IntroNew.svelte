<script lang="ts">
  /**
   * 新版开场动画（19 秒时间轴，配 TapToStartNew.mp3）。
   *
   * 音乐高潮位于 19~20 秒，19.0s 处画面同步炸开：背景揭晓 + Title + TAP TO START + 花瓣飘落。
   * 高潮之前依次是 logo、免责声明、版本卡片、特别鸣谢，最后 1.4 秒刻意留白到纯黑，
   * 让高潮命中时的视觉冲击最大化。
   *
   * 音频由父组件在"节点选择页点击"这一用户手势中解锁并解码后传入，
   * 本组件只负责起播与（跳过时的）快进。
   */
  import { onDestroy, onMount } from 'svelte';
  import PetalField from '$lib/components/PetalField.svelte';

  /** 已解锁的 AudioContext 与已解码的音频；任一为空时动画照常走，只是没有声音 */
  export let actx: AudioContext | null = null;
  export let buffer: AudioBuffer | null = null;
  /** 首次启动不允许跳过前摇 */
  export let canSkip = false;
  /** 已被上层界面完全遮住（如加载界面）：停掉花瓣绘制，省下无意义的 GPU 开销 */
  export let occluded = false;
  export let version = 'v2.0.0';
  /** 当前部署节点名，显示在版本卡片上 */
  export let nodeLabel = '';
  /** 玩家在 TAP TO START 页点击后回调（父组件负责后续黑屏与跳转） */
  export let onDone: () => void = () => {};

  /* ---------------- 时间轴（秒） ---------------- */
  const T = {
    scanlines: 0.4,
    logoIn: 1.2,
    logoOut: 5.6,
    disclaimerIn: 6.0,
    disclaimerOut: 10.2,
    versionIn: 10.6,
    versionOut: 13.9,
    thanksIn: 14.3,
    thanksOut: 18.1,
    /**
     * 音乐高潮命中：一切揭晓。
     * 高潮区间为 19~20 秒，取 19.5 让画面比鼓点稍晚半拍落下，冲击感更足。
     */
    climax: 19.5,
  };

  /** 特别鸣谢：逐条错开出现（各自的 at 为出现时刻） */
  const THANKS: { at: number; name: string; role: string }[] = [
    { at: 14.7, name: 'PhiCommunity', role: '原版项目 · yuameshi' },
    { at: 15.3, name: 'PhiZone', role: 'Player 引擎, 谱面资源' },
    { at: 15.9, name: 'PhiTogether', role: '谱面资源' },
    { at: 16.5, name: 'OSU!Lazer', role: '灵感设计' },
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
  /** 起播时刻的 AudioContext 时间；有音频时以音频时钟驱动时间轴 */
  let audioStartTime = 0;
  let audioPlaying = false;

  /** 起播（offset 为音频内起始秒数，跳过时从高潮前一点开始） */
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
      }
      const s = actx.createBufferSource();
      s.buffer = buffer;
      s.loop = true;
      s.connect(gain);
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
   * 保证 19 秒的高潮命中与音乐严格同步（切后台再回来也不会错位）。
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
  $: showDisclaimer = elapsed >= T.disclaimerIn && elapsed < T.disclaimerOut;
  $: showVersion = elapsed >= T.versionIn && elapsed < T.versionOut;
  $: showThanks = elapsed >= T.thanksIn && elapsed < T.thanksOut;
  $: climax = elapsed >= T.climax;
  /** 收拢留白：鸣谢淡出到高潮之间保持纯黑 */
  $: showSkipHint = canSkip && !climax && elapsed >= T.logoIn;
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
  </div>

  <!-- ② 免责声明 -->
  <div class="stage disclaimer-stage" class:on={showDisclaimer}>
    <p>本作为 Phigros 同人社区作品，与厦门鸽游网络有限公司无关。</p>
    <p>全部谱面、音乐与美术资源版权归原作者所有。</p>
    <p>仅供学习交流，请勿用于商业用途。</p>
  </div>

  <!-- ③ 版本卡片 -->
  <div class="stage version-card" class:on={showVersion}>
    <span class="vc-label">PHICOMMUNITY REVIVE</span>
    <strong class="vc-version">{version}</strong>
    {#if nodeLabel}
      <span class="vc-node">NODE · {nodeLabel}</span>
    {/if}
  </div>

  <!-- ⑤ 特别鸣谢：三条依次浮现，随后整体淡出留白，接高潮 -->
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

  <!-- ⑥ 高潮：TAP TO START + 花瓣 -->
  {#if climax && !occluded}
    <PetalField />
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
    filter: blur(12px) brightness(0.5) contrast(0.9) grayscale(0.25);
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
    background: #000;
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
  .stage {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    opacity: 0;
    /* 淡出时轻微收拢，配合"向中心聚合"的收尾观感 */
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
    font-family: var(--phi-mono);
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

  /* ---- ② 免责声明 ---- */
  .disclaimer-stage {
    gap: 10px;
    padding: 0 28px;
    color: rgba(255, 255, 255, 0.55);
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
  }

  .vc-label {
    color: rgba(255, 255, 255, 0.42);
    font-size: clamp(0.6rem, 1.4vw, 0.72rem);
    font-weight: 700;
    letter-spacing: 0.3em;
  }

  .vc-version {
    font-size: clamp(2rem, 6vw, 3.4rem);
    font-weight: 900;
    letter-spacing: 0.08em;
    text-shadow: 0 0 32px rgba(255, 255, 255, 0.28);
  }

  .vc-node {
    padding: 5px 16px;
    border: 1px solid rgba(255, 255, 255, 0.28);
    color: rgba(255, 255, 255, 0.6);
    font-size: clamp(0.58rem, 1.3vw, 0.7rem);
    letter-spacing: 0.22em;
  }

  /* ---- ④b 特别鸣谢：三条依次浮现 ---- */
  .thanks {
    gap: 22px;
    text-align: center;
  }

  .thanks-label {
    color: rgba(255, 255, 255, 0.4);
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
    font-weight: 900;
    letter-spacing: 0.06em;
    text-shadow: 0 0 24px rgba(255, 255, 255, 0.25);
  }

  .thanks-item small {
    color: rgba(255, 255, 255, 0.5);
    font-family: var(--phi-mono);
    font-size: clamp(0.58rem, 1.3vw, 0.7rem);
    letter-spacing: 0.16em;
  }

  /* ---- ⑤ TAP TO START ---- */
  .tap {
    z-index: 18;
  }

  .title-logo.big {
    height: clamp(72px, 15vh, 120px);
    margin-bottom: 40px;
  }

  .tap-to-start {
    color: #e8e8e8;
    font-family: var(--phi-mono);
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
    bottom: calc(22px + env(safe-area-inset-bottom, 0px));
    z-index: 18;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: rgba(255, 255, 255, 0.4);
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
    color: rgba(255, 255, 255, 0.6);
  }

  /* ---- 跳过提示 ---- */
  .skip-hint {
    position: absolute;
    right: 24px;
    bottom: calc(20px + env(safe-area-inset-bottom, 0px));
    z-index: 18;
    color: rgba(255, 255, 255, 0.32);
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
</style>
