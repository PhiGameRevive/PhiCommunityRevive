<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { confirm as confirmModal } from '$lib/modal';

  let cachesInfo: { name: string; size: number }[] = [];
  let loading = true;

  onMount(async () => {
    await refresh();
  });

  const refresh = async () => {
    loading = true;
    const names = await caches.keys();
    const info = await Promise.all(
      names.map(async (name) => {
        const cache = await caches.open(name);
        const keys = await cache.keys();
        let size = 0;
        for (const key of keys) {
          if (key instanceof Request) {
            const res = await cache.match(key);
            if (res) {
              const blob = await res.blob();
              size += blob.size;
            }
          }
        }
        return { name, size };
      }),
    );
    cachesInfo = info;
    loading = false;
  };

  const clearCache = async (name: string) => {
    await caches.delete(name);
    await refresh();
  };

  const clearAll = async () => {
    if (await confirmModal('确定清除全部缓存？')) {
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
      await refresh();
    }
  };
</script>

<svelte:head>
  <title>缓存管理 - PhiCommunity</title>
</svelte:head>

<div class="phi-page">
  <h1 class="phi-title">缓存管理</h1>
  <p class="phi-subtitle">清除浏览器缓存可解决部分资源更新不及时的问题</p>

  {#if loading}
    <p class="phi-hint">加载中…</p>
  {:else if cachesInfo.length === 0}
    <p class="phi-hint">当前没有缓存</p>
  {:else}
    <div class="phi-card">
      {#each cachesInfo as cache}
        <div class="phi-row">
          <span class="phi-label">{cache.name}</span>
          <span class="phi-hint">{(cache.size / 1024 / 1024).toFixed(2)} MB</span>
          <button onclick={() => clearCache(cache.name)}>清除</button>
        </div>
      {/each}
    </div>
    <button onclick={clearAll}>清除全部缓存</button>
  {/if}
  <button onclick={() => goto('/')}>返回主页</button>
</div>