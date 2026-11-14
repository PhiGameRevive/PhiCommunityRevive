import assert from 'node:assert/strict';
import test from 'node:test';
import {
	CONTENT_VERSION,
	acknowledgeReload,
	addTime,
	advance,
	armReload,
	chapterComplete,
	chapterOpen,
	choose,
	createStory,
	currentBeat,
	enterScene,
	finishEnding,
	inspectHotspot,
	markCutscene,
	markPuzzle,
	recordTrack,
	sceneOpen,
} from '../src/lib/story/model.ts';

function scene(id, steps = [{ type: 'dialogue', speaker: '栞', text: '下一页。' }], extra = {}) {
	return { id, title: id, location: id, summary: '', requires: [], hotspots: [], steps, ...extra };
}

function chapter(id, scenes) {
	return { id, title: `第 ${id} 章`, region: `r${id}`, description: '', scenes };
}

function fixture(steps, extra) {
	const current = scene('start', steps, extra);
	const chapters = [chapter(0, [current])];
	return { scene: current, chapters, save: createStory(chapters) };
}

function freeze(value) {
	if (value && typeof value === 'object') {
		Object.values(value).forEach(freeze);
		Object.freeze(value);
	}
	return value;
}

const orders = [
	[2, 3, 4],
	[2, 4, 3],
	[3, 2, 4],
	[3, 4, 2],
	[4, 2, 3],
	[4, 3, 2],
];
for (const order of orders) {
	test(`三线顺序 ${order.join(' → ')} 完整到达三结局；不依赖时间或支线`, () => {
		const chapters = Array.from({ length: 10 }, (_, id) => chapter(id, [scene(`c${id}a`), scene(`c${id}b`, undefined, { requires: [`c${id}a`] }), scene(`c${id}optional`, undefined, { optional: true })]));
		let save = createStory(chapters);
		assert.equal(save.contentVersion, CONTENT_VERSION);
		assert.equal(save.revision, 0);
		assert.deepEqual(
			chapters.filter((ch) => chapterOpen(save, ch, chapters)).map((ch) => ch.id),
			[0],
		);
		for (const id of [0, 1, ...order, 5, 6, 7, 8, 9]) {
			const ch = chapters[id];
			assert.ok(chapterOpen(save, ch, chapters));
			assert.equal(sceneOpen(save, ch.scenes[1], chapters), false);
			assert.throws(() => enterScene(save, ch.scenes[1], chapters), /尚未开放/);
			for (const current of ch.scenes.slice(0, 2)) {
				save = enterScene(freeze(save), current, chapters);
				save = advance(freeze(save), current);
			}
			assert.ok(chapterComplete(save, ch));
			assert.equal(save.completed.includes(ch.scenes[2].id), false);
			if (id === 1) for (const parallel of [2, 3, 4]) assert.ok(chapterOpen(save, chapters[parallel], chapters));
			if (order.slice(0, 2).includes(id)) assert.equal(chapterOpen(save, chapters[5], chapters), false);
			if (id !== 9) assert.throws(() => finishEnding(save, 'unbound', chapters), /第 9 章/);
		}
		for (const ending of ['unbound', 'daylight', 'closed']) {
			const finished = finishEnding(freeze(save), ending, chapters);
			assert.equal(finished.ending, ending);
			assert.equal(finished.revision, save.revision + 1);
			assert.equal(finishEnding(finished, ending, chapters), finished);
		}
		assert.equal(
			Object.values(save.activeSeconds).reduce((a, b) => a + b),
			0,
		);
		assert.equal(save.completed.length, 20);
	});
}

test('一次仅消费一拍；选择、演奏、谜题、过场 gate；必要热点只拦截最后收尾', () => {
	const f = fixture(
		[
			{ type: 'dialogue', speaker: '栞', text: '先看这一句。' },
			{ type: 'choice', id: 'name', prompt: '名字？', options: [{ id: 'guest', label: '访客', text: '' }] },
			{ type: 'track', track: 'T00', before: '', after: '' },
			{ type: 'puzzle', puzzle: 'P00' },
			{ type: 'cutscene', cutscene: 'C00' },
			{ type: 'evidence', id: 'ticket', title: '校听票', text: '已核验' },
		],
		{ requiresHotspots: ['window'], hotspots: [{ id: 'window', title: '窗口', description: '', lines: [], evidence: { id: 'ticket', title: '校听票', text: '已核验' } }] },
	);
	let save = f.save;
	const move = (operation) => {
		const before = freeze(save);
		save = operation(before);
		assert.equal(save.revision, before.revision + 1);
	};
	move((s) => advance(s, f.scene));
	assert.equal(save.positions.start, 1);
	assert.throws(() => advance(save, f.scene), /选择/);
	assert.throws(() => choose(save, f.scene, 'absent'), /选项无效/);
	move((s) => choose(s, f.scene, 'guest'));
	assert.equal(save.choices.name, 'guest');
	assert.equal(save.positions.start, 2);
	assert.throws(() => advance(save, f.scene), /演奏/);
	assert.throws(() => recordTrack(save, f.scene, { track: 'other', mode: 'listen', seconds: 1 }), /回执/);
	move((s) => recordTrack(s, f.scene, { track: 'T00', mode: 'summary', seconds: 0 }));
	assert.equal(save.positions.start, 2);
	assert.equal(recordTrack(save, f.scene, { track: 'T00', mode: 'manual', seconds: 99 }), save);
	assert.equal(save.trackReceipts.T00.mode, 'summary');
	move((s) => advance(s, f.scene));
	assert.throws(() => recordTrack(save, f.scene, { track: 'T00', mode: 'summary', seconds: 0 }), /回执/);
	assert.throws(() => advance(save, f.scene), /谜题/);
	assert.throws(() => markPuzzle(save, f.scene, 'P01'), /谜题/);
	move((s) => markPuzzle(s, f.scene, 'P00'));
	assert.equal(save.positions.start, 3);
	assert.equal(markPuzzle(save, f.scene, 'P00'), save);
	move((s) => advance(s, f.scene));
	assert.throws(() => advance(save, f.scene), /过场/);
	assert.throws(() => markCutscene(save, f.scene, 'C01'), /过场/);
	move((s) => markCutscene(s, f.scene, 'C00'));
	assert.equal(save.positions.start, 4);
	assert.equal(markCutscene(save, f.scene, 'C00'), save);
	move((s) => advance(s, f.scene));
	assert.throws(() => advance(save, f.scene), /必须调查/);
	assert.equal(save.evidence.length, 0);
	assert.equal(save.completed.length, 0);
	move((s) => inspectHotspot(s, f.scene, 'window'));
	assert.equal(save.positions.start, 5);
	assert.deepEqual(save.hotspots, ['start/window']);
	assert.equal(inspectHotspot(save, f.scene, 'window'), save);
	move((s) => advance(s, f.scene));
	assert.deepEqual(save.completed, ['start']);
	assert.equal(save.evidence.length, 1);
	assert.deepEqual(
		save.seenBeats,
		Array.from({ length: 6 }, (_, i) => `start/${i}`),
	);
	assert.equal(currentBeat(save, f.scene), undefined);
	assert.throws(() => advance(save, f.scene), /已结束/);
});

test('提前调查不会消费剧情或把场景标成完成；失败的最后选择也不写 choices', () => {
	const f = fixture([{ type: 'choice', id: 'q', prompt: '', options: [{ id: 'a', label: '', text: '' }] }], { requiresHotspots: ['h'], hotspots: [{ id: 'h', title: '', description: '', lines: [] }] });
	assert.throws(() => choose(f.save, f.scene, 'a'), /必须调查/);
	assert.deepEqual(f.save.choices, {});
	const inspected = inspectHotspot(freeze(f.save), f.scene, 'h');
	assert.equal(inspected.positions.start, 0);
	assert.deepEqual(inspected.seenBeats, []);
	assert.deepEqual(inspected.completed, []);
	assert.equal(choose(inspected, f.scene, 'a').positions.start, 1);
});

test('所有演奏模式均可推进；无最低秒数；无效或非当前回执严格拒绝', () => {
	for (const mode of ['manual', 'auto', 'listen', 'summary']) {
		const f = fixture([{ type: 'track', track: 't', before: '', after: '' }]);
		const receipt = { track: 't', mode, seconds: 0 };
		const recorded = recordTrack(freeze(f.save), f.scene, receipt);
		receipt.seconds = 100;
		assert.equal(recorded.trackReceipts.t.seconds, 0);
		assert.equal(advance(recorded, f.scene).completed.length, 1);
		for (const seconds of [-1, NaN, Infinity, '1']) assert.throws(() => recordTrack(f.save, f.scene, { track: 't', mode, seconds }), /回执/);
		assert.throws(() => recordTrack(f.save, f.scene, { track: 't', mode: 'cheat', seconds: 1 }), /回执/);
	}
	const f = fixture();
	assert.throws(() => recordTrack(f.save, f.scene, { track: 't', mode: 'auto', seconds: 1 }), /回执/);
	assert.throws(() => markPuzzle(f.save, f.scene, 'P00'), /谜题/);
	assert.throws(() => markCutscene(f.save, f.scene, 'C00'), /过场/);
	assert.throws(() => choose(f.save, f.scene, 'a'), /选项/);
});

test('锁区、非当前场景、伪造场景与非法游标不能操作', () => {
	const a = scene('a');
	const b = scene('b');
	const locked = scene('locked');
	const chapters = [chapter(0, [a, b]), chapter(1, [locked])];
	const save = createStory(chapters);
	assert.throws(() => advance(save, locked), /尚未开放/);
	assert.throws(() => advance(save, b), /当前所在/);
	assert.throws(() => advance({ ...save, scene: 'locked', positions: { ...save.positions, locked: 0 } }, locked), /尚未开放/);
	assert.throws(() => advance(save, { ...a }), /尚未开放/);
	for (const value of [-1, 0.5, 2, NaN, Infinity]) assert.throws(() => advance({ ...save, positions: { a: value } }, a), /游标/);
	assert.throws(() => advance({ ...save, positions: {} }, a), /缺少游标/);
	assert.throws(() => advance({ ...save, completed: ['a'] }, a), /不一致/);
	const loaded = structuredClone(save);
	const freshChapters = structuredClone(chapters);
	assert.throws(() => advance(loaded, freshChapters[0].scenes[0]), /先进入/);
	assert.equal(enterScene(loaded, freshChapters[0].scenes[0], freshChapters), loaded);
	assert.equal(advance(loaded, freshChapters[0].scenes[0]).positions.a, 1);
});

test('计时仅接受单次 0–5 秒；没有 forced minimum 或越界累计', () => {
	const { save } = fixture();
	assert.equal(addTime(freeze(save), 'dialogue', 0), save);
	assert.equal(addTime(save, 'dialogue', 0.01).activeSeconds.dialogue, 0.01);
	const next = addTime(save, 'music', 5);
	assert.equal(next.activeSeconds.music, 5);
	assert.equal(save.activeSeconds.music, 0);
	assert.equal(next.revision, save.revision + 1);
	for (const value of [-1, 5.01, NaN, Infinity, '1']) assert.throws(() => addTime(save, 'music', value), /0–5/);
	assert.throws(() => addTime(save, '__proto__', 1), /0–5/);
	assert.throws(() => addTime({ ...save, activeSeconds: { ...save.activeSeconds, music: Number.MAX_SAFE_INTEGER } }, 'music', 5), /溢出/);
});

test('刷新标记按页面实例区分，重复 arm/ack 不增加 revision 或清除 returned', () => {
	const f = fixture();
	assert.equal(acknowledgeReload(f.save, 'page-a'), f.save);
	const armed = armReload(freeze(f.save), f.scene, 'page-a');
	assert.equal(armed.revision, 1);
	assert.equal(acknowledgeReload(armed, 'page-a'), armed);
	assert.equal(armReload(armed, f.scene, 'page-a'), armed);
	assert.equal(armReload(armed, f.scene, 'page-b'), armed);
	const returned = acknowledgeReload(freeze(armed), 'page-b');
	assert.equal(returned.reload.returned, true);
	assert.equal(returned.reload.origin, 'page-a');
	assert.equal(returned.revision, 2);
	assert.equal(acknowledgeReload(returned, 'page-c'), returned);
	assert.equal(armReload(returned, f.scene, 'page-c'), returned);
});

test('不安全 Record 键不能当成内容标识符；revision 不溢出', () => {
	for (const id of ['__proto__', 'constructor', 'prototype']) {
		assert.throws(() => createStory([chapter(0, [scene(id)])]), /标识符/);
		const f = fixture([{ type: 'choice', id, prompt: '', options: [{ id: 'a', label: '', text: '' }] }]);
		assert.throws(() => choose(f.save, f.scene, 'a'), /标识符/);
		const track = fixture([{ type: 'track', track: id, before: '', after: '' }]);
		assert.throws(() => recordTrack(track.save, track.scene, { track: id, mode: 'auto', seconds: 1 }), /标识符/);
	}
	const f = fixture();
	assert.throws(() => advance({ ...f.save, revision: Number.MAX_SAFE_INTEGER }, f.scene), /溢出/);
	assert.equal({}.polluted, undefined);
});
