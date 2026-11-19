import fs from 'node:fs';
import path from 'node:path';

const dir = 'src/lib/story/content';
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
const chapters = files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));

const han = (t) => (t.match(/\p{Script=Han}/gu) ?? []).length;
let issues = [];
const sceneIds = new Set();
let totalMainHan = 0;
let hotspotHan = 0;
const trackRefs = [];
const puzzleRefs = [];
const cutsceneRefs = [];

if (chapters.length !== 10) issues.push(`章节数 ${chapters.length} != 10`);
for (let i = 0; i < 10; i++) if (chapters[i]?.id !== i) issues.push(`章节顺序错误：索引 ${i} 的 id 是 ${chapters[i]?.id}`);

for (const c of chapters) {
	if (!Number.isInteger(c.id) || !c.title || !c.region || !c.description) issues.push(`章 ${c.id} 头部字段缺失`);
	if (c.scenes.length !== 5) issues.push(`章 ${c.id} 场景数 ${c.scenes.length}`);
	for (const s of c.scenes) {
		if (sceneIds.has(s.id)) issues.push(`重复场景 id ${s.id}`);
		sceneIds.add(s.id);
		if (!/^c\ds\d$/.test(s.id)) issues.push(`场景 id 命名异常 ${s.id}`);
		if (!new RegExp(`^R${c.id}-\\d$`).test(s.location) && c.id !== 9) issues.push(`章 ${c.id} 场景 ${s.id} 地点 ${s.location} 不符合 R${c.id}-n`);
		if (!Array.isArray(s.hotspots)) issues.push(`${s.id} 缺 hotspots`);
		if (!Array.isArray(s.steps) || !s.steps.length) issues.push(`${s.id} 无 steps`);
		const hids = new Set(s.hotspots.map((h) => h.id));
		for (const req of s.requiresHotspots ?? []) if (!hids.has(req)) issues.push(`${s.id} requiresHotspots 引用不存在的 ${req}`);
		for (const h of s.hotspots) {
			if (!h.title || !h.description || !Array.isArray(h.lines) || !h.lines.length) issues.push(`${s.id}/${h.id} 调查内容不完整`);
			hotspotHan += han(h.description) + h.lines.reduce((n, l) => n + han(l.text), 0);
			if (h.evidence) {
				if (!h.evidence.id || !h.evidence.title || !h.evidence.text) issues.push(`${s.id}/${h.id} 证据不完整`);
			}
		}
		let hasChoice = false;
		for (const b of s.steps) {
			switch (b.type) {
				case 'dialogue':
					if (!b.speaker || !b.text) issues.push(`${s.id} 对白缺字段`);
					if (!s.optional) totalMainHan += han(b.text);
					break;
				case 'evidence':
					if (!b.id || !b.title || !b.text) issues.push(`${s.id} 证据拍不完整`);
					break;
				case 'choice':
					hasChoice = true;
					if (!b.id || !b.prompt || !Array.isArray(b.options) || b.options.length < 2) issues.push(`${s.id} 选择拍不完整`);
					for (const o of b.options) if (!o.id || !o.label || !o.text) issues.push(`${s.id} 选项 ${o.id} 不完整`);
					break;
				case 'track':
					trackRefs.push({ id: b.track, scene: s.id });
					if (!b.before || !b.after) issues.push(`${s.id} 曲目 ${b.track} 缺语境`);
					break;
				case 'puzzle':
					puzzleRefs.push({ id: b.puzzle, scene: s.id });
					break;
				case 'cutscene':
					cutsceneRefs.push({ id: b.cutscene, scene: s.id });
					break;
				default:
					issues.push(`${s.id} 未知 beat 类型 ${b.type}`);
			}
		}
		if (!s.optional && !hasChoice) issues.push(`${s.id} 主线场景没有选择`);
	}
	// 前置只允许本章
	for (const s of c.scenes) for (const r of s.requires) if (!c.scenes.some((x) => x.id === r)) issues.push(`${s.id} 前置跨章或不存在：${r}`);
	const s0 = c.scenes.filter((s) => !s.requires.length);
	if (s0.length !== 1) issues.push(`章 ${c.id} 的起始场景数为 ${s0.length}`);
	const opt = c.scenes.filter((s) => s.optional);
	if (opt.length !== 1) issues.push(`章 ${c.id} 可选场景数 ${opt.length}`);
}

const dup = (arr) => {
	const seen = new Map();
	for (const e of arr) seen.set(e.id, (seen.get(e.id) ?? []).concat(e.scene));
	return [...seen.entries()].filter(([, v]) => v.length > 1);
};
for (const [kind, list, expect] of [
	['track', trackRefs, 32],
	['puzzle', puzzleRefs, 9],
	['cutscene', cutsceneRefs, 12],
]) {
	const d = dup(list);
	if (d.length) issues.push(`${kind} 重复：${JSON.stringify(d)}`);
	const unique = new Set(list.map((e) => e.id));
	if (unique.size !== expect) issues.push(`${kind} 数量 ${unique.size} != ${expect}`);
}

console.log('章节:', chapters.map((c) => `${c.id}:${c.title}`).join(' | '));
console.log('场景总数:', sceneIds.size, '调查热点字数:', hotspotHan);
console.log('主线正文汉字（仅 dialogue，不含可选/热点/选项）:', totalMainHan);
console.log('曲目引用:', new Set(trackRefs.map((e) => e.id)).size, '谜题:', new Set(puzzleRefs.map((e) => e.id)).size, '过场:', new Set(cutsceneRefs.map((e) => e.id)).size);
const trackIds = [...new Set(trackRefs.map((e) => e.id))].sort();
const puzzleIds = [...new Set(puzzleRefs.map((e) => e.id))].sort();
const cutsceneIds = [...new Set(cutsceneRefs.map((e) => e.id))].sort();
console.log('TRACKS', trackIds.join(','));
console.log('PUZZLES', puzzleIds.join(','));
console.log('CUTSCENES', cutsceneIds.join(','));
for (let i = 1; i <= 32; i++) {
	const id = `T${String(i).padStart(2, '0')}`;
	if (!trackIds.includes(id)) issues.push(`缺少曲目 ${id}`);
}
for (let i = 0; i <= 8; i++) {
	const id = `P${String(i).padStart(2, '0')}`;
	if (!puzzleIds.includes(id)) issues.push(`缺少谜题 ${id}`);
}
for (let i = 0; i <= 11; i++) {
	const id = `C${String(i).padStart(2, '0')}`;
	if (!cutsceneIds.includes(id)) issues.push(`缺少过场 ${id}`);
}
console.log(issues.length ? `问题 ${issues.length}：\n` + issues.map((x) => '  - ' + x).join('\n') : '结构检查：全部通过');
