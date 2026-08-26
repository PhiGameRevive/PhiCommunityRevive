/*
 * 前奏/间奏倒计时：谱面开头或曲中存在较长的无音符空白段时，在屏幕中央显示
 * 「剩余秒数 + 白色进度条」。进度条从满宽开始，随倒计时向中间收缩
 * （两端同时收拢），完全缩没即下一个音符落下。
 *
 * 前奏（第一个空白窗口）剩余超过 SKIP_LEAD_SEC 秒时提供跳过入口：
 * 点击按钮（或按空格，见 KeyboardHandler）直接跳到前奏还剩 3 秒处。
 *
 * 由 Game 场景持有，在 update() 中逐帧刷新；暂停时时钟冻结，倒计时自然暂停。
 */
import { GameObjects, type Input, type Types } from 'phaser';
import type { Game } from '../scenes/Game';
import { GameStatus } from '$lib/types';
import { OUTRO_MIN_SEC, SKIP_LEAD_SEC } from '../constants';

/** 进出场动画时长（毫秒） */
const ENTRY_DURATION = 260;
const EXIT_DURATION = 300;

export interface CountdownWindow {
  /** 空白段起点（秒，谱面时间）。前奏为 0。 */
  start: number;
  /** 空白段终点 = 下一个可交互音符的命中时刻 */
  end: number;
}

export class IntroCountdown extends GameObjects.Container {
  private _scene: Game;
  private _number: GameObjects.Text;
  private _bar: GameObjects.Rectangle;
  private _skipButton: GameObjects.Text;
  /** 尾奏跳过按钮：独立于容器（倒计时容器隐藏时仍可显示） */
  private _outroButton: GameObjects.Text;
  /** 所有空白窗口（按 start 升序；第一个即前奏） */
  private _windows: CountdownWindow[] = [];
  /** 尾奏起点（最后一个音符判定结束时刻）；Infinity 表示无音符 */
  private _outroStart = Infinity;
  /** 当前帧是否可跳过前奏（前奏窗口且剩余 > SKIP_LEAD_SEC） */
  private _skipAvailable = false;
  /** 当前帧是否可跳过尾奏 */
  private _outroAvailable = false;
  /** 已播放进场动画（正在显示中） */
  private _entered = false;
  /** 退场动画进行中 */
  private _exiting = false;

  constructor(scene: Game) {
    super(scene, scene.w(0), scene.h(0));
    this._scene = scene;
    this.setDepth(20); // 高于 note(2~11) 与常规 UI(8~15)，低于 debug(Infinity)

    this._number = new GameObjects.Text(scene, 0, -this._scene.p(42), '', {
      fontFamily: scene.respack.fonts[0].name,
      fontSize: this._scene.p(96),
      color: '#ffffff',
      align: 'center',
      shadow: {
        offsetX: 0,
        offsetY: 4,
        color: 'rgba(0, 0, 0, 0.65)',
        blur: 10,
        fill: true,
      },
    }).setOrigin(0.5);

    this._bar = new GameObjects.Rectangle(
      scene,
      0,
      this._scene.p(26),
      this._scene.p(420),
      this._scene.p(9),
      0xffffff,
      1,
    ).setOrigin(0.5, 0.5);

    this._skipButton = new GameObjects.Text(scene, 0, this._scene.p(76), '跳过前奏 ▸▸', {
      fontFamily: scene.respack.fonts[0].name,
      fontSize: this._scene.p(30),
      color: '#ffffff',
      align: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.4)',
      padding: { x: 20, y: 10 },
      shadow: {
        offsetX: 0,
        offsetY: 3,
        color: 'rgba(0, 0, 0, 0.7)',
        blur: 8,
        fill: true,
      },
    })
      .setOrigin(0.5)
      .setAlpha(0.9)
      .setInteractive({ useHandCursor: true })
      .on(
        'pointerdown',
        (_pointer: Input.Pointer, _localX: number, _localY: number, event: Types.Input.EventData) => {
          // 阻止事件继续传播到场景级打击输入（前奏期无音符，双保险）
          event.stopPropagation();
          this._scene.skipIntro();
        },
      );

    this.add(this._number);
    this.add(this._bar);
    this.add(this._skipButton);
    this.setVisible(false);

    this._outroButton = new GameObjects.Text(scene, scene.w(0), scene.h(0), '跳过尾奏 ▸▸', {
      fontFamily: scene.respack.fonts[0].name,
      fontSize: this._scene.p(30),
      color: '#ffffff',
      align: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.4)',
      padding: { x: 20, y: 10 },
      shadow: {
        offsetX: 0,
        offsetY: 3,
        color: 'rgba(0, 0, 0, 0.7)',
        blur: 8,
        fill: true,
      },
    })
      .setOrigin(0.5)
      .setAlpha(0.9)
      .setDepth(20)
      .setVisible(false)
      .setInteractive({ useHandCursor: true })
      .on(
        'pointerdown',
        (_pointer: Input.Pointer, _localX: number, _localY: number, event: Types.Input.EventData) => {
          event.stopPropagation();
          this._scene.skipOutro();
        },
      );
    scene.registerNode(this._outroButton, 'ui-outro-skip');

    scene.registerNode(this, 'ui-intro-countdown');
  }

  /** 设置全部空白窗口（前奏 + 间奏），由 Game 在谱面初始化后计算传入 */
  setWindows(windows: CountdownWindow[]) {
    this._windows = windows;
  }

  /** 设置尾奏起点（最后一个音符判定结束时刻），由 Game 传入 */
  setOutroStart(time: number) {
    this._outroStart = time;
  }

  /** 当前是否可跳过前奏 */
  public get skipAvailable(): boolean {
    return this._skipAvailable;
  }

  /** 当前是否可跳过尾奏 */
  public get outroAvailable(): boolean {
    return this._outroAvailable;
  }

  /** 跳过目标时刻（秒，谱面时间）：前奏窗口结尾前 SKIP_LEAD_SEC 秒 */
  public get skipTarget(): number {
    return this._windows.length > 0 ? this._windows[0].end - SKIP_LEAD_SEC : 0;
  }

  update() {
    const scene = this._scene;
    // SEEKING 与 PLAYING 同权（拖动/跳转的那一帧仍保持显示）
    const playing =
      (scene.status === GameStatus.PLAYING || scene.status === GameStatus.SEEKING) &&
      !scene.fastForwarding;
    const t = scene.timeSec;

    // 尾奏跳过：最后一个音符判定结束后、音乐剩余超过 OUTRO_MIN_SEC 时显示。
    // 提前结算开启时由引擎自动出结算，无需按钮。
    const songDuration = scene.song?.duration ?? 0;
    const showOutro =
      playing &&
      !scene.earlyFinish &&
      this._outroStart !== Infinity &&
      t >= this._outroStart &&
      songDuration - t > OUTRO_MIN_SEC;
    this._outroAvailable = showOutro;
    if (showOutro) {
      if (!this._outroButton.visible) {
        this._outroButton.setVisible(true);
        this._outroButton.setAlpha(0);
        scene.tweens.add({
          targets: this._outroButton,
          alpha: 0.9,
          duration: 240,
          ease: 'Cubic.easeOut',
        });
      }
      this._outroButton.setFontSize(scene.p(30));
      this._outroButton.setPosition(scene.w(0), scene.h(0) + scene.p(76));
    } else {
      scene.tweens.killTweensOf(this._outroButton);
      this._outroButton.setVisible(false);
    }

    // 定位当前所在的空白窗口：仅真正的开头前奏窗口（start === 0）允许
    // chart 起播瞬间（timeSec 可能为负）提前显示；间奏窗口必须等前一个
    // 音符结束（t >= start）才出现，否则会在真实音符期间提前倒计时并冻结。
    let current: CountdownWindow | null = null;
    for (const w of this._windows) {
      if (t < w.end && (t >= w.start || w.start === 0)) {
        current = w;
        break;
      }
    }
    this._skipAvailable = false;

    // 暂停/快进/回退追赶（resume 倒计时）期间不显示
    if (!playing || !current || scene.preserveJudgments) {
      this._skipButton.setVisible(false);
      if (this._exiting) return;
      if (this._entered) {
        this._exiting = true;
        this.playExit();
      } else {
        this.setVisible(false);
      }
      return;
    }
    const active = current;

    // 退场中途恢复显示：取消退场，直接回到完整状态（不再重复播放进场）
    if (this._exiting) {
      this._exiting = false;
      scene.tweens.killTweensOf(this);
      this.setAlpha(1);
      this.setScale(1, 1);
    }
    if (!this._entered) {
      this._entered = true;
      this.playEntry();
    }

    const remaining = active.end - t;
    this.updateContent(remaining, active.end - active.start);

    // 跳过入口仅限前奏窗口（start === 0），且剩余超过 3 秒
    this._skipAvailable = active.start === 0 && remaining > SKIP_LEAD_SEC;
    this._skipButton.setVisible(this._skipAvailable);
  }

  /** 更新数字、进度条与跳过按钮（容器居中 + 尺寸随画布缩放，支持窗口 resize） */
  private updateContent(remaining: number, total: number) {
    const scene = this._scene;
    this.setPosition(scene.w(0), scene.h(0));
    this._number.setFontSize(scene.p(96));
    this._number.setPosition(0, -scene.p(42));
    // 剩余时间不超出窗口总长，避免 offset 让数字多出 1 秒
    this._number.setText(Math.ceil(Math.min(remaining, total)).toString());

    const maxBarWidth = scene.p(420);
    const ratio = Math.max(0, Math.min(1, remaining / total));
    this._bar.setPosition(0, scene.p(26));
    this._bar.displayWidth = Math.max(0.01, maxBarWidth * ratio);
    this._bar.displayHeight = scene.p(9);

    this._skipButton.setFontSize(scene.p(30));
    this._skipButton.setPosition(0, scene.p(76));
  }

  private playEntry() {
    const scene = this._scene;
    this.setVisible(true);
    scene.tweens.killTweensOf(this);
    this.setAlpha(0);
    this.setScale(0.92, 0.92);
    scene.tweens.add({
      targets: this,
      alpha: 1,
      scale: 1,
      duration: ENTRY_DURATION,
      ease: 'Cubic.easeOut',
    });
  }

  private playExit() {
    const scene = this._scene;
    scene.tweens.killTweensOf(this);
    scene.tweens.add({
      targets: this,
      alpha: 0,
      scale: 0.94,
      duration: EXIT_DURATION,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        this._exiting = false;
        this._entered = false;
        this.setVisible(false);
      },
    });
  }

  destroy() {
    this._scene.tweens.killTweensOf(this);
    this._scene.tweens.killTweensOf(this._outroButton);
    this._outroButton.destroy();
    super.destroy();
  }
}
