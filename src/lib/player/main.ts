/*
 * Derived from Team-PhiZone/player (https://github.com/Team-PhiZone/player).
 * SPDX-License-Identifier: MPL-2.0
 * Modified by PhiCommunity Revive for web-only usage.
 */
import { Game as MainGame } from './scenes/Game';
import { WEBGL, Game, Scale, type Types } from 'phaser';
import type { Config } from '$lib/types';
import { fit, IS_TAURI_LIKE } from '$lib/utils';

const start = async (parent: string, sceneConfig: Config) => {
  const parentElement = document.getElementById(parent)!;

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
  if (sceneConfig.preferences.aspectRatio !== null) {
    const ratio = sceneConfig.preferences.aspectRatio;
    const dimensions = fit(
      ratio[0],
      ratio[1],
      Math.max(window.screen.width, window.screen.height) * window.devicePixelRatio,
      Math.min(window.screen.width, window.screen.height) * window.devicePixelRatio,
      true,
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
  }
  return game;
};

export default start;