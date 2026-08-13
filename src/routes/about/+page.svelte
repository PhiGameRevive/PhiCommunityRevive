<script lang="ts">
  import { goto } from '$app/navigation';
</script>

<svelte:head>
  <title>关于 - PhiCommunity</title>
</svelte:head>

<div class="phi-page">
  <h1 class="phi-title">关于我们</h1>
  <div class="phi-card about-card">
    <h2>PhiCommunity</h2>
    <p>
      PhiCommunity 是一个社区驱动的类 Phigros 网页音游项目。本项目使用
      <a href="https://github.com/phigamerevive/PhiCommunity" target="_blank" rel="noreferrer">phigamerevive/PhiCommunity</a>
      的引擎代码与谱面资源。
    </p>
    <h3>引擎</h3>
    <p>
      谱面引擎基于
      <a href="https://github.com/Team-PhiZone/player" target="_blank" rel="noreferrer">PhiZone Player</a>
      （MPL-2.0 许可），并适配了 PRPR / Phira 的 extra.json 故事板格式。
    </p>
    <h3>许可证</h3>
    <p>
      源码遵循
      <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noreferrer">AGPL-3.0</a>
      许可；媒体资源版权归原团队所有。
    </p>
    <h3>谱面仓库</h3>
    <p>
      <a href="https://github.com/MoeFurina/PhiCommunity-Charts-Repo" target="_blank" rel="noreferrer">
        PhiCommunity-Charts-Repo
      </a>
    </p>
  </div>
  <button onclick={() => goto('/')}>返回主页</button>
</div>

<style>
  .about-card h2 {
    margin-top: 0;
  }

  .about-card p {
    line-height: 1.7;
    color: rgba(255, 255, 255, 0.85);
  }
</style>