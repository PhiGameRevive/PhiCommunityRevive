<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { saveLocalChart, deleteLocalChart, getAllLocalCharts, type LocalChart } from '$lib/db';
  import { parseChartFiles, readZipFile, readDirFiles, type InputFile } from '$lib/localChart';

  let previews: (LocalChart & { illustrationUrl?: string })[] = [];
  let imported: (LocalChart & { illustrationUrl?: string })[] = [];
  let busy = false;
  let error = '';
  let dragOver = false;

  onMount(async () => {
    imported = (await getAllLocalCharts()).map((l) => ({ ...l, illustrationUrl: imgUrl(l) }));
  });

  const imgUrl = (l: LocalChart): string | undefined => {
    if (!l.illustration) return undefined;
    const file = l.files.find((f) => f.name === l.illustration);
    return file ? URL.createObjectURL(file.blob) : undefined;
  };

  const handleFiles = async (files: InputFile[]) => {
    if (files.length === 0 || busy) return;
    busy = true;
    error = '';
    previews = [];
    try {
      const chart = await parseChartFiles(files);
      previews = [{ ...chart, illustrationUrl: imgUrl(chart) }];
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  };

  const onFileInput = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (/\.(zip|pez)$/i.test(file.name)) {
      await handleFiles(await readZipFile(file));
    } else {
      error = '仅支持 .zip / .pez 文件';
    }
    input.value = '';
  };

  const onDirInput = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    await handleFiles(readDirFiles(input.files));
    input.value = '';
  };

  const onDrop = async (e: DragEvent) => {
    dragOver = false;
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (/\.(zip|pez)$/i.test(file.name)) {
      await handleFiles(await readZipFile(file));
    } else {
      error = '拖拽仅支持 .zip / .pez 文件（文件夹请用下方按钮选择）';
    }
  };

  const doImport = async () => {
    const chart = previews[0];
    if (!chart || busy) return;
    busy = true;
    try {
      await saveLocalChart(chart);
      imported = (await getAllLocalCharts()).map((l) => ({ ...l, illustrationUrl: imgUrl(l) }));
      previews = [];
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  };

  const remove = async (codename: string) => {
    await deleteLocalChart(codename);
    imported = (await getAllLocalCharts()).map((l) => ({ ...l, illustrationUrl: imgUrl(l) }));
  };
</script>

<svelte:head>
  <title>上传谱面 - PhiCommunity</title>
</svelte:head>

<div class="page">
  <div class="header">
    <button class="icon-btn back-btn" onclick={() => goto('/songs')} aria-label="返回"></button>
    <h1 class="title">上传谱面</h1>
  </div>

  <!-- 上传区 -->
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_no_noninteractive_element_interactions -->
  <div
    class="drop-zone"
    class:dragover={dragOver}
    ondragover={(e) => {
      e.preventDefault();
      dragOver = true;
    }}
    ondragleave={() => (dragOver = false)}
    ondrop={(e) => {
      e.preventDefault();
      onDrop(e);
    }}
  >
    <p class="drop-title">拖拽 .zip / .pez 谱面包到此处</p>
    <div class="drop-actions">
      <label class="flat-btn file-btn">
        选择 zip / pez
        <input type="file" accept=".zip,.pez" hidden onchange={onFileInput} />
      </label>
      <label class="flat-btn file-btn">
        选择文件夹
        <input type="file" webkitdirectory hidden onchange={onDirInput} />
      </label>
    </div>
    <p class="hint">支持 PhiCommunity 仓库格式（meta.json）与 Phira / PRPR 谱面包（chart.json + extra.json）</p>
  </div>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  <!-- 待导入预览 -->
  {#if previews.length > 0}
    <div class="group">
      <h2 class="group-title">待导入</h2>
      {#each previews as p}
        <div class="preview-item">
          {#if p.illustrationUrl}
            <img class="preview-img" src={p.illustrationUrl} alt="" />
          {/if}
          <div class="preview-info">
            <span class="preview-name">{p.name}</span>
            <span class="preview-artist">{p.artist}</span>
            <span class="preview-levels">
              难度：
              {#each Object.entries(p.chartFiles) as [lv, file]}
                <span class="level-tag">{lv.toUpperCase()}</span>
              {/each}
            </span>
          </div>
          <button class="flat-btn" onclick={doImport} disabled={busy}>导入</button>
        </div>
      {/each}
    </div>
  {/if}

  <!-- 已导入列表 -->
  {#if imported.length > 0}
    <div class="group">
      <h2 class="group-title">已导入（{imported.length}）</h2>
      {#each imported as p}
        <div class="preview-item">
          {#if p.illustrationUrl}
            <img class="preview-img" src={p.illustrationUrl} alt="" />
          {/if}
          <div class="preview-info">
            <span class="preview-name">{p.name}</span>
            <span class="preview-artist">{p.artist}</span>
            <span class="preview-levels">
              难度：
              {#each Object.entries(p.chartFiles) as [lv]}
                <span class="level-tag">{lv.toUpperCase()}</span>
              {/each}
            </span>
          </div>
          <button class="flat-btn danger" onclick={() => remove(p.codename)}>删除</button>
        </div>
      {/each}
    </div>
  {/if}

  <button class="flat-btn done-btn" onclick={() => goto('/songs')}>完成，去选歌</button>
</div>

<style>
  .page {
    height: 100vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    padding: 24px 16px 48px;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 16px;
    width: min(640px, 100%);
  }

  .icon-btn {
    width: 40px;
    height: 40px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.25);
    cursor: pointer;
    padding: 0;
    position: relative;
  }

  .back-btn::before {
    content: '';
    position: absolute;
    left: 14px;
    top: 14px;
    width: 12px;
    height: 12px;
    border-left: 2.5px solid #fff;
    border-bottom: 2.5px solid #fff;
    transform: rotate(45deg);
  }

  .title {
    margin: 0;
    font-size: 1.6rem;
    font-weight: 900;
    letter-spacing: 0.08em;
  }

  .drop-zone {
    width: min(640px, 100%);
    border: 1.5px dashed rgba(255, 255, 255, 0.35);
    border-radius: 2px;
    padding: 40px 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 18px;
    text-align: center;
    transition: border-color 0.2s, background 0.2s;
  }

  .drop-zone.dragover {
    border-color: #fff;
    background: rgba(255, 255, 255, 0.05);
  }

  .drop-title {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 700;
    letter-spacing: 0.05em;
  }

  .drop-actions {
    display: flex;
    gap: 14px;
  }

  .file-btn {
    display: inline-block;
    cursor: pointer;
  }

  .hint {
    margin: 0;
    font-size: 0.78rem;
    color: rgba(255, 255, 255, 0.45);
  }

  .error {
    color: #ff8a8a;
    font-size: 0.9rem;
  }

  .group {
    width: min(640px, 100%);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 2px;
    padding: 8px 16px;
  }

  .group-title {
    margin: 12px 0 6px;
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.15em;
    color: rgba(255, 255, 255, 0.45);
    text-transform: uppercase;
  }

  .preview-item {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .preview-item:last-child {
    border-bottom: none;
  }

  .preview-img {
    width: 96px;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    border-radius: 2px;
    flex-shrink: 0;
    background: #1d1d24;
  }

  .preview-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .preview-name {
    font-weight: 800;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .preview-artist {
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.55);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .preview-levels {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.5);
  }

  .level-tag {
    border: 1px solid rgba(255, 255, 255, 0.35);
    padding: 1px 7px;
    border-radius: 2px;
    font-weight: 700;
    font-size: 0.68rem;
  }

  .flat-btn {
    background: transparent;
    border: 1.5px solid #fff;
    color: #fff;
    border-radius: 2px;
    padding: 8px 22px;
    font-weight: 700;
    font-size: 0.9rem;
    cursor: pointer;
    transition: background 0.2s, color 0.2s;
    flex-shrink: 0;
  }

  .flat-btn:hover {
    background: #fff;
    color: #0a0a0c;
  }

  .flat-btn.danger {
    border-color: rgba(255, 255, 255, 0.5);
    color: rgba(255, 255, 255, 0.7);
  }

  .flat-btn.danger:hover {
    background: #fff;
    color: #0a0a0c;
  }

  .done-btn {
    width: min(640px, 100%);
    padding: 14px;
    font-size: 1.05rem;
    letter-spacing: 0.2em;
  }
</style>