import { CONTENT_VERSION } from './model';
import type { Evidence, StoryCategory, StoryReceipt, StorySave } from './types';

const DATABASE = 'PhiCommunityYuye';
const STORE = 'saves';
const SAVE_KEY = 'current';
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_ITEMS = 10_000;
const categories: StoryCategory[] = ['dialogue', 'exploration', 'puzzle', 'music', 'cutscene'];
const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype']);

function invalid(message: string): never {
	throw new Error(`《余页》存档无效：${message}`);
}

function object(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(`${name} 必须是普通对象`);
	const result = value as Record<string, unknown>;
	if (Object.keys(result).some((id) => unsafeKeys.has(id))) invalid(`${name} 含不安全键`);
	return result;
}

function fields(value: unknown, name: string, expected: string[]): Record<string, unknown> {
	const result = object(value, name);
	const keys = Object.keys(result);
	if (keys.length !== expected.length || expected.some((field) => !Object.prototype.hasOwnProperty.call(result, field))) invalid(`${name} 字段缺失或未知`);
	return result;
}

function text(value: unknown, name: string, limit = 100_000): string {
	if (typeof value !== 'string' || value.length > limit) invalid(`${name} 必须是长度不超过 ${limit} 的文本`);
	return value;
}

function id(value: unknown, name: string): string {
	const result = text(value, name, 256);
	if (!result || result.split('/').some((part) => unsafeKeys.has(part))) invalid(`${name} 含空值或不安全标识符`);
	return result;
}

function number(value: unknown, name: string, min = 0, max = Number.MAX_SAFE_INTEGER, integer = false): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) invalid(`${name} 数值越界或类型错误`);
	return value;
}

function boolean(value: unknown, name: string): boolean {
	if (typeof value !== 'boolean') invalid(`${name} 必须是布尔值`);
	return value;
}

function array(value: unknown, name: string): unknown[] {
	if (!Array.isArray(value) || value.length > MAX_ITEMS) invalid(`${name} 必须是至多 ${MAX_ITEMS} 项的数组`);
	return value;
}

function ids(value: unknown, name: string): string[] {
	return [...new Set(array(value, name).map((entry) => id(entry, name)))];
}

function record<T>(value: unknown, name: string, parse: (entry: unknown, key: string) => T): Record<string, T> {
	const entries = Object.entries(object(value, name));
	if (entries.length > MAX_ITEMS) invalid(`${name} 项目过多`);
	return Object.fromEntries(entries.map(([key, entry]) => [id(key, name), parse(entry, key)]));
}

function receipt(value: unknown, key: string): StoryReceipt {
	const data = fields(value, '演奏回执', ['track', 'mode', 'seconds']);
	const track = id(data.track, '曲目');
	if (track !== key) invalid('演奏回执的键与曲目不匹配');
	if (data.mode !== 'manual' && data.mode !== 'auto' && data.mode !== 'listen' && data.mode !== 'summary') invalid('未知演奏模式');
	return { track, mode: data.mode, seconds: number(data.seconds, '演奏秒数') };
}

/** 校验并重建每层数据，不保留输入对象的引用。此处校验存档结构；场景内容与 gate 由 model 在操作时核验。 */
function validate(value: unknown): StorySave {
	const data = fields(value, '根对象', [
		'schemaVersion',
		'contentVersion',
		'revision',
		'scene',
		'positions',
		'completed',
		'choices',
		'evidence',
		'hotspots',
		'trackReceipts',
		'puzzles',
		'cutscenes',
		'seenBeats',
		'notes',
		'preferences',
		'activeSeconds',
		'ending',
		'reload',
	]);
	if (data.schemaVersion !== 1) invalid('不支持此 schemaVersion（当前为 1）');
	if (data.contentVersion !== CONTENT_VERSION) invalid(`未知内容版本 ${String(data.contentVersion)}；当前仅支持 ${CONTENT_VERSION}，请使用对应版本游戏或等待迁移支持`);
	const preferences = fields(data.preferences, '偏好', ['volume', 'reducedMotion', 'horror', 'textSize']);
	const time = fields(data.activeSeconds, '活动计时', categories);
	if (data.ending !== null && data.ending !== 'unbound' && data.ending !== 'daylight' && data.ending !== 'closed') invalid('未知结局');
	const evidence = new Map<string, Evidence>();
	for (const entry of array(data.evidence, '证据')) {
		const item = fields(entry, '证据项', ['id', 'title', 'text']);
		const parsed = { id: id(item.id, '证据编号'), title: text(item.title, '证据标题', 1024), text: text(item.text, '证据正文') };
		const previous = evidence.get(parsed.id);
		if (previous && (previous.title !== parsed.title || previous.text !== parsed.text)) invalid('同一证据编号的内容冲突');
		evidence.set(parsed.id, parsed);
	}
	let reload: StorySave['reload'] = null;
	if (data.reload !== null) {
		const item = fields(data.reload, '重载标记', ['scene', 'origin', 'returned']);
		reload = { scene: id(item.scene, '重载场景'), origin: id(item.origin, '页面实例'), returned: boolean(item.returned, '重载返回状态') };
	}
	const positions = record(data.positions, '场景游标', (entry) => number(entry, '游标', 0, 100_000, true));
	const scene = id(data.scene, '当前场景');
	if (!Object.prototype.hasOwnProperty.call(positions, scene)) invalid('当前场景缺少游标');
	const completed = ids(data.completed, '完成场景');
	if (completed.some((sceneId) => !Object.prototype.hasOwnProperty.call(positions, sceneId) || positions[sceneId] === 0)) invalid('完成场景缺少有效游标');
	if (reload && !Object.prototype.hasOwnProperty.call(positions, reload.scene)) invalid('重载场景缺少游标');
	return {
		schemaVersion: 1,
		contentVersion: CONTENT_VERSION,
		revision: number(data.revision, 'revision', 0, Number.MAX_SAFE_INTEGER, true),
		scene,
		positions,
		completed,
		choices: record(data.choices, '选择', (entry) => id(entry, '选项')),
		evidence: [...evidence.values()],
		hotspots: ids(data.hotspots, '调查热点'),
		trackReceipts: record(data.trackReceipts, '演奏回执', receipt),
		puzzles: ids(data.puzzles, '谜题'),
		cutscenes: ids(data.cutscenes, '过场'),
		seenBeats: ids(data.seenBeats, '已读剧情'),
		notes: text(data.notes, '笔记', 1_000_000),
		preferences: { volume: number(preferences.volume, '音量', 0, 1), reducedMotion: boolean(preferences.reducedMotion, '降低动态'), horror: boolean(preferences.horror, '恐怖演出'), textSize: number(preferences.textSize, '字体倍率', 0.75, 2) },
		activeSeconds: Object.fromEntries(categories.map((category) => [category, number(time[category], `${category} 时间`)])) as Record<StoryCategory, number>,
		ending: data.ending,
		reload,
	};
}

export function parseStoryImport(textValue: string): StorySave {
	if (typeof textValue !== 'string' || textValue.length > MAX_BYTES || new TextEncoder().encode(textValue).byteLength > MAX_BYTES) invalid('导入文件不得超过 3 MB');
	let value: unknown;
	try {
		value = JSON.parse(textValue);
	} catch {
		invalid('不是合法 JSON');
	}
	return validate(value);
}

export function exportStory(save: StorySave): string {
	const result = JSON.stringify(validate(save), null, 2);
	if (new TextEncoder().encode(result).byteLength > MAX_BYTES) invalid('导出文件超过 3 MB');
	return result;
}

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value && typeof value === 'object')
		return `{${Object.entries(value)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
			.join(',')}}`;
	return JSON.stringify(value);
}

type Snapshot = { revision: number; content: string } | null;
let observed: Snapshot | undefined;
let loadFailed = false;
let queue: Promise<unknown> = Promise.resolve();

function snapshot(save: StorySave | null): Snapshot {
	return save ? { revision: save.revision, content: canonical(save) } : null;
}

function serial<T>(operation: () => Promise<T>): Promise<T> {
	const next = queue.then(operation, operation);
	queue = next.catch(() => undefined);
	return next;
}

function open(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		if (typeof indexedDB === 'undefined') {
			reject(new Error('浏览器不支持 IndexedDB，故事存档未保存'));
			return;
		}
		let settled = false;
		const request = indexedDB.open(DATABASE, 1);
		const fail = (error: unknown) => {
			settled = true;
			reject(error);
		};
		request.onblocked = () => fail(new Error('故事存档数据库升级被其他标签页阻塞，请关闭旧标签页后重试'));
		request.onerror = () => fail(request.error ?? new Error('无法打开故事存档数据库'));
		request.onupgradeneeded = () => {
			if (settled) {
				request.transaction?.abort();
				return;
			}
			try {
				if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
			} catch (error) {
				request.transaction?.abort();
				fail(error);
			}
		};
		request.onsuccess = () => {
			const db = request.result;
			if (settled) {
				db.close();
				return;
			}
			settled = true;
			db.onversionchange = () => db.close();
			resolve(db);
		};
	});
}

/** resolve 只发生于 transaction.complete；get/put 的 success 尚不意味着落盘。 */
async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore, setResult: (value: T) => void, fail: (error: unknown) => void) => void): Promise<T> {
	const db = await open();
	try {
		return await new Promise<T>((resolve, reject) => {
			let tx: IDBTransaction;
			let result: T;
			let hasResult = false;
			let failure: unknown;
			try {
				tx = db.transaction(STORE, mode);
			} catch (error) {
				reject(error);
				return;
			}
			const fail = (error: unknown) => {
				failure ??= error;
				try {
					tx.abort();
				} catch {
					reject(failure);
				}
			};
			tx.onabort = () => reject(failure ?? tx.error ?? new Error('故事存档事务已中止'));
			tx.onerror = () => fail(tx.error ?? new Error('故事存档事务失败'));
			tx.oncomplete = () => {
				if (failure) reject(failure);
				else if (!hasResult) reject(new Error('故事存档事务没有返回结果'));
				else resolve(result);
			};
			try {
				action(
					tx.objectStore(STORE),
					(value) => {
						result = value;
						hasResult = true;
					},
					fail,
				);
			} catch (error) {
				fail(error);
			}
		});
	} finally {
		db.close();
	}
}

export function loadStory(): Promise<StorySave | null> {
	return serial(async () => {
		try {
			const save = await transaction<StorySave | null>('readonly', (store, done, fail) => {
				const request = store.get(SAVE_KEY);
				request.onerror = () => fail(request.error ?? new Error('故事存档读取失败'));
				request.onsuccess = () => {
					try {
						done(request.result === undefined ? null : validate(request.result));
					} catch (error) {
						fail(error);
					}
				};
			});
			observed = snapshot(save);
			loadFailed = false;
			return save;
		} catch (error) {
			loadFailed = true;
			throw error;
		}
	});
}

function write(save: StorySave, replace: boolean): Promise<StorySave> {
	return serial(async () => {
		if (loadFailed) throw new Error('上次加载失败，禁止覆盖旧档；请先成功重新加载');
		const saved = await transaction<StorySave>('readwrite', (store, done, fail) => {
			const request = store.get(SAVE_KEY);
			request.onerror = () => fail(request.error ?? new Error('故事存档读取失败'));
			request.onsuccess = () => {
				try {
					const existing = request.result === undefined ? null : validate(request.result);
					const current = snapshot(existing);
					if (!replace && current?.revision === save.revision && current.content === canonical(save)) {
						done(save);
						return;
					}
					if (observed === undefined && existing) throw new Error('请先加载现有故事存档，再保存修改');
					if (observed !== undefined && (observed?.content ?? null) !== (current?.content ?? null)) throw new Error('存档冲突：其他标签页已更新，请重新加载后继续');
					let candidate = save;
					if (replace) {
						if (observed === undefined) throw new Error('替换存档前必须先加载当前存档');
						const revision = (existing?.revision ?? -1) + 1;
						if (!Number.isSafeInteger(revision)) throw new Error('存档 revision 已溢出');
						candidate = { ...save, revision };
					} else if (existing && save.revision <= existing.revision) throw new Error('存档 revision 冲突：禁止旧档覆盖或同版本不同内容');
					const put = store.put(candidate, SAVE_KEY);
					put.onerror = () => fail(put.error ?? new Error('故事存档写入失败'));
					put.onsuccess = () => done(candidate);
				} catch (error) {
					fail(error);
				}
			};
		});
		observed = snapshot(saved);
		return saved;
	});
}

export async function commitStory(save: StorySave): Promise<void> {
	await write(validate(save), false);
}

/**
 * 显式导入替换：UI 先 loadStory()、parseStoryImport() 并确认替换，再调用本函数。
 * 仍以事务内 CAS 检查其他标签页；revision 重设为本地旧档 + 1。
 * 返回的存档才是 UI 应采用的状态；普通 commitStory 不用于旧版本导入替换。
 * 损坏旧档必须先恢复为可加载状态，此函数不会绕开加载失败保护。
 */
export function replaceStory(save: StorySave): Promise<StorySave> {
	return write(validate(save), true);
}
