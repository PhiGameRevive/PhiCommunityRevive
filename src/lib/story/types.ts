/** 《余页》：故事内容、存档与渲染器之间的稳定契约。 */
export type StoryCategory = 'dialogue' | 'exploration' | 'puzzle' | 'music' | 'cutscene';
export type StoryEnding = 'unbound' | 'daylight' | 'closed';
export interface Evidence {
	id: string;
	title: string;
	text: string;
}
export interface DialogueLine {
	speaker: string;
	text: string;
}
export type StoryBeat =
	| ({ type: 'dialogue' } & DialogueLine)
	| { type: 'evidence'; id: string; title: string; text: string }
	| { type: 'choice'; id: string; prompt: string; options: { id: string; label: string; text: string }[] }
	| { type: 'track'; track: string; before: string; after: string }
	| { type: 'puzzle'; puzzle: string }
	| { type: 'cutscene'; cutscene: string };
export interface StoryHotspot {
	id: string;
	title: string;
	description: string;
	lines: DialogueLine[];
	evidence?: Evidence;
}
export interface StoryScene {
	id: string;
	title: string;
	/** 稳定地点编号；尾声可回到同一地点但拥有新的场景实例。 */
	location: string;
	summary: string;
	optional?: boolean;
	/** 已完成场景 ID；仅使用本章内前置，章节开放由模型控制。 */
	requires: string[];
	requiresHotspots?: string[];
	hotspots: StoryHotspot[];
	steps: StoryBeat[];
}
export interface StoryChapter {
	id: number;
	title: string;
	region: string;
	description: string;
	scenes: StoryScene[];
}
export interface StoryTrack {
	id: string;
	chapter: number;
	name: string;
	artist: string;
	codename: string;
	level: 'ez' | 'hd' | 'in' | 'at' | 'sp';
	difficulty: string;
	seconds: number;
}
export interface StoryReceipt {
	track: string;
	mode: 'manual' | 'auto' | 'listen' | 'summary';
	seconds: number;
}
export interface StoryPreferences {
	volume: number;
	reducedMotion: boolean;
	horror: boolean;
	textSize: number;
}
export interface StorySave {
	schemaVersion: 1;
	contentVersion: string;
	revision: number;
	scene: string;
	positions: Record<string, number>;
	completed: string[];
	choices: Record<string, string>;
	evidence: Evidence[];
	hotspots: string[];
	trackReceipts: Record<string, StoryReceipt>;
	puzzles: string[];
	cutscenes: string[];
	seenBeats: string[];
	notes: string;
	preferences: StoryPreferences;
	activeSeconds: Record<StoryCategory, number>;
	ending: StoryEnding | null;
	reload: { scene: string; origin: string; returned: boolean } | null;
}
