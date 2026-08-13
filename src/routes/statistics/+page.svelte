<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { getAllResults, type PlayResult } from '$lib/db';
  import { fetchMeta } from '$lib/meta';

  let results: (PlayResult & { songName?: string })[] = [];
  let loaded = false;

  onMount(async () => {
    const list = await getAllResults();
    const metas = new Map<string, string>();
    await Promise.all(
      [...new Set(list.map((r) => r.codename.split('-').slice(0, -1).join('-')))].map(
        async (codename) => {
          try {
            const meta = await fetchMeta(codename);
            metas.set(codename, meta.name);
          } catch {
            /* 谱面可能已下架 */
          }
        },
      ),
    );
    results = list
      .map((r) => ({ ...r, songName: metas.get(r.codename.split('-').slice(0, -1).join('-')) }))
      .sort((a, b) => b.rankingScore - a.rankingScore);
    loaded = true;
  });
</script>

<svelte:head>
  <title>统计 - PhiCommunity</title>
</svelte:head>

<div class="phi-page">
  <h1 class="phi-title">个人统计</h1>
  {#if !loaded}
    <p class="phi-hint">加载中…</p>
  {:else if results.length === 0}
    <p class="phi-hint">还没有游玩记录，去选歌页打一把吧！</p>
  {:else}
    <div class="stats-summary">
      <div class="stat-card">
        <span class="stat-value">{results.length}</span>
        <span class="stat-label">游玩曲目</span>
      </div>
      <div class="stat-card">
        <span class="stat-value">
          {results.reduce((sum, r) => sum + r.rankingScore, 0).toFixed(2)}
        </span>
        <span class="stat-label">RKS 总和</span>
      </div>
      <div class="stat-card">
        <span class="stat-value">
          {Math.max(0, ...results.map((r) => r.rankingScore)).toFixed(2)}
        </span>
        <span class="stat-label">最高 RKS</span>
      </div>
    </div>
    <div class="phi-card table-card">
      <table>
        <thead>
          <tr>
            <th>曲目</th>
            <th>难度</th>
            <th>定数</th>
            <th>分数</th>
            <th>ACC</th>
            <th>RKS</th>
          </tr>
        </thead>
        <tbody>
          {#each results as r}
            <tr>
              <td>{r.songName ?? r.codename}</td>
              <td>{r.level.toUpperCase()}</td>
              <td>{r.levelRank}</td>
              <td>{Math.round(r.score).toLocaleString()}</td>
              <td>{(r.accuracy * 100).toFixed(2)}%</td>
              <td>{r.rankingScore.toFixed(2)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
  <button onclick={() => goto('/')}>返回主页</button>
</div>

<style>
  .stats-summary {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    justify-content: center;
  }

  .stat-card {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 12px;
    padding: 16px 28px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  .stat-value {
    font-size: 1.8rem;
    font-weight: bold;
  }

  .stat-label {
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.6);
  }

  .table-card {
    padding: 8px;
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }

  th,
  td {
    padding: 8px 12px;
    text-align: left;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  th {
    color: rgba(255, 255, 255, 0.6);
    font-size: 0.8rem;
  }
</style>