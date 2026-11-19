import fs from 'node:fs';
import path from 'node:path';

const dir = 'src/lib/story/content';
const chapters = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))).sort((a, b) => a.id - b.id);
const han = (t) => (t.match(/\p{Script=Han}/gu) ?? []).length;
const issues = [];

for (const c of chapters) {
	const choices = c.scenes.flatMap((s) => s.steps.filter((b) => b.type === 'choice'));
	if (choices.length < 2) issues.push(`章 ${c.id} 选择数 ${choices.length} < 2`);
	const main = c.scenes.filter((s) => !s.optional);
	const mainHan = main.flatMap((s) => s.steps.filter((b) => b.type === 'dialogue')).reduce((n, b) => n + han(b.text), 0);
	console.log(`章 ${c.id}: 主线正文 ${mainHan} 汉字 · 选择 ${choices.length} · 曲目 ${c.scenes.flatMap((s) => s.steps.filter((b) => b.type === 'track')).length} · 热点 ${main.reduce((n, s) => n + s.hotspots.length, 0)}`);
}

// 重复检测：完整句子与 20 字以上的重复子串
const texts = [];
for (const c of chapters) for (const s of c.scenes) for (const b of s.steps) {
	if (b.type === 'dialogue') texts.push({ where: `${s.id}`, text: b.text.trim() });
	if (b.type === 'choice') { texts.push({ where: `${s.id}`, text: b.prompt.trim() }); for (const o of b.options) texts.push({ where: `${s.id}`, text: o.text.trim() }); }
}
const exact = new Map();
for (const t of texts) exact.set(t.text, (exact.get(t.text) ?? []).concat(t.where));
const dupExact = [...exact.entries()].filter(([k, v]) => v.length > 1 && k.length > 8);
console.log('\n完全重复的长句:', dupExact.length);
for (const [k, v] of dupExact.slice(0, 6)) console.log('  ', v.join(','), '::', k.slice(0, 40));

// 长公共子串近似：按 30 字窗口
const seen = new Map();
const dups = new Map();
for (const t of texts) {
	const clean = t.text.replace(/\s+/g, '');
	for (let i = 0; i + 30 <= clean.length; i += 15) {
		const key = clean.slice(i, i + 30);
		if (seen.has(key) && seen.get(key) !== t.where) dups.set(key, [seen.get(key), t.where]);
		else seen.set(key, t.where);
	}
}
console.log('30 字窗口重复片段:', dups.size);
for (const [k, v] of [...dups.entries()].slice(0, 8)) console.log('  ', v.join(' / '), '::', k);

// 说话人分布
const speakers = new Map();
for (const c of chapters) for (const s of c.scenes) for (const b of s.steps) if (b.type === 'dialogue') speakers.set(b.speaker, (speakers.get(b.speaker) ?? 0) + 1);
console.log('\n说话人分布:', [...speakers.entries()].map(([k, v]) => `${k}:${v}`).join(' '));

// 章节门禁链
const per = new Map(chapters.map((c) => [c.id, c.scenes]));
console.log('\n每章起始/终局场景:');
for (const c of chapters) {
	const start = c.scenes.filter((s) => !s.requires.length).map((s) => s.id);
	const terminal = c.scenes.filter((s) => !s.optional && !c.scenes.some((o) => o.requires.includes(s.id))).map((s) => s.id);
	console.log(`  ${c.id}: start=${start.join(',')} terminal=${terminal.join(',')}`);
}

// 证据 id 冲突
const evIds = new Map();
for (const c of chapters) for (const s of c.scenes) {
	for (const b of s.steps) if (b.type === 'evidence') evIds.set(b.id, (evIds.get(b.id) ?? 0) + 1);
	for (const h of s.hotspots) if (h.evidence) evIds.set(h.evidence.id, (evIds.get(h.evidence.id) ?? 0) + 1);
}
const conflict = [...evIds.entries()].filter(([, n]) => n > 1);
console.log('\n重复证据 id:', conflict.length, conflict.slice(0, 10).map(([k, n]) => `${k}×${n}`).join(' '));

console.log(issues.length ? '\n问题:\n' + issues.join('\n') : '\n章级检查通过');
