<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { chartSource } from '$lib/chartSource';
  import { fetchMeta, type ChartMeta } from '$lib/meta';

  const EXCLUDED = /.github|README.md|CNAME|_headers|ouroVoros|tutorial|content|edgeone/;

  let songs: (ChartMeta & { added: boolean })[] = [];
  let loading = true;
  let error = '';

  const installedCharts = (): string[] =>
    JSON.parse(localStorage.getItem('installedCharts') ?? '[]');

  onMount(async () => {
    try {
      const res = await fetch(`${chartSource}/content.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = await res.json();
      const codenames = (list as { name: string }[])
        .map((item) => item.name)
        .filter((name) => !EXCLUDED.test(name));
      const metas = await Promise.all(
        codenames.map(async (codename) => {
          try {
            return await fetchMeta(codename);
          } catch (e) {
            console.error(`Failed to load meta for ${codename}`, e);
            return null;
          }
        }),
      );
      const installed = installedCharts();
      songs = metas
        .filter((m): m is ChartMeta => m !== null)
        .map((meta) => ({ ...meta, added: installed.includes(meta.codename) }));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  });

  const toggle = (codename: string) => {
    const installed = installedCharts();
    const idx = installed.indexOf(codename);
    if (idx >= 0) {
      installed.splice(idx, 1);
    } else {
      installed.push(codename);
    }
    localStorage.setItem('installedCharts', JSON.stringify(installed));
    songs = songs.map((s) => (s.codename === codename ? { ...s, added: idx < 0 } : s));
  };
</script>

<svelte:head>
  <title>获取谱面 - PhiCommunity</title>
</svelte:head>

<div class="phi-page">
  <h1 class="phi-title">谱面仓库</h1>
  <p class="phi-subtitle">将谱面添加到你的选歌列表</p>

  {#if loading}
    <p class="phi-hint">加载中…</p>
  {:else if error}
    <p class="phi-hint">获取失败：{error}</p>
  {:else}
    <div class="song-list">
      {#each songs as song}
        <div class="song-card" style="--bg: url('{chartSource}/{encodeURIComponent(song.codename)}/{encodeURIComponent(song.illustration)}')">
          <div class="song-info">
            <div class="song-title">{song.name}</div>
            <div class="song-artist">{song.artist}</div>
          </div>
          <button class="add-btn" class:added={song.added} onclick={() => toggle(song.codename)}>
            {song.added ? '已添加 ✓' : '添加'}
          </button>
        </div>
      {/each}
    </div>
  {/if}
  <button onclick={() => goto('/')}>返回主页</button>
</div>

<style>
  .song-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: min(640px, 100%);
  }

  .song-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px;
    border-radius: 12px;
    background:
      linear-gradient(to right, rgba(0, 0, 0, 0.8), rgba(0, 0, 0, 0.4)),
      var(--bg) center center / cover no-repeat;
    border: 1px solid rgba(255, 255, 255, 0.15);
  }

  .song-title {
    font-weight: bold;
    font-size: 1.1rem;
  }

  .song-artist {
    color: rgba(255, 255, 255, 0.7);
    font-size: 0.85rem;
  }

  .add-btn {
    flex-shrink: 0;
    padding: 8px 20px;
  }

  .add-btn.added {
    background: rgba(76, 175, 80, 0.35);
    border-color: #4caf50;
  }
</style>