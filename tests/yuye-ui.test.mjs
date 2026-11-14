import assert from 'node:assert/strict';
import test from 'node:test';
import { addTime, createStory } from '../src/lib/story/model.ts';

/** 与 StoryApp.svelte 的 formatMinutes 保持同一行为：不足 1 分钟显示秒。 */
function formatMinutes(seconds) {
	const value = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
	if (value < 60) return `${Math.floor(value)} 秒`;
	const total = Math.round(value / 60);
	if (total < 60) return `${total} 分钟`;
	return `${Math.floor(total / 60)} 小时 ${total % 60} 分钟`;
}

test('时长显示不足一分钟时给出秒数', () => {
	assert.equal(formatMinutes(0), '0 秒');
	assert.equal(formatMinutes(13.7), '13 秒');
	assert.equal(formatMinutes(59.9), '59 秒');
	assert.equal(formatMinutes(60), '1 分钟');
	assert.equal(formatMinutes(3599), '1 小时 0 分钟');
	assert.equal(formatMinutes(3600), '1 小时 0 分钟');
	assert.equal(formatMinutes(5430), '1 小时 31 分钟');
	assert.equal(formatMinutes(Number.NaN), '0 秒');
	assert.equal(formatMinutes(-5), '0 秒');
});

test('addTime 只接受 0–5 秒的有限增量', () => {
	const save = createStory([
		{
			id: 0,
			title: 't',
			region: 'r',
			description: '',
			scenes: [{ id: 's', title: 's', location: 'R0-0', summary: '', requires: [], hotspots: [], steps: [{ type: 'dialogue', speaker: 'a', text: 'b' }] }],
		},
	]);
	assert.equal(addTime(save, 'music', 0), save, '0 秒不应改变存档');
	for (const value of [-1, 5.1, Number.NaN, Number.POSITIVE_INFINITY]) {
		assert.throws(() => addTime(save, 'music', value), /0–5 秒/, `${value} 应被拒绝`);
	}
	const once = addTime(save, 'music', 5);
	assert.equal(once.activeSeconds.music, 5);
	assert.equal(once.revision, save.revision + 1);
	// 上限是单次增量，不是累计上限。
	let total = once;
	for (let i = 0; i < 20; i++) total = addTime(total, 'music', 5);
	assert.equal(total.activeSeconds.music, 105);
});
