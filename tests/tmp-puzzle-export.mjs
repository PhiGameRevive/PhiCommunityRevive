import fs from 'node:fs';

const source = fs.readFileSync('src/lib/story/puzzles.ts', 'utf8');
// 只保留谜题定义：把四份 `?raw` 线索导入改写为独立空常量，避免依赖文件扩展名加载。
const patched = source
	.replace(/^import archiveReadme from .*$/m, 'const archiveReadme = "";')
	.replace(/^import rainNight from .*$/m, 'const rainNight = "";')
	.replace(/^import baiYuRights from .*$/m, 'const baiYuRights = "";')
	.replace(/^import collate from .*$/m, 'const collate = "";')
	.replace(/^import type .*$/gm, '')
	.replace("import.meta.env.VITE_STORY_ARCHIVE_REVISION", "''");
fs.writeFileSync('tests/.puzzles-stub.mts', patched, 'utf8');

const module = await import('./.puzzles-stub.mts');
const summary = {};
for (const [id, puzzle] of Object.entries(module.PUZZLES)) {
	summary[id] = {
		title: puzzle.title,
		questions: puzzle.questions.map((question) => ({ id: question.id, answer: question.answer, labels: question.options.map((option) => option.label) })),
	};
}
fs.writeFileSync('tests/.puzzle-answers.json', JSON.stringify(summary, null, 2), 'utf8');
console.log('导出的谜题:', Object.keys(summary).join(','));
console.log('问题总数:', Object.values(summary).reduce((sum, item) => sum + item.questions.length, 0));
