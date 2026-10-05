/*
 * 延迟校准预览场景（独立于主游玩引擎）。
 *
 * 在原版 Phigros 风格里复刻一个「半个游玩界面」：
 * - 底部一条判定线
 * - 音符按校准音频的重拍（1.5s / 3.5s / 5.5s / 7.5s）落到判定线上并爆开
 * - 点击/空格记录相对重拍的偏移，取平均作为谱面延时
 *
 * 不复用 scenes/Game.ts：那是完整谱面引擎，重量级且依赖谱面数据；
 * 这里只需加载少量素材即可运行，避免在设置侧边栏里启动整套引擎。
 */
import { Game, GameObjects, Scene, Scale, WEBGL, type Types } from 'phaser';

/** 校准音频的重拍时刻（秒） */
export const CALIBRATE_BEATS = [1.5, 3.5, 5.5, 7.5] as const;

const ASSET_BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

/** 音符从出现到落线的下落时长（秒），与判定线到顶部的距离配合 */
const FALL_DURATION = 1.1;

export type CalibrateEvent =
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | { type: 'started' }
  | { type: 'ended' }
  | { type: 'hit' }
  | { type: 'result'; stage: number; offset: number };

export class CalibrateScene extends Scene {
  private _started = false;
  private _audioBuffer?: AudioBuffer;
  private _audioCtx?: AudioContext;
  private _source?: AudioBufferSourceNode;
  private _startTime = 0;
  /** 已提交的结果（4 个重拍各一次） */
  private _results: (number | undefined)[] = [undefined, undefined, undefined, undefined];
  private _judgeX = 0;
  private _judgeY = 0;

  constructor() {
    super('CalibrateScene');
  }

  preload() {
    this.load.image('cal-tap', `${ASSET_BASE}/game/notes/Tap.png`);
    this.load.spritesheet('cal-hit', `${ASSET_BASE}/game/HitEffects.png`, {
      frameWidth: 256,
      frameHeight: 256,
    });
    this.load.audio('cal-hit-sound', `${ASSET_BASE}/game/hitsounds/tap.ogg`);
  }

  create() {
    const { width, height } = this.scale;
    this._judgeX = width / 2;
    this._judgeY = height * 0.78;

    this.anims.create({
      key: 'cal-hit-anim',
      frames: this.anims.generateFrameNumbers('cal-hit', { start: 0, end: 29 }),
      frameRate: 60,
      repeat: 0,
    });

    this.drawStage();
    this.events.once('shutdown', () => this.cleanup());
    this.events.once('destroy', () => this.cleanup());

    // 校准音频不走 Phaser 音频缓存：直接用 Web Audio 解码，
    // 既避免依赖 Phaser cache 的内部结构，也方便精确对齐重拍。
    void this.loadCalibrateAudio();
  }

  private async loadCalibrateAudio() {
    try {
      const res = await fetch(`${ASSET_BASE}/calibrate/calibrate.mp3`, { credentials: 'omit' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.arrayBuffer();
      const ctx = new AudioContext();
      const buffer = await ctx.decodeAudioData(raw);
      await ctx.close();
      this._audioBuffer = buffer;
      // 音频就绪后才允许开始校准
      this.emit({ type: 'ready' });
    } catch (e) {
      console.warn('calibrate audio load failed', e);
      this.emit({ type: 'error', message: '校准音频加载失败，请检查网络后重试' });
    }
  }

  private emit(event: CalibrateEvent) {
    this.game.events.emit('calibrate', event);
  }

  /** 判定线 + 背景网格，营造「半个游玩界面」的观感 */
  private drawStage() {
    const { width, height } = this.scale;

    const bg = this.add.graphics();
    bg.fillStyle(0x0a0a0c, 1);
    bg.fillRect(0, 0, width, height);

    // 顶部渐隐区域的细微网格，模仿游玩界面透视线
    bg.lineStyle(1, 0xffffff, 0.04);
    for (let i = 0; i <= 10; i++) {
      const x = (width / 10) * i;
      bg.lineBetween(x, 0, this._judgeX + (x - this._judgeX) * 0.25, this._judgeY);
    }

    // 判定线：白色细线 + 轻微辉光
    const line = this.add.graphics();
    line.lineStyle(10, 0xffffff, 0.06);
    line.lineBetween(width * 0.12, this._judgeY, width * 0.88, this._judgeY);
    line.lineStyle(2, 0xffffff, 0.9);
    line.lineBetween(width * 0.12, this._judgeY, width * 0.88, this._judgeY);
  }

  /** 开始一次校准：播放音频并在每个重拍生成音符 */
  async start() {
    if (this._started || !this._audioBuffer) return;
    this._started = true;
    this._results = [undefined, undefined, undefined, undefined];

    const ctx = new AudioContext();
    this._audioCtx = ctx;
    // 部分浏览器初始为 suspended，需在用户手势中 resume 才会出声
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        /* 忽略，下面照常 start，由 onended 兜底 */
      }
    }
    const source = ctx.createBufferSource();
    source.buffer = this._audioBuffer;
    source.connect(ctx.destination);
    this._source = source;
    this._startTime = ctx.currentTime;
    source.onended = () => {
      this._started = false;
      this.finish();
    };
    source.start();

    // 每个重拍提前 FALL_DURATION 让音符从顶部出发，正好在重拍落线
    for (let i = 0; i < CALIBRATE_BEATS.length; i++) {
      const hitTime = CALIBRATE_BEATS[i];
      const spawnDelay = Math.max(0, hitTime - FALL_DURATION);
      this.time.delayedCall(spawnDelay * 1000, () => {
        if (!this._started) return;
        this.spawnNote(hitTime - this.currentAudioTime());
      });
    }

    this.emit({ type: 'started' });
  }

  private currentAudioTime(): number {
    if (!this._audioCtx) return 0;
    return this._audioCtx.currentTime - this._startTime;
  }

  /** 生成一个从顶部落到判定线的音符 */
  private spawnNote(secondsUntilHit: number) {
    const note = this.add.image(this._judgeX, 0, 'cal-tap');
    note.setName('cal-note');
    // Tap.png 原始 989×100，按画布宽度取一个较小的比例（0.2），避免音符显得笨重
    const targetWidth = this.scale.width * 0.2;
    note.setDisplaySize(targetWidth, (100 / 989) * targetWidth);
    note.setOrigin(0.5, 0.5);

    const startY = -note.displayHeight;
    note.y = startY;
    this.tweens.add({
      targets: note,
      y: this._judgeY,
      duration: Math.max(0, secondsUntilHit) * 1000,
      ease: 'Linear',
      onComplete: () => {
        this.explode(note);
      },
    });
  }

  /** 音符落线：爆开特效 + 打击音，然后销毁音符 */
  private explode(note: GameObjects.Image) {
    // 组件被销毁 / 场景停止后补间可能仍回调一次，避免操作已销毁对象
    if (!note.active) return;
    const x = note.x;
    const y = Number.isFinite(note.y) ? note.y : this._judgeY;
    note.destroy();

    const hit = this.add.sprite(x, y, 'cal-hit');
    const scale = (this.scale.width / 989) * 1.0;
    hit.setScale(scale);
    hit.setTint(0xffec9f); // PERFECT 色
    hit.play('cal-hit-anim');
    hit.once('animationcomplete', () => hit.destroy());

    // 粒子：向四周飞散的白色小方块
    for (let i = 0; i < 6; i++) {
      const p = this.add.rectangle(x, y, 10 * scale, 10 * scale, 0xffec9f).setOrigin(0.5).setScale(0);
      const angle = Math.random() * Math.PI * 2;
      const range = (60 + Math.random() * 140) * scale;
      this.tweens.add({
        targets: p,
        x: x + range * Math.cos(angle),
        y: y + range * Math.sin(angle),
        duration: 700,
        ease: 'Quint.easeOut',
      });
      this.tweens.add({ targets: p, scale: 1, duration: 220, ease: 'Cubic.easeOut' });
      this.tweens.add({ targets: p, scale: 0, duration: 420, delay: 260, ease: 'Cubic.easeIn' });
      this.tweens.add({
        targets: p,
        alpha: 0,
        duration: 500,
        onComplete: () => p.destroy(),
      });
    }

    this.sound.play('cal-hit-sound', { volume: 0.7 });
  }

  /** 记录一次点击，返回是否有效提交 */
  public registerHit() {
    if (!this._started) return;
    // 先广播「收到了点击」，便于 UI 区分「点击没送达」和「点击未落在重拍窗口」
    this.emit({ type: 'hit' });
    const t = this.currentAudioTime();
    // 找最近的、尚未记录的重拍
    let bestIndex = -1;
    let bestDist = Infinity;
    for (let i = 0; i < CALIBRATE_BEATS.length; i++) {
      if (this._results[i] !== undefined) continue;
      const dist = Math.abs(t - CALIBRATE_BEATS[i]);
      if (dist < bestDist && dist < 1.2) {
        bestDist = dist;
        bestIndex = i;
      }
    }
    if (bestIndex < 0) return;
    const offset = Math.round((t - CALIBRATE_BEATS[bestIndex]) * 1000);
    this._results[bestIndex] = offset;
    this.emit({ type: 'result', stage: bestIndex + 1, offset });
  }

  private finish() {
    this.emit({ type: 'ended' });
  }

  /** 手动结束：停止音频与在途音符，保留已记录结果 */
  public stop() {
    if (!this._started) return;
    this._started = false;
    try {
      this._source?.stop();
    } catch {
      /* 已结束 */
    }
    if (this._audioCtx && this._audioCtx.state !== 'closed') void this._audioCtx.close();
    this._audioCtx = undefined;
    this._source = undefined;
    // 清掉尚未落到判定线的音符与补间，避免结束后续播
    this.tweens.killAll();
    this.children.list
      .filter((child) => child.name === 'cal-note')
      .forEach((child) => child.destroy());
    this.emit({ type: 'ended' });
  }

  private cleanup() {
    try {
      this._source?.stop();
    } catch {
      /* 已结束 */
    }
    if (this._audioCtx && this._audioCtx.state !== 'closed') void this._audioCtx.close();
    this._audioCtx = undefined;
    this._source = undefined;
  }
}

export interface CalibrateHandle {
  start: () => void;
  hit: () => void;
  stop: () => void;
  destroy: () => void;
}
/**
 * 在指定容器内启动校准预览。返回句柄以便组件卸载时销毁整个 Phaser 实例。
 * 事件通过 `game.events`（'calibrate'）发出，由 Svelte 组件订阅。
 */
export function createCalibrateGame(
  parent: string,
  onEvent: (event: CalibrateEvent) => void,
): CalibrateHandle {
  const parentElement = document.getElementById(parent);
  if (!parentElement) {
    return { start: () => undefined, hit: () => undefined, stop: () => undefined, destroy: () => undefined };
  }

  const config: Types.Core.GameConfig = {
    type: WEBGL,
    width: parentElement.clientWidth * window.devicePixelRatio,
    height: parentElement.clientHeight * window.devicePixelRatio,
    scale: {
      mode: Scale.FIT,
      autoCenter: Scale.CENTER_BOTH,
    },
    antialias: true,
    backgroundColor: '#0a0a0c',
    loader: { crossOrigin: 'anonymous' },
    scene: [CalibrateScene],
  };

  const game = new Game({ ...config, parent });
  game.events.on('calibrate', onEvent);

  // 场景在构造后异步启动，不能在此时缓存引用（会拿到 undefined / 过早的实例）；
  // 每次调用都按 key 重新取，SceneManager 会返回当前存活的实例。
  const getScene = () => game.scene.getScene('CalibrateScene') as CalibrateScene | undefined;

  // 容器尺寸变化（侧边栏宽度/界面缩放）时同步画布分辨率
  const resizeObserver = new ResizeObserver(() => {
    const w = parentElement.clientWidth * window.devicePixelRatio;
    const h = parentElement.clientHeight * window.devicePixelRatio;
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      game.scale.resize(w, h);
    }
  });
  resizeObserver.observe(parentElement);

  return {
    start: () => getScene()?.start(),
    hit: () => getScene()?.registerHit(),
    stop: () => getScene()?.stop(),
    destroy: () => {
      resizeObserver.disconnect();
      game.events.off('calibrate', onEvent);
      game.destroy(true);
    },
  };
}
