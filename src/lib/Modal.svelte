<script lang="ts">
  import { modalStore, closeModal } from './modal';

  let inputValue = '';

  $: if ($modalStore?.type === 'prompt') {
    inputValue = $modalStore.defaultValue ?? '';
  }

  const submit = () => {
    const s = $modalStore;
    if (!s) return;
    if (s.type === 'prompt') closeModal(inputValue);
    else closeModal(true);
  };

  const cancel = () => {
    const s = $modalStore;
    if (!s) return;
    closeModal(s.type === 'alert' ? true : null);
  };
</script>

{#if $modalStore}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex a11y_no_noninteractive_element_interactions -->
  <div
    class="modal-overlay"
    role="group"
    tabindex="-1"
    onclick={() => $modalStore.type === 'alert' && cancel()}
    onkeydown={(e) => {
      if (e.key === 'Escape') cancel();
      if (e.key === 'Enter') submit();
    }}
  >
    <div class="modal-panel" role="presentation" onclick={(e) => e.stopPropagation()}>
      <h2 class="modal-title">[ {$modalStore.title} ]</h2>
      <p class="modal-message">{ $modalStore.message }</p>

      {#if $modalStore.type === 'prompt'}
        <input
          class="modal-input"
          bind:value={inputValue}
          spellcheck="false"
          autocomplete="off"
          onkeydown={(e) => e.key === 'Enter' && submit()}
        />
      {/if}

      <div class="modal-actions">
        {#if $modalStore.type !== 'alert'}
          <button class="modal-btn" onclick={cancel}>取消</button>
        {/if}
        <button class="modal-btn primary" onclick={submit}>确定</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(5, 5, 8, 0.78);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 99999;
    outline: none;
  }

  .modal-panel {
    background: #0d0d11;
    border: 1px solid rgba(255, 255, 255, 0.5);
    border-radius: 2px;
    width: min(420px, 88vw);
    padding: 26px 28px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    box-shadow: 0 24px 70px rgba(0, 0, 0, 0.7);
    animation: modal-in 0.16s ease-out;
  }

  @keyframes modal-in {
    from {
      opacity: 0;
      transform: scale(0.94);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  .modal-title {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 900;
    letter-spacing: 0.2em;
    font-family: 'Courier New', ui-monospace, Menlo, Consolas, monospace;
    color: #e8e8e8;
  }

  .modal-message {
    margin: 0;
    font-size: 0.92rem;
    line-height: 1.6;
    color: rgba(232, 232, 232, 0.82);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .modal-input {
    background: #101014;
    border: 1px solid rgba(255, 255, 255, 0.4);
    border-radius: 2px;
    color: #e8e8e8;
    padding: 10px 12px;
    font-size: 0.95rem;
    font-family: 'Courier New', ui-monospace, Menlo, Consolas, monospace;
    outline: none;
  }

  .modal-input:focus {
    border-color: #fff;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 6px;
  }

  .modal-btn {
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.6);
    color: #e8e8e8;
    border-radius: 2px;
    padding: 9px 26px;
    font-size: 0.9rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .modal-btn:hover {
    background: #e8e8e8;
    color: #0a0a0c;
  }

  .modal-btn.primary {
    background: #e8e8e8;
    color: #0a0a0c;
    border-color: #e8e8e8;
  }

  .modal-btn.primary:hover {
    background: #fff;
  }
</style>