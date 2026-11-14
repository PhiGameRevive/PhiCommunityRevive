import fs from 'node:fs';
import path from 'node:path';

/**
 * 《余页》主线时长模型（不是实测报告）。
 * 只统计必经内容；不计支线、其他结局重玩、下载等待、挂机与失败重试。
 * 所有参数集中在此，便于核对与重算。
 */
const CONTENT_DIR = path.join(process.cwd(), 'src/lib/story/content');
const chapters = fs
	.readdirSync(CONTENT_DIR)
	.filter((file) => file.endsWith('.json'))
	.map((file) => JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, file), 'utf8')))
	.sort((a, b) => a.id - b.id);
const cutsceneFile = fs.readFileSync(path.join(process.cwd(), 'src/lib/story/cutscenes.ts'), 'utf8');
const catalogFile = fs.readFileSync(path.join(process.cwd(), 'src/lib/story/catalog.ts'), 'utf8');
const puzzlesFile = fs.readFileSync(path.join(process.cwd(), 'src/lib/story/puzzles.ts'), 'utf8');

const han = (text) => (text.match(/\p{Script=Han}/gu) ?? []).length;

// 曲目时长来自目录表（每首均为独立曲目，且已 ffprobe 核验源文件时长）。
const trackSeconds = [...catalogFile.matchAll(/\['T\d\d', \d+, '[^']*', '[^']*', '[^']*', '\w+', '[^']*', (\d+(?:\.\d+)?)\]/g)].map((match) => Number(match[1]));
const cutsceneSeconds = [...cutsceneFile.matchAll(/seconds: (\d+)/g)].map((match) => Number(match[1]));

let mainDialogue = 0;
let mainBeats = 0;
let requiredInvestigation = 0;
let optionalInvestigation = 0;
let evidenceText = 0;
let choiceText = 0;
let choiceCount = 0;
let mainScenes = 0;
let optionalScenes = 0;
let hotspotsRequired = 0;

for (const chapter of chapters) {
	for (const scene of chapter.scenes) {
		if (scene.optional) {
			optionalScenes++;
			for (const hotspot of scene.hotspots) optionalInvestigation += han(hotspot.description) + hotspot.lines.reduce((sum, line) => sum + han(line.text), 0);
			continue;
		}
		mainScenes++;
		const required = new Set(scene.requiresHotspots ?? []);
		for (const hotspot of scene.hotspots) {
			const amount = han(hotspot.description) + hotspot.lines.reduce((sum, line) => sum + han(line.text), 0);
			if (required.has(hotspot.id)) {
				requiredInvestigation += amount;
				hotspotsRequired++;
			} else optionalInvestigation += amount;
		}
		for (const beat of scene.steps) {
			if (beat.type === 'dialogue') {
				mainDialogue += han(beat.text);
				mainBeats++;
			} else if (beat.type === 'evidence') {
				evidenceText += han(beat.title) + han(beat.text);
			} else if (beat.type === 'choice') {
				choiceCount++;
				// 玩家会先读完所有选项再决定，因此选项全算，取最长的即时反馈。
				choiceText += han(beat.prompt) + beat.options.reduce((sum, option) => sum + han(option.label), 0);
				choiceText += Math.max(...beat.options.map((option) => han(option.text)));
			}
		}
	}
}

// 谜题证据全文：从 PUZZLES 的 evidence 字段粗略统计（该文件含本地线索的 ?raw 导入，不能直接执行）。
const puzzleBlocks = puzzlesFile.match(/evidence: \[([\s\S]*?)\],\s*questions:/g) ?? [];
let puzzleEvidenceText = 0;
for (const block of puzzleBlocks) puzzleEvidenceText += han(block);
const puzzleCount = (puzzlesFile.match(/^\tP0\d: \{/gm) ?? []).length;

const mandatoryReading = mainDialogue + requiredInvestigation + evidenceText + choiceText;

/** 参数：保守（快读）与常规两档。阅读速度只算中文正文字符，不含点击与思考间隔。 */
const scenarios = [
	{
		name: '保守下界（快读者，仍听完所有曲目与过场）',
		readingSpeed: 600,
		exploreSecondsPerScene: 25,
		puzzleSeconds: 5 * 60,
		musicFactor: 1,
		cutsceneFactor: 1,
		choiceSeconds: 6,
		// 每拍对白都要点一次「继续」；这是操作成本，不是阅读，也不属于等待。
		beatSeconds: 1.2,
		hotspotSeconds: 4,
	},
	{
		name: '常规首见',
		readingSpeed: 400,
		exploreSecondsPerScene: 45,
		puzzleSeconds: 8 * 60,
		musicFactor: 1,
		cutsceneFactor: 1,
		choiceSeconds: 12,
		beatSeconds: 2,
		hotspotSeconds: 8,
	},
	{
		name: '沉浸细读',
		readingSpeed: 300,
		exploreSecondsPerScene: 60,
		puzzleSeconds: 10 * 60,
		musicFactor: 1,
		cutsceneFactor: 1,
		choiceSeconds: 20,
		beatSeconds: 3,
		hotspotSeconds: 12,
	},
];

const rows = scenarios.map((scenario) => {
	const reading = (mandatoryReading / scenario.readingSpeed) * 60;
	const explore = mainScenes * scenario.exploreSecondsPerScene;
	// 拍与热点的点击/收起时间独立于阅读速度：再快的读者也要点。
	const handling = mainBeats * scenario.beatSeconds + hotspotsRequired * scenario.hotspotSeconds;
	const puzzles = puzzleCount * scenario.puzzleSeconds;
	const music = trackSeconds.reduce((sum, value) => sum + value, 0) * scenario.musicFactor;
	const cutscene = cutsceneSeconds.reduce((sum, value) => sum + value, 0) * scenario.cutsceneFactor;
	const choices = choiceCount * scenario.choiceSeconds;
	const total = reading + explore + handling + puzzles + music + cutscene + choices;
	return { name: scenario.name, reading, explore, handling, puzzles, music, cutscene, choices, total };
});

const minutes = (seconds) => Math.round(seconds / 60);

console.log('== 内容量（依据实际发布 JSON）==');
console.log(`章节 ${chapters.length} · 必经场景 ${mainScenes} · 可选场景 ${optionalScenes}`);
console.log(`必经对白：${mainDialogue} 汉字 / ${mainBeats} 拍`);
console.log(`必经调查物件：${hotspotsRequired} 个 / ${requiredInvestigation} 汉字（不含可选物件 ${optionalInvestigation} 汉字）`);
console.log(`证据正文：${evidenceText} 汉字 · 选择 ${choiceCount} 次 / 选项与反馈 ${choiceText} 汉字`);
console.log(`谜题 ${puzzleCount} 道 · 题面证据约 ${puzzleEvidenceText} 汉字`);
console.log(`曲目 ${trackSeconds.length} 首 · ${minutes(trackSeconds.reduce((a, b) => a + b, 0))} 分钟（每首完整播放）`);
console.log(`过场 ${cutsceneSeconds.length} 镜头 · ${minutes(cutsceneSeconds.reduce((a, b) => a + b, 0))} 分钟`);
console.log(`\n必经阅读总量：${mandatoryReading} 汉字（对白 + 必需调查 + 证据 + 选择文本）`);

console.log('\n== 时长模型（分钟）==');
for (const row of rows) {
	console.log(
		`${row.name}\n  阅读 ${minutes(row.reading)} · 调查/地图 ${minutes(row.explore)} · 逐拍操作 ${minutes(row.handling)} · 谜题 ${minutes(row.puzzles)} · 音乐 ${minutes(row.music)} · 过场 ${minutes(row.cutscene)} · 选择 ${minutes(row.choices)}\n  合计 ${minutes(row.total)} 分钟（${(row.total / 3600).toFixed(2)} 小时）`,
	);
}

const lowest = Math.min(...rows.map((row) => row.total));
console.log(`\n模型下界：${minutes(lowest)} 分钟；是否达到 360 分钟：${lowest >= 360 ? '是' : '否'}`);
// 保守下界的余量：决定"最低 6 小时"是否稳固，而不只看是否刚过线。
const margin = lowest - 360 * 60;
console.log(`相对 360 分钟的余量：${margin >= 0 ? '+' : ''}${minutes(margin)} 分钟`);
console.log('注意：这是内容量与预算模型，不是首见实测。真实时长必须由未读剧本的测试者记录，且扣除切后台、下载与重试。');
