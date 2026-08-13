<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { loadPreferences, savePreferences } from '$lib/preferences';
  import { confirm as confirmModal } from '$lib/modal';

  let running = false;
  let results: number[] = [];
  let audioBuffer: ArrayBuffer | null = null;
  let actx: AudioContext | null = null;
  let source: AudioBufferSourceNode | null = null;
  let startTime = 0;
  let loadingError = '';

  onMount(async () => {
    try {
      const res = await fetch('/calibrate/calibrate.mp3');
      audioBuffer = await res.arrayBuffer();
    } catch (e) {
      loadingError = '校准音频加载失败';
    }
  });

  const start = async () => {
    if (!audioBuffer || running) return;
    results = [];
    running = true;
    actx = new AudioContext();
    const buffer = await actx.decodeAudioData(audioBuffer.slice(0));
    source = actx.createBufferSource();
    source.buffer = buffer;
    source.connect(actx.destination);
    startTime = actx.currentTime;
    source.start(0);
    source.onended = () => {
      running = false;
      actx?.close();
      actx = null;
      source = null;
    };
  };

  // 校准音频中节拍位于每 2 秒段的 0.5 秒处（1.5s / 3.5s / 5.5s / 7.5s）
  const click = () => {
    if (!actx || !running) return;
    const t = actx.currentTime - startTime;
    const stage = Math.min(4, Math.max(1, Math.floor(t / 2) + 1));
    const beatTime = stage * 2 - 0.5;
    const offset = Math.round((t - beatTime) * 1000);
    results[stage - 1] = offset;
  };

  const finish = async () => {
    if (results.length === 4) {
      const avg = Math.round(results.reduce((a, b) => a + b, 0) / 4);
      if (await confirmModal(`谱面延时即将被设置为 ${avg} ms，是否确认？`)) {
        const prefs = loadPreferences();
        savePreferences({ ...prefs, chartOffset: avg });
      }
    }
    goto('/settings');
  };
</script>

<svelte:head>
  <title>校准 - PhiCommunity</title>
</svelte:head>

<div
  class="phi-page"
  role="button"
  onkeydown={(e) => e.key === ' ' && click()}
  tabindex="0"
>
  <h1 class="phi-title">偏移校准</h1>
  <p class="phi-subtitle">听节拍，在听到“滴”声的瞬间点击按钮或按空格</p>

  {#if loadingError}
    <p class="phi-hint">{loadingError}</p>
  {:else if !running}
    <button onclick={start}>开始校准</button>
  {:else}
    <button class="click-btn" onclick={click}>点击</button>
    <div class="results">
      {#each [0, 1, 2, 3] as i}
        <div class="result-card">
          <span>第 {i + 1} 次</span>
          <span class="result-value">{results[i] !== undefined ? `${results[i]} ms` : '…'}</span>
        </div>
      {/each}
    </div>
    {#if results.length === 4}
      <button onclick={finish}>完成</button>
    {/if}
  {/if}
  <button onclick={() => goto('/settings')}>返回</button>
</div>

<style>
  .click-btn {
    width: 160px;
    height: 160px;
    border-radius: 50%;
    font-size: 1.5rem;
  }

  .results {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }

  .result-card {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 12px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    font-size: 0.8rem;
  }

  .result-value {
    font-size: 1.1rem;
    font-weight: bold;
  }
</style>