<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { CHAPTERS, SCENES, TRACK_BY_ID } from './catalog';
	import { acknowledgeReload, addTime, advance, armReload, chapterComplete, chapterOpen, choose, createStory, currentBeat, enterScene, finishEnding, inspectHotspot, markCutscene, markPuzzle, recordTrack, sceneOpen } from './model';
	import { commitStory, exportStory, loadStory, parseStoryImport, replaceStory } from './storage';
	import { DIAGNOSTIC_HELP, PUZZLES, diagnostic } from './puzzles';
	import StoryBackdrop from './StoryBackdrop.svelte';
	import StoryPerformance from './StoryPerformance.svelte';
	import PuzzlePanel from './PuzzlePanel.svelte';
	import CutscenePlayer from './CutscenePlayer.svelte';
	import type { StoryCategory, StoryChapter, StoryEnding, StoryHotspot, StoryPreferences, StoryReceipt, StorySave, StoryScene } from './types';

	type Phase = 'loading' | 'title' | 'map' | 'scene' | 'ending';
	type Mode = 'story' | 'performance' | 'puzzle';
	type Drawer = null | 'notes' | 'history' | 'record' | 'settings' | 'hotspots';
	type Feedback = { label: string; text: string };
	type HotspotView = { hotspot: StoryHotspot; index: number };
	type TrackAfter = { name: string; text: string };
	type Banner = { kind: 'info' | 'error'; text: string } | null;

	const CATEGORY_ROWS: { id: StoryCategory; label: string }[] = [
		{ id: 'dialogue', label: '对话阅读' },
		{ id: 'exploration', label: '地图调查' },
		{ id: 'puzzle', label: '证据与谜题' },
		{ id: 'music', label: '曲目录音' },
		{ id: 'cutscene', label: '过场演出' },
	];
	const DEFAULT_PREFERENCES: StoryPreferences = { volume: 0.7, reducedMotion: false, horror: true, textSize: 1 };
	const ENDINGS: { id: StoryEnding; name: string; subtitle: string; text: string }[] = [
		{ id: 'unbound', name: '余页', subtitle: '按授权轮换 · 并列标注', text: '席位继续共享，版本各自署名；撤回与退出随时有效，明天不再保证一模一样。' },
		{ id: 'daylight', name: '长昼', subtitle: '经协商暂停新增排演', text: '已获准的档案保持可读，暂时不制造下一天；被撤回的内容不会因冻结重新获得展示权。' },
		{ id: 'closed', name: '合页', subtitle: '结束本次排演', text: '必要的进度与获准留存的说明被保存，制作记录可回看；停止不被写成任何人的失败。' },
	];
	const EPILOGUE: Record<StoryEnding, { title: string; lines: string[] }> = {
		unbound: {
			title: '余页 · 城市继续变化',
			lines: [
				'席位表被改成可以看见的轮换：街本与幕本各有自己的时段，门口同时写着两个入口名。栞把两枚书签摆正，仍不对称，却不再有人要求她合成一个。',
				'白榆的新图与旧图并排挂着，署名、适用范围和事故原因都写在图上；送纸员按现行路线出发，也在页边留下“这条路雨天再测”的字条。',
				'岑拆掉补位调用，把工具挂在离手最近的位置；季的书店在多数时段安静，门口留着一张注明“闭店说明”的纸，没有人替她重新问候。',
				'城市不再保证每天一样。你在站台等到一班晚点的车，车上有人正在读一份还没定稿的节目单。',
			],
		},
		daylight: {
			title: '长昼 · 静止的档案日',
			lines: [
				'新增排演被暂停，已获准展示的档案保持原样，可以查阅、对照与引用。标尺收回页边，城市停在一个说得清来源的白天。',
				'栞的两份自述并列在册，各自带着自己的版记；白榆在修订记录里承认地图的缺口，并在旁边标注“仍恐高”。',
				'书店照旧开门，却不再自动播放同一句问候。季留下的闭店说明被允许保留，没有被当作复活用的脚本。',
				'你把今天的票放回窗口。没有新的排练开始，也没有人被要求为这份安静道歉。',
			],
		},
		closed: {
			title: '合页 · 本次排演结束',
			lines: [
				'本次排演合上。必要的进度、被允许留存的说明和制作记录都收进档案，任何人都不必为一个不会继续营业的城市守夜。',
				'栞把索引交还窗口，白榆卷起地图，岑关了最后一盏工作灯；季的书架保持她离开时的顺序，没有人为了留客把她叫回来。',
				'标尺对齐折线，然后退回页边。它没有被处决，也不再替别人选择唯一版本；可审计、可暂停、可以承认不知道。',
				'你走出白页站。身后没有追赶的脚步，也没有“关掉就会消失”的警告。这一页已经完整。',
			],
		},
	};

	let phase: Phase = 'loading';
	let mode: Mode = 'story';
	let drawer: Drawer = null;
	let save: StorySave | null = null;
	let latest: StorySave | null = null;
	let origin = '';
	let banner: Banner = null;
	let loadError = '';
	let conflict = false;
	let booting = true;

	let feedback: Feedback | null = null;
	let hotspotView: HotspotView | null = null;
	let trackAfter: TrackAfter | null = null;
	let performanceId: string | null = null;
	let puzzleId: string | null = null;
	let cutsceneId: string | null = null;
	let clearedScene = false;
	let history: { speaker: string; text: string; kind: 'line' | 'choice' | 'evidence' | 'note' }[] = [];
	let toastTimer: ReturnType<typeof setTimeout> | undefined;
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	let fileInput: HTMLInputElement | undefined;
	let pendingImport: StorySave | null = null;
	let importError = '';
	let confirmRestart = false;
	let endingBusy = false;
	let lastInput = Date.now();
	let ticker: ReturnType<typeof setInterval> | undefined;
	const buffer: Record<StoryCategory, number> = { dialogue: 0, exploration: 0, puzzle: 0, music: 0, cutscene: 0 };

	/* ---------------- 派生状态 ---------------- */

	$: prefs = save?.preferences ?? DEFAULT_PREFERENCES;
	$: scene = save ? (SCENES.find((candidate) => candidate.id === save?.scene) ?? undefined) : undefined;
	$: chapter = scene ? CHAPTERS.find((candidate) => candidate.scenes.includes(scene!)) : undefined;
	$: beat = save && scene ? currentBeat(save, scene) : undefined;
	$: location = scene ? /^R(\d+)-(\d+)$/.exec(scene.location) : null;
	$: backdropRegion = location ? Number(location[1]) : (chapter?.id ?? 0);
	$: backdropScene = location ? Number(location[2]) : 0;
	$: sceneProgress = save && scene ? Math.min(scene.steps.length, save.positions[scene.id] ?? 0) : 0;
	$: hotspotLines = hotspotView?.hotspot.lines ?? [];
	$: currentHotspotLine = hotspotView ? hotspotLines[hotspotView.index] : undefined;
	$: missingHotspots = scene && save ? (scene.requiresHotspots ?? []).filter((id) => !save!.hotspots.includes(`${scene!.id}/${id}`)) : [];
	$: atLastBeat = save && scene ? (save.positions[scene.id] ?? 0) >= scene.steps.length - 1 : false;
	$: trackDef = performanceId ? TRACK_BY_ID[performanceId] : undefined;
	$: puzzleTitle = puzzleId && Object.prototype.hasOwnProperty.call(PUZZLES, puzzleId) ? PUZZLES[puzzleId].title : puzzleId;
	$: puzzleSolved = !!(save && puzzleId && save.puzzles.includes(puzzleId));
	$: displaySpeaker = hotspotView ? (currentHotspotLine?.speaker ?? '') : (feedback ? '你的选择' : beat && beat.type === 'dialogue' ? beat.speaker : '');
	$: inventoryCount = save?.evidence.length ?? 0;
	$: chapterIsCleared = !!(save && chapter && chapterComplete(save, chapter));
	$: sceneDone = !!(save && scene && save.completed.includes(scene.id));
	$: endingReady = !!(save && !save.ending && CHAPTERS[9] && chapterComplete(save, CHAPTERS[9]));
	$: totalMinutes = save ? Math.round((Object.values(save.activeSeconds).reduce((sum, value) => sum + value, 0) / 60) * 10) / 10 : 0;
	$: countingCategory = activeCategory(save, booting, phase, mode, cutsceneId);

	/* ---------------- 通用工具 ---------------- */

	function message(cause: unknown): string {
		return cause instanceof Error ? cause.message : String(cause);
	}

	/** 互斥的活动分类：同一时刻只累计一类，地图探索、谜题与对话不会互相叠加。 */
	function activeCategory(current: StorySave | null, loading: boolean, stage: Phase, view: Mode, cutscene: string | null): StoryCategory | null {
		if (!current || loading) return null;
		if (stage === 'map') return 'exploration';
		if (stage !== 'scene') return null;
		if (view === 'puzzle') return 'puzzle';
		if (view === 'performance' || cutscene) return null;
		return 'dialogue';
	}

	function say(bannerValue: Banner) {
		banner = bannerValue;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (banner = null), 6200);
	}

	function markInput() {
		lastInput = Date.now();
	}

	function patch(changes: Partial<StorySave>, critical = false): void {
		if (!save) return;
		const next: StorySave = { ...save, ...changes, revision: save.revision + 1 };
		setSave(next, critical);
	}

	function setSave(next: StorySave, critical = false): void {
		save = next;
		latest = next;
		if (critical) scheduleSave(0);
		else scheduleSave();
	}

	function scheduleSave(delay = 1800): void {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => void persist(), delay);
	}

	async function persist(): Promise<void> {
		flushTime();
		if (!save) return;
		try {
			await commitStory(save);
			conflict = false;
		} catch (cause) {
			const text = message(cause);
			conflict = text.includes('冲突');
			say({ kind: 'error', text: conflict ? `${text}。请重新载入后再继续，或先导出当前故事存档。` : `存档未写入：${text}` });
		}
	}

	function flushTime(): void {
		if (!save) return;
		let next = save;
		for (const row of CATEGORY_ROWS) {
			let pending = buffer[row.id];
			while (pending > 0) {
				const step = Math.min(5, pending);
				next = addTime(next, row.id, step);
				pending -= step;
			}
			buffer[row.id] = 0;
		}
		if (next !== save) {
			save = next;
			latest = next;
		}
	}

	function noteHistory(speaker: string, text: string, kind: 'line' | 'choice' | 'evidence' | 'note' = 'line'): void {
		history = [...history.slice(-240), { speaker, text, kind }];
	}

	/* ---------------- 启动与存档 ---------------- */

	onMount(() => {
		origin = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
		registerConsole();
		window.addEventListener('pointerdown', markInput, { passive: true });
		window.addEventListener('keydown', markInput, { passive: true });
		document.addEventListener('visibilitychange', onVisibility);
		window.addEventListener('pagehide', onPageHide);
		ticker = setInterval(onTick, 1000);
		void boot();
		return () => {
			// onMount 返回的清理函数与 onDestroy 共同保证不留下监听或计时器。
			window.removeEventListener('pointerdown', markInput);
			window.removeEventListener('keydown', markInput);
			document.removeEventListener('visibilitychange', onVisibility);
			window.removeEventListener('pagehide', onPageHide);
			clearInterval(ticker);
			clearTimeout(toastTimer);
			clearTimeout(saveTimer);
			unregisterConsole();
		};
	});

	async function boot(): Promise<void> {
		try {
			const loaded = await loadStory();
			if (loaded) {
				let restored = loaded;
				if (restored.reload && restored.reload.origin !== origin) restored = acknowledgeReload(restored, origin);
				const target = SCENES.find((candidate) => candidate.id === restored.scene);
				if (target) {
					try {
						restored = enterScene(restored, target, CHAPTERS);
					} catch {
						phase = 'map';
					}
				}
				save = restored;
				latest = restored;
				if (restored !== loaded) await commitStory(restored);
				phase = 'title';
			} else {
				phase = 'title';
			}
		} catch (cause) {
			loadError = message(cause);
			say({ kind: 'error', text: `${loadError}。为避免覆盖，本页不会自动新建存档；你可以先导出或修复浏览器存储后刷新。` });
			phase = 'title';
		} finally {
			booting = false;
		}
	}

	function onVisibility(): void {
		if (document.visibilityState === 'hidden') {
			flushTime();
			void persist();
		}
		lastInput = Date.now();
	}

	function onPageHide(): void {
		flushTime();
		void persist();
	}

	function onTick(): void {
		if (!save || document.visibilityState !== 'visible') return;
		const category = countingCategory;
		if (!category) return;
		if (Date.now() - lastInput > 90_000) return;
		buffer[category] = Math.min(5, buffer[category] + 1);
		if (buffer[category] >= 5) {
			flushTime();
			scheduleSave();
		}
	}

	async function startNewGame(): Promise<void> {
		if (!save) {
			const fresh = createStory(CHAPTERS);
			const first = fresh.scene;
			const target = SCENES.find((candidate) => candidate.id === first);
			let next = fresh;
			if (target) next = enterScene(fresh, target, CHAPTERS);
			save = next;
			latest = next;
			await persist();
		} else {
			try {
				const fresh = createStory(CHAPTERS);
				const target = SCENES.find((candidate) => candidate.id === fresh.scene);
				const seeded = target ? enterScene(fresh, target, CHAPTERS) : fresh;
				const stored = await replaceStory(seeded);
				save = stored;
				latest = stored;
				history = [];
			} catch (cause) {
				say({ kind: 'error', text: `无法开始新故事：${message(cause)}` });
				return;
			}
		}
		confirmRestart = false;
		drawer = null;
		phase = 'scene';
		mode = 'story';
		clearedScene = false;
		say({ kind: 'info', text: '新的校听记录已开始。所有进度都保存在独立的故事存档中。' });
	}

	async function continueStory(): Promise<void> {
		flushTime();
		await persist();
		phase = save && save.ending ? 'ending' : 'map';
	}

	function openScene(target: StoryScene): void {
		if (!save) return;
		try {
			const next = enterScene(save, target, CHAPTERS);
			setSave(next, true);
			mode = 'story';
			phase = 'scene';
			drawer = null;
			feedback = null;
			hotspotView = null;
			trackAfter = null;
			performanceId = null;
			puzzleId = null;
			clearedScene = false;
			markInput();
		} catch (cause) {
			say({ kind: 'error', text: message(cause) });
		}
	}

	/* ---------------- 剧情推进 ---------------- */

	function advanceStory(): void {
		if (!save || !scene) return;
		if (trackAfter) {
			trackAfter = null;
			return;
		}
		if (feedback) {
			feedback = null;
			return;
		}
		if (hotspotView) {
			nextHotspotLine();
			return;
		}
		if (save.completed.includes(scene.id) || !beat) return;
		if (beat.type === 'choice') return;
		if (beat.type === 'track' || beat.type === 'puzzle' || beat.type === 'cutscene') return;
		const before = save;
		try {
			const next = advance(before, scene);
			// 证据与对白立即记入本页历史，便于回看。
			if (beat.type === 'evidence') noteHistory('证据', `${beat.title}：${beat.text}`, 'evidence');
			else if (beat.type === 'dialogue') noteHistory(beat.speaker, beat.text, 'line');
			applyAdvance(before, next);
		} catch (cause) {
			say({ kind: 'error', text: message(cause) });
		}
	}

	function applyAdvance(before: StorySave, next: StorySave): void {
		const wasComplete = before.completed.includes(next.scene);
		setSave(next, true);
		if (!save || !scene) return;
		if (!wasComplete && next.completed.includes(scene.id)) {
			clearedScene = true;
			if (!chapter) return;
			scheduleSave();
		}
		markInput();
	}

	function pickOption(option: { id: string; label: string; text: string }): void {
		if (!save || !scene || !beat || beat.type !== 'choice') return;
		try {
			const next = choose(save, scene, option.id);
			setSave(next, true);
			feedback = { label: option.label, text: option.text };
			noteHistory('选择', `${option.label}：${option.text}`, 'choice');
			// 选择本身可能是最后一拍：反馈读完后展示场景完成面板。
			if (next.completed.includes(scene.id)) {
				clearedScene = true;
			}
			markInput();
		} catch (cause) {
			say({ kind: 'error', text: message(cause) });
		}
	}

	function dismissFeedback(): void {
		feedback = null;
	}

	function nextHotspotLine(): void {
		if (!hotspotView) return;
		if (hotspotView.index + 1 < hotspotView.hotspot.lines.length) hotspotView = { ...hotspotView, index: hotspotView.index + 1 };
		else hotspotView = null;
	}

	function inspect(hotspot: StoryHotspot): void {
		if (!save || !scene) return;
		const already = save.hotspots.includes(`${scene.id}/${hotspot.id}`);
		try {
			const next = inspectHotspot(save, scene, hotspot.id);
			if (next !== save) setSave(next, true);
			else if (!already) setSave(next);
		} catch (cause) {
			say({ kind: 'error', text: message(cause) });
			return;
		}
		hotspotView = { hotspot, index: 0 };
		feedback = null;
		drawer = null;
		if (hotspot.lines[0]) noteHistory(hotspot.lines[0].speaker, hotspot.lines[0].text, 'line');
		markInput();
	}

	/* ---------------- 曲目 ---------------- */

	function beginPerformance(): void {
		if (!save || !scene || !beat || beat.type !== 'track') return;
		if (!TRACK_BY_ID[beat.track]) {
			say({ kind: 'error', text: '曲目定义缺失，无法开始演奏。' });
			return;
		}
		performanceId = beat.track;
		mode = 'performance';
		markInput();
	}

	function onTrackComplete(receipt: StoryReceipt): void {
		if (!save || !scene || !beat || beat.type !== 'track') return;
		try {
			const next = recordTrack(save, scene, receipt);
			setSave(next, true);
			buffer.music = 0;
			trackAfter = { name: TRACK_BY_ID[beat.track]?.name ?? beat.track, text: beat.after };
			noteHistory('演奏', `${TRACK_BY_ID[beat.track]?.name ?? beat.track} · ${receipt.mode === 'manual' ? '手动' : receipt.mode === 'auto' ? '自动伴奏' : receipt.mode === 'listen' ? '聆听' : '摘要'} · 有效 ${Math.round(receipt.seconds)} 秒`, 'note');
		} catch (cause) {
			say({ kind: 'error', text: message(cause) });
		}
		performanceId = null;
		mode = 'story';
	}

	function cancelPerformance(): void {
		performanceId = null;
		mode = 'story';
		say({ kind: 'info', text: '已回到剧情。本次演奏没有产生回执，可以稍后重新选择演奏方式。' });
	}

	function continueAfterTrack(): void {
		if (!save || !scene) return;
		trackAfter = null;
		try {
			const next = advance(save, scene);
			const before = save;
			applyAdvance(before, next);
		} catch (cause) {
			say({ kind: 'error', text: message(cause) });
		}
	}

	/* ---------------- 谜题 ---------------- */

	function openPuzzle(): void {
		if (!beat || beat.type !== 'puzzle') return;
		puzzleId = beat.puzzle;
		mode = 'puzzle';
		markInput();
	}

	function onPuzzleSolved(id: string): void {
		if (!save || !scene) return;
		try {
			const next = markPuzzle(save, scene, id);
			setSave(next, true);
			noteHistory('证据板', `${puzzleTitle ?? id}：推理通过并归档。`, 'note');
		} catch (cause) {
			say({ kind: 'error', text: message(cause) });
		}
	}

	function closePuzzle(): void {
		if (!save || !scene) return;
		puzzleId = null;
		mode = 'story';
		if (puzzleSolved) {
			try {
				const next = advance(save, scene);
				const before = save;
				applyAdvance(before, next);
			} catch (cause) {
				say({ kind: 'error', text: message(cause) });
			}
		}
	}

	/* ---------------- 过场 ---------------- */

	function playCutscene(): void {
		if (!beat || beat.type !== 'cutscene') return;
		cutsceneId = beat.cutscene;
		markInput();
	}

	function onCutsceneComplete(): void {
		if (!save || !scene || !beat || beat.type !== 'cutscene' || !cutsceneId) return;
		const id = cutsceneId;
		cutsceneId = null;
		try {
			const next = markCutscene(save, scene, id);
			setSave(next, true);
			noteHistory('过场', `${id}：已观看或跳过，同等剧情已记入证据。`, 'note');
			const advanced = advance(next, scene);
			applyAdvance(next, advanced);
		} catch (cause) {
			say({ kind: 'error', text: message(cause) });
		}
	}

	/* ---------------- 谜题：保存并真刷新 ---------------- */

	async function reloadForPuzzle(): Promise<void> {
		if (!save || !scene) throw new Error('当前不在可保存的场景');
		flushTime();
		const armed = armReload(save, scene, origin);
		await commitStory(armed);
		save = armed;
		latest = armed;
		window.location.reload();
	}

	/* ---------------- 结局 ---------------- */

	async function chooseEnding(ending: StoryEnding): Promise<void> {
		if (!save || endingBusy) return;
		endingBusy = true;
		try {
			const next = finishEnding(save, ending, CHAPTERS);
			setSave(next, true);
			flushTime();
			await persist();
			noteHistory('运行方式', `${ENDINGS.find((item) => item.id === ending)?.name ?? ending}：已完成协商并记录。`, 'note');
		} catch (cause) {
			say({ kind: 'error', text: message(cause) });
		} finally {
			endingBusy = false;
		}
	}

	/* ---------------- 设置、导入导出与诊断 ---------------- */

	function setPreference<K extends keyof StoryPreferences>(field: K, value: StoryPreferences[K]): void {
		if (!save) return;
		patch({ preferences: { ...save.preferences, [field]: value } }, true);
	}

	function downloadExport(): void {
		if (!save) return;
		try {
			const text = exportStory(save);
			const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement('a');
			anchor.href = url;
			anchor.download = `yuye-story-${new Date().toISOString().slice(0, 10)}.json`;
			anchor.click();
			setTimeout(() => URL.revokeObjectURL(url), 4000);
			say({ kind: 'info', text: '故事存档已导出。该文件只包含《余页》进度，不含自由模式成绩。' });
		} catch (cause) {
			say({ kind: 'error', text: `导出失败：${message(cause)}` });
		}
	}

	async function onImportFile(event: Event): Promise<void> {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		importError = '';
		pendingImport = null;
		if (!file) return;
		try {
			const text = await file.text();
			pendingImport = parseStoryImport(text);
		} catch (cause) {
			importError = message(cause);
		} finally {
			input.value = '';
		}
	}

	async function commitImport(): Promise<void> {
		if (!pendingImport) return;
		try {
			const stored = await replaceStory(pendingImport);
			save = stored;
			latest = stored;
			pendingImport = null;
			history = [];
			const target = SCENES.find((candidate) => candidate.id === stored.scene);
			if (target) {
				try {
					save = enterScene(stored, target, CHAPTERS);
					latest = save;
					await commitStory(save);
				} catch {
					phase = 'map';
				}
			}
			phase = save?.ending ? 'ending' : 'map';
			say({ kind: 'info', text: '导入成功：已替换为导入存档，并重新绑定当前场景。' });
		} catch (cause) {
			importError = message(cause);
		}
	}

	function refreshDiagnostic(target: 'clock' | 'cast' | 'verify'): string {
		return save ? diagnostic(save, target) : DIAGNOSTIC_HELP;
	}

	type ConsoleApi = { inspect: (target: string) => string; verify: () => string; help: string; snapshot: () => unknown };
	type StoryWindow = Window & { yuye?: ConsoleApi };

	function registerConsole(): void {
		const api: ConsoleApi = {
			inspect: (target: string) => {
				if (target === 'clock' || target === 'cast' || target === 'verify') return latest ? diagnostic(latest, target) : DIAGNOSTIC_HELP;
				return DIAGNOSTIC_HELP;
			},
			verify: () => (latest ? diagnostic(latest, 'verify') : DIAGNOSTIC_HELP),
			help: DIAGNOSTIC_HELP,
			snapshot: () =>
				latest
					? {
							scene: latest.scene,
							chapter: `${latest.contentVersion}`,
							completed: [...latest.completed],
							evidence: latest.evidence.map((item) => item.id),
							puzzles: [...latest.puzzles],
							cutscenes: [...latest.cutscenes],
							ending: latest.ending,
						}
					: null,
		};
		(window as StoryWindow).yuye = api;
	}

	function unregisterConsole(): void {
		delete (window as StoryWindow).yuye;
	}

	/* ---------------- 键盘操作 ---------------- */

	function onKeydown(event: KeyboardEvent): void {
		const target = event.target as HTMLElement | null;
		if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable || target.tagName === 'SELECT')) return;
		if (event.key === 'Escape') {
			if (drawer) {
				drawer = null;
				event.preventDefault();
			} else if (mode === 'puzzle') {
				closePuzzle();
				event.preventDefault();
			}
			return;
		}
		if (drawer || phase !== 'scene' || mode !== 'story' || cutsceneId) return;
		if (event.key !== ' ' && event.key !== 'Enter') return;
		if (hotspotView || feedback || trackAfter) {
			event.preventDefault();
			if (hotspotView) nextHotspotLine();
			else if (feedback) dismissFeedback();
			else trackAfter = null;
			return;
		}
		if (!beat) return;
		if (beat.type === 'dialogue' || beat.type === 'evidence') {
			event.preventDefault();
			if (atLastBeat && missingHotspots.length) {
				say({ kind: 'info', text: '本场还有必须调查的关键对象。打开「调查」查看带有「关键」标记的物件。' });
				return;
			}
			advanceStory();
		}
	}

	/* ---------------- 地图与导航辅助 ---------------- */

	function chapterUnlocked(target: StoryChapter): boolean {
		return save ? chapterOpen(save, target, CHAPTERS) : false;
	}

	function sceneUnlocked(target: StoryScene): boolean {
		return save ? sceneOpen(save, target, CHAPTERS) : false;
	}

	function sceneIsDone(target: StoryScene): boolean {
		return !!save?.completed.includes(target.id);
	}

	function sceneLockNote(target: StoryScene): string {
		const missing = target.requires.filter((id) => !save?.completed.includes(id));
		if (!missing.length) return '完成前序场景后开放';
		const names = missing.map((id) => SCENES.find((candidate) => candidate.id === id)?.title ?? id);
		return `还需完成：${names.join('、')}`;
	}

	function openNextScene(): void {
		if (!chapter || !save) {
			phase = 'map';
			return;
		}
		const next = chapter.scenes.find((candidate) => sceneOpen(save as StorySave, candidate, CHAPTERS) && !save?.completed.includes(candidate.id));
		if (next) openScene(next);
		else phase = 'map';
	}

	function backToMap(): void {
		flushTime();
		void persist();
		phase = 'map';
		mode = 'story';
		clearedScene = false;
		feedback = null;
		hotspotView = null;
		trackAfter = null;
		drawer = null;
	}

	function leaveStory(): void {
		flushTime();
		void persist();
		void goto('/songs');
	}

	function formatMinutes(seconds: number): string {
		const total = Math.round(seconds / 60);
		if (total < 60) return `${total} 分钟`;
		return `${Math.floor(total / 60)} 小时 ${total % 60} 分钟`;
	}

	onDestroy(() => {
		flushTime();
		void persist();
	});
</script>

<svelte:window onkeydown={onKeydown} />
<svelte:head>
	<title>余页 · THE UNBOUND EDITION</title>
	<meta name="description" content="折页城故事模式：区域调查、GalGame 对话、黑白过场与真实控制台线索。" />
</svelte:head>

<div class="story" class:reduced={prefs.reducedMotion} style={`--ts:${prefs.textSize}`}>
	{#if phase !== 'loading' && phase !== 'title'}
		<header class="bar">
			<div class="brand">
				<span class="brand-cn">余页</span>
				<span class="brand-en">THE UNBOUND EDITION</span>
			</div>
			<nav class="bar-actions" aria-label="故事工具栏">
				<button type="button" onclick={backToMap} class:active={phase === 'map'}>地图</button>
				{#if phase === 'scene' && scene}
					<button type="button" onclick={() => (drawer = 'hotspots')} class="hotspot-btn">
						调查<span class="count">{missingHotspots.length ? `关键 ${missingHotspots.length}` : scene.hotspots.length}</span>
					</button>
				{/if}
				<button type="button" onclick={() => (drawer = 'notes')}>笔记<span class="count">{inventoryCount}</span></button>
				<button type="button" onclick={() => (drawer = 'history')}>历史</button>
				<button type="button" onclick={() => (drawer = 'record')}>记录</button>
				<button type="button" onclick={() => (drawer = 'settings')}>设置</button>
				<button type="button" class="leave" onclick={leaveStory}>离开</button>
			</nav>
		</header>
	{/if}

	<main class="page">
		{#if phase === 'loading'}
			<div class="boot" role="status">
				<p class="eyebrow">YUYE / LOADING</p>
				<p>正在取回校听记录…</p>
			</div>
		{:else if phase === 'title'}
			<section class="cover" aria-labelledby="cover-title">
				<div class="cover-glyph" aria-hidden="true">
					<span>余</span><span>页</span>
				</div>
				<div class="cover-copy">
					<p class="eyebrow">A STORY IN FOLDED PAGES</p>
					<h1 id="cover-title">余页</h1>
					<p class="cover-sub">THE UNBOUND EDITION</p>
					<p class="cover-lead">
						一座由来稿装订而成的城市，请你修复它的错误。每修好一处，某个人就少了一种成为自己的可能。先喝茶，再看清那些被整齐藏起的东西。
					</p>
					<ul class="cover-facts">
						<li>十章 · 九座区域 · 三十二首曲目</li>
						<li>黑白程序化演出，不含新增图片或配音</li>
						<li>剧情可完整通关：手动、自动伴奏、纯聆听等价</li>
						<li>独立故事存档，不写入自由模式成绩</li>
					</ul>
					<div class="cover-actions">
						{#if save}
							<button type="button" class="primary" onclick={continueStory}>继续校听</button>
						{/if}
						<button type="button" class={save ? '' : 'primary'} onclick={startNewGame}>{save ? '重新开始' : '进入折页城'}</button>
						<button type="button" onclick={() => (drawer = 'settings')}>导入 / 设置</button>
						<button type="button" class="ghost" onclick={leaveStory}>返回选歌</button>
					</div>
					{#if save}
						<p class="cover-progress">
							当前：第 {chapter?.id ?? 0} 章 · {scene?.title ?? '未知场景'} · 已完成 {save.completed.length}/{SCENES.length} 场景 · 有效 {formatMinutes(Object.values(save.activeSeconds).reduce((sum, value) => sum + value, 0))}
						</p>
					{/if}
					<p class="cover-warning">
						内容提示：含较强恐怖与舞台故障表现，可随时在设置中降低强度；关键剧情不会因辅助、降低恐怖或使用提示而减少。
					</p>
					{#if save}
						<label class="restart-check"><input type="checkbox" bind:checked={confirmRestart} /> 我确认「重新开始」会替换当前故事进度（自由模式数据不受影响）</label>
					{/if}
				</div>
			</section>
		{:else if phase === 'map'}
			<section class="map" aria-labelledby="map-title">
				<div class="map-head">
					<div>
						<p class="eyebrow">FOLDED CITY / INDEX</p>
						<h1 id="map-title">选择一处先去看</h1>
						<p class="map-lead">区域按授权与前置场景开放。灰色条目不是任务清单，而是此刻还缺哪一个已完成的场景。</p>
					</div>
					{#if save && scene && !save.completed.includes(scene.id)}
						<button type="button" class="primary" onclick={() => openScene(scene)}>回到当前场景<span>{scene.title}</span></button>
					{/if}
				</div>

				<div class="map-grid">
					{#each CHAPTERS as entry (entry.id)}
						<article class="chapter-card" class:locked={!chapterUnlocked(entry)} class:done={save ? chapterComplete(save, entry) : false} class:parallel={entry.id === 2 || entry.id === 3 || entry.id === 4}>
							<header>
								<p class="chapter-no">第 {entry.id} 章</p>
								<h2>{entry.title}</h2>
								<p class="chapter-region">{entry.region}{entry.id === 2 || entry.id === 3 || entry.id === 4 ? ' · 三线并行' : ''}</p>
							</header>
							<p class="chapter-desc">{entry.description}</p>
							{#if !chapterUnlocked(entry)}
								<p class="lock">尚未开放：需要先完成前置章节。</p>
							{/if}
							<ol class="scene-list">
								{#each entry.scenes as target (target.id)}
									{@const unlocked = sceneUnlocked(target) && chapterUnlocked(entry)}
									{@const done = sceneIsDone(target)}
									<li>
										<button type="button" class="scene-row" class:done class:locked={!unlocked} disabled={!unlocked} onclick={() => openScene(target)}>
											<span class="scene-mark" aria-hidden="true">{done ? '✓' : target.optional ? '◇' : '·'}</span>
											<span class="scene-name">{target.title}</span>
											<span class="scene-loc">{target.location}{target.optional ? ' / 可选' : ''}</span>
											{#if !unlocked}<span class="scene-lock">{sceneLockNote(target)}</span>{/if}
											{#if done}<span class="scene-done">已完成</span>{/if}
										</button>
									</li>
								{/each}
							</ol>
						</article>
					{/each}
				</div>

				{#if endingReady || save?.ending}
					<div class="ending-entry">
						<p>第 9 章已完成。</p>
						<button type="button" class="primary" onclick={() => (phase = 'ending')}>{save?.ending ? '回看结局与记录' : '进入离场协商'}</button>
					</div>
				{/if}
			</section>
		{:else if phase === 'scene' && scene && chapter}
			<section class="scene" aria-labelledby="scene-title">
				<div class="backdrop-layer">
					<StoryBackdrop region={backdropRegion} scene={backdropScene} speaker={displaySpeaker} changed={clearedScene || !!save?.ending} reducedMotion={prefs.reducedMotion} />
				</div>

				<header class="scene-head">
					<div>
						<p class="eyebrow">第 {chapter.id} 章 · {chapter.region} · {scene.location}</p>
						<h1 id="scene-title">{scene.title}</h1>
					</div>
					<div class="scene-meter" aria-label={`本场进度 ${sceneProgress}/${scene.steps.length}`}>
						<span>{sceneProgress} / {scene.steps.length}</span>
						<progress max={scene.steps.length} value={sceneProgress}></progress>
					</div>
				</header>

				<div class="scene-area">
					<aside class="hotspot-rail" aria-label="本场调查对象">
						<h2>调查</h2>
						<p class="rail-note">点击物件即可检查；关键物件用「关键」标出，重看不会重复推进剧情。</p>
						<ul>
							{#each scene.hotspots as hotspot (hotspot.id)}
								{@const found = !!save?.hotspots.includes(`${scene.id}/${hotspot.id}`)}
								{@const required = !!scene.requiresHotspots?.includes(hotspot.id)}
								<li>
									<button type="button" class="hotspot" class:found onclick={() => inspect(hotspot)}>
										<span class="hotspot-title">{hotspot.title}</span>
										{#if required}<span class="tag">关键</span>{/if}
										{#if found}<span class="found-mark" aria-label="已调查">✓</span>{/if}
									</button>
								</li>
							{/each}
						</ul>
						{#if missingHotspots.length && !clearedScene}
							<p class="rail-warn">本场收尾前必须调查的关键物件还剩 {missingHotspots.length} 项。</p>
						{/if}
					</aside>

					<div class="stage-body">
						{#if mode === 'performance' && trackDef}
							<StoryPerformance
								track={trackDef}
								volume={prefs.volume}
								oncomplete={onTrackComplete}
								oncancel={cancelPerformance}
								ontick={(seconds) => {
									buffer.music = Math.min(5, buffer.music + seconds);
									if (buffer.music >= 5) {
										flushTime();
										scheduleSave();
									}
								}}
							/>
						{:else if mode === 'puzzle' && puzzleId}
							<section class="puzzle-shell" aria-label={`谜题 ${puzzleId}`}>
								<header class="puzzle-head">
									<p class="eyebrow">证据板 · {puzzleId}</p>
									<h2>{puzzleTitle}</h2>
									<p class="puzzle-lead">三层提示与完整答案始终开放；使用提示不影响任何结局资格。</p>
								</header>
								<PuzzlePanel id={puzzleId} save={save as StorySave} onsolve={onPuzzleSolved} onreload={reloadForPuzzle} />
								<footer class="puzzle-foot">
									{#if puzzleSolved}
										<button type="button" class="primary" onclick={closePuzzle}>收好证据 · 继续剧情</button>
									{:else}
										<button type="button" onclick={closePuzzle}>先回剧情（稍后再解）</button>
									{/if}
								</footer>
							</section>
						{:else if hotspotView}
							<div class="dialogue" role="group" aria-label="场景调查">
								<p class="tag">调查 · {hotspotView.hotspot.title}</p>
								<p class="description">{hotspotView.hotspot.description}</p>
								{#if currentHotspotLine}
									<p class="line"><b>{currentHotspotLine.speaker}</b>{currentHotspotLine.text}</p>
								{/if}
								<div class="dialogue-actions">
									<button type="button" class="primary" onclick={nextHotspotLine}>
										{hotspotView.index + 1 < hotspotView.hotspot.lines.length ? '继续' : '收起'}
									</button>
									<span class="hint">{hotspotView.index + 1} / {hotspotView.hotspot.lines.length}</span>
								</div>
							</div>
						{:else if feedback}
							<div class="dialogue" role="group" aria-label="选择反馈">
								<p class="tag">你选择了 · {feedback.label}</p>
								<p class="line">{feedback.text}</p>
								<div class="dialogue-actions">
									<button type="button" class="primary" onclick={dismissFeedback} disabled={!!save?.ending}>继续</button>
								</div>
							</div>
						{:else if trackAfter}
							<div class="dialogue" role="group" aria-label="曲目完成">
								<p class="tag">《{trackAfter.name}》 · 已记录</p>
								<p class="line">{trackAfter.text}</p>
								<div class="dialogue-actions">
									<button type="button" class="primary" onclick={continueAfterTrack}>继续剧情</button>
								</div>
							</div>
						{:else if sceneDone}
							<div class="dialogue" role="group" aria-label="场景完成">
								<p class="tag">场景完成</p>
								<p class="line">「{scene.title}」的校听记录已归档。你可以留在这里重看调查物件，也可以回到地图选择下一处。</p>
								{#if chapterIsCleared}
									<p class="line">
										第 {chapter?.id} 章「{chapter?.title}」已完成。{chapter?.id === 9
											? '下一步是离场协商：三种运行方式都需要相关角色同意，同样完成权限验证。'
											: chapter?.id === 1
												? '校样馆、无幕剧院与逆秒钟塔三条线现已同时开放，顺序由你决定。'
												: '新的区域已按前置关系开放。'}
									</p>
								{/if}
								<div class="dialogue-actions">
									{#if chapterIsCleared && chapter?.id === 9 && !save?.ending}
										<button type="button" class="primary" onclick={() => (phase = 'ending')}>进入离场协商</button>
									{:else}
										<button type="button" class="primary" onclick={openNextScene}>下一处场景</button>
									{/if}
									<button type="button" onclick={backToMap}>返回地图</button>
								</div>
							</div>
						{:else if beat && beat.type === 'dialogue'}
							<div class="dialogue" role="group" aria-label="剧情对白">
								<p class="speaker">{beat.speaker}</p>
								<p class="line" aria-live="polite">{beat.text}</p>
								<div class="dialogue-actions">
									<button type="button" class="primary" onclick={advanceStory}>
										{atLastBeat && missingHotspots.length ? '还需调查' : atLastBeat ? '结束本场' : '继续'}
									</button>
									<span class="hint">空格 / Enter</span>
								</div>
							</div>
						{:else if beat && beat.type === 'evidence'}
							<div class="dialogue evidence-card" role="group" aria-label="获得证据">
								<p class="tag">证据入册</p>
								<h2>{beat.title}</h2>
								<p class="line">{beat.text}</p>
								<div class="dialogue-actions">
									<button type="button" class="primary" onclick={advanceStory}>收下并继续</button>
									<button type="button" onclick={() => (drawer = 'notes')}>打开笔记</button>
								</div>
							</div>
						{:else if beat && beat.type === 'choice'}
							<div class="dialogue choice" role="group" aria-label="剧情选择">
								<p class="tag">选择</p>
								<p class="line">{beat.prompt}</p>
								<div class="options">
									{#each beat.options as option (option.id)}
										<button type="button" onclick={() => pickOption(option)}>
											<span class="option-label">{option.label}</span>
											<span class="option-arrow" aria-hidden="true">▸</span>
										</button>
									{/each}
								</div>
							</div>
						{:else if beat && beat.type === 'track'}
							{@const trackInfo = TRACK_BY_ID[beat.track]}
							{@const done = !!save?.trackReceipts[beat.track]}
							<div class="dialogue" role="group" aria-label="曲目节点">
								<p class="tag">演奏 · {beat.track}{trackInfo ? ` · ${trackInfo.name}` : ''}</p>
								{#if done}
									<p class="line">{beat.after}</p>
									<div class="dialogue-actions">
										<button type="button" class="primary" onclick={continueAfterTrack}>继续剧情</button>
									</div>
								{:else}
									<p class="line">{beat.before}</p>
									{#if trackInfo}
										<p class="meta-line">{trackInfo.artist} · {trackInfo.difficulty} · 约 {Math.floor(trackInfo.seconds / 60)} 分 {Math.round(trackInfo.seconds % 60)} 秒</p>
									{/if}
									<div class="dialogue-actions">
										<button type="button" class="primary" onclick={beginPerformance}>进入演奏</button>
										<span class="hint">手动 / 自动伴奏 / 纯聆听任选其一</span>
									</div>
								{/if}
							</div>
						{:else if beat && beat.type === 'puzzle'}
							{@const solved = !!save?.puzzles.includes(beat.puzzle)}
							<div class="dialogue" role="group" aria-label="谜题节点">
								<p class="tag">证据板 · {beat.puzzle}</p>
								<p class="line">{solved ? '这组证据已经归档，可以在这里只读重看。' : '现场材料已经收齐，接下来需要把出处、关系与判断分开对照。'}</p>
								<div class="dialogue-actions">
									{#if solved}
										<button type="button" class="primary" onclick={() => { if (save && scene) applyAdvance(save, advance(save, scene)); }}>继续剧情</button>
										<button type="button" onclick={openPuzzle}>只读重看证据板</button>
									{:else}
										<button type="button" class="primary" onclick={openPuzzle}>打开证据板</button>
									{/if}
								</div>
							</div>
						{:else if beat && beat.type === 'cutscene'}
							{@const seen = !!save?.cutscenes.includes(beat.cutscene)}
							<div class="dialogue" role="group" aria-label="过场节点">
								<p class="tag">过场 · {beat.cutscene}</p>
								<p class="line">{seen ? '这段过场已记录，摘要与证据留在笔记里。' : '接下来是一段可暂停、可跳过的黑白过场。跳过后有同等剧情摘要。'}</p>
								<div class="dialogue-actions">
									{#if seen}
										<button type="button" class="primary" onclick={() => { if (save && scene) applyAdvance(save, advance(save, scene)); }}>继续剧情</button>
										<button type="button" onclick={playCutscene}>重看过场</button>
									{:else}
										<button type="button" class="primary" onclick={playCutscene}>播放过场</button>
									{/if}
								</div>
							</div>
						{:else}
							<div class="dialogue" role="group" aria-label="场景结束">
								<p class="tag">本场已归档</p>
								<p class="line">这里暂时没有新的正文。你可以回到地图，或检查本场尚未调查的物件。</p>
								<div class="dialogue-actions"><button type="button" class="primary" onclick={backToMap}>返回地图</button></div>
							</div>
						{/if}
					</div>
				</div>

				{#if cutsceneId}
					<div class="overlay" role="dialog" aria-modal="true" aria-label="过场播放">
						<div class="overlay-inner">
							<CutscenePlayer
								id={cutsceneId}
								reducedMotion={prefs.reducedMotion}
								horror={prefs.horror}
								oncomplete={onCutsceneComplete}
								ontick={(seconds) => {
									buffer.cutscene = Math.min(5, buffer.cutscene + seconds);
									if (buffer.cutscene >= 5) {
										flushTime();
										scheduleSave();
									}
								}}
							/>
						</div>
					</div>
				{/if}
			</section>
		{:else if phase === 'ending'}
			<section class="ending" aria-labelledby="ending-title">
				<p class="eyebrow">LEAVING / 离场协商</p>
				<h1 id="ending-title">{save?.ending ? EPILOGUE[save.ending].title : '下一阶段怎样运行'}</h1>
				{#if save?.ending}
					<div class="epilogue">
						{#each EPILOGUE[save.ending].lines as line}
							<p>{line}</p>
						{/each}
						<div class="epilogue-actions">
							<button type="button" class="primary" onclick={backToMap}>回到地图（后日谈）</button>
							<button type="button" onclick={() => (drawer = 'record')}>查看完成记录</button>
							<button type="button" onclick={downloadExport}>导出故事存档</button>
						</div>
						<p class="fine">选择一个运行方式不会删除任何真实进度；其他结局可以从记录回看，不要求重打全部曲目。</p>
					</div>
				{:else}
					<p class="ending-lead">三种运行方式都要求相同规模的主线与权限验证，区别只在未来如何安排。玩家只决定自己如何参与，不能替退场者留下，也不能一键冻结所有人。</p>
					<div class="ending-options">
						{#each ENDINGS as option (option.id)}
							<button type="button" class="ending-card" disabled={endingBusy} onclick={() => chooseEnding(option.id)}>
								<span class="ending-name">{option.name}</span>
								<span class="ending-sub">{option.subtitle}</span>
								<span class="ending-text">{option.text}</span>
							</button>
						{/each}
					</div>
					<p class="fine">可以先去记录页确认各角色的许可状态，再回来选择；选择后仍可回到地图查看后日谈。</p>
				{/if}
			</section>
		{/if}
	</main>

	{#if phase !== 'loading'}
		<aside class="drawer" class:open={!!drawer} aria-hidden={!drawer}>
			{#if drawer}
				<div class="drawer-head">
					<h2>
						{drawer === 'notes' ? '笔记与证据' : drawer === 'history' ? '对话历史' : drawer === 'record' ? '完成记录' : drawer === 'settings' ? '设置与存档' : '本场调查'}
					</h2>
					<button type="button" onclick={() => (drawer = null)} aria-label="关闭面板">×</button>
				</div>
				<div class="drawer-body">
					{#if drawer === 'hotspots' && scene}
						<ul class="drawer-hotspots">
							{#each scene.hotspots as hotspot (hotspot.id)}
								{@const found = !!save?.hotspots.includes(`${scene.id}/${hotspot.id}`)}
								{@const required = !!scene.requiresHotspots?.includes(hotspot.id)}
								<li>
									<button type="button" onclick={() => inspect(hotspot)}>
										<span>{hotspot.title}</span>
										{#if required}<span class="tag">关键</span>{/if}
										<span class="found-mark">{found ? '✓ 已调查' : '未调查'}</span>
									</button>
								</li>
							{/each}
						</ul>
					{:else if drawer === 'notes'}
						<section class="notes">
							<h3>证据 {inventoryCount} 件</h3>
							{#if !inventoryCount}<p class="fine">还没有证据。调查场景物件与关键对白会自动入册，并记录出处。</p>{/if}
							<ul class="evidence-list">
								{#each save?.evidence ?? [] as item (item.id)}
									<li>
										<h4>{item.title}</h4>
										<p>{item.text}</p>
										<p class="source">编号：{item.id}</p>
									</li>
								{/each}
							</ul>
							<label class="notes-label" for="yuye-notes">自己的笔记（自动保存在故事存档）</label>
							<textarea
								id="yuye-notes"
								rows="6"
								value={save?.notes ?? ''}
								oninput={(event) => {
									if (!save) return;
									patch({ notes: (event.currentTarget as HTMLTextAreaElement).value });
								}}
								placeholder="记下想核对的路名、页码或约定。"
							></textarea>
						</section>
					{:else if drawer === 'history'}
						<section class="history">
							{#if !history.length}<p class="fine">本次会话还没有对白记录。历史面板保留原文，被舞台改写过的文本另列在证据中。</p>{/if}
							<ol>
								{#each history as entry, index (index)}
									<li class:note={entry.kind === 'note'} class:choice={entry.kind === 'choice'}>
										<span class="history-speaker">{entry.speaker}</span>
										<p>{entry.text}</p>
									</li>
								{/each}
							</ol>
						</section>
					{:else if drawer === 'record'}
						<section class="record">
							<h3>故事存档</h3>
							<p class="fine">独立数据库 PhiCommunityYuye。自由模式的最佳成绩、RKS、回放与本地谱面不受影响。</p>
							<dl class="record-grid">
								<div><dt>内容版本</dt><dd>{save?.contentVersion ?? '—'}</dd></div>
								<div><dt>存档 revision</dt><dd>{save?.revision ?? '—'}</dd></div>
								<div><dt>已完成场景</dt><dd>{save?.completed.length ?? 0} / {SCENES.length}</dd></div>
								<div><dt>证据</dt><dd>{inventoryCount}</dd></div>
								<div><dt>谜题</dt><dd>{save?.puzzles.length ?? 0} / 9</dd></div>
								<div><dt>过场</dt><dd>{save?.cutscenes.length ?? 0} / 12</dd></div>
								<div><dt>曲目回执</dt><dd>{save ? Object.keys(save.trackReceipts).length : 0} / 32</dd></div>
								<div><dt>结局</dt><dd>{save?.ending ? (ENDINGS.find((item) => item.id === save?.ending)?.name ?? '已记录') : '未选择'}</dd></div>
							</dl>

							<h3>有效活动计时</h3>
							<p class="fine">只统计前台且有输入的互斥活动；下载、挂机、暂停与失败重试不计入，且任何进度都不依赖累计时间。</p>
							<ul class="time-list">
								{#each CATEGORY_ROWS as row (row.id)}
									<li>
										<span>{row.label}</span>
										<span class="time-value">{formatMinutes(save?.activeSeconds[row.id] ?? 0)}</span>
									</li>
								{/each}
							</ul>
							<p class="total">合计 {totalMinutes} 分钟（本页以来的累计，不是已验收的首见时长）</p>

							<h3>章节</h3>
							<ol class="chapter-status">
								{#each CHAPTERS as entry (entry.id)}
									<li class:done={save && chapterComplete(save, entry)}>
										<span>第 {entry.id} 章 · {entry.title}</span>
										<span>{save && chapterComplete(save, entry) ? '完成' : chapterUnlocked(entry) ? '进行中' : '未开放'}</span>
									</li>
								{/each}
							</ol>

							<h3>只读诊断端口</h3>
							<p class="fine">电脑控制台可输入 <code>window.yuye.inspect('clock')</code>、<code>window.yuye.inspect('cast')</code> 或 <code>window.yuye.verify()</code>。这里的功能与手机端按钮读取同一份故事状态，不读取账号、成绩或浏览器隐私。</p>
							<div class="diagnostic-actions">
								<button type="button" onclick={() => say({ kind: 'info', text: refreshDiagnostic('clock') })}>钟楼诊断</button>
								<button type="button" onclick={() => say({ kind: 'info', text: refreshDiagnostic('cast') })}>排演清单</button>
								<button type="button" onclick={() => say({ kind: 'info', text: refreshDiagnostic('verify') })}>三案例验收</button>
							</div>
							<details>
								<summary>控制台入口说明</summary>
								<pre>{DIAGNOSTIC_HELP}</pre>
							</details>
						</section>
					{:else if drawer === 'settings'}
						<section class="settings">
							<label class="range">
								<span>音量 <b>{Math.round(prefs.volume * 100)}%</b></span>
								<input type="range" min="0" max="1" step="0.05" value={prefs.volume} oninput={(event) => setPreference('volume', Number((event.currentTarget as HTMLInputElement).value))} />
							</label>
							<label class="range">
								<span>文字倍率 <b>{prefs.textSize.toFixed(2)}×</b></span>
								<input type="range" min="0.75" max="2" step="0.05" value={prefs.textSize} oninput={(event) => setPreference('textSize', Number((event.currentTarget as HTMLInputElement).value))} />
							</label>
							<label class="toggle"><input type="checkbox" checked={prefs.reducedMotion} onchange={(event) => setPreference('reducedMotion', (event.currentTarget as HTMLInputElement).checked)} /> 降低动态（保留全部剧情与证据）</label>
							<label class="toggle"><input type="checkbox" checked={prefs.horror} onchange={(event) => setPreference('horror', (event.currentTarget as HTMLInputElement).checked)} /> 允许较强恐怖表现（无闪光与音量失控）</label>

							<h3>导入 / 导出</h3>
							<p class="fine">导出只包含故事存档。导入会校验 schema、内容版本与结构，失败时不覆盖当前存档。</p>
							<div class="settings-actions">
								<button type="button" onclick={downloadExport} disabled={!save}>导出故事存档</button>
								<button type="button" onclick={() => fileInput?.click()}>选择导入文件</button>
								<input bind:this={fileInput} type="file" accept="application/json,.json" hidden onchange={onImportFile} />
							</div>
							{#if importError}<p class="error" role="alert">{importError}</p>{/if}
							{#if pendingImport}
								<div class="import-confirm" role="status">
									<p>导入文件有效：当前场景 {pendingImport.scene}，已完成 {pendingImport.completed.length} 个场景，revision {pendingImport.revision}。</p>
									<div class="settings-actions">
										<button type="button" class="primary" onclick={commitImport}>确认替换故事存档</button>
										<button type="button" onclick={() => (pendingImport = null)}>取消</button>
									</div>
								</div>
							{/if}

							<h3>重新开始</h3>
							<p class="fine">替换当前故事进度，不触碰自由模式数据、本地谱面与回放。</p>
							<label class="toggle"><input type="checkbox" bind:checked={confirmRestart} /> 我确认要替换当前故事进度</label>
							<div class="settings-actions">
								<button type="button" class="danger" disabled={!confirmRestart} onclick={startNewGame}>重新开始故事</button>
								<button type="button" onclick={leaveStory}>离开故事模式</button>
							</div>
						</section>
					{/if}
				</div>
			{/if}
		</aside>
	{/if}

	{#if drawer}<button type="button" class="scrim" aria-label="关闭面板" onclick={() => (drawer = null)}></button>{/if}

	{#if banner}
		<div class="toast" class:error={banner.kind === 'error'} role="status">
			<pre>{banner.text}</pre>
			{#if conflict}
				<button type="button" onclick={async () => { const reloaded = await loadStory(); if (reloaded) { save = reloaded; latest = reloaded; const target = SCENES.find((candidate) => candidate.id === reloaded.scene); if (target) { try { save = enterScene(reloaded, target, CHAPTERS); latest = save; } catch { phase = 'map'; } } conflict = false; banner = null; } }}>重新载入存档</button>
			{/if}
			<button type="button" onclick={() => (banner = null)} aria-label="关闭提示">×</button>
		</div>
	{/if}
</div>

<style>
	.story {
		--ink: #f0ece4;
		--ink-dim: #b9b5ad;
		--ink-faint: #7d7a74;
		--paper: #0c0c0c;
		--panel: #141414;
		--line: #4a4a48;
		--line-soft: #2a2a29;
		--serif: 'Songti SC', 'Noto Serif SC', 'Source Han Serif SC', Georgia, serif;
		--mono: 'Courier New', ui-monospace, Menlo, Consolas, monospace;
		position: relative;
		height: 100vh;
		height: 100dvh;
		display: flex;
		flex-direction: column;
		background: var(--paper);
		color: var(--ink);
		font-family: var(--serif);
		font-size: calc(1rem * var(--ts, 1));
		line-height: 1.75;
		overflow-x: hidden;
		overflow-y: auto;
		overscroll-behavior: contain;
		user-select: text;
	}

	button {
		font: inherit;
		color: inherit;
		background: transparent;
		border: 1px solid var(--line);
		border-radius: 2px;
		padding: 0.52em 1.05em;
		min-height: 44px;
		cursor: pointer;
		transition:
			background 0.16s ease,
			color 0.16s ease,
			border-color 0.16s ease,
			transform 0.12s ease;
	}
	button:hover:not(:disabled) {
		background: var(--ink);
		color: var(--paper);
		border-color: var(--ink);
	}
	button:active:not(:disabled) {
		transform: translateY(1px);
	}
	button:disabled {
		opacity: 0.42;
		cursor: not-allowed;
	}
	button:focus-visible {
		outline: 2px solid var(--ink);
		outline-offset: 3px;
	}
	.primary {
		background: var(--ink);
		color: var(--paper);
		border-color: var(--ink);
		font-weight: 700;
	}
	.primary:hover:not(:disabled) {
		background: transparent;
		color: var(--ink);
	}
	.ghost {
		border-color: transparent;
		color: var(--ink-dim);
	}
	.danger {
		border-color: #8a8a88;
	}

	h1,
	h2,
	h3,
	h4 {
		font-weight: 400;
		letter-spacing: 0.02em;
	}
	h1 {
		font-size: clamp(1.6rem, 4vw, 2.5rem);
		margin: 0;
	}
	h2 {
		font-size: 1.15rem;
		margin: 0;
	}
	h3 {
		font-size: 1rem;
		margin: 1.6rem 0 0.5rem;
		letter-spacing: 0.12em;
		color: var(--ink-dim);
	}
	code,
	pre {
		font-family: var(--mono);
	}
	.eyebrow {
		margin: 0;
		font-family: var(--mono);
		font-size: 0.66rem;
		letter-spacing: 0.24em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}
	.fine {
		font-size: 0.8rem;
		color: var(--ink-faint);
	}

	/* ---------- 工具栏 ---------- */

	.bar {
		position: sticky;
		top: 0;
		z-index: 30;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
		flex-wrap: wrap;
		padding: 0.5rem clamp(0.8rem, 3vw, 2rem);
		background: rgba(8, 8, 8, 0.94);
		border-bottom: 1px solid var(--line-soft);
		backdrop-filter: blur(6px);
	}
	.brand {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		min-width: 0;
	}
	.brand-cn {
		font-size: 1.15rem;
		letter-spacing: 0.2em;
	}
	.brand-en {
		font-family: var(--mono);
		font-size: 0.56rem;
		letter-spacing: 0.2em;
		color: var(--ink-faint);
	}
	.bar-actions {
		display: flex;
		gap: 0.35rem;
		flex-wrap: nowrap;
		justify-content: flex-end;
		max-width: 100%;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.bar-actions::-webkit-scrollbar {
		display: none;
	}
	.bar-actions button {
		min-height: 38px;
		padding: 0.3em 0.75em;
		font-size: 0.82rem;
		border-color: transparent;
		color: var(--ink-dim);
	}
	.bar-actions button:hover:not(:disabled) {
		color: var(--paper);
	}
	.bar-actions button.active {
		color: var(--ink);
		border-color: var(--line);
	}
	.bar-actions .leave {
		border-left: 1px solid var(--line-soft);
		margin-left: 0.3rem;
	}
	.count {
		display: inline-block;
		margin-left: 0.35em;
		font-family: var(--mono);
		font-size: 0.66rem;
		color: var(--ink-faint);
	}

	.page {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	/* ---------- 启动 ---------- */

	.boot {
		margin: auto;
		text-align: center;
		color: var(--ink-dim);
	}

	/* ---------- 封面 ---------- */

	.cover {
		flex: 1;
		display: grid;
		grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
		align-items: center;
		gap: clamp(1.5rem, 5vw, 4rem);
		padding: clamp(1.5rem, 5vw, 4rem);
		max-width: 1200px;
		width: 100%;
		margin: 0 auto;
	}
	.cover-glyph {
		display: flex;
		justify-content: center;
		gap: 0.1em;
		font-size: clamp(4rem, 14vw, 10rem);
		line-height: 1;
		color: var(--ink);
		writing-mode: vertical-rl;
		letter-spacing: 0.08em;
		opacity: 0.94;
	}
	.cover-glyph span:last-child {
		color: transparent;
		-webkit-text-stroke: 1px var(--ink-dim);
	}
	.cover-copy h1 {
		font-size: clamp(2.6rem, 8vw, 5rem);
		letter-spacing: 0.24em;
		margin: 0.2em 0 0;
	}
	.cover-sub {
		margin: 0.2em 0 1.4em;
		font-family: var(--mono);
		font-size: 0.74rem;
		letter-spacing: 0.34em;
		color: var(--ink-faint);
	}
	.cover-lead {
		max-width: 34em;
		color: var(--ink-dim);
		margin: 0 0 1.2em;
	}
	.cover-facts {
		list-style: none;
		margin: 0 0 1.8em;
		padding: 0;
		display: grid;
		gap: 0.3em;
		font-size: 0.86rem;
		color: var(--ink-dim);
	}
	.cover-facts li::before {
		content: '—';
		margin-right: 0.7em;
		color: var(--ink-faint);
	}
	.cover-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin-bottom: 1.2rem;
	}
	.cover-progress {
		font-family: var(--mono);
		font-size: 0.74rem;
		color: var(--ink-faint);
		margin: 0 0 0.8rem;
	}
	.cover-warning {
		font-size: 0.78rem;
		color: var(--ink-faint);
		border-left: 1px solid var(--line);
		padding-left: 0.9em;
		max-width: 40em;
	}
	.restart-check {
		display: flex;
		gap: 0.5em;
		align-items: flex-start;
		font-size: 0.78rem;
		color: var(--ink-dim);
		max-width: 36em;
	}

	/* ---------- 地图 ---------- */

	.map {
		padding: clamp(1rem, 3vw, 2.2rem);
		max-width: 1240px;
		width: 100%;
		margin: 0 auto;
	}
	.map-head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1rem;
		border-bottom: 1px solid var(--line-soft);
		padding-bottom: 1.2rem;
		margin-bottom: 1.4rem;
	}
	.map-lead {
		color: var(--ink-dim);
		max-width: 42em;
		margin: 0.6em 0 0;
		font-size: 0.9rem;
	}
	.map-head .primary {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.15em;
		text-align: left;
	}
	.map-head .primary span {
		font-size: 0.72rem;
		font-weight: 400;
		opacity: 0.75;
	}
	.map-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 21rem), 1fr));
		gap: 1rem;
	}
	.chapter-card {
		border: 1px solid var(--line-soft);
		background: var(--panel);
		padding: 1rem 1.05rem 0.7rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.chapter-card.done {
		border-color: var(--line);
	}
	.chapter-card.locked {
		opacity: 0.55;
	}
	.chapter-card.parallel .chapter-no::after {
		content: ' ∥';
		color: var(--ink-faint);
	}
	.chapter-no {
		margin: 0;
		font-family: var(--mono);
		font-size: 0.66rem;
		letter-spacing: 0.2em;
		color: var(--ink-faint);
	}
	.chapter-region {
		margin: 0.15em 0 0;
		font-size: 0.76rem;
		color: var(--ink-faint);
	}
	.chapter-desc {
		margin: 0;
		font-size: 0.84rem;
		color: var(--ink-dim);
	}
	.lock {
		margin: 0;
		font-size: 0.76rem;
		color: var(--ink-faint);
		border-left: 1px solid var(--line);
		padding-left: 0.7em;
	}
	.scene-list {
		list-style: none;
		margin: 0.2rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.scene-row {
		width: 100%;
		display: grid;
		grid-template-columns: 1.1em minmax(0, 1fr) auto;
		align-items: baseline;
		gap: 0.5em;
		padding: 0.55em 0.2em;
		min-height: 42px;
		border: 0;
		border-bottom: 1px solid var(--line-soft);
		text-align: left;
		font-size: 0.86rem;
	}
	.scene-row:hover:not(:disabled) {
		background: #1e1e1e;
		color: var(--ink);
	}
	.scene-row.locked {
		color: var(--ink-faint);
	}
	.scene-row.done .scene-name {
		color: var(--ink-dim);
	}
	.scene-mark {
		font-family: var(--mono);
		color: var(--ink-faint);
	}
	.scene-name {
		overflow-wrap: anywhere;
	}
	.scene-loc {
		font-family: var(--mono);
		font-size: 0.64rem;
		color: var(--ink-faint);
		white-space: nowrap;
	}
	.scene-lock {
		grid-column: 2 / -1;
		font-size: 0.68rem;
		color: var(--ink-faint);
	}
	.scene-done {
		grid-column: 2 / -1;
		font-family: var(--mono);
		font-size: 0.62rem;
		color: var(--ink-faint);
		letter-spacing: 0.14em;
	}
	.ending-entry {
		margin-top: 1.6rem;
		padding: 1rem;
		border: 1px solid var(--line);
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	/* ---------- 场景 ---------- */

	.scene {
		position: relative;
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		isolation: isolate;
	}
	.backdrop-layer {
		position: absolute;
		inset: 0;
		opacity: 0.6;
		filter: grayscale(1);
		pointer-events: none;
		z-index: 0;
	}
	.scene-head {
		position: relative;
		z-index: 2;
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: 0.8rem;
		padding: clamp(0.9rem, 2.4vw, 1.6rem) clamp(0.9rem, 3vw, 2.2rem) 0;
	}
	.scene-head h1 {
		font-size: clamp(1.2rem, 3vw, 1.8rem);
		margin-top: 0.15em;
		text-shadow: 0 2px 18px #000;
	}
	.scene-meter {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-family: var(--mono);
		font-size: 0.7rem;
		color: var(--ink-dim);
	}
	.scene-meter progress {
		width: clamp(5rem, 16vw, 12rem);
		height: 3px;
		appearance: none;
		border: 0;
		background: #3a3a38;
	}
	.scene-meter progress::-webkit-progress-bar {
		background: #3a3a38;
	}
	.scene-meter progress::-webkit-progress-value {
		background: var(--ink);
	}
	.scene-meter progress::-moz-progress-bar {
		background: var(--ink);
	}
	.scene-area {
		position: relative;
		z-index: 2;
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: minmax(13rem, 16rem) minmax(0, 1fr);
		gap: clamp(0.8rem, 2vw, 1.6rem);
		align-items: end;
		padding: clamp(0.8rem, 2.2vw, 1.6rem) clamp(0.9rem, 3vw, 2.2rem) clamp(0.9rem, 2.4vw, 1.8rem);
	}
	.hotspot-rail {
		align-self: stretch;
		max-height: min(58vh, 30rem);
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.9rem;
		background: rgba(10, 10, 10, 0.88);
		border: 1px solid var(--line-soft);
		overflow-y: auto;
	}
	.hotspot-rail h2 {
		font-size: 0.78rem;
		letter-spacing: 0.22em;
		color: var(--ink-dim);
	}
	.rail-note,
	.rail-warn {
		margin: 0;
		font-size: 0.7rem;
		color: var(--ink-faint);
		line-height: 1.6;
	}
	.rail-warn {
		color: var(--ink);
		border-top: 1px solid var(--line);
		padding-top: 0.5em;
	}
	.hotspot-rail ul {
		list-style: none;
		margin: 0.2rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.hotspot {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.45em;
		text-align: left;
		font-size: 0.8rem;
		padding: 0.45em 0.55em;
		min-height: 40px;
		border-color: var(--line-soft);
		color: var(--ink-dim);
	}
	.hotspot.found {
		color: var(--ink-faint);
	}
	.hotspot-title {
		flex: 1;
		overflow-wrap: anywhere;
	}
	.tag {
		font-family: var(--mono);
		font-size: 0.6rem;
		letter-spacing: 0.12em;
		border: 1px solid var(--line);
		padding: 0.1em 0.35em;
		color: var(--ink);
		white-space: nowrap;
	}
	.found-mark {
		font-family: var(--mono);
		font-size: 0.64rem;
		color: var(--ink-faint);
	}

	.stage-body {
		min-width: 0;
		align-self: end;
		width: 100%;
	}

	.dialogue {
		position: relative;
		width: min(100%, 62rem);
		margin: 0 auto;
		background: linear-gradient(180deg, rgba(12, 12, 12, 0.82), rgba(8, 8, 8, 0.96));
		border: 1px solid var(--line);
		padding: clamp(1rem, 2.4vw, 1.8rem);
		box-shadow: 0 24px 70px rgba(0, 0, 0, 0.7);
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		animation: rise 0.34s cubic-bezier(0.22, 1, 0.36, 1) both;
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	.speaker {
		margin: 0;
		font-size: 0.8rem;
		letter-spacing: 0.22em;
		color: var(--ink-dim);
	}
	.speaker::after {
		content: '';
		display: block;
		width: 2.2rem;
		height: 1px;
		margin-top: 0.5em;
		background: var(--line);
	}
	.line {
		margin: 0.2em 0 0;
		font-size: 1.02rem;
		line-height: 1.95;
		color: var(--ink);
		overflow-wrap: anywhere;
	}
	.line b {
		font-weight: 400;
		letter-spacing: 0.12em;
		color: var(--ink-dim);
		margin-right: 0.7em;
		font-size: 0.84rem;
	}
	.description {
		margin: 0;
		font-size: 0.84rem;
		color: var(--ink-faint);
		border-left: 1px solid var(--line);
		padding-left: 0.8em;
	}
	.meta-line {
		margin: 0;
		font-family: var(--mono);
		font-size: 0.7rem;
		color: var(--ink-faint);
	}
	.evidence-card h2 {
		font-size: 1.3rem;
		margin-top: 0.2em;
	}
	.dialogue-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
		margin-top: 0.7rem;
	}
	.hint {
		font-family: var(--mono);
		font-size: 0.66rem;
		color: var(--ink-faint);
		letter-spacing: 0.08em;
	}
	.options {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.6rem;
	}
	.options button {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		text-align: left;
		padding: 0.75em 1em;
		font-size: 0.94rem;
	}
	.option-arrow {
		font-family: var(--mono);
		opacity: 0.6;
	}

	/* ---------- 谜题与过场外壳 ---------- */

	.puzzle-shell {
		width: min(100%, 68rem);
		margin: 0 auto;
		max-height: min(78vh, 52rem);
		overflow-y: auto;
		background: #0a0a0a;
		border: 1px solid var(--line);
	}
	.puzzle-head {
		padding: 1rem 1.1rem 0.4rem;
	}
	.puzzle-head h2 {
		margin-top: 0.1em;
		font-size: 1.35rem;
	}
	.puzzle-lead {
		margin: 0.3em 0 0;
		font-size: 0.8rem;
		color: var(--ink-faint);
	}
	.puzzle-foot {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
		padding: 0.9rem 1.1rem 1.2rem;
		border-top: 1px solid var(--line-soft);
	}
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: clamp(0.5rem, 2vw, 1.5rem);
		background: rgba(4, 4, 4, 0.94);
		overflow-y: auto;
	}
	.overlay-inner {
		width: min(100%, 74rem);
		max-height: 100%;
		overflow-y: auto;
	}

	/* ---------- 结局 ---------- */

	.ending {
		flex: 1;
		width: min(100%, 62rem);
		margin: 0 auto;
		padding: clamp(1.2rem, 4vw, 3rem);
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
	}
	.ending-lead {
		color: var(--ink-dim);
		max-width: 44em;
	}
	.ending-options {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
		gap: 0.8rem;
		margin-top: 0.6rem;
	}
	.ending-card {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.35em;
		padding: 1.1rem;
		text-align: left;
		min-height: 12rem;
		border-color: var(--line);
		background: var(--panel);
	}
	.ending-card:hover:not(:disabled) {
		background: var(--ink);
		color: var(--paper);
	}
	.ending-name {
		font-size: 1.4rem;
		letter-spacing: 0.22em;
	}
	.ending-sub {
		font-family: var(--mono);
		font-size: 0.68rem;
		letter-spacing: 0.12em;
		opacity: 0.8;
	}
	.ending-text {
		font-size: 0.84rem;
		line-height: 1.8;
		opacity: 0.9;
	}
	.epilogue {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		max-width: 44em;
	}
	.epilogue p {
		margin: 0;
		color: var(--ink-dim);
		line-height: 2;
	}
	.epilogue-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin-top: 0.5rem;
	}

	/* ---------- 抽屉 ---------- */

	.drawer {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		width: min(100%, 34rem);
		z-index: 50;
		background: #0b0b0b;
		border-left: 1px solid var(--line);
		transform: translateX(102%);
		transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
		display: flex;
		flex-direction: column;
		visibility: hidden;
	}
	.drawer.open {
		transform: none;
		visibility: visible;
	}
	.drawer-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.9rem 1.1rem;
		border-bottom: 1px solid var(--line-soft);
	}
	.drawer-head h2 {
		font-size: 1rem;
		letter-spacing: 0.16em;
	}
	.drawer-head button {
		min-height: 38px;
		padding: 0 0.7em;
		font-size: 1.1rem;
		line-height: 1;
	}
	.drawer-body {
		flex: 1;
		overflow-y: auto;
		padding: 1rem 1.1rem 2rem;
	}
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 40;
		background: rgba(0, 0, 0, 0.55);
		border: 0;
		min-height: 0;
		padding: 0;
	}
	.drawer-hotspots {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.drawer-hotspots button {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.6em;
		justify-content: space-between;
		text-align: left;
		font-size: 0.86rem;
	}
	.evidence-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
	}
	.evidence-list li {
		border: 1px solid var(--line-soft);
		padding: 0.8rem;
		background: #101010;
	}
	.evidence-list h4 {
		margin: 0 0 0.3em;
		font-size: 0.94rem;
	}
	.evidence-list p {
		margin: 0;
		font-size: 0.84rem;
		line-height: 1.85;
		color: var(--ink-dim);
	}
	.evidence-list .source {
		margin-top: 0.5em;
		font-family: var(--mono);
		font-size: 0.62rem;
		color: var(--ink-faint);
	}
	.notes-label {
		display: block;
		margin: 1.4rem 0 0.4rem;
		font-size: 0.8rem;
		color: var(--ink-dim);
	}
	textarea {
		width: 100%;
		font: inherit;
		font-size: 0.86rem;
		color: var(--ink);
		background: #101010;
		border: 1px solid var(--line);
		padding: 0.7rem;
		resize: vertical;
	}
	textarea:focus-visible {
		outline: 2px solid var(--ink);
		outline-offset: 2px;
	}
	.history ol {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}
	.history li {
		border-left: 1px solid var(--line-soft);
		padding-left: 0.8em;
	}
	.history li.note {
		border-left-color: var(--line);
	}
	.history-speaker {
		font-family: var(--mono);
		font-size: 0.64rem;
		letter-spacing: 0.16em;
		color: var(--ink-faint);
	}
	.history p {
		margin: 0.25em 0 0;
		font-size: 0.86rem;
		line-height: 1.9;
		color: var(--ink-dim);
	}
	.record-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
		gap: 0.6rem;
		margin: 0.8rem 0 0;
	}
	.record-grid div {
		border: 1px solid var(--line-soft);
		padding: 0.55rem 0.7rem;
	}
	.record-grid dt {
		font-family: var(--mono);
		font-size: 0.6rem;
		letter-spacing: 0.12em;
		color: var(--ink-faint);
	}
	.record-grid dd {
		margin: 0.2em 0 0;
		font-size: 0.92rem;
	}
	.time-list {
		list-style: none;
		margin: 0.5rem 0 0;
		padding: 0;
	}
	.time-list li {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		font-size: 0.84rem;
		color: var(--ink-dim);
		border-bottom: 1px dashed var(--line-soft);
		padding: 0.4em 0;
	}
	.time-value {
		font-family: var(--mono);
		font-size: 0.72rem;
	}
	.total {
		font-family: var(--mono);
		font-size: 0.7rem;
		color: var(--ink-faint);
		margin-top: 0.6em;
	}
	.chapter-status {
		list-style: none;
		margin: 0.5rem 0 0;
		padding: 0;
		font-size: 0.82rem;
	}
	.chapter-status li {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.4em 0;
		border-bottom: 1px solid var(--line-soft);
		color: var(--ink-faint);
	}
	.chapter-status li.done {
		color: var(--ink);
	}
	.chapter-status li span:last-child {
		font-family: var(--mono);
		font-size: 0.64rem;
		letter-spacing: 0.12em;
	}
	.diagnostic-actions,
	.settings-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin: 0.6rem 0;
	}
	details {
		margin-top: 0.8rem;
		border: 1px solid var(--line-soft);
		padding: 0.6rem 0.8rem;
	}
	summary {
		cursor: pointer;
		font-size: 0.82rem;
		color: var(--ink-dim);
	}
	details pre {
		white-space: pre-wrap;
		word-break: break-word;
		font-size: 0.72rem;
		color: var(--ink-dim);
		line-height: 1.7;
	}
	.range {
		display: flex;
		flex-direction: column;
		gap: 0.4em;
		margin-bottom: 1rem;
		font-size: 0.84rem;
		color: var(--ink-dim);
	}
	.range span {
		display: flex;
		justify-content: space-between;
	}
	.range b {
		font-family: var(--mono);
		font-weight: 400;
	}
	input[type='range'] {
		width: 100%;
		accent-color: #f0ece4;
		min-height: 32px;
	}
	.toggle {
		display: flex;
		gap: 0.6em;
		align-items: flex-start;
		font-size: 0.84rem;
		color: var(--ink-dim);
		margin-bottom: 0.7em;
	}
	.toggle input {
		margin-top: 0.4em;
		accent-color: #f0ece4;
	}
	.import-confirm {
		border: 1px solid var(--line);
		padding: 0.8rem;
		font-size: 0.84rem;
		color: var(--ink-dim);
	}
	.import-confirm p {
		margin: 0 0 0.6em;
	}
	.error {
		color: var(--ink);
		border-left: 2px solid var(--ink);
		padding-left: 0.7em;
		font-size: 0.82rem;
	}

	/* ---------- 提示条 ---------- */

	.toast {
		position: fixed;
		left: 50%;
		top: 3.6rem;
		transform: translateX(-50%);
		z-index: 70;
		width: min(calc(100% - 1.6rem), 46rem);
		display: flex;
		align-items: flex-start;
		gap: 0.7rem;
		padding: 0.75rem 0.9rem;
		background: #f0ece4;
		color: #0c0c0c;
		border: 1px solid #f0ece4;
		box-shadow: 0 18px 50px rgba(0, 0, 0, 0.6);
		/* 提示条不遮挡剧情交互：只有它自己的按钮可点。 */
		pointer-events: none;
	}
	.toast pre {
		margin: 0;
		flex: 1;
		white-space: pre-wrap;
		word-break: break-word;
		font-family: var(--serif);
		font-size: 0.82rem;
		line-height: 1.7;
	}
	.toast button {
		color: #0c0c0c;
		border-color: #0c0c0c;
		min-height: 34px;
		padding: 0.2em 0.6em;
		font-size: 0.76rem;
		white-space: nowrap;
		pointer-events: auto;
	}
	.toast button:hover {
		background: #0c0c0c;
		color: #f0ece4;
	}

	/* ---------- 动效与移动端 ---------- */

	@keyframes reveal {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	.reduced .dialogue {
		animation: none;
	}
	.reduced .drawer {
		transition: none;
	}

	@media (max-width: 900px) {
		.cover {
			grid-template-columns: 1fr;
			gap: 1.2rem;
		}
		.cover-glyph {
			writing-mode: horizontal-tb;
			font-size: clamp(3rem, 18vw, 5rem);
			justify-content: flex-start;
		}
		/* 窄屏不再把对话框压进固定高度：整场可滚动，背景仍铺满内容。 */
		.scene {
			overflow-y: auto;
			overflow-x: hidden;
		}
		.scene-area {
			grid-template-columns: minmax(0, 1fr);
			align-items: stretch;
			min-height: 0;
		}
		.hotspot-rail {
			display: none;
		}
		.dialogue {
			width: 100%;
			margin-top: auto;
		}
	}
	@media (max-width: 640px) {
		.story {
			font-size: calc(0.95rem * var(--ts, 1));
		}
		.bar {
			gap: 0.4rem;
			padding: 0.4rem 0.7rem;
			flex-wrap: nowrap;
		}
		.brand {
			flex: 0 0 auto;
		}
		.bar-actions {
			flex: 1 1 auto;
			min-width: 0;
			justify-content: flex-start;
		}
		.brand-en {
			display: none;
		}
		.bar-actions button {
			min-height: 36px;
			padding: 0.24em 0.55em;
			font-size: 0.76rem;
		}
		.scene-head {
			padding: 0.7rem 0.7rem 0;
		}
		.scene-area {
			padding: 0.7rem 0.7rem 0.8rem;
		}
		.dialogue {
			padding: 0.9rem;
		}
		.line {
			font-size: 0.98rem;
			line-height: 1.85;
		}
		.map {
			padding: 0.9rem 0.7rem;
		}
		.ending {
			padding: 1rem 0.8rem;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.dialogue {
			animation: none;
		}
		.drawer {
			transition: none;
		}
		button {
			transition: none;
		}
	}
</style>
