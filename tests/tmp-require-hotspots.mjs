import fs from 'node:fs';
import path from 'node:path';

/**
 * 把第 0/1/6/7/8/9 章主线场景的全部调查物件设为必修。
 * 这些场景的三个物件都带有独立叙述与证据，原本只把 h0 设为必修会让另外两个看起来像装饰；
 * 设为必修后，玩家必须真正逐件检查，收尾时也不会漏证据。
 */
const dir = path.join(process.cwd(), 'src/lib/story/content');
const targets = new Set([0, 1, 6, 7, 8, 9]);

for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.json'))) {
	const full = path.join(dir, file);
	const chapter = JSON.parse(fs.readFileSync(full, 'utf8'));
	if (!targets.has(chapter.id)) continue;
	let changed = 0;
	for (const scene of chapter.scenes) {
		if (scene.optional) continue;
		const all = scene.hotspots.map((hotspot) => hotspot.id);
		if (scene.requiresHotspots?.length === all.length) continue;
		scene.requiresHotspots = all;
		changed++;
	}
	if (changed) {
		fs.writeFileSync(full, `${JSON.stringify(chapter, null, '\t')}\n`, 'utf8');
		console.log(`${file}: 更新 ${changed} 个主线场景的必修调查项`);
	}
}
