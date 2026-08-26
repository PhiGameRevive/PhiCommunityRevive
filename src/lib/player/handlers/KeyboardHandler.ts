/*
 * Derived from Team-PhiZone/player (https://github.com/Team-PhiZone/player).
 * SPDX-License-Identifier: MPL-2.0
 * Modified by PhiCommunity Revive for web-only usage.
 */
import type { Game } from '../scenes/Game';
import { GameStatus } from '$lib/types';
import type { PlainNote } from '../objects/PlainNote';
import type { LongNote } from '../objects/LongNote';
import { KEYBOARD_INPUT_REGEX } from '../constants';
import { EventBus } from '../EventBus';

export class KeyboardHandler {
  private _scene: Game;
  private _increment: number = 5;
  private _isShiftDown: boolean = false;
  private _keysDown: Set<string> = new Set();

  constructor(scene: Game) {
    this._scene = scene;

    // 空格总是注册：前奏倒计时可跳过时优先触发跳过，其余模式走各自的暂停逻辑
    this._scene.input.keyboard?.on('keydown-SPACE', this.handleSpaceDown, this);

    if (this._scene.autoplay || this._scene.practice || this._scene.replay) {
      this._scene.input.keyboard?.on('keydown-LEFT', this.handleLeftArrowDown, this);
      this._scene.input.keyboard?.on('keydown-RIGHT', this.handleRightArrowDown, this);
      this._scene.input.keyboard?.on('keydown-SHIFT', this.handleShiftDown, this);
      this._scene.input.keyboard?.on('keyup-SHIFT', this.handleShiftUp, this);
    }
    this._scene.input.keyboard?.on('keyup-ESC', this.handleEscapeUp, this);
    this._scene.input.keyboard?.on('keydown', this.handleDown, this);
    this._scene.input.keyboard?.on('keyup', this.handleUp, this);
  }

  findDrag(_note: PlainNote | LongNote, _requireVelocity: boolean = false) {
    return this._keysDown.size > 0;
  }

  reset() {
    this._keysDown.clear();
  }

  handleDown(e: KeyboardEvent) {
    if (e.repeat) {
      return;
    }
    if (!KEYBOARD_INPUT_REGEX.test(e.key)) {
      return;
    }
    if (this._scene.replay || this._scene.autoplay || this._scene.status !== GameStatus.PLAYING) return;
    this._keysDown.add(e.key);
    EventBus.emit('replay-input', { t: this._scene.timeSec, type: 'keydown', key: e.key });
    console.debug('+', e.key, this._keysDown);
    this._scene.judgment.judgeTap();
  }

  handleUp(e: KeyboardEvent) {
    if (e.repeat) {
      return;
    }
    if (!KEYBOARD_INPUT_REGEX.test(e.key)) {
      return;
    }
    if (this._scene.replay || this._scene.autoplay || this._scene.status !== GameStatus.PLAYING) return;
    this._keysDown.delete(e.key);
    EventBus.emit('replay-input', { t: this._scene.timeSec, type: 'keyup', key: e.key });
    console.debug('-', e.key, this._keysDown);
  }

  handleSpaceDown() {
    // 前奏/尾奏可跳过时，空格优先触发跳过（任何模式都生效）
    if (this._scene.skipIntroAvailable) {
      this._scene.skipIntro();
      return;
    }
    if (this._scene.skipOutroAvailable) {
      this._scene.skipOutro();
      return;
    }
    // 普通游玩：空格不参与暂停（保持原有行为；空格仍作为键盘打击键）
    if (!(this._scene.autoplay || this._scene.practice || this._scene.replay)) return;
    if (this._scene.status === GameStatus.PLAYING) {
      if (this._scene.practice && !this._isShiftDown) return;
      this._scene.pause(true);
    } else if (this._scene.status === GameStatus.PAUSED) {
      this._scene.resume();
    }
  }

  handleLeftArrowDown() {
    this.setSeek(Math.max(0, this._scene.clock.seek - this._increment * this._scene.timeScale));
  }

  handleRightArrowDown() {
    this.setSeek(
      Math.min(
        this._scene.song.duration,
        this._scene.clock.seek + this._increment * this._scene.timeScale,
      ),
    );
  }

  setSeek(value: number) {
    const pauseAndResume = this._scene.status === GameStatus.PLAYING;
    if (pauseAndResume) this._scene.pause();
    this._scene.setSeek(value);
    if (pauseAndResume) this._scene.resume();
  }

  handleShiftDown() {
    this._isShiftDown = true;
    this._increment = 0.1;
  }

  handleShiftUp() {
    this._isShiftDown = false;
    this._increment = 5;
  }

  handleEscapeUp() {
    if (this._scene.status === GameStatus.PLAYING) {
      this._scene.pause();
    } else if (this._scene.status === GameStatus.PAUSED) {
      this._scene.resume();
    }
  }

  replayDown(key: string) {
    if (this._keysDown.has(key)) return;
    this._keysDown.add(key);
    this._scene.judgment.judgeTap();
  }

  replayUp(key: string) {
    this._keysDown.delete(key);
  }
}
