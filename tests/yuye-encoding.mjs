import fs from 'node:fs';

const files = [
	'docs/design/story-mode/implementation.md',
	'src/lib/story/StoryApp.svelte',
	'src/lib/story/puzzles.ts',
	'src/lib/story/PuzzlePanel.svelte',
	'src/lib/story/StoryBackdrop.svelte',
	'src/lib/story/CutscenePlayer.svelte',
	'src/lib/story/cutscenes.ts',
	'src/lib/story/model.ts',
	'src/lib/story/storage.ts',
	'src/lib/story/types.ts',
	'src/lib/story/catalog.ts',
	'src/lib/story/StoryPerformance.svelte',
	'src/lib/story/content/chapter-00.json',
	'src/lib/story/content/chapter-01.json',
	'src/lib/story/content/chapter-02.json',
	'src/lib/story/content/chapter-03.json',
	'src/lib/story/content/chapter-04.json',
	'src/lib/story/content/chapter-05.json',
	'src/lib/story/content/chapter-06.json',
	'src/lib/story/content/chapter-07.json',
	'src/lib/story/content/chapter-08.json',
	'src/lib/story/content/chapter-09.json',
	'src/routes/story/+page.svelte',
	'src/routes/+layout.svelte',
	'src/routes/songs/+page.svelte',
	'src/lib/player/Player.svelte',
	'story-evidence/yuye/edition-01/README.md',
	'story-evidence/yuye/edition-01/records/rain-night.txt',
	'story-evidence/yuye/edition-01/rights/bai-yu.txt',
	'story-evidence/yuye/edition-01/runtime/collate.ts',
	'tests/yuye-story.test.mjs',
	'tests/yuye-duration.mjs',
	'scripts/set-story-revision.mjs',
];

const problems = [];
for (const file of files) {
	let text;
	try {
		text = fs.readFileSync(file, 'utf8');
	} catch (error) {
		problems.push(`${file}: 读取失败 ${error.message}`);
		continue;
	}
	if (text.includes('\uFFFD')) problems.push(`${file}: 含替换字符 U+FFFD`);
	let count = 0;
	for (const char of text) if (char === '\uFFFD') count++;
	const nul = text.includes('\u0000');
	if (nul) problems.push(`${file}: 含 NUL`);
	if (file.endsWith('.json')) {
		try {
			JSON.parse(text);
		} catch (error) {
			problems.push(`${file}: JSON 无效 ${error.message}`);
		}
	}
	const longest = text.split('\n').reduce((max, line) => Math.max(max, [...line].length), 0);
	if (longest > 4000) problems.push(`${file}: 单行过长 ${longest}`);
	console.log(`${file}: ${text.length} 字符, 最长行 ${longest}${count ? `, U+FFFD ×${count}` : ''}`);
}

console.log(problems.length ? `\n问题 ${problems.length}:\n` + problems.join('\n') : '\n全部文件为合法 UTF-8，无替换字符');
