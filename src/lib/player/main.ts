/*
 * Derived from Team-PhiZone/player (https://github.com/Team-PhiZone/player).
 * SPDX-License-Identifier: MPL-2.0
 * Modified by PhiCommunity Revive for web-only usage.
 */
import { Game as MainGame } from './scenes/Game';
import { WEBGL, Game, Scale, type Types } from 'phaser';
import type { Config } from '$lib/types';
import { IS_TAURI_LIKE } from '$lib/utils';

/**
 * 计算满足目标宽高比、且在容器内尽可能大的画布分辨率。
 * 取整数像素，避免非整数尺寸被浏览器二次缩放而模糊。
 */
const fitAspect = (
  ratio: [number, number],
  containerWidth: number,
  containerHeight: number,
): { width: number; height: number } => {
  const [ratioW, ratioH] = ratio;
  let width = containerWidth;
  let height = (containerWidth * ratioH) / ratioW;
  if (height > containerHeight) {
    height = containerHeight;
    width = (containerHeight * ratioW) / ratioH;
  }
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
};

const start = async (parent: string, sceneConfig: Config) => {
  const parentElement = document.getElementById(parent)!;
  const ratio = sceneConfig.preferences.aspectRatio;

  const config: Types.Core.GameConfig = {
    type: WEBGL,
    width: parentElement.clientWidth * window.devicePixelRatio,
    height: parentElement.clientHeight * window.devicePixelRatio,
    fps: {
      smoothStep: !(IS_TAURI_LIKE && sceneConfig.render),
    },
    scale: {
      mode: Scale.EXPAND,
      autoCenter: Scale.CENTER_BOTH,
    },
    antialias: true,
    backgroundColor: '#000000',
    loader: {
      crossOrigin: 'anonymous',
    },
    scene: [MainGame],
    input: {
      activePointers: 10,
    },
  };

  localStorage.setItem('player', JSON.stringify(sceneConfig));
  if (ratio !== null) {
    // 以实际容器尺寸为基准计算画布分辨率。原实现把比例数字（如 16、9）
    // 直接当尺寸交给 fit()，会得到 16×9 的极小画布，再由 Scale.FIT 拉伸
    // 铺满屏幕，导致严重模糊。
    const dimensions = fitAspect(
      ratio,
      parentElement.clientWidth * window.devicePixelRatio,
      parentElement.clientHeight * window.devicePixelRatio,
    );
    config.width = dimensions.width;
    config.height = dimensions.height;
    config.scale = {
      mode: Scale.FIT,
      autoCenter: Scale.CENTER_BOTH,
    };
  }

  const game = new Game({ ...config, parent });
  // @ts-expect-error - globalThis is not defined in TypeScript
  globalThis.__PHASER_GAME__ = game;
  game.scene.start('MainGame');

  if (!config.scale || config.scale.mode === Scale.EXPAND) {
    new ResizeObserver((entries) => {
      requestAnimationFrame(() => {
        try {
          const size = entries[0]?.contentBoxSize?.[0];
          if (!size) return;
          const w = size.inlineSize * window.devicePixelRatio;
          const h = size.blockSize * window.devicePixelRatio;
          // 数值无效时跳过（Phaser Size2 对 NaN/0 会崩溃）
          if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
          game.scale.resize(w, h);
        } catch (e) {
          console.warn(e);
        }
      });
    }).observe(parentElement);
  } else if (ratio !== null) {
    // 固定宽高比：Scale.FIT 只负责把画布等比铺满容器，但画布分辨率需随
    // 视口变化重算，否则窗口缩放后会因分辨率不足而变糊。
    new ResizeObserver((entries) => {
      requestAnimationFrame(() => {
        try {
          const size = entries[0]?.contentBoxSize?.[0];
          if (!size) return;
          const w = size.inlineSize * window.devicePixelRatio;
          const h = size.blockSize * window.devicePixelRatio;
          if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
          const dimensions = fitAspect(ratio, w, h);
          game.scale.resize(dimensions.width, dimensions.height);
        } catch (e) {
          console.warn(e);
        }
      });
    }).observe(parentElement);
  }
  return game;
};

export default start;