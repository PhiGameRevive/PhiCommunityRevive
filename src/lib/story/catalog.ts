import type { StoryChapter, StoryTrack } from './types';

const content = import.meta.glob<StoryChapter>('./content/chapter-*.json', { eager: true, import: 'default' });
export const CHAPTERS: StoryChapter[] = Object.values(content).sort((a, b) => a.id - b.id);
export const SCENES = CHAPTERS.flatMap((chapter) => chapter.scenes);

/** 来自实际目录与媒体探测；定数未知时保留未知，不伪造低难版本。 */
const rows: [string, number, string, string, string, StoryTrack['level'], string, number][] = [
	['T01', 0, 'Tutorial', 'HanHan vs BGM Cat', 'phi-tutorial', 'ez', 'EZ 3', 148.593],
	['T02', 0, 'Lifeline', 'Zeraphym', 'phi-Lifeline', 'in', 'IN 11', 270.508],
	['T03', 1, '星茶会', '灰澈', 'ptc-r97447892', 'in', 'IN ?', 196.728],
	['T04', 1, 'The Railway', 'ARForest', 'phi-theRailway', 'in', 'IN 13', 183.393],
	['T05', 1, 'Skyscape', 'Plum', 'ptc-r7890178', 'in', 'IN 13', 170.201],
	['T06', 2, 'Fine Logic', 'Sephid', 'phi-ChickenPige0n.FineLogic', 'in', 'IN 14', 134.279],
	['T07', 2, '灰色鹦鹉', 'ChiliChill feat.洛天依', 'ptc-r53604803', 'sp', 'Gray 14', 198.097],
	['T08', 2, 'Options', 'Frums', 'phi-Options', 'in', 'IN 13', 132.331],
	['T09', 3, 'NightTheater', 'わかどり', 'phi-NightTheater', 'in', 'IN 14', 177.728],
	['T10', 3, '微观戏剧', '颜语(kkryu&雨狸&崩坏)', 'ptc-r66488738', 'in', 'IN 14', 96.094],
	['T11', 3, 'ハッピーフェイクショー', 'Ponchi♪,はぁち', 'ptc-r64165254', 'at', 'AT 14', 140],
	['T12', 4, 'All The Time', 'Rhythm Doctor', 'phi-allTheTime', 'in', 'IN 13', 214.436],
	['T13', 4, 'Time Traveler', '|闹闹、| feat.洛天依', 'ptc-r64554235', 'in', 'IN 14', 239.104],
	['T14', 4, 'Stasis', 'Maozon', 'phi-IceAge.Stasis', 'at', 'AT 16', 157.184],
	['T15', 5, '海洋', 'cheetah mobile games', 'ptc-r26973036', 'in', 'IN 13', 128.448],
	['T16', 5, '我的悲伤是水做的', 'Chilichill', 'ptc-r91278846', 'in', 'IN 13', 225.574],
	['T17', 5, 'もぺもぺ', 'LeaF', 'phi-mpmp', 'at', 'AT 15', 110.407],
	['T18', 6, 'NULCTRL', 'Silentroom', 'phi-NULCTRL', 'in', 'IN 14', 155.599],
	['T19', 6, 'Between Boundaries', 'DJ Counterforce', 'ptc-r66545277', 'at', 'AT 16', 117.369],
	['T20', 6, 'Inverted World', 'Mechari', 'phi-invertworld', 'in', 'IN 15', 133.068],
	['T21', 6, 'Materialize Anything', 'anubasu-anubasu', 'phi-materializeAnything', 'in', 'IN 15', 136.79],
	['T22', 7, 'Children of the City', 'Mili', 'ptc-r17466480', 'at', 'AT 15', 146.202],
	['T23', 7, 'Terrasphere', 'Plum', 'phi-BeS.Terrasphere', 'in', 'IN 15', 154.5],
	['T24', 7, 'ouroVoros', 'Negentropy', 'phi-ouroVoros', 'in', 'IN 15', 152.803],
	['T25', 7, 'Grievous Lady', 'Team Grimoire vs Laur', 'phi-grievousLady', 'in', 'IN 15.9', 140.592],
	['T26', 8, 'Tempestissimo', 't+pazolite', 'phi-Tempestissimo', 'at', 'AT 16', 137.169],
	['T27', 8, 'Light', 'Artificial Intelligence & Wanjiongming', 'phi-Light', 'in', 'IN 14', 142.211],
	['T28', 8, 'Abiogenesis', 'BlackY', 'phi-Abiogenesis', 'in', 'IN 14', 179.382],
	['T29', 8, 'Fading Wind', 'Feint', 'ptc-r72948255', 'in', 'IN 15', 295.172],
	['T30', 9, '夜航星', '三体宇宙/不才', 'ptc-r24427861', 'in', 'IN 13', 121.813],
	['T31', 9, 'Credits', 'Frums', 'phi-cd', 'in', 'IN 13', 100.615],
	['T32', 9, 'たったそれだけの物語', 'ucchii0', 'ptc-r69536916', 'at', 'AT 15', 173.479],
];
export const TRACKS: StoryTrack[] = rows.map(([id, chapter, name, artist, codename, level, difficulty, seconds]) => ({ id, chapter, name, artist, codename, level, difficulty, seconds }));
export const TRACK_BY_ID = Object.fromEntries(TRACKS.map((track) => [track.id, track]));

/** 静态阅读量不是时长证明；最短选项反馈防止将互斥分支全部相加。 */
export function contentMetrics(chapters = CHAPTERS) {
	let characters = 0;
	let investigationCharacters = 0;
	let dialogueBeats = 0;
	const tracks = new Set<string>();
	const puzzles = new Set<string>();
	const cutscenes = new Set<string>();
	const han = (text: string) => (text.match(/\p{Script=Han}/gu) ?? []).length;
	for (const scene of chapters.flatMap((chapter) => chapter.scenes).filter((scene) => !scene.optional)) {
		for (const step of scene.steps) {
			if (step.type === 'dialogue') {
				characters += han(step.text);
				dialogueBeats++;
			}
			if (step.type === 'choice') characters += han(step.prompt) + Math.min(...step.options.map((option) => han(option.text)));
			if (step.type === 'evidence') investigationCharacters += han(step.text);
			if (step.type === 'track') tracks.add(step.track);
			if (step.type === 'puzzle') puzzles.add(step.puzzle);
			if (step.type === 'cutscene') cutscenes.add(step.cutscene);
		}
		for (const hotspot of scene.hotspots.filter((hotspot) => scene.requiresHotspots?.includes(hotspot.id))) {
			investigationCharacters += han(hotspot.description) + hotspot.lines.reduce((sum, line) => sum + han(line.text), 0);
		}
	}
	return { characters, investigationCharacters, dialogueBeats, musicSeconds: TRACKS.filter((track) => tracks.has(track.id)).reduce((sum, track) => sum + track.seconds, 0), tracks: tracks.size, puzzles: puzzles.size, cutscenes: cutscenes.size };
}
