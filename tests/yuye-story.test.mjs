import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { advance, chapterComplete, chapterOpen, choose, createStory, currentBeat, enterScene, finishEnding, inspectHotspot, markCutscene, markPuzzle, recordTrack, sceneOpen, CONTENT_VERSION } from '../src/lib/story/model.ts';
import { CUTSCENES } from '../src/lib/story/cutscenes.ts';

/**
 * catalog.ts 与 puzzles.ts 使用 Vite 的 import.meta.glob / ?raw，不能在裸 Node 中加载；
 * 这里直接从同一批 JSON 构建内容图，保证测试针对实际发布的章节文件。
 */
const CONTENT_DIR = path.join(process.cwd(), 'src/lib/story/content');
const CHAPTERS = fs
	.readdirSync(CONTENT_DIR)
	.filter((file) => file.endsWith('.json'))
	.map((file) => JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, file), 'utf8')))
	.sort((a, b) => a.id - b.id);
const SCENES = CHAPTERS.flatMap((chapter) => chapter.scenes);
const SCENE_BY_ID = new Map(SCENES.map((scene) => [scene.id, scene]));
const TRACK_REFERENCES = SCENES.flatMap((scene) => scene.steps)
	.filter((beat) => beat.type === 'track')
	.map((beat) => beat.track);
const PUZZLE_IDS = SCENES.flatMap((scene) => scene.steps)
	.filter((beat) => beat.type === 'puzzle')
	.map((beat) => beat.puzzle);
const CUTSCENE_IDS = SCENES.flatMap((scene) => scene.steps)
	.filter((beat) => beat.type === 'cutscene')
	.map((beat) => beat.cutscene);

function receipt(track) {
	return { track, mode: 'auto', seconds: 60 };
}

/** 把某一场景完整走完：先补必须调查的热点，再逐拍处理所有 gate。 */
function playScene(save, scene, { answers = {} } = {}) {
	for (const hotspot of scene.hotspots) {
		if (!save.hotspots.includes(`${scene.id}/${hotspot.id}`)) save = inspectHotspot(save, scene, hotspot.id);
	}
	let guard = 0;
	while (!save.completed.includes(scene.id)) {
		if (++guard > 4000) throw new Error(`${scene.id} 无法收尾：${JSON.stringify(currentBeat(save, scene))}`);
		const beat = currentBeat(save, scene);
		assert.ok(beat, `${scene.id} 提前结束但没有完成记录`);
		if (beat.type === 'track') {
			if (!save.trackReceipts[beat.track]) save = recordTrack(save, scene, receipt(beat.track));
		} else if (beat.type === 'puzzle') {
			if (!save.puzzles.includes(beat.puzzle)) save = markPuzzle(save, scene, beat.puzzle);
		} else if (beat.type === 'cutscene') {
			if (!save.cutscenes.includes(beat.cutscene)) save = markCutscene(save, scene, beat.cutscene);
		} else if (beat.type === 'choice') {
			const option = answers[beat.id] ?? beat.options[0].id;
			save = choose(save, scene, option);
			continue;
		}
		save = advance(save, scene);
	}
	return save;
}

function openAndPlay(save, scene) {
	assert.ok(scene, '场景缺失');
	assert.ok(sceneOpen(save, scene, CHAPTERS), `${scene.id} 未开放`);
	const entered = enterScene(save, scene, CHAPTERS);
	const played = playScene(entered, scene);
	assert.ok(played.completed.includes(scene.id), `${scene.id} 未完成`);
	return played;
}

function scene(id) {
	const found = SCENE_BY_ID.get(id);
	assert.ok(found, `缺少场景 ${id}`);
	return found;
}

/** 按给定顺序走完三线（章 2/3/4），再完成其余章与结局。 */
function playAll(order = [2, 3, 4], ending = 'unbound') {
	let save = createStory(CHAPTERS);
	for (const id of ['c0s0', 'c0s1', 'c0s2', 'c0s3', 'c1s0', 'c1s1', 'c1s2', 'c1s3']) save = openAndPlay(save, scene(id));
	for (const chapterId of order) {
		for (const entry of CHAPTERS[chapterId].scenes) save = openAndPlay(save, entry);
	}
	for (const chapterId of [5, 6, 7, 8, 9]) {
		for (const entry of CHAPTERS[chapterId].scenes) save = openAndPlay(save, entry);
	}
	return finishEnding(save, ending, CHAPTERS);
}

test('故事内容与运行时目录一致', () => {
	assert.equal(CHAPTERS.length, 10);
	assert.equal(SCENES.length, 50);
	assert.equal(new Set(SCENES.map((entry) => entry.id)).size, SCENES.length);
	assert.equal(new Set(TRACK_REFERENCES).size, 32);
	assert.equal(new Set(PUZZLE_IDS).size, 9);
	assert.equal(new Set(CUTSCENE_IDS).size, 12);
	assert.equal(Object.keys(CUTSCENES).length, 12);
	for (const id of CUTSCENE_IDS) assert.ok(Object.prototype.hasOwnProperty.call(CUTSCENES, id), `过场 ${id} 没有分镜定义`);
	for (const id of PUZZLE_IDS) assert.match(id, /^P0[0-8]$/);
	const hotspotIds = SCENES.flatMap((entry) => entry.hotspots.map((hotspot) => `${entry.id}/${hotspot.id}`));
	assert.equal(new Set(hotspotIds).size, hotspotIds.length);
});

test('每章可完成，六种三线顺序都能到达三种结局', () => {
	const orders = [
		[2, 3, 4],
		[2, 4, 3],
		[3, 2, 4],
		[3, 4, 2],
		[4, 2, 3],
		[4, 3, 2],
	];
	for (const order of orders) {
		const save = playAll(order, 'unbound');
		assert.equal(save.ending, 'unbound', `顺序 ${order} 未到结局`);
		for (const chapter of CHAPTERS) assert.ok(chapterComplete(save, chapter), `章 ${chapter.id} 未完成`);
		assert.equal(save.puzzles.length, 9);
		assert.equal(save.cutscenes.length, 12);
		assert.equal(Object.keys(save.trackReceipts).length, 32);
	}
	for (const ending of ['daylight', 'closed']) {
		assert.equal(playAll([3, 2, 4], ending).ending, ending);
	}
});

test('第 9 章完成前不能选择结局', () => {
	const save = createStory(CHAPTERS);
	assert.throws(() => finishEnding(save, 'unbound', CHAPTERS), /完成第 9 章|完成第/);
});

test('三线未全部完成时第 5 章保持关闭', () => {
	let save = createStory(CHAPTERS);
	for (const id of ['c0s0', 'c0s1', 'c0s2', 'c0s3', 'c1s0', 'c1s1', 'c1s2', 'c1s3']) save = openAndPlay(save, scene(id));
	for (const entry of CHAPTERS[2].scenes) save = openAndPlay(save, entry);
	assert.equal(chapterOpen(save, CHAPTERS[5], CHAPTERS), false);
	assert.equal(chapterOpen(save, CHAPTERS[3], CHAPTERS), true);
	assert.equal(chapterOpen(save, CHAPTERS[4], CHAPTERS), true);
});

test('可选场景独立完成，且不阻断章节推进', () => {
	let save = createStory(CHAPTERS);
	save = openAndPlay(save, scene('c0s0'));
	save = openAndPlay(save, scene('c0s4'));
	assert.equal(chapterComplete(save, CHAPTERS[0]), false);
	for (const id of ['c0s1', 'c0s2', 'c0s3']) save = openAndPlay(save, scene(id));
	assert.ok(chapterComplete(save, CHAPTERS[0]));
});

test('必须调查的热点会阻止提前收尾，但不会吞掉对白', () => {
	const target = scene('c0s0');
	let save = createStory(CHAPTERS);
	save = enterScene(save, target, CHAPTERS);
	let guard = 0;
	let blocked = false;
	let readBeforeBlock = 0;
	while (currentBeat(save, target) && guard++ < 400) {
		const beat = currentBeat(save, target);
		if (beat.type === 'choice') {
			save = choose(save, target, beat.options[0].id);
			continue;
		}
		try {
			save = advance(save, target);
			readBeforeBlock++;
		} catch (error) {
			assert.match(error.message, /必须调查/);
			blocked = true;
			break;
		}
	}
	assert.ok(blocked, '未调查关键热点却允许收尾');
	assert.equal(readBeforeBlock, target.steps.length - 2, '应能读完除最后一拍外的全部对白（其中一拍为选择）');
	assert.ok(!save.completed.includes(target.id));
	const finished = playScene(enterScene(save, target, CHAPTERS), target);
	assert.ok(finished.completed.includes(target.id));
});

test('重复回执幂等，不重复推进或累计', () => {
	const target = scene('c0s2');
	let save = createStory(CHAPTERS);
	for (const id of ['c0s0', 'c0s1']) save = openAndPlay(save, scene(id));
	save = enterScene(save, target, CHAPTERS);
	while (currentBeat(save, target).type !== 'track') {
		const beat = currentBeat(save, target);
		save = beat.type === 'choice' ? choose(save, target, beat.options[0].id) : advance(save, target);
	}
	const trackBeat = currentBeat(save, target);
	save = recordTrack(save, target, receipt(trackBeat.track));
	const once = save;
	assert.equal(recordTrack(save, target, { track: trackBeat.track, mode: 'manual', seconds: 1 }), once);
	assert.equal(save.trackReceipts[trackBeat.track].mode, 'auto');
});

test('内容版本与运行时一致', () => {
	const save = createStory(CHAPTERS);
	assert.equal(save.contentVersion, CONTENT_VERSION);
	assert.equal(save.schemaVersion, 1);
});
