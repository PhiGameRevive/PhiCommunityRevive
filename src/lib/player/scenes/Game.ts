/*
 * Derived from Team-PhiZone/player (https://github.com/Team-PhiZone/player).
 * SPDX-License-Identifier: MPL-2.0
 * Modified by PhiCommunity Revive for web-only usage.
 */
import { Cameras, GameObjects, Scene, Sound } from 'phaser';
import { EventBus } from '../EventBus';
import { inferLevelType, fit, send, getLines, IS_TAURI_LIKE } from '$lib/utils';
import {
  processIllustration,
  loadJson,
  toBeats,
  getAudio,
  calculatePrecedences,
  loadText,
  getSpritesheet,
  findHighlightMoments,
  loadChart,
} from '../utils';
import {
  GameStatus,
  type Bpm,
  type Config,
  type GameObject,
  type LevelType,
  type PhiraExtra,
  type ResultsMusic,
  type RpeJson,
  type ShaderEffect,
} from '$lib/types';
import { Line } from '../objects/Line';
import type { LongNote } from '../objects/LongNote';
import type { PlainNote } from '../objects/PlainNote';
import { GameUI } from '../objects/GameUI';
import { ResultsUI } from '../objects/ResultsUI';
import { PointerHandler } from '../handlers/PointerHandler';
import { KeyboardHandler } from '../handlers/KeyboardHandler';
import { JudgmentHandler } from '../handlers/JudgmentHandler';
import { StatisticsHandler } from '../handlers/StatisticsHandler';
import { ShaderFilter } from '../objects/ShaderPipeline';
import { Video } from '../objects/Video';
import { Signal } from '../objects/Signal';
import { Node, ROOT } from '../objects/Node';
import { ShaderNode } from '../objects/ShaderNode';
import { base } from '$app/paths';
import { Clock } from '../services/clock';
import { HtmlAudioSong, type SongLike } from '../services/htmlAudioSong';
import { ResourcePackHandler } from '../handlers/ResourcePackHandler';
import { m } from '$lib/messages';
import { HOLD_TAIL_TOLERANCE } from '../constants';

const JUDGMENT_END_GRACE_SEC = 0.2;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** 读取图片尺寸 */
function loadImageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = url;
  });
}

/**
 * 自动推断 spritesheet 帧尺寸：
 * 1) 原帧尺寸能整除图片宽高 → 沿用原布局
 * 2) 否则按最大公约数取正方形帧（如 1280x1536 → 256x256，5×6 网格）
 * 3) 再不行 → 单帧整图
 */
async function autoDetectFrameSize(
  url: string,
  defaultW: number,
  defaultH: number,
): Promise<{ frameW: number; frameH: number }> {
  const { width, height } = await loadImageSize(url);
  if (width <= 0 || height <= 0) return { frameW: defaultW, frameH: defaultH };
  if (width % defaultW === 0 && height % defaultH === 0) {
    return { frameW: defaultW, frameH: defaultH };
  }
  const g = gcd(width, height);
  if (g >= 16 && width % g === 0 && height % g === 0) {
    return { frameW: g, frameH: g };
  }
  return { frameW: width, frameH: height };
}

export class Game extends Scene {
  private _status: GameStatus = GameStatus.LOADING;

  private _data: Config;
  private _chart: RpeJson;
  private _songUrl: string;
  private _chartUrl: string;
  private _illustrationUrl: string;
  private _extraUrl: string | undefined;
  private _extra: PhiraExtra | undefined;
  private _lineCsvUrl: string | undefined;
  private _hitEffectsFrameRate: number;
  private _resultsMusic: ResultsMusic<string>;
  private _animatedAssets: {
    key: string;
    url: string;
    isGif: boolean;
    frameCount?: number;
    frameRate?: number;
    repeat?: number;
  }[] = [];
  private _audioAssets: { key: string; url: string }[] = [];
  private _shaderAssets: { key: string; url: string; source?: string; fallback?: boolean }[] = [];
  private _skinSize: number | undefined = undefined;

  private _title: string | null;
  private _composer: string | null;
  private _charter: string | null;
  private _illustrator: string | null;
  private _levelType: LevelType;
  private _level: string | null;
  private _offset: number;
  private _bpmList: Bpm[];
  private _numberOfNotes: number;
  private _autoplay = false;
  private _practice = false;
  private _autostart = false;
  private _adjustOffset = false;
  private _render = false;

  private _bpmIndex: number = 0;
  private _lines: Line[];
  private _notes: (PlainNote | LongNote)[];
  private _judgmentNotesByStart: (PlainNote | LongNote)[] = [];
  private _activeJudgmentNotes: (PlainNote | LongNote)[] = [];
  private _judgmentNoteIndex: number = 0;
  private _lastChartSongTime: number | undefined;
  private _shaders:
    | (
        | {
            key: string;
            effect: ShaderEffect;
            target: Cameras.Scene2D.Camera | ShaderNode;
            filter: ShaderFilter;
          }
        | undefined
      )[]
    | undefined;
  private _videos: Video[] | undefined;
  private _visible: boolean = true;
  private _timeout: NodeJS.Timeout;
  private _isSeeking: boolean = false;
  private _timeScale: number = 1;
  private _lastProgressUpdate: number | undefined;

  /**
   * 练习模式的 A/B 循环区间（秒）。两者都设置后，播放越过 B 点会自动跳回 A 点。
   * 未设置时为 null。
   */
  private _loopA: number | null = null;
  private _loopB: number | null = null;

  private _fonts: Record<string, string> = {};

  private _objects: Node[] = [];

  private _song: SongLike;
  private _background: GameObjects.Image;
  private _gameUI: GameUI;
  private _resultsUI?: ResultsUI;

  private _clock: Clock;
  private _pointerHandler?: PointerHandler;
  private _keyboardHandler?: KeyboardHandler;
  private _judgmentHandler: JudgmentHandler;
  private _statisticsHandler: StatisticsHandler;
  private _respack: ResourcePackHandler;

  constructor() {
    super('Game');
  }

  init() {
    const val = localStorage.getItem('player');
    if (!val) {
      this._status = GameStatus.ERROR;
      alert(m.error_no_data_provided());
      return;
    }
    this._data = JSON.parse(val);
  }

  preload() {
    if (this._status === GameStatus.ERROR) return;

    this.load.on('progress', (progress: number) => {
      EventBus.emit('loading', progress);
    });
    this.load.on('fileprogress', (e: { key: string; url: string }) => {
      EventBus.emit(
        'loading-detail',
        m.loading({ name: (e.url.startsWith('blob:') ? e.url.split('/').pop() : e.key) ?? 'file' }),
      );
    });

    const { song, chart, illustration, assetNames, assetTypes, assets } = this._data.resources;

    this._songUrl = song;
    this._chartUrl = chart;
    this._illustrationUrl = illustration;
    this._title = this._data.metadata.title;
    this._composer = this._data.metadata.composer;
    this._charter = this._data.metadata.charter;
    this._illustrator = this._data.metadata.illustrator;
    this._levelType = this._data.metadata.levelType;
    this._level =
      this._data.metadata.level !== null && this._data.metadata.difficulty !== null
        ? `${this._data.metadata.level}  Lv.${this._data.metadata.difficulty?.toFixed(0)}`
        : this._data.metadata.level;
    this._autoplay = this._data.autoplay;
    this._practice = this._data.practice;
    this._autostart = this._data.autostart;
    this._adjustOffset = this._data.adjustOffset;
    this._render = false;

    this._respack = new ResourcePackHandler(this._data.resourcePack);

    // 注意：不要在这里创建临时 AudioContext（会泄漏，且多次游玩后浏览器 AudioContext 上限耗尽导致音频异常）。
    // 进入游玩页前用户必有点击手势（Tap to start），AudioContext 已处于可用状态，autostart 可安全直接播放。

    this.load.svg('pause', `${base}/game/Pause.svg`, { width: 128, height: 128 });
    this.load.image('progress-bar', `${base}/game/Progress.png`);
    this.load.image('asset-line.png', `${base}/game/line.png`);
    this.loadAudio('grade-hit', `${base}/game/ending/GradeHit.wav`);

    this.loadAudio('4', this._respack.getHitSound('Drag'));
    this.loadAudio('3', this._respack.getHitSound('Flick'));
    this.loadAudio('2', this._respack.getHitSound('Tap'));
    this.loadAudio('1', this._respack.getHitSound('Tap'));

    this.load.image('4', this._respack.getNoteSkin('Drag'));
    this.load.image('4-hl', this._respack.getNoteSkin('DragHL'));
    this.load.image('3', this._respack.getNoteSkin('Flick'));
    this.load.image('3-hl', this._respack.getNoteSkin('FlickHL'));
    this.load.image('2', this._respack.getNoteSkin('HoldBody'));
    this.load.image('2-hl', this._respack.getNoteSkin('HoldBodyHL'));
    this.load.image('2-h', this._respack.getNoteSkin('HoldHead'));
    this.load.image('2-h-hl', this._respack.getNoteSkin('HoldHeadHL'));
    this.load.image('2-t', this._respack.getNoteSkin('HoldTail'));
    this.load.image('2-t-hl', this._respack.getNoteSkin('HoldTailHL'));
    this.load.image('1', this._respack.getNoteSkin('Tap'));
    this.load.image('1-hl', this._respack.getNoteSkin('TapHL'));

    this.load.image('grade-3', this._respack.getGrade('A'));
    this.load.image('grade-2', this._respack.getGrade('B'));
    this.load.image('grade-1', this._respack.getGrade('C'));
    this.load.image('grade-0', this._respack.getGrade('F'));
    this.load.image('grade-7', this._respack.getGrade('Phi'));
    this.load.image('grade-4', this._respack.getGrade('S'));
    this.load.image('grade-6', this._respack.getGrade('V-FC'));
    this.load.image('grade-5', this._respack.getGrade('V'));

    this._respack.fonts.forEach((font) => {
      this.load.font(font.name, font.file, font.type);
    });
    this._respack.bitmapFonts.forEach((font) => {
      this.load.bitmapFont(font.name, font.texture, font.descriptor);
    });

    assets.forEach((asset, i) => {
      const name = assetNames[i];
      const key = `asset-${name}`;
      if (assetTypes[i] === 0)
        if (name.toLowerCase().endsWith('.gif'))
          this._animatedAssets.push({ key, url: asset, isGif: true });
        else if (name.toLowerCase().endsWith('.apng'))
          this._animatedAssets.push({ key, url: asset, isGif: false });
        else this.load.image(key, asset);
      else if (assetTypes[i] === 1) this._audioAssets.push({ key, url: asset });
      else if (assetTypes[i] === 2) this.load.video(key, asset, true);
      else if (assetTypes[i] === 3) {
        const nameLower = name.toLowerCase();
        if (nameLower === 'extra.json') this._extraUrl = asset;
        else if (nameLower === 'line.csv') this._lineCsvUrl = asset;
        else console.log('To be implemented:', name);
        // TODO
      } else if (assetTypes[i] === 4)
        this._shaderAssets.push({
          key,
          url: asset,
        });
      else if (assetTypes[i] === 5) {
        const nameLower = name.toLowerCase();
        const fontType = nameLower.endsWith('.otf')
          ? 'opentype'
          : nameLower.endsWith('.woff2')
            ? 'woff2'
            : nameLower.endsWith('.woff')
              ? 'woff'
              : 'truetype';
        const id = `font-${crypto.randomUUID()}`;
        this.load.font(id, asset, fontType);
        this._fonts[name] = id;
      } else if (assetTypes[i] !== 6) console.log('Not supported:', name);
    });
  }

  create() {
    if (this._status === GameStatus.ERROR) return;
    const load = async () => {
      const { background, cropped } = await processIllustration(
        this._illustrationUrl,
        115 * this._data.preferences.backgroundBlur,
        this._data.preferences.backgroundLuminance,
      );
      this.load.image('illustration-background', background);
      this.load.image('illustration-cropped', cropped);
      // 打击特效 spritesheet：自动推断帧尺寸（换图后原 375x378 可能不匹配）
      const { spriteSheet, frameWidth, frameHeight, frameRate } = this._respack.getHitEffects();
      const { frameW, frameH } = await autoDetectFrameSize(spriteSheet, frameWidth, frameHeight);
      this.load.spritesheet('hit-effects', spriteSheet, {
        frameWidth: frameW,
        frameHeight: frameH,
      });
      this._hitEffectsFrameRate = frameRate;
      // 音乐是视频时用原生 HTMLAudioElement 流式播放，不走 Phaser load.audio（XHR 下载大文件 / 解码失败）
      if (!this._data.songIsVideo) {
        this.load.audio('song', await getAudio(this._songUrl));
      }
      await Promise.all([
        ...this._animatedAssets.map(async (asset) => {
          const spritesheet = await getSpritesheet(asset.url, asset.isGif);

          this.load.spritesheet(
            asset.key,
            spritesheet.spritesheet.toDataURL(),
            spritesheet.frameSize,
          );

          asset.frameCount = spritesheet.frameCount;
          asset.frameRate = spritesheet.frameRate;
          asset.repeat = spritesheet.repeat;
        }),
        ...this._audioAssets.map(async (asset) =>
          this.loadAudio(asset.key, await getAudio(asset.url)),
        ),
      ]);
      const chart = await loadChart(this._chartUrl);
      if (!chart) {
        this._status = GameStatus.ERROR;
        alert(m.error_failed_to_load_chart());
        return;
      }
      this._chart = chart;
      if (this._extraUrl) {
        console.log('extra.json exists.');
        const extra = await loadJson(this._extraUrl, 'extra.json');
        this._extra = extra;
        if (!this._extra) {
          this._status = GameStatus.ERROR;
          alert(m.error_failed_to_load({ name: 'extra.json' }));
          return;
        }
        this._extra.effects?.forEach((effect) => {
          if (effect.shader.startsWith('/')) {
            effect.shader = `asset-${effect.shader.slice(1)}`;
            // 外置 shader 未随谱面打包时，回退到随包发布的内置同名 shader
            // （如 Phigrim 谱面的 image_noise_pr.glsl，与内置 noise.glsl 同为屏幕噪点效果）
            if (!this._shaderAssets.some((a) => a.key === effect.shader)) {
              const shaderName = effect.shader.slice(6).replace(/\.glsl$/, '');
              this._shaderAssets.push({
                key: effect.shader,
                url: base + '/game/shaders/' + shaderName + '.glsl',
                fallback: true,
              });
            }
          } else {
            // 谱面可能已带 .glsl 后缀，避免拼成 chromatic.glsl.glsl
            const shaderName = effect.shader.endsWith('.glsl')
              ? effect.shader.slice(0, -5)
              : effect.shader;
            this._shaderAssets.push({
              key: `intsh-${shaderName}`,
              url: base + '/game/shaders/' + shaderName + '.glsl',
            });
            effect.shader = `intsh-${shaderName}`;
          }
        });
        await Promise.all(
          this._shaderAssets.map(async (asset) => {
            console.log('Loading shader: ', asset.url);
            if (asset.fallback) {
              // 内置回退必须真的存在才启用（download/loadText 不校验 HTTP 状态，404 会拿到 HTML 页面）
              try {
                const res = await fetch(asset.url);
                if (res.ok) asset.source = await res.text();
              } catch {
                /* 忽略：未发布同名内置 shader */
              }
              if (!asset.source) {
                console.warn(`内置 shader ${asset.key.slice(6)} 不可用，该特效将被跳过`);
              }
            } else {
              asset.source = await loadText(asset.url, asset.key);
            }
          }),
        );
      }
      if (this._lineCsvUrl) {
        const lineCsv = await loadText(this._lineCsvUrl, 'line.csv');
        if (lineCsv) {
          const [_header, ...rows] = getLines(lineCsv);
          const data = rows.map((row) => row.split(','));
          if (data.length > 0 && data[0].length >= 3) {
            data.forEach((row) => {
              const line = this._chart.judgeLineList.at(parseInt(row[1]));
              if (line) {
                line.Texture = row[2];
              }
            });
          }
        }
      }
      this._resultsMusic = this._respack.getResultsMusic(this._levelType);
      this.loadAudio('ending', this._resultsMusic.file);
      this.load.once('complete', async () => {
        // 动画需在 spritesheet 纹理加载完成后创建，否则帧解析为空导致播放崩溃
        this.createHitEffectsAnimation();
        this.createTextureAnimations();
        this.initializeChart();
        this.initializeShaders();
        this.preprocess();
        this.initializeHandlers();
        this.setupUI();
        this.createBackground();
        this.createAudio();
        await this.initializeVideos();
        this.sortObjects();
        if (this._autostart) {
          void this.start();
        } else {
          this._status = GameStatus.READY;
        }
        this._lines.forEach((line) => line.setVisible(true));
        if (this._adjustOffset) {
          EventBus.on('offset-adjusted', (offset: number) => {
            this._chart.META.offset = offset;
            this._offset = this._chart.META.offset;
          });
        }
        EventBus.emit('current-scene-ready', this);
      });
      this.load.start();
    };
    load();
  }

  loadAudio(key: string, url: string) {
    if (this._render) return;
    this.load.audio(key, url);
  }

  in() {
    this._gameUI.in();
    const targets = [...this._lines.map((l) => l.elements).flat(), ...(this._videos ?? [])];
    targets.forEach((target) => {
      target.alpha = 0;
    });
    this.tweens.add({
      targets,
      alpha: 1,
      duration: 1000,
      ease: 'Sine.easeOut',
    });
  }

  out(onComplete: () => void) {
    this._gameUI.out();
    this.tweens.add({
      targets: [...this._lines.map((l) => l.elements).flat(), ...(this._videos ?? [])],
      alpha: 0,
      duration: 1000,
      ease: 'Sine.easeIn',
      onComplete,
    });
  }

  resetShadersAndVideos() {
    this._shaders?.forEach((shader) => {
      if (!shader) return;
      const filterTarget = 'object' in shader.target ? shader.target.object : shader.target;
      filterTarget.filters?.external.clear();
    });
    this._videos?.forEach((video) => video.destroy());
  }

  async start(): Promise<boolean> {
    if (this._status === GameStatus.ERROR) return false;
    this.in();
    try {
      // 浏览器可能要求用户手势才能恢复 WebAudio；原生 HTMLAudio 的 play()
      // 也会在无痕/移动浏览器中返回 rejected Promise。
      const context = (this.sound as unknown as { context?: AudioContext }).context;
      if (context?.state === 'suspended') await context.resume();
      if (!this._render) {
        await new Promise<void>((resolve, reject) => {
          this._timeout = setTimeout(() => {
            this._clock.play().then(resolve).catch(reject);
          }, 1000 / this.tweens.timeScale);
        });
      }
    } catch (error) {
      clearTimeout(this._timeout);
      this._status = GameStatus.READY;
      EventBus.emit('audio-blocked', error);
      return false;
    }
    this._status = GameStatus.PLAYING;
    this.updateChart(this.beat, this.timeSec, Date.now());
    EventBus.emit('started');
    send({
      type: 'event',
      payload: {
        name: 'started',
      },
    });
    this.game.events.on('hidden', () => {
      this._visible = false;
      if (this._status !== GameStatus.FINISHED) this.pause();
    });
    this.game.events.on('visible', () => {
      this._visible = true;
    });
    this._song.on('complete', () => {
      this.end();
    });
    return true;
  }

  pause(emittedBySpace: boolean = false) {
    if (this._status === GameStatus.ERROR || !this._song.isPlaying) return;
    clearTimeout(this._timeout);
    this._status = GameStatus.PAUSED;
    if (!this._render) this._clock.pause();
    this._videos?.forEach((video) => video.pause());
    EventBus.emit('paused', emittedBySpace);
    send({
      type: 'event',
      payload: {
        name: 'paused',
      },
    });
    return true;
  }

  resume() {
    if (this._status === GameStatus.ERROR) return;
    this.updateChart(this.beat, this.timeSec, Date.now());
    this._status = GameStatus.PLAYING;
    if (!this._render) this._clock.resume();
    this._videos?.forEach((video) => video.resume());
    EventBus.emit('started');
    send({
      type: 'event',
      payload: {
        name: 'resumed',
      },
    });
  }

  async restart() {
    if (this._status === GameStatus.ERROR) return;
    this._status = GameStatus.LOADING;
    if (!this._render) this._clock.pause();
    this._pointerHandler?.reset();
    this._keyboardHandler?.reset();
    this._judgmentHandler.reset();
    this._clock.setSeek(0);
    this._resultsUI?.destroy();
    this._resultsUI = undefined;
    this.resetShadersAndVideos();
    this.initializeShaders();
    await this.initializeVideos();
    this.sortObjects();
    this.in();
    if (!this._render)
      this._timeout = setTimeout(() => {
        this._clock.play();
      }, 1000 / this.tweens.timeScale);
    this._status = GameStatus.PLAYING;
    EventBus.emit('started');
    send({
      type: 'event',
      payload: {
        name: 'restarted',
      },
    });
  }

  end() {
    if (this._status === GameStatus.ERROR) return;
    // 练习模式：播完不结算，改为停在暂停界面，玩家可继续跳转或主动退出。
    // 不能直接复用 pause()：歌曲已播完，isPlaying 为 false 会让它提前 return。
    if (this._practice) {
      if (this._status === GameStatus.PAUSED) return;
      clearTimeout(this._timeout);
      this._status = GameStatus.PAUSED;
      if (!this._render) this._clock.pause();
      this._videos?.forEach((video) => video.pause());
      EventBus.emit('paused', false);
      return;
    }
    this._status = GameStatus.FINISHED;
    this.out(() => {
      this.resetShadersAndVideos();
      this._resultsUI!.play();
      EventBus.emit('finished');
      send({
        type: 'event',
        payload: {
          name: 'finished',
        },
      });
    });
    this._resultsUI = new ResultsUI(
      this,
      this._resultsMusic,
      this._data.mediaOptions.resultsLoopsToRender,
    );
  }

  sortObjects() {
    this._objects.sort((a, b) => a.depth - b.depth);
  }

  setSeek(value: number) {
    this._isSeeking = true;
    this._clock.setSeek(value);
    this._videos?.forEach((video) => video.setSeek(value));
  }

  /* ---------------- 练习模式：A/B 点循环 ---------------- */

  /** 设置 A 点（循环起点）；传 null 清除。B 点在其之前时一并清除。 */
  setLoopA(value: number | null) {
    this._loopA = value;
    if (value !== null && this._loopB !== null && this._loopB <= value) this._loopB = null;
  }

  /** 设置 B 点（循环终点）；传 null 清除。A 点在其之后时一并清除。 */
  setLoopB(value: number | null) {
    this._loopB = value;
    if (value !== null && this._loopA !== null && this._loopA >= value) this._loopA = null;
  }

  clearLoop() {
    this._loopA = null;
    this._loopB = null;
  }

  public get loopA() {
    return this._loopA;
  }

  public get loopB() {
    return this._loopB;
  }

  /**
   * 越过 B 点时跳回 A 点。仅练习模式生效，在 update 的时间推进之后调用。
   * 判定与统计交由 updateChart 的「时间回退」分支自行重置。
   */
  private applyPracticeLoop() {
    if (!this._practice || this._loopA === null || this._loopB === null) return;
    if (this._status !== GameStatus.PLAYING) return;
    if (this.timeSec < this._loopB) return;
    this._judgmentHandler.reset();
    this._pointerHandler?.reset();
    this._keyboardHandler?.reset();
    this.setSeek(this._loopA);
  }

  update(time: number, delta: number) {
    if (
      !this._song ||
      this._status === GameStatus.DESTROYED ||
      this._status === GameStatus.ERROR ||
      this._status === GameStatus.LOADING
    ) {
      if (this._status === GameStatus.ERROR) {
        EventBus.emit('error');
        send({
          type: 'event',
          payload: {
            name: 'errored',
          },
        });
      }
      return;
    }
    if (!this._render) {
      this._clock.update();
      // 练习模式的 A/B 循环：紧跟时钟推进判断，越过 B 点即跳回 A 点
      this.applyPracticeLoop();
    }
    if (this._resultsUI) this._resultsUI.update();
    const status = this._status;
    if (this._isSeeking) this._status = GameStatus.SEEKING;
    this._pointerHandler?.update(delta);
    if (this._visible) {
      this._gameUI.update();
      this.positionBackground(this._background);
    }
    const realTimeSec = this.realTimeSec;
    this.report(time, realTimeSec);
    this.updateChart(this.beat, this.timeSec, time);
    this._judgmentHandler.update(this.beat);
    this.statistics.updateDisplay(delta);
    if (this._isSeeking) {
      this._status = status;
      this._isSeeking = false;
    }
  }

  report(gameTime: number, songTime: number) {
    EventBus.emit('update', songTime);
    if (!this._lastProgressUpdate || gameTime - this._lastProgressUpdate >= 100) {
      this._lastProgressUpdate = gameTime;
      send({
        type: 'event',
        payload: {
          name: 'progress',
          value: songTime,
        },
      });
    }
  }

  destroy() {
    this._status = GameStatus.DESTROYED;
    if (typeof (this._song as HtmlAudioSong).pause === 'function' && 'audioElement' in this._song) {
      (this._song as HtmlAudioSong).pause();
    } else {
      (this._song as { destroy?: () => void }).destroy?.();
    }
    this._lines.forEach((line) => line.destroy());
    this._gameUI.destroy();
    if (this._resultsUI) this._resultsUI.destroy();
  }

  updateChart(beat: number, songTime: number, gameTime: number) {
    if (this._status === GameStatus.FINISHED || this._status === GameStatus.DESTROYED) return;
    gameTime *= this._timeScale;
    const forceFullNoteUpdate =
      this._isSeeking ||
      this._lastChartSongTime === undefined ||
      songTime + 0.05 < this._lastChartSongTime;
    if (forceFullNoteUpdate) this.resetActiveNoteWindows();
    this._lines.forEach((line) => line.update(beat, songTime, gameTime, forceFullNoteUpdate));
    if (forceFullNoteUpdate) {
      this._notes.forEach((note) => note.updateJudgment(beat, songTime));
    } else {
      this.updateActiveJudgmentNotes(beat, songTime);
    }
    this._lastChartSongTime = songTime;
    this._shaders?.forEach((shader) => {
      if (!shader) return;
      shader.filter.detach(beat);
    });
    this._shaders?.forEach((shader) => {
      if (!shader) return;
      shader.filter.update(beat, songTime);
    });
    this._videos?.forEach((video) => video.update(beat, songTime));
  }

  createAudio() {
    this.sound.pauseOnBlur = false;
    if (this._data.songIsVideo) {
      // 音乐是视频：原生 HTMLAudioElement 流式播放（WebAudio 无法解码视频容器）
      this._song = new HtmlAudioSong(this._songUrl);
      this._song.setVolume(this._data.preferences.musicVolume);
      this._clock = new Clock(
        this._song,
        { rate: 1 },
        () => this._status === GameStatus.FINISHED || this.end(),
      );
    } else {
      this._song = this.sound.add('song');
      this._song.setVolume(this._data.preferences.musicVolume);
      this._clock = new Clock(
        this._song,
        this.sound,
        () => this._status === GameStatus.FINISHED || this.end(),
      );
    }
    if (!this._render) this.timeScale = this._data.preferences.timeScale;
  }

  createBackground() {
    EventBus.emit('loading-detail', m.drawing_background());
    this._background = new GameObjects.Image(
      this,
      this.sys.canvas.width / 2,
      this.sys.canvas.height / 2,
      'illustration-background',
    ).setDepth(0);
    this.registerNode(this._background, 'illustration');
    this.positionBackground(this._background);
  }

  positionBackground(
    object: GameObjects.Image | GameObjects.Video | GameObjects.Rectangle,
    mode: 'envelop' | 'fit' | 'stretch' = 'envelop',
    refWidth?: number,
    refHeight?: number,
    scaleOnly = false,
  ) {
    if (!scaleOnly) object.setPosition(this.sys.canvas.width / 2, this.sys.canvas.height / 2);
    refWidth ??= this.sys.canvas.width;
    refHeight ??= this.sys.canvas.height;
    const dimensions =
      mode !== 'stretch'
        ? fit(object.displayWidth, object.displayHeight, refWidth, refHeight, mode === 'fit')
        : { width: refWidth, height: refHeight };
    object.displayWidth = dimensions.width;
    object.displayHeight = dimensions.height;
  }

  initializeChart() {
    EventBus.emit('loading-detail', m.initializing_chart());
    const chart = this._chart;
    this._offset =
      chart.META.offset + (this._adjustOffset ? 0 : this._data.preferences.chartOffset);
    this._bpmList = chart.BPMList;
    // PRPR 谱面（chart 可能没有 BPMList），从 extra.json 兜底（bpm 支持单值或列表）
    if (this._bpmList.length === 0 && this._extra?.bpm) {
      if (typeof this._extra.bpm === 'number') {
        this._bpmList = [
          { bpm: this._extra.bpm, startTime: [0, 0, 0], startBeat: 0, startTimeSec: 0 },
        ];
      } else {
        this._bpmList = this._extra.bpm.map((item) => ({
          bpm: item.bpm,
          startTime: item.time,
          startBeat: 0,
          startTimeSec: 0,
        }));
      }
    }

    if (!this._title) this._title = chart.META.name;
    if (!this._composer) this._composer = chart.META.composer;
    if (!this._charter) this._charter = chart.META.charter;
    if (!this._illustrator) this._illustrator = chart.META.illustration ?? null;
    if (!this._level) {
      this._level = chart.META.level;
      this._levelType = inferLevelType(chart.META.level);
    }

    EventBus.emit('metadata', {
      title: this._title,
      composer: this._composer,
      charter: this._charter,
      illustrator: this._illustrator,
      levelType: this._levelType,
      level: this._level,
    });

    let lastBpm = 0;
    let lastBeat = 0;
    let lastTimeSec = 0;
    this._bpmList.forEach((bpm, i) => {
      bpm.startBeat = toBeats(bpm.startTime);
      bpm.startTimeSec =
        i === 0 ? lastTimeSec : lastTimeSec + ((bpm.startBeat - lastBeat) / lastBpm) * 60;
      lastBpm = bpm.bpm;
      lastBeat = bpm.startBeat;
      lastTimeSec = bpm.startTimeSec;
    });

    const precedences = calculatePrecedences(this._chart.judgeLineList.map((data) => data.zOrder));
    const moments = this._data.preferences.simultaneousNoteHint
      ? findHighlightMoments(this._chart.judgeLineList.map((line) => line.notes ?? []).flat())
      : [];
    this._lines = this._chart.judgeLineList.map(
      (data, i) => new Line(this, data, i, precedences.get(data.zOrder)!, moments),
    );
  }

  preprocess() {
    EventBus.emit('loading-detail', m.preprocessing_chart());
    const notes = this._lines
      .map((line) => line.notes)
      .flat()
      .sort((a, b) => a.note.startBeat - b.note.startBeat);
    this._notes = notes
      .filter((note) => !note.note.isFake)
      .sort((a, b) =>
        a.note.startBeat === b.note.startBeat
          ? a.note.type - b.note.type
          : a.note.startBeat - b.note.startBeat,
      );
    this._judgmentNotesByStart = [...this._notes].sort(
      (a, b) => this.getNoteJudgmentStartTime(a) - this.getNoteJudgmentStartTime(b),
    );
    this._numberOfNotes = this._notes.length;
    this._lines
      .filter((line) => line.data.father != -1)
      .forEach((line) => {
        const father = this._lines[line.data.father];
        line.setParent(father);
      });
  }

  resetActiveNoteWindows() {
    this._lines.forEach((line) => line.resetActiveNoteWindow());
    this._judgmentNoteIndex = 0;
    this._activeJudgmentNotes = [];
  }

  updateActiveJudgmentNotes(beat: number, songTime: number) {
    while (
      this._judgmentNoteIndex < this._judgmentNotesByStart.length &&
      this.getNoteJudgmentStartTime(this._judgmentNotesByStart[this._judgmentNoteIndex]) <= songTime
    ) {
      const note = this._judgmentNotesByStart[this._judgmentNoteIndex++];
      if (this.getNoteJudgmentEndTime(note) >= songTime) {
        this._activeJudgmentNotes.push(note);
      }
    }

    for (let i = this._activeJudgmentNotes.length - 1; i >= 0; i--) {
      const note = this._activeJudgmentNotes[i];
      if (this.getNoteJudgmentEndTime(note) < songTime) {
        this._activeJudgmentNotes.splice(i, 1);
        continue;
      }
      note.updateJudgment(beat, songTime);
    }
  }

  private getNoteJudgmentStartTime(note: PlainNote | LongNote) {
    return note.hitTime - (this.preferences.goodJudgment * 1.125) / 1000;
  }

  private getNoteJudgmentEndTime(note: PlainNote | LongNote) {
    const endTime = note.note.type === 2 ? (note as LongNote).endHitTime : note.hitTime;
    return (
      endTime +
      (note.note.type === 2
        ? HOLD_TAIL_TOLERANCE / 1000
        : (this.preferences.goodJudgment * 1.125) / 1000) +
      JUDGMENT_END_GRACE_SEC
    );
  }

  initializeHandlers() {
    EventBus.emit('loading-detail', m.initializing_handlers());
    if (!this._render) {
      this._pointerHandler = new PointerHandler(this);
      this._keyboardHandler = new KeyboardHandler(this);
    }
    this._judgmentHandler = new JudgmentHandler(this);
    this._statisticsHandler = new StatisticsHandler(this);
  }

  setupUI() {
    EventBus.emit('loading-detail', m.setting_up_ui());
    this._gameUI = new GameUI(this);
  }

  createHitEffectsAnimation() {
    EventBus.emit('loading-detail', m.initializing_hit_effects());
    this.anims.create({
      key: 'hit-effects',
      frames: 'hit-effects',
      frameRate: this._hitEffectsFrameRate,
      repeat: 0,
    });
  }

  createTextureAnimations() {
    this._animatedAssets.forEach((asset) => {
      this.anims.create({
        key: asset.key,
        frames: this.anims.generateFrameNumbers(asset.key, {
          start: 0,
          end: asset.frameCount ? asset.frameCount - 1 : 0,
        }),
        frameRate: asset.frameRate,
        repeat: asset.repeat,
      });
    });
  }

  initializeShaders() {
    if (!this._extra) return;

    EventBus.emit('loading-detail', m.initializing_shaders());
    const missing: string[] = [];
    this._shaders = this._extra.effects?.map((effect, i) => {
      const asset = this._shaderAssets.find((asset) => asset.key === effect.shader);
      // 缺失或回退加载失败：不阻塞游玩，跳过该特效并仅记录警告
      if (!asset || !asset.source) {
        if (!missing.includes(effect.shader)) {
          missing.push(effect.shader);
          console.warn(m.error_shader_not_found({ name: effect.shader.slice(6) }));
        }
        return undefined;
      }
      const key = `sh-${effect.shader.slice(6)}-${i}`;
      if (!('renderNodes' in this.renderer)) {
        alert(m.error_shader_unavailable());
        return undefined;
      }
      let target: Cameras.Scene2D.Camera | ShaderNode;
      let filterTarget: Cameras.Scene2D.Camera | GameObjects.Layer;
      if (effect.global) {
        target = this.cameras.main;
        filterTarget = this.cameras.main;
      } else {
        if (!effect.targetRange) {
          effect.targetRange = {
            minZIndex: 0,
            maxZIndex: 8,
            exclusive: false,
          };
        }
        const shaderNode = this.registerShaderNode(
          new GameObjects.Layer(this),
          effect.targetRange.minZIndex,
          effect.targetRange.maxZIndex,
          key,
        );
        target = shaderNode;
        filterTarget = shaderNode.object;
      }
      const camera =
        filterTarget instanceof Cameras.Scene2D.Camera ? filterTarget : this.cameras.main;
      const filter = new ShaderFilter(
        camera,
        key,
        this,
        asset.source!,
        effect,
        target instanceof Cameras.Scene2D.Camera ? undefined : target,
      );
      if (filterTarget instanceof Cameras.Scene2D.Camera) {
        filterTarget.filters.external.add(filter);
      } else {
        filterTarget.enableFilters();
        filterTarget.filters!.external.add(filter);
      }
      return { key, effect, target, filter };
    });
  }

  async initializeVideos() {
    if (!this._extra?.videos || this._extra.videos.length === 0) return;

    EventBus.emit('loading-detail', m.initializing_videos());

    const signal = new Signal(this._extra.videos.length);
    const callback = (errorMsg?: string, exception?: DOMException | string) => {
      signal.emit();
      if (errorMsg) {
        // 视频加载失败不打断游戏：仅控制台记录，静默降级为曲绘背景
        console.error(errorMsg, exception ?? '');
      }
    };
    this._videos = this._extra.videos.map((data) => new Video(this, data, callback));
    // 视频不可用（404 / 格式不支持 / 加载超时）时不阻塞游戏启动
    await Promise.race([
      signal.wait(),
      new Promise((resolve) => setTimeout(resolve, 10000)),
    ]);
  }

  async updateVideoTicks(timeSec?: number) {
    if (!this._videos) return;
    timeSec ??= this.timeSec;
    await Promise.all(this._videos.map((video) => video.tick(timeSec)));
  }

  registerNode(object: GameObject, name: string) {
    this.add.existing(object);
    const entry = new Node(name, object, object.depth, ROOT);
    this._objects.push(entry);
    return entry;
  }

  registerShaderNode(
    object: GameObjects.Layer,
    lowerDepth: number,
    upperDepth: number,
    name: string,
  ) {
    object.setDepth(lowerDepth);
    this.add.existing(object);
    const entry = new ShaderNode(name, object, lowerDepth, upperDepth, ROOT);
    this._objects.push(entry);
    return entry;
  }

  getFont(name: string | undefined) {
    return name ? this._fonts[name] : this._respack.fonts[0].name;
  }

  getBeat(songTime: number) {
    if (this._bpmIndex > 0 && songTime < this._bpmList[this._bpmIndex].startTimeSec) {
      this._bpmIndex = 0;
    }
    while (
      this._bpmIndex < this._bpmList.length - 1 &&
      songTime >= this._bpmList[this._bpmIndex + 1].startTimeSec
    ) {
      this._bpmIndex++;
    }
    const curBpm = this._bpmList[this._bpmIndex];
    return curBpm.startBeat + ((songTime - curBpm.startTimeSec) / 60) * curBpm.bpm;
  }

  getTimeSec(realTimeSec?: number) {
    realTimeSec ??= this.realTimeSec;
    return realTimeSec - this._offset / 1000;
  }

  w(width: number) {
    return (width / 1350) * this.sys.canvas.width + this.sys.canvas.width / 2;
  }

  p(position: number) {
    return (position / 1350) * this.sys.canvas.width;
  }

  h(height: number) {
    return (-height / 900) * this.sys.canvas.height + this.sys.canvas.height / 2;
  }

  o(offset: number) {
    return (offset / 900) * this.sys.canvas.height;
  }

  d(distance: number) {
    return (distance * this.sys.canvas.height * 2) / 15;
  }

  public set timeScale(value: number) {
    this._timeScale = value;
    if (this._autoplay) {
      this.sound.setRate(value);
      this._clock.setRate(value);
      this.anims.globalTimeScale = value;
      this.tweens.timeScale = value;
      this._clock.sync();
    } else {
      this._clock.setRate(value);
    }
  }

  public get gameUI() {
    return this._gameUI;
  }

  public get resultsUI() {
    return this._resultsUI;
  }

  public get clock() {
    return this._clock;
  }

  public get pointer() {
    return this._pointerHandler;
  }

  public get keyboard() {
    return this._keyboardHandler;
  }

  public get judgment() {
    return this._judgmentHandler;
  }

  public get statistics() {
    return this._statisticsHandler;
  }

  public get respack() {
    return this._respack;
  }

  public get lines() {
    return this._lines;
  }

  public get notes() {
    return this._notes;
  }

  public get numberOfNotes() {
    return this._numberOfNotes;
  }

  public get metadata() {
    return {
      title: this._title,
      composer: this._composer,
      charter: this._charter,
      illustrator: this._illustrator,
      levelType: this._levelType,
      level: this._level,
    };
  }

  public get preferences() {
    return this._data.preferences;
  }

  public get resources() {
    return this._data.resources;
  }

  public get mediaOptions() {
    return this._data.mediaOptions;
  }

  public get audioAssets() {
    return this._audioAssets;
  }

  public get beat() {
    return this.getBeat(this.timeSec);
  }

  public get timeSec() {
    return this.realTimeSec - this._offset / 1000;
  }

  public get realTimeSec() {
    return this._status === GameStatus.FINISHED ? this._song.duration : this._clock.seek;
  }

  public get bpm() {
    return this._bpmList[this._bpmIndex].bpm;
  }

  public get bpmList() {
    return this._bpmList;
  }

  public get offset() {
    return this._offset;
  }

  public get chart() {
    return this._chart;
  }

  public get song() {
    return this._song;
  }

  public get songUrl() {
    return this._songUrl;
  }

  public get status() {
    return this._status;
  }

  public get skinSize() {
    if (!this._skinSize) {
      this._skinSize = this.textures.get('1').getSourceImage().width;
    }
    return this._skinSize;
  }

  public get timeScale() {
    return this._timeScale;
  }

  public get autoplay() {
    return this._autoplay;
  }

  public get practice() {
    return this._practice;
  }

  public get adjustOffset() {
    return this._adjustOffset;
  }

  public get render() {
    return this._render;
  }

  public get objects() {
    return this._objects;
  }
}
