<script lang="ts">
  /**
   * 旧版开场动画（8.5 秒，配 TapToStart.mp3）。
   *
   * 由 2.0 之前的 tapToStart 体验原样迁移而来，供设置页切回："制作组图标 → 文字免责声明
   * → Tap To Start"。光敏性警告与节点选择已上移到 +page.svelte 统一编排，
   * 音频同样由父组件在用户手势中解锁并解码后传入。
   */
  import { onDestroy, onMount } from 'svelte';

  export let actx: AudioContext | null = null;
  export let buffer: AudioBuffer | null = null;
  /** 首次启动不允许跳过前摇 */
  export let canSkip = false;
  export let version = 'v2.0.0';
  export let nodeLabel = '';
  export let onDone: () => void = () => {};

  /** 前摇结束、Tap To Start 显现的时间点（秒） */
  const TAP_AT = 8.5;

  let iconsOn = false;
  let disclaimerOn = false;
  let tapOn = false;
  let skipped = false;
  let finished = false;
  let skipAt = 0;

  let iconOnTimer = 0;
  let iconOffTimer = 0;
  let disclaimerTimer = 0;
  let tapTimer = 0;

  let source: AudioBufferSourceNode | null = null;
  let gain: GainNode | null = null;

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
    } catch (e) {
      console.warn('intro audio playback failed', e);
    }
  };

  const clearTimers = () => {
    clearTimeout(iconOnTimer);
    clearTimeout(iconOffTimer);
    clearTimeout(disclaimerTimer);
    clearTimeout(tapTimer);
  };

  onMount(() => {
    playAudio(0);
    // 音乐渐入的同时在黑屏上展示制作组图标，随后换成文字免责声明
    iconOnTimer = window.setTimeout(() => (iconsOn = true), 0);
    iconOffTimer = window.setTimeout(() => (iconsOn = false), 4400);
    disclaimerTimer = window.setTimeout(() => (disclaimerOn = true), 5400);
    tapTimer = window.setTimeout(() => {
      disclaimerOn = false;
      tapOn = true;
    }, TAP_AT * 1000);
  });

  onDestroy(() => {
    clearTimers();
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
  });

  /** 前摇阶段点击 = 跳过（首启禁用）；Tap To Start 阶段点击 = 进入选歌页 */
  const onTap = () => {
    if (finished) return;
    if (!tapOn) {
      if (!canSkip) return;
      clearTimers();
      iconsOn = false;
      disclaimerOn = false;
      skipped = true;
      tapOn = true;
      skipAt = performance.now();
      // 音乐一并跳到 8.5 秒处，与"正常等到 8.5 秒"的听感一致
      playAudio(TAP_AT);
      return;
    }
    if (skipped && performance.now() - skipAt < 350) return;
    finished = true;
    onDone();
  };
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
  <div class="bg" class:on={tapOn}></div>
  <div class="bg-dim" class:reveal={tapOn}></div>
  <div class="scanlines" class:on={tapOn}></div>

  <!-- ① 制作组图标 + 原作者 -->
  <div class="stage credits" class:on={iconsOn}>
    <div class="credits-icons">
      <img class="phizone-logo" src="/ui/phizone-icon.png" alt="PhiZone Player" />
      <img class="title-logo" src="/ui/Title.svg" alt="PhiCommunity" />
    </div>
    <div class="credits-line">
      <span class="credits-label">原作者</span>
      <span class="credits-name">yuameshi</span>
    </div>
  </div>

  <!-- ② 文字免责声明 -->
  <div class="disclaimer" class:on={disclaimerOn}>
    <p>本作为 Phigros 同人社区作品，与厦门鸽游网络有限公司无关。</p>
    <p>全部谱面、音乐与美术资源版权归原作者所有。</p>
    <p>仅供学习交流，请勿用于商业用途。</p>
  </div>

  <!-- ③ Tap To Start -->
  <div class="stage tap" class:on={tapOn}>
    <img class="title-logo big" src="/ui/Title.svg" alt="PhiCommunity" />
    <div class="tap-to-start">
      <span class="dot">▮</span>
      TAP TO START
      <span class="dot">▮</span>
    </div>
  </div>

  <div class="info" class:on={tapOn}>
    <span class="ver">PhiCommunity Revive {version}{nodeLabel ? ` · ${nodeLabel}` : ''}</span>
    <span class="info-disclaimer">
      本项目与厦门鸽游网络有限公司（Xiamen Pigeon Games Network Co., Ltd.）没有任何关系
    </span>
  </div>

  <div class="skip-hint" class:on={canSkip && !tapOn}>点按以跳过</div>
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

  .bg {
    position: absolute;
    inset: -20px;
    background: url('/ui/ElementSqare.webp') center center no-repeat;
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

  /* 黑色压暗层：与背景同步 1.6s 揭晓，避免"黑屏 → 整页内容"硬切造成闪光 */
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

  .stage {
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

  .stage.on {
    opacity: 1;
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

  /* ---- ② 文字免责声明 ---- */
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
    font-family: var(--phi-mono);
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

  /* ---- ③ Tap To Start ---- */
  .title-logo.big {
    height: clamp(72px, 15vh, 120px);
    margin-bottom: 40px;
  }

  .tap-to-start {
    color: #e8e8e8;
    font-family: var(--phi-mono);
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

  .skip-hint {
    position: absolute;
    right: 24px;
    bottom: 20px;
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
  .intro.instant .scanlines,
  .intro.instant .stage,
  .intro.instant .disclaimer,
  .intro.instant .info {
    transition: none;
  }
</style>
