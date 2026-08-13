/*
 * HTML Audio 适配器：当谱面音乐是视频文件（mp4/webm 等）时，
 * 用原生 HTMLAudioElement 流式播放（WebAudio 无法解码视频容器，
 * Phaser HTML5AudioFile 又会 XHR 下载整文件导致大文件崩溃）。
 * 实现与 Clock 兼容的接口。
 */
export class HtmlAudioSong {
  private _audio: HTMLAudioElement;
  private _endedCallbacks: (() => void)[] = [];

  constructor(url: string) {
    this._audio = new Audio();
    this._audio.preload = 'auto';
    this._audio.crossOrigin = 'anonymous';
    this._audio.src = url;
    this._audio.addEventListener('ended', () => {
      this._endedCallbacks.forEach((cb) => cb());
    });
  }

  play() {
    this._audio.play().catch(() => {});
  }

  pause() {
    this._audio.pause();
  }

  resume() {
    this._audio.play().catch(() => {});
  }

  setSeek(time: number) {
    this._audio.currentTime = time;
  }

  setRate(rate: number) {
    this._audio.playbackRate = rate;
  }

  setVolume(volume: number) {
    this._audio.volume = volume;
  }

  on(event: string, callback: () => void) {
    if (event === 'complete') {
      this._endedCallbacks.push(callback);
    }
    return this;
  }

  get seek() {
    return this._audio.currentTime;
  }

  get isPlaying() {
    return !this._audio.paused;
  }

  get rate() {
    return this._audio.playbackRate;
  }

  get duration() {
    return Number.isFinite(this._audio.duration) ? this._audio.duration : 0;
  }

  get audioElement() {
    return this._audio;
  }
}

export type SongLike = HtmlAudioSong | {
  play(): unknown;
  pause(): unknown;
  resume(): unknown;
  setSeek(time: number): unknown;
  setRate(rate: number): unknown;
  setVolume(volume: number): unknown;
  on(event: string, cb: () => void): unknown;
  seek: number;
  isPlaying: boolean;
  rate: number;
  duration: number;
};
