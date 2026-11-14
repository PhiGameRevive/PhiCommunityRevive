<script lang="ts">
	import { onMount, tick } from 'svelte';
	import Player from '$lib/player/Player.svelte';
	import { EventBus } from '$lib/player/EventBus';
	import type { Game as GameScene } from '$lib/player/scenes/Game';
	import { preparePlay, resolvePlaySource, type PreparedPlay } from '$lib/playLoader';
	import { loadPreferences } from '$lib/preferences';
	import { GameStatus, type Config } from '$lib/types';
	import type { StoryReceipt, StoryTrack } from './types';

	export let track: StoryTrack;
	export let volume = 0.6;
	export let oncomplete: (receipt: StoryReceipt) => void;
	export let oncancel: () => void;
	export let ontick: ((seconds: number) => void) | undefined = undefined;

	type Mode = Exclude<StoryReceipt['mode'], 'summary'>;
	type Phase = 'choose' | 'loading' | 'listen' | 'player' | 'finished' | 'error';
	const modes: { id: Mode; name: string; description: string }[] = [
		{ id: 'manual', name: '手动演奏', description: '亲手接住音符 · 失误不会中断故事' },
		{ id: 'auto', name: '自动伴奏', description: '由自动演奏接住全部音符 · 所有谱面均可使用' },
		{ id: 'listen', name: '纯聆听', description: '只播放音乐 · 可随时暂停、拖动或跳过' },
	];
	let mode: Mode = 'listen';
	let phase: Phase = 'choose';
	let config: Config | null = null;
	let prepared: PreparedPlay | null = null;
	let gameRef: { game: import('phaser').Game | null; scene: GameScene | null } = { game: null, scene: null };
	let audio: HTMLAudioElement | undefined;
	let audioUrl = '';
	let detail = '';
	let error = '';
	let progress = 0;
	let seconds = 0;
	let sought = false;
	let receipt: StoryReceipt | null = null;
	let mounted = false;
	let delivered = false;
	let request: AbortController | null = null;
	let loadTimer: ReturnType<typeof setTimeout> | undefined;
	let lastSample: { wall: number; media: number; rate: number; playing: boolean } | null = null;
	let lastPosition: { wall: number; media: number } | null = null;
	let detachEngine: (() => void) | null = null;
	let audioPlaying = false;
	let activeTrack = track.id;

	$: if (mounted && activeTrack !== track.id) {
		activeTrack = track.id;
		releaseRun();
		delivered = false;
		phase = 'choose';
		receipt = null;
		seconds = 0;
		sought = false;
		error = '';
		detail = '';
	}

	$: safeVolume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.6;
	$: if (audio) audio.volume = safeVolume;
	$: if (config) {
		// 仅修改本次 Config 的副本，不写入玩家的全局音量偏好。
		config.preferences.musicVolume = safeVolume;
		config.preferences.hitSoundVolume = safeVolume * 0.75;
		gameRef.scene?.song?.setVolume(safeVolume);
	}

	const formatTime = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
	const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
	const current = (controller: AbortController) => mounted && !delivered && request === controller && !controller.signal.aborted;

	/** 只接纳前台、连续播放的短片段；媒体地址的变化不能变成游玩时长。 */
	function sample() {
		if (!mounted || delivered || (phase !== 'listen' && phase !== 'player')) {
			resetClock();
			return;
		}
		const scene = gameRef.scene;
		const song = scene?.song;
		const media = mode === 'listen' ? audio?.currentTime : song?.seek;
		const rate = mode === 'listen' ? audio?.playbackRate : scene?.timeScale;
		const playing =
			mounted &&
			!delivered &&
			document.visibilityState === 'visible' &&
			(mode === 'listen'
				? phase === 'listen' && audioPlaying && !!audio && !audio.paused && !audio.ended && !audio.seeking && audio.readyState >= 3
				: phase === 'player' && scene?.status === GameStatus.PLAYING && !!song?.isPlaying && !scene.fastForwarding);
		const now = performance.now();
		if (media === undefined || !Number.isFinite(media) || !rate || !Number.isFinite(rate)) {
			lastSample = null;
			return;
		}
		const previous = lastSample;
		lastSample = { wall: now, media, rate, playing };
		// 暂停寻址 / AT 快进不会留下连续播放样本，单独观察位置变化。
		if (lastPosition && media - lastPosition.media > ((now - lastPosition.wall) / 1000) * rate + 0.35) sought = true;
		if (scene?.fastForwarding) sought = true;
		lastPosition = { wall: now, media };
		if (!previous) return;
		const wall = (now - previous.wall) / 1000;
		const advance = media - previous.media;
		// 前台发生跳跃时明确降为摘要回执；暂停恢复的引擎回退不冒充播放。
		if (previous.playing && advance > wall * rate + 0.35) sought = true;
		if (!playing || !previous.playing || wall <= 0 || wall > 2 || rate !== previous.rate || advance <= 0 || advance > wall * rate + 0.35) return;
		const elapsed = Math.min(wall, advance / rate);
		seconds += elapsed;
		ontick?.(elapsed);
	}

	function resetClock() {
		lastSample = null;
	}

	function stopAudio() {
		audioPlaying = false;
		if (audio) {
			audio.pause();
			audio.removeAttribute('src');
			audio.load();
		}
		audioUrl = '';
	}

	/** 子组件先销毁 Phaser，再释放它正在使用的 blob；迟到的 prepare 另行释放。 */
	function releaseRun() {
		request?.abort();
		request = null;
		clearTimeout(loadTimer);
		detachEngine?.();
		detachEngine = null;
		resetClock();
		lastPosition = null;
		stopAudio();
		const resource = prepared;
		prepared = null;
		config = null;
		void tick().then(() => resource?.release());
	}

	function fail(cause: unknown) {
		if (!mounted || delivered || phase === 'finished' || phase === 'error') return;
		error = message(cause);
		phase = 'error';
		releaseRun();
	}

	function finish() {
		if (!mounted || delivered || receipt || (phase !== 'player' && phase !== 'listen')) return;
		// 不使用谱面标称时长、seek 目标或结算成绩推算秒数。
		receipt = { track: track.id, mode: sought ? 'summary' : mode, seconds };
		phase = 'finished';
		releaseRun();
	}

	function complete(summary = false) {
		if (!mounted || delivered) return;
		if (summary) sample();
		const result: StoryReceipt | null = summary ? { track: track.id, mode: 'summary', seconds } : receipt;
		if (!result) return;
		delivered = true;
		releaseRun();
		oncomplete(result);
	}

	function cancel() {
		if (delivered) return;
		delivered = true;
		releaseRun();
		oncancel();
	}

	function attachEngine(controller: AbortController) {
		// 所有订阅均使用同一函数引用成对移除，不能清空全局事件。
		const onFinished = () => {
			if (current(controller) && gameRef.scene?.status === GameStatus.FINISHED) finish();
		};
		const onError = (cause?: unknown) => {
			if (current(controller)) fail(cause ?? '谱面引擎加载或解码失败。可重试、改为纯聆听，或阅读摘要继续。');
		};
		const onLoading = (value: number) => {
			if (current(controller)) progress = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
		};
		const onDetail = (value: string) => {
			if (current(controller)) detail = value;
		};
		const onStarted = () => {
			if (!current(controller)) return;
			clearTimeout(loadTimer);
			detail = '';
			resetClock();
		};
		const onBlocked = () => {
			if (!current(controller)) return;
			clearTimeout(loadTimer);
			detail = '浏览器需要一次点击，请点击演奏区内的“点击播放”。';
			resetClock();
		};
		const onFailed = () => {
			if (current(controller)) fail('本次演奏已中断。可以重试，或使用自动伴奏、纯聆听继续故事。');
		};
		EventBus.on('finished', onFinished);
		EventBus.on('error', onError);
		EventBus.on('loading', onLoading);
		EventBus.on('loading-detail', onDetail);
		EventBus.on('started', onStarted);
		EventBus.on('paused', resetClock);
		EventBus.on('audio-blocked', onBlocked);
		EventBus.on('failed', onFailed);
		detachEngine = () => {
			EventBus.off('finished', onFinished);
			EventBus.off('error', onError);
			EventBus.off('loading', onLoading);
			EventBus.off('loading-detail', onDetail);
			EventBus.off('started', onStarted);
			EventBus.off('paused', resetClock);
			EventBus.off('audio-blocked', onBlocked);
			EventBus.off('failed', onFailed);
		};
	}

	async function start(nextMode: Mode) {
		if (!mounted || delivered) return;
		releaseRun();
		const controller = new AbortController();
		request = controller;
		mode = nextMode;
		phase = 'loading';
		error = '';
		seconds = 0;
		sought = false;
		receipt = null;
		progress = 0;
		detail = '正在解析远端曲目地址…首次下载可能需要一些时间。';
		loadTimer = setTimeout(() => {
			if (current(controller)) fail('加载超过 60 秒，请检查网络或谱面源后重试；也可以跳过音乐，阅读摘要。');
		}, 60_000);
		try {
			// 先让上一次 Player 完成卸载，避免新旧 Phaser 共享同一容器。
			await tick();
			if (!current(controller)) return;
			gameRef = { game: null, scene: null };
			// resolvePlaySource 尚无 signal 参数；返回后检查本次请求是否仍有效。
			const source = await resolvePlaySource(track.codename, track.level);
			if (!current(controller)) return;
			if (nextMode === 'listen') {
				if (!source.songUrl) throw new Error('曲目源没有提供可直接播放的音乐地址。请尝试自动伴奏，或阅读摘要继续。');
				audioUrl = source.songUrl;
				phase = 'listen';
				detail = '正在加载音乐…准备好后可使用下方播放器播放。';
				return;
			}
			const result = await preparePlay(
				source,
				track.level,
				{
					...loadPreferences(),
					musicVolume: safeVolume,
					hitSoundVolume: safeVolume * 0.75,
					timeScale: 1,
					earlyFinish: false,
				},
				{
					preloadResources: true,
					signal: controller.signal,
					// AT 才是 autoplay；NF 只保护手动演奏，不自动判定音符。
					mods: nextMode === 'auto' ? ['AT'] : ['NF'],
					onProgress: (value, text) => {
						if (!current(controller)) return;
						progress = value;
						detail = text;
					},
				},
			);
			if (!current(controller)) {
				result.release();
				return;
			}
			prepared = result;
			attachEngine(controller);
			config = result.config;
			phase = 'player';
			detail = '正在初始化演奏与音频资源…';
		} catch (cause) {
			if (current(controller)) fail(cause);
		}
	}

	function audioReady() {
		if (phase !== 'listen') return;
		clearTimeout(loadTimer);
		detail = audio?.paused ? '音乐已就绪 · 点击播放即可聆听。' : '';
	}

	function audioError() {
		if (phase !== 'listen') return;
		const reasons: Record<number, string> = {
			1: '音乐加载被中止',
			2: '音乐下载失败，请检查网络与远端资源是否可用',
			3: '浏览器无法解码这份音乐文件',
			4: '音乐格式不受浏览器支持，或远端音乐地址不可用',
		};
		fail(`${reasons[audio?.error?.code ?? 0] ?? '音乐无法播放'}${audio?.error?.message ? `：${audio.error.message}` : ''}。可以重试或阅读摘要继续。`);
	}

	function audioEnded() {
		finish();
		if (receipt) complete();
	}

	onMount(() => {
		mounted = true;
		const interval = setInterval(sample, 250);
		const visibility = () => {
			resetClock();
			if (document.visibilityState !== 'visible') {
				audio?.pause();
				if (phase === 'player') gameRef.scene?.pause();
			}
		};
		document.addEventListener('visibilitychange', visibility);
		return () => {
			mounted = false;
			clearInterval(interval);
			document.removeEventListener('visibilitychange', visibility);
			releaseRun();
		};
	});
</script>

<section class="performance" aria-label={`${track.name} · 故事演奏`}>
	<header>
		<p class="eyebrow">余页 / MUSIC</p>
		<h2>{track.name}</h2>
		<p class="credit">{track.artist} <span aria-hidden="true">／</span> {track.difficulty}</p>
	</header>

	{#if phase === 'choose' || phase === 'error'}
		<div class="modes" aria-label="选择演奏方式">
			{#each modes as item}
				<button class="mode" onclick={() => start(item.id)}>
					<strong>{item.name}</strong><span>{item.description}</span>
				</button>
			{/each}
		</div>
	{/if}

	{#if phase === 'loading'}
		<div class="loading" role="status">
			<p>{detail}</p>
			<progress max="1" value={progress} aria-label="曲目下载进度"></progress>
			<small>下载与等待不会计入有效播放时间。</small>
		</div>
	{:else if phase === 'listen'}
		<div class="audio-panel">
			<div class="disc" aria-hidden="true"><span>余</span></div>
			<p role="status">{detail || '正在聆听'}</p>
			<audio
				bind:this={audio}
				src={audioUrl}
				controls
				preload="auto"
				oncanplay={audioReady}
				onplaying={() => {
					audioPlaying = true;
					detail = '';
					clearTimeout(loadTimer);
					resetClock();
				}}
				onpause={() => {
					audioPlaying = false;
					detail = '已暂停 · 可以继续播放或阅读摘要。';
					resetClock();
				}}
				onwaiting={() => {
					audioPlaying = false;
					detail = '正在缓冲音乐…';
					resetClock();
				}}
				onseeking={() => {
					sought = true;
					resetClock();
				}}
				onseeked={resetClock}
				onratechange={resetClock}
				onended={audioEnded}
				onerror={audioError}
			></audio>
			<p class="hint">可自由暂停、拖动进度。跳过的部分不计时；拖动后以「摘要」回到故事，不标记为完整聆听。</p>
		</div>
	{:else if phase === 'player' && config}
		<div class="stage">
			<Player {config} {gameRef} recorded={false} mods={mode === 'auto' ? ['AT'] : ['NF']} scoreMultiplier={0} onExit={cancel} />
			<div class="stage-tools">
				<span>{mode === 'auto' ? '自动伴奏' : '手动演奏'} · 有效 {formatTime(seconds)}</span>
				<button onclick={() => complete(true)}>跳过 · 读摘要</button>
				<button onclick={cancel}>返回故事</button>
			</div>
			{#if detail}<p class="stage-status" role="status">{detail}</p>{/if}
		</div>
	{:else if phase === 'finished'}
		<div class="finished" role="status">
			<p>{receipt?.mode === 'summary' ? '已到曲尾 · 本次包含进度跳转，以摘要继续。' : '余音落定。可以回到故事了。'}</p>
			<p>有效播放 {formatTime(seconds)}</p>
			<button class="primary" onclick={() => complete()}>返回剧情</button>
		</div>
	{:else if phase === 'error'}
		<div class="error" role="alert">
			<p>暂时无法演奏《{track.name}》</p>
			<p>{error}</p>
			<button onclick={() => start(mode)}>重试{modes.find((item) => item.id === mode)?.name}</button>
		</div>
	{/if}

	{#if phase !== 'player' && phase !== 'finished'}
		<footer>
			<button onclick={cancel}>返回故事</button>
			<button onclick={() => complete(true)}>跳过音乐 · 阅读摘要</button>
		</footer>
	{/if}
	<p class="footnote">故事演奏不保存高分或回放。有效时间只计前台实际播放；暂停、快进与进度拖动不会补算时长，跳过或向前寻址以摘要继续。</p>
</section>

<style>
	.performance {
		width: min(100%, 52rem);
		margin-inline: auto;
		padding: clamp(1rem, 4vw, 2.5rem);
		box-sizing: border-box;
		color: #eeeae2;
		background: #151515;
		border: 1px solid #666;
	}
	.eyebrow {
		margin: 0 0 1.2rem;
		font-size: 0.7rem;
		letter-spacing: 0.25em;
		color: #bcb8b0;
	}
	h2 {
		margin: 0;
		font-family: Georgia, 'Noto Serif SC', serif;
		font-size: clamp(1.5rem, 5vw, 2.4rem);
		font-weight: 400;
		overflow-wrap: anywhere;
	}
	.credit {
		color: #c3bfb7;
		font-size: 0.9rem;
		line-height: 1.6;
	}
	.credit span {
		margin: 0 0.6rem;
	}
	.modes {
		display: grid;
		gap: 0.75rem;
		margin-block: 1.8rem;
	}
	button {
		min-height: 44px;
		padding: 0.7rem 1rem;
		border: 1px solid #8b8881;
		border-radius: 2px;
		font: inherit;
		color: inherit;
		background: #1b1b1b;
		cursor: pointer;
	}
	button:hover {
		background: #343434;
	}
	button:focus-visible {
		outline: 2px solid #fff;
		outline-offset: 4px;
	}
	.mode {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.55rem 1rem;
		text-align: left;
	}
	.mode strong {
		font-weight: 500;
		white-space: nowrap;
	}
	.mode span {
		color: #c3bfb7;
		font-size: 0.85rem;
		line-height: 1.6;
	}
	.audio-panel {
		padding-block: 1.5rem;
		text-align: center;
	}
	.disc {
		display: grid;
		place-items: center;
		width: 7rem;
		aspect-ratio: 1;
		margin: 0 auto 1.5rem;
		border: 1px solid #999;
		border-radius: 50%;
		background: repeating-radial-gradient(circle, #191919 0 3px, #292929 4px 5px);
	}
	.disc span {
		display: grid;
		place-items: center;
		width: 2.5rem;
		aspect-ratio: 1;
		border-radius: 50%;
		color: #111;
		background: #ddd9cf;
		font-family: serif;
	}
	audio {
		display: block;
		width: 100%;
		margin-block: 1rem;
		color-scheme: dark;
	}
	.hint,
	.footnote {
		color: #bcb8b0;
		font-size: 0.78rem;
		line-height: 1.8;
	}
	.footnote {
		margin: 1.5rem 0 0;
	}
	.loading,
	.error,
	.finished {
		padding-block: 1rem;
		line-height: 1.8;
		overflow-wrap: anywhere;
	}
	progress {
		width: 100%;
		height: 0.35rem;
		accent-color: #eee;
	}
	.loading small {
		display: block;
		color: #bcb8b0;
	}
	.error {
		border-top: 1px solid #888;
	}
	.primary {
		background: #eeeae2;
		color: #111;
	}
	.primary:hover {
		background: #ccc8c0;
	}
	footer {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.75rem;
		margin-top: 1.5rem;
	}
	.stage {
		position: fixed;
		inset: 0;
		z-index: 1000;
		background: #000;
		isolation: isolate;
	}
	.stage-tools {
		position: absolute;
		top: max(0.5rem, env(safe-area-inset-top));
		right: max(0.5rem, env(safe-area-inset-right));
		z-index: 40;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: 0.4rem;
		max-width: calc(100% - 4rem);
		font-size: 0.75rem;
	}
	.stage-tools span {
		padding: 0.35rem;
		background: #111e;
	}
	.stage-tools button {
		background: #111e;
	}
	.stage-status {
		position: absolute;
		bottom: max(1rem, env(safe-area-inset-bottom));
		inset-inline: 1rem;
		z-index: 40;
		margin: 0;
		padding: 0.65rem;
		background: #111e;
		text-align: center;
		font-size: 0.8rem;
		pointer-events: none;
	}
	@media (max-width: 480px) {
		footer button {
			width: 100%;
		}
		.stage-tools span {
			flex-basis: 100%;
			text-align: right;
		}
		.stage-tools button {
			padding-inline: 0.6rem;
		}
	}
</style>
