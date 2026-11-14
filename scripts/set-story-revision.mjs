import fs from 'node:fs';
import path from 'node:path';

/**
 * 谜题 P06 的源码线索需要一份"冻结版本"的引用。
 * 这里只把已经提交的真实提交号写进构建配置；没有提交就什么都不做，
 * 绝不构造 SHA，也不把 main 当作冻结版本。
 */
const target = '.env';
const marker = 'VITE_STORY_ARCHIVE_REVISION';
const env = fs.readFileSync(target, 'utf8');
if (env.includes(`${marker}=`) && !env.includes(`# ${marker}=`)) {
	console.log(`${marker} 已配置，未改动`);
	process.exit(0);
}

const sha = (process.argv[2] ?? '').trim();
if (!/^[0-9a-f]{40}$/i.test(sha)) {
	console.error('用法：node scripts/set-story-revision.mjs <40 位提交 SHA>');
	console.error('未写入任何值：谜题面板会继续显示「尚未发布的源码线索」并只提供站内镜像。');
	process.exit(1);
}

const evidenceDir = 'story-evidence/yuye/edition-01';
if (!fs.existsSync(evidenceDir)) {
	console.error(`找不到 ${evidenceDir}，未写入`);
	process.exit(1);
}

fs.writeFileSync(target, env.replace(`# ${marker}=`, `${marker}=${sha.toLowerCase()}`), 'utf8');
console.log(`已写入 ${marker}=${sha.toLowerCase()}`);
console.log(`请在确认提交 ${sha.slice(0, 7)} 已推送到公开仓库后重新构建；未发布时不要填写。`);
