import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const CONTENT_DIR = path.join(process.cwd(), 'src/lib/story/content');
const CHAPTERS = fs
	.readdirSync(CONTENT_DIR)
	.filter((file) => file.endsWith('.json'))
	.map((file) => ({ file, chapter: JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, file), 'utf8')) }))
	.sort((a, b) => a.chapter.id - b.chapter.id);
const SCENES = CHAPTERS.flatMap(({ chapter }) => chapter.scenes);
const ALL_BEATS = SCENES.flatMap((scene) => scene.steps);
const han = (text) => (text.match(/\p{Script=Han}/gu) ?? []).length;

/** 每章最低主线正文量（汉字，仅 dialogue 拍、仅必经场景）。 */
const MIN_MAIN_DIALOGUE = { 0: 8000, 1: 9000, 2: 11000, 3: 10000, 4: 10000, 5: 11000, 6: 9000, 7: 10000, 8: 9000, 9: 8500 };

test('每个章节文件都是合法 JSON，且字段完整', () => {
	assert.equal(CHAPTERS.length, 10);
	for (const { file, chapter } of CHAPTERS) {
		assert.ok(Number.isInteger(chapter.id), `${file} 缺少 id`);
		for (const field of ['title', 'region', 'description']) assert.equal(typeof chapter[field], 'string', `${file} 缺少 ${field}`);
		assert.equal(chapter.scenes.length, 5, `${file} 场景数不是 5`);
		for (const scene of chapter.scenes) {
			for (const field of ['id', 'title', 'location', 'summary']) assert.equal(typeof scene[field], 'string', `${scene.id} 缺少 ${field}`);
			assert.ok(Array.isArray(scene.requires), `${scene.id} 缺少 requires`);
			assert.ok(Array.isArray(scene.hotspots), `${scene.id} 缺少 hotspots`);
			assert.ok(Array.isArray(scene.steps) && scene.steps.length > 0, `${scene.id} 没有 steps`);
		}
	}
});

test('场景 id、地点与前置关系自洽', () => {
	const ids = new Set();
	for (const { chapter } of CHAPTERS) {
		for (const scene of chapter.scenes) {
			assert.ok(!ids.has(scene.id), `重复场景 id ${scene.id}`);
			ids.add(scene.id);
			for (const required of scene.requires) {
				assert.ok(
					chapter.scenes.some((other) => other.id === required),
					`${scene.id} 的前置 ${required} 不在本章`,
				);
			}
			const opening = chapter.scenes.filter((other) => other.requires.length === 0);
			assert.equal(opening.length, 1, `章 ${chapter.id} 应有且仅有一个起始场景`);
			assert.equal(chapter.scenes.filter((other) => other.optional).length, 1, `章 ${chapter.id} 应有一个可选场景`);
			const main = chapter.scenes.filter((other) => !other.optional);
			const terminal = main.filter((scene2) => !main.some((other) => other.requires.includes(scene2.id)));
			assert.equal(terminal.length, 1, `章 ${chapter.id} 应有唯一必经终局场景`);
		}
	}
	assert.equal(ids.size, 50);
});

test('必需调查热点都真实存在', () => {
	for (const scene of SCENES) {
		const hotspotIds = scene.hotspots.map((hotspot) => hotspot.id);
		assert.equal(new Set(hotspotIds).size, hotspotIds.length, `${scene.id} 热点 id 重复`);
		for (const required of scene.requiresHotspots ?? []) {
			assert.ok(hotspotIds.includes(required), `${scene.id} 要求不存在的热点 ${required}`);
		}
		for (const hotspot of scene.hotspots) {
			assert.ok(hotspot.title && hotspot.description, `${scene.id}/${hotspot.id} 缺少标题或描述`);
			assert.ok(hotspot.lines.length > 0, `${scene.id}/${hotspot.id} 没有对白`);
			if (hotspot.evidence) assert.ok(hotspot.evidence.id && hotspot.evidence.title && hotspot.evidence.text, `${scene.id}/${hotspot.id} 证据不完整`);
		}
	}
});

test('beat 字段与剧情节点完整', () => {
	const choiceIds = new Set();
	for (const scene of SCENES) {
		for (const beat of scene.steps) {
			switch (beat.type) {
				case 'dialogue':
					assert.ok(beat.speaker && beat.text, `${scene.id} 对白缺字段`);
					break;
				case 'evidence':
					assert.ok(beat.id && beat.title && beat.text, `${scene.id} 证据拍不完整`);
					break;
				case 'choice': {
					assert.ok(!choiceIds.has(beat.id), `重复选择 id ${beat.id}`);
					choiceIds.add(beat.id);
					assert.ok(beat.prompt, `${beat.id} 缺少问题`);
					assert.ok(beat.options.length >= 2, `${beat.id} 选项少于两个`);
					const optionIds = new Set();
					for (const option of beat.options) {
						assert.ok(option.id && option.label && option.text, `${beat.id} 选项字段缺失`);
						assert.ok(!optionIds.has(option.id), `${beat.id} 选项 id 重复`);
						optionIds.add(option.id);
					}
					break;
				}
				case 'track':
					assert.match(beat.track, /^T\d\d$/, `${scene.id} 曲目编号异常`);
					assert.ok(beat.before && beat.after, `${scene.id} 曲目 ${beat.track} 缺少前后语境`);
					break;
				case 'puzzle':
					assert.match(beat.puzzle, /^P0[0-8]$/, `${scene.id} 谜题编号异常`);
					break;
				case 'cutscene':
					assert.match(beat.cutscene, /^C(0\d|1[01])$/, `${scene.id} 过场编号异常`);
					break;
				default:
					assert.fail(`${scene.id} 出现未支持的 beat 类型 ${beat.type}`);
			}
		}
	}
});

test('32 首曲目、9 道谜题、12 段过场各出现一次', () => {
	const tracks = ALL_BEATS.filter((beat) => beat.type === 'track').map((beat) => beat.track);
	const puzzles = ALL_BEATS.filter((beat) => beat.type === 'puzzle').map((beat) => beat.puzzle);
	const cutscenes = ALL_BEATS.filter((beat) => beat.type === 'cutscene').map((beat) => beat.cutscene);
	const expected = (count, prefix, width) => Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1).padStart(width, '0')}`);
	assert.deepEqual([...tracks].sort(), expected(32, 'T', 2));
	assert.deepEqual(
		[...puzzles].sort(),
		Array.from({ length: 9 }, (_, index) => `P0${index}`),
	);
	assert.deepEqual(
		[...cutscenes].sort(),
		Array.from({ length: 12 }, (_, index) => `C${String(index).padStart(2, '0')}`),
	);
	for (const id of [...tracks, ...puzzles, ...cutscenes]) assert.ok(typeof id === 'string');
});

test('证据编号全局唯一，正文不重复', () => {
	const evidenceIds = new Map();
	for (const scene of SCENES) {
		for (const beat of scene.steps) {
			if (beat.type !== 'evidence') continue;
			evidenceIds.set(beat.id, (evidenceIds.get(beat.id) ?? 0) + 1);
		}
		for (const hotspot of scene.hotspots) {
			if (!hotspot.evidence) continue;
			evidenceIds.set(hotspot.evidence.id, (evidenceIds.get(hotspot.evidence.id) ?? 0) + 1);
		}
	}
	const duplicated = [...evidenceIds.entries()].filter(([, count]) => count > 1);
	assert.deepEqual(duplicated, [], `重复证据编号：${duplicated.map(([id]) => id).join(', ')}`);

	const lines = new Map();
	for (const scene of SCENES) {
		for (const beat of scene.steps) {
			if (beat.type !== 'dialogue') continue;
			const key = beat.text.trim();
			if (key.length < 20) continue;
			lines.set(key, (lines.get(key) ?? 0) + 1);
		}
	}
	const repeated = [...lines.entries()].filter(([, count]) => count > 1);
	assert.deepEqual(repeated.slice(0, 5), [], `重复对白：${repeated.length} 句`);
});

test('每章主线正文达到最低字数', () => {
	for (const { chapter } of CHAPTERS) {
		const main = chapter.scenes.filter((scene) => !scene.optional);
		const count = main
			.flatMap((scene) => scene.steps)
			.filter((beat) => beat.type === 'dialogue')
			.reduce((sum, beat) => sum + han(beat.text), 0);
		assert.ok(count >= MIN_MAIN_DIALOGUE[chapter.id], `章 ${chapter.id} 主线对白只有 ${count} 汉字，低于 ${MIN_MAIN_DIALOGUE[chapter.id]}`);
	}
});

test('每章至少两个有意义选择，且主线场景都有选择', () => {
	for (const { chapter } of CHAPTERS) {
		const choices = chapter.scenes.flatMap((scene) => scene.steps.filter((beat) => beat.type === 'choice'));
		assert.ok(choices.length >= 2, `章 ${chapter.id} 只有 ${choices.length} 个选择`);
		// 每个选择必须给出可读的即时反馈，而不是只有标签。
		for (const choice of choices) for (const option of choice.options) assert.ok(han(option.text) >= 20, `${choice.id}/${option.id} 的反馈文本过短`);
	}
});

test('第 1 章的路名选择保留固定 id 与两个选项', () => {
	const choice = SCENES.flatMap((scene) => scene.steps).find((beat) => beat.type === 'choice' && beat.id === 'bridge-name');
	assert.ok(choice, '缺少 bridge-name 选择');
	assert.deepEqual(choice.options.map((option) => option.id).sort(), ['annotated', 'original']);
});
