/*
 * Derived from Team-PhiZone/player (https://github.com/Team-PhiZone/player).
 * SPDX-License-Identifier: MPL-2.0
 * Modified by PhiCommunity Revive for web-only usage.
 */
import type { Sound, Timestamp } from '$lib/types';

// 浏览器端不支持多轨音频混合（原 Tauri 平台能力），此函数保留签名但直接返回。
export const mixAudio = async (
  _sounds: Sound[],
  _timestamps: Timestamp[],
  _length: number,
  _output: string,
) => {};