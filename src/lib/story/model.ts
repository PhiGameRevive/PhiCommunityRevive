import type { Evidence, StoryBeat, StoryCategory, StoryChapter, StoryEnding, StoryReceipt, StorySave, StoryScene } from './types';

export const CONTENT_VERSION = 'yuye-1';

const categories: StoryCategory[] = ['dialogue', 'exploration', 'puzzle', 'music', 'cutscene'];
const modes = new Set(['manual', 'auto', 'listen', 'summary']);
const endings = new Set<StoryEnding>(['unbound', 'daylight', 'closed']);
const prerequisites: number[][] = [[], [0], [1], [1], [1], [2, 3, 4], [5], [6], [7], [8]];
const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype']);

/** 场景定义不写入存档。加载后先 enterScene(save, scene, chapters)，为无 chapters 参数的命令绑定内容上下文。 */
const contexts = new WeakMap<StoryScene, StoryChapter[]>();

function key(value: string): string {
	if (typeof value !== 'string' || !value || value.length > 256 || value.split('/').some((part) => unsafeKeys.has(part))) throw new Error('无效的故事标识符');
	return value;
}

function has(record: object, id: string): boolean {
	return Object.prototype.hasOwnProperty.call(record, key(id));
}

function updated(save: StorySave, changes: Partial<StorySave>): StorySave {
	if (!Number.isSafeInteger(save.revision) || save.revision < 0 || save.revision === Number.MAX_SAFE_INTEGER) throw new Error('存档 revision 已无效或溢出');
	return { ...save, ...changes, revision: save.revision + 1 };
}

function bind(chapters: StoryChapter[]): void {
	for (const chapter of chapters) for (const scene of chapter.scenes) contexts.set(scene, chapters);
}

function position(save: StorySave, scene: StoryScene): number {
	const value = has(save.positions, scene.id) ? save.positions[scene.id] : 0;
	if (!Number.isSafeInteger(value) || value < 0 || value > scene.steps.length) throw new Error('场景游标无效');
	if (save.completed.includes(scene.id) !== (value === scene.steps.length)) throw new Error('场景游标与完成记录不一致');
	return value;
}

function active(save: StorySave, scene: StoryScene): number {
	const chapters = contexts.get(scene);
	if (!chapters || !sceneOpen(save, scene, chapters)) throw new Error('场景尚未开放；加载后请先进入场景');
	if (save.scene !== scene.id) throw new Error('只能操作当前所在场景');
	if (!has(save.positions, scene.id)) throw new Error('当前场景缺少游标');
	return position(save, scene);
}

function activeBeat(save: StorySave, scene: StoryScene): StoryBeat {
	const beat = scene.steps[active(save, scene)];
	if (!beat) throw new Error('当前场景已结束');
	return beat;
}

function evidenceWith(evidence: Evidence[], item: Evidence): Evidence[] {
	key(item.id);
	return evidence.some((entry) => entry.id === item.id) ? evidence : [...evidence, { id: item.id, title: item.title, text: item.text }];
}

function validReceipt(receipt: StoryReceipt): boolean {
	return modes.has(receipt.mode) && Number.isFinite(receipt.seconds) && receipt.seconds >= 0 && receipt.seconds <= Number.MAX_SAFE_INTEGER;
}

export function createStory(chapters: StoryChapter[]): StorySave {
	const ids = new Set<string>();
	const chapterIds = new Set<number>();
	for (const chapter of chapters) {
		if (!Number.isInteger(chapter.id) || chapter.id < 0 || chapter.id > 9 || chapterIds.has(chapter.id)) throw new Error('章节编号无效或重复');
		chapterIds.add(chapter.id);
		for (const scene of chapter.scenes) {
			key(scene.id);
			if (ids.has(scene.id) || scene.steps.length === 0) throw new Error('场景编号重复或剧情为空');
			ids.add(scene.id);
		}
	}
	const first = chapters.find((chapter) => chapter.id === 0)?.scenes.find((scene) => !scene.optional && scene.requires.length === 0);
	if (!first) throw new Error('缺少第 0 章开放的起始场景');
	bind(chapters);
	return {
		schemaVersion: 1,
		contentVersion: CONTENT_VERSION,
		revision: 0,
		scene: first.id,
		positions: { [first.id]: 0 },
		completed: [],
		choices: {},
		evidence: [],
		hotspots: [],
		trackReceipts: {},
		puzzles: [],
		cutscenes: [],
		seenBeats: [],
		notes: '',
		preferences: { volume: 0.7, reducedMotion: false, horror: true, textSize: 1 },
		activeSeconds: { dialogue: 0, exploration: 0, puzzle: 0, music: 0, cutscene: 0 },
		ending: null,
		reload: null,
	};
}

export function chapterComplete(save: StorySave, chapter: StoryChapter): boolean {
	return chapter.scenes.filter((scene) => !scene.optional).every((scene) => save.completed.includes(scene.id));
}

export function chapterOpen(save: StorySave, chapter: StoryChapter, chapters: StoryChapter[]): boolean {
	if (!Number.isInteger(chapter.id) || !prerequisites[chapter.id] || !chapters.includes(chapter)) return false;
	return prerequisites[chapter.id].every((id) => {
		const previous = chapters.find((candidate) => candidate.id === id);
		return !!previous && chapterComplete(save, previous);
	});
}

export function sceneOpen(save: StorySave, scene: StoryScene, chapters: StoryChapter[]): boolean {
	const chapter = chapters.find((candidate) => candidate.scenes.includes(scene));
	if (!chapter || !chapterOpen(save, chapter, chapters)) return false;
	const open = scene.requires.every((id) => chapter.scenes.some((candidate) => candidate.id === id) && save.completed.includes(id));
	if (open) contexts.set(scene, chapters);
	return open;
}

export function currentBeat(save: StorySave, scene: StoryScene): StoryBeat | undefined {
	return scene.steps[position(save, scene)];
}

/** 每次只消费一拍。必查热点在最后一拍收尾时检查，不能让调查提前吞掉对白或发奖。 */
export function advance(save: StorySave, scene: StoryScene): StorySave {
	const cursor = active(save, scene);
	const beat = scene.steps[cursor];
	if (!beat) throw new Error('当前场景已结束');
	if (beat.type === 'track') {
		const receipt = has(save.trackReceipts, beat.track) ? save.trackReceipts[beat.track] : undefined;
		if (!receipt || receipt.track !== beat.track || !validReceipt(receipt)) throw new Error('请先完成当前演奏或聆听');
	} else if (beat.type === 'puzzle' && !save.puzzles.includes(key(beat.puzzle))) throw new Error('请先完成当前谜题');
	else if (beat.type === 'cutscene' && !save.cutscenes.includes(key(beat.cutscene))) throw new Error('请先观看或跳过当前过场');
	else if (beat.type === 'choice' && (!has(save.choices, beat.id) || !beat.options.some((option) => option.id === save.choices[beat.id]))) throw new Error('请先作出当前选择');
	const complete = cursor + 1 === scene.steps.length;
	if (complete && !(scene.requiresHotspots ?? []).every((id) => scene.hotspots.some((hotspot) => hotspot.id === id) && save.hotspots.includes(`${scene.id}/${key(id)}`))) {
		throw new Error('还有必须调查的场景对象');
	}
	const seen = `${scene.id}/${cursor}`;
	return updated(save, {
		positions: { ...save.positions, [key(scene.id)]: cursor + 1 },
		completed: complete ? [...save.completed, scene.id] : save.completed,
		evidence: beat.type === 'evidence' ? evidenceWith(save.evidence, beat) : save.evidence,
		seenBeats: save.seenBeats.includes(seen) ? save.seenBeats : [...save.seenBeats, seen],
	});
}

export function choose(save: StorySave, scene: StoryScene, optionId: string): StorySave {
	const beat = activeBeat(save, scene);
	key(optionId);
	if (beat.type !== 'choice' || !beat.options.some((option) => option.id === optionId)) throw new Error('当前选项无效');
	return advance({ ...save, choices: { ...save.choices, [key(beat.id)]: optionId } }, scene);
}

export function inspectHotspot(save: StorySave, scene: StoryScene, hotspotId: string): StorySave {
	active(save, scene);
	const hotspot = scene.hotspots.find((candidate) => candidate.id === key(hotspotId));
	if (!hotspot) throw new Error('当前调查对象不存在');
	const id = `${scene.id}/${hotspot.id}`;
	const evidence = hotspot.evidence ? evidenceWith(save.evidence, hotspot.evidence) : save.evidence;
	if (save.hotspots.includes(id) && evidence === save.evidence) return save;
	return updated(save, { hotspots: save.hotspots.includes(id) ? save.hotspots : [...save.hotspots, id], evidence });
}

export function enterScene(save: StorySave, scene: StoryScene, chapters: StoryChapter[]): StorySave {
	if (!sceneOpen(save, scene, chapters)) throw new Error('此场景尚未开放');
	const cursor = position(save, scene);
	if (save.scene === scene.id && has(save.positions, scene.id)) return save;
	return updated(save, { scene: key(scene.id), positions: { ...save.positions, [scene.id]: cursor } });
}

/** 回执首次写入后保持不变；重复回调不累计时间、不改变游标，也不覆盖第一次的模式。 */
export function recordTrack(save: StorySave, scene: StoryScene, receipt: StoryReceipt): StorySave {
	const beat = activeBeat(save, scene);
	if (beat.type !== 'track' || receipt.track !== beat.track || !validReceipt(receipt)) throw new Error('演奏回执不匹配当前曲目或数据无效');
	if (has(save.trackReceipts, receipt.track)) return save;
	return updated(save, { trackReceipts: { ...save.trackReceipts, [receipt.track]: { track: receipt.track, mode: receipt.mode, seconds: receipt.seconds } } });
}

export function markPuzzle(save: StorySave, scene: StoryScene, puzzleId: string): StorySave {
	const beat = activeBeat(save, scene);
	if (beat.type !== 'puzzle' || beat.puzzle !== key(puzzleId)) throw new Error('谜题不匹配当前剧情');
	return save.puzzles.includes(puzzleId) ? save : updated(save, { puzzles: [...save.puzzles, puzzleId] });
}

export function markCutscene(save: StorySave, scene: StoryScene, id: string): StorySave {
	const beat = activeBeat(save, scene);
	if (beat.type !== 'cutscene' || beat.cutscene !== key(id)) throw new Error('过场不匹配当前剧情');
	return save.cutscenes.includes(id) ? save : updated(save, { cutscenes: [...save.cutscenes, id] });
}

/** 调用方只统计前台有效活动；一次最多收取 5 秒，所有推进条件都与此计时独立。 */
export function addTime(save: StorySave, category: StoryCategory, seconds: number): StorySave {
	if (!categories.includes(category) || !Number.isFinite(seconds) || seconds < 0 || seconds > 5) throw new Error('活动时间必须是 0–5 秒的有限数');
	if (seconds === 0) return save;
	const total = save.activeSeconds[category] + seconds;
	if (!Number.isFinite(total) || total > Number.MAX_SAFE_INTEGER) throw new Error('活动时间已溢出');
	return updated(save, { activeSeconds: { ...save.activeSeconds, [category]: total } });
}

export function finishEnding(save: StorySave, ending: StoryEnding, chapters: StoryChapter[]): StorySave {
	const epilogue = chapters.find((chapter) => chapter.id === 9);
	if (!endings.has(ending) || !epilogue || !chapterOpen(save, epilogue, chapters) || !chapterComplete(save, epilogue)) throw new Error('完成第 9 章后才能选择结局');
	return save.ending === ending ? save : updated(save, { ending });
}

/** origin 是本次页面实例的随机标识（不是 URL）；先 commitStory 成功，再执行真正重载或重开布景。 */
export function armReload(save: StorySave, scene: StoryScene, origin: string): StorySave {
	active(save, scene);
	key(origin);
	if (save.reload?.scene === scene.id) return save;
	return updated(save, { reload: { scene: scene.id, origin, returned: false } });
}

export function acknowledgeReload(save: StorySave, newOrigin: string): StorySave {
	key(newOrigin);
	if (!save.reload || save.reload.returned || save.reload.origin === newOrigin) return save;
	return updated(save, { reload: { ...save.reload, returned: true } });
}
