/**
 * 极客风弹窗管理器：替代浏览器原生 alert / confirm / prompt。
 */
import { writable } from 'svelte/store';

export type ModalType = 'alert' | 'confirm' | 'prompt';

export interface ModalState {
  type: ModalType;
  title: string;
  message: string;
  defaultValue?: string;
  resolve: (value: string | boolean | null) => void;
}

export const modalStore = writable<ModalState | null>(null);

export function alert(message: string, title = '提示'): Promise<void> {
  return new Promise((resolve) => {
    modalStore.set({
      type: 'alert',
      title,
      message,
      resolve: () => resolve(),
    });
  });
}

export function confirm(message: string, title = '确认'): Promise<boolean> {
  return new Promise((resolve) => {
    modalStore.set({
      type: 'confirm',
      title,
      message,
      resolve: (v) => resolve(v === true),
    });
  });
}

export function prompt(message: string, defaultValue = '', title = '输入'): Promise<string | null> {
  return new Promise((resolve) => {
    modalStore.set({
      type: 'prompt',
      title,
      message,
      defaultValue,
      resolve: (v) => resolve(typeof v === 'string' ? v : null),
    });
  });
}

export function closeModal(value: string | boolean | null): void {
  const state = modalStoreValue();
  if (state) {
    state.resolve(value);
    modalStore.set(null);
  }
}

let cached: ModalState | null = null;
modalStore.subscribe((v) => (cached = v));
function modalStoreValue(): ModalState | null {
  return cached;
}
