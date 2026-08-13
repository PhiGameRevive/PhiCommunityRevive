<script lang="ts">
  import { page } from '$app/state';
</script>

<svelte:head>
  <title>404 - PhiCommunity</title>
</svelte:head>

<div class="phi-page">
  <h1 class="phi-title">Error 404</h1>
  <p class="phi-subtitle">找不到指定的页面：{page.url.pathname}</p>
  <a href="/">回到主页</a>
</div>