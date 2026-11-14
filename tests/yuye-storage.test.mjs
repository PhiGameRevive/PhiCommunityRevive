import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { createStory } from '../src/lib/story/model.ts';

// Node 24 原生 stripping；只补全本测试命名空间中 storage 的扩展名，不改变应用 import。
registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === './model' && context.parentURL?.includes('/src/lib/story/storage.ts')) return nextResolve(new URL('./model.ts', context.parentURL).href, context);
		return nextResolve(specifier, context);
	},
});

let moduleId = 0;
const seed = () => createStory([{ id: 0, title: '', region: '', description: '', scenes: [{ id: 'start', title: '', location: 'station', summary: '', requires: [], hotspots: [], steps: [{ type: 'dialogue', speaker: '栞', text: '下一页。' }] }] }]);

/** 小型事务替身：写入先暂存，complete 才发布；跨连接串行，abort 丢弃暂存。故障来自指定事件阶段。 */
class YuyeDatabase {
	value = undefined;
	fault = null;
	opened = [];
	closed = 0;
	transactions = [];
	pending = [];
	busy = false;
	hasStore = false;

	install() {
		globalThis.indexedDB = {
			open: (name, version) => {
				this.opened.push([name, version]);
				const request = {};
				const db = {
					objectStoreNames: { contains: (store) => this.hasStore && store === 'saves' },
					createObjectStore: (store) => {
						assert.equal(store, 'saves');
						this.hasStore = true;
					},
					close: () => {
						this.closed++;
					},
					transaction: (store, mode) => {
						assert.equal(store, 'saves');
						assert.ok(this.hasStore);
						if (this.fault === 'transaction-create') {
							this.fault = null;
							throw new Error('injected transaction create');
						}
						const tx = new YuyeTransaction(this, mode, this.fault);
						this.fault = null;
						this.transactions.push(tx);
						this.pending.push(tx);
						this.startNext();
						return tx;
					},
				};
				setImmediate(() => {
					if (this.fault === 'open') {
						this.fault = null;
						request.error = new Error('injected open');
						request.onerror?.();
						return;
					}
					request.result = db;
					if (this.fault === 'blocked') {
						this.fault = null;
						request.onblocked?.();
						// 阻塞解除后的迟到连接必须关闭，不能把已拒绝的打开变成成功。
						setImmediate(() => request.onsuccess?.());
						return;
					}
					if (!this.hasStore) request.onupgradeneeded?.();
					request.onsuccess?.();
				});
				return request;
			},
		};
	}

	startNext() {
		if (this.busy || !this.pending.length) return;
		this.busy = true;
		const tx = this.pending.shift();
		setImmediate(() => tx.run());
	}

	end() {
		this.busy = false;
		this.startNext();
	}
}

class YuyeTransaction {
	operations = [];
	state = 'pending';
	error = null;
	result = undefined;
	written = false;
	constructor(backend, mode, fault) {
		this.backend = backend;
		this.mode = mode;
		this.fault = fault;
	}

	objectStore(name) {
		assert.equal(name, 'saves');
		return {
			get: (key) => this.request('get', key),
			put: (value, key) => {
				assert.equal(this.mode, 'readwrite');
				return this.request('put', key, structuredClone(value));
			},
		};
	}

	request(kind, key, value) {
		assert.equal(key, 'current');
		const request = {};
		this.operations.push({ kind, value, request });
		return request;
	}

	abort() {
		if (this.state === 'aborted' || this.state === 'complete') throw new Error('InvalidStateError');
		this.state = 'aborted';
		setImmediate(() => {
			this.onabort?.();
			this.backend.end();
		});
	}

	run() {
		if (this.state === 'aborted') return;
		if (this.state === 'pending') {
			this.state = 'active';
			this.result = structuredClone(this.backend.value);
		}
		const operation = this.operations.shift();
		if (!operation) {
			this.state = 'complete';
			if (this.written) this.backend.value = this.result;
			this.oncomplete?.();
			this.backend.end();
			return;
		}
		const { kind, value, request } = operation;
		if (this.fault === kind) {
			request.error = new Error(`injected ${kind}`);
			request.onerror?.();
			if (this.state !== 'aborted') this.abort();
			return;
		}
		if (kind === 'put') {
			this.result = value;
			this.written = true;
		}
		request.result = kind === 'get' ? structuredClone(this.result) : 'current';
		request.onsuccess?.();
		if (this.state === 'aborted') return;
		if (this.fault === 'abort-after-put' && kind === 'put') {
			this.error = new Error('injected abort after successful put');
			this.abort();
			return;
		}
		if (this.fault === 'transaction-error') {
			this.error = new Error('injected transaction error');
			this.onerror?.();
			return;
		}
		setImmediate(() => this.run());
	}
}

async function fresh(backend = new YuyeDatabase()) {
	backend.install();
	const storage = await import(`../src/lib/story/storage.ts?yuyeTest=${++moduleId}`);
	return { backend, ...storage };
}

test('导出/导入完整往返、深拷贝、数组去重；只接收 yuye-1', async () => {
	const storage = await fresh();
	const save = seed();
	save.positions.start = 1;
	save.completed = ['start', 'start'];
	save.choices.q = 'a';
	save.hotspots = ['start/window', 'start/window'];
	save.puzzles = ['P00', 'P00'];
	save.cutscenes = ['C00', 'C00'];
	save.seenBeats = ['start/0', 'start/0'];
	save.evidence = [
		{ id: 'e', title: '来稿', text: '说明' },
		{ id: 'e', title: '来稿', text: '说明' },
	];
	save.trackReceipts.T00 = { track: 'T00', mode: 'summary', seconds: 0 };
	save.reload = { scene: 'start', origin: 'page-a', returned: false };
	save.notes = '访客的笔记\n下一页';
	const result = storage.parseStoryImport(storage.exportStory(save));
	for (const field of ['completed', 'hotspots', 'puzzles', 'cutscenes', 'seenBeats', 'evidence']) assert.equal(result[field].length, 1);
	assert.equal(result.notes, save.notes);
	assert.deepEqual(result.reload, save.reload);
	assert.notEqual(result.preferences, save.preferences);
	assert.notEqual(result.positions, save.positions);
	assert.notEqual(result.trackReceipts.T00, save.trackReceipts.T00);
	result.evidence[0].text = '不同';
	assert.equal(save.evidence[0].text, '说明');
	assert.throws(() => storage.parseStoryImport(JSON.stringify({ ...seed(), contentVersion: 'yuye-2' })), /yuye-2.*yuye-1.*迁移/);
});

test('非法导入：深层结构、整数、数组上限、安全键、mode/ending/preferences', async () => {
	const { parseStoryImport: parse } = await fresh();
	for (const text of ['{', 'null', '[]', '{}', 'true', '1']) assert.throws(() => parse(text), /存档无效/);
	const mutations = [
		(s) => {
			delete s.scene;
		},
		(s) => {
			s.unknown = true;
		},
		(s) => {
			s.schemaVersion = 2;
		},
		(s) => {
			s.revision = -1;
		},
		(s) => {
			s.revision = 0.5;
		},
		(s) => {
			s.revision = Number.MAX_SAFE_INTEGER + 1;
		},
		(s) => {
			s.positions.start = -1;
		},
		(s) => {
			s.positions.start = 0.1;
		},
		(s) => {
			s.positions.start = 100001;
		},
		(s) => {
			s.positions = [];
		},
		(s) => {
			s.positions = {};
		},
		(s) => {
			s.completed = ['unknown'];
		},
		(s) => {
			s.completed = ['start'];
		},
		(s) => {
			s.choices = { q: [] };
		},
		(s) => {
			s.hotspots = [null];
		},
		(s) => {
			s.puzzles = Array(10001).fill('P00');
		},
		(s) => {
			s.cutscenes = 'C00';
		},
		(s) => {
			s.seenBeats = [{}];
		},
		(s) => {
			s.evidence = [{ id: 'e', title: '证据' }];
		},
		(s) => {
			s.evidence = [
				{ id: 'e', title: '', text: '' },
				{ id: 'e', title: '冲突', text: '' },
			];
		},
		(s) => {
			s.trackReceipts = { t: { track: 'different', mode: 'auto', seconds: 1 } };
		},
		(s) => {
			s.trackReceipts = { t: { track: 't', mode: 'cheat', seconds: 1 } };
		},
		(s) => {
			s.trackReceipts = { t: { track: 't', mode: 'auto', seconds: -1 } };
		},
		(s) => {
			s.ending = 'bad';
		},
		(s) => {
			s.notes = 12;
		},
		(s) => {
			s.preferences.volume = 1.1;
		},
		(s) => {
			s.preferences.horror = 'true';
		},
		(s) => {
			s.preferences.reducedMotion = 1;
		},
		(s) => {
			s.preferences.textSize = 0;
		},
		(s) => {
			s.preferences.textSize = 3;
		},
		(s) => {
			s.activeSeconds.music = -1;
		},
		(s) => {
			s.activeSeconds.puzzle = null;
		},
		(s) => {
			s.reload = { scene: 'start', origin: 'a' };
		},
		(s) => {
			s.reload = { scene: 'unknown', origin: 'a', returned: false };
		},
		(s) => {
			s.reload = { scene: 'start', origin: 'a', returned: 1 };
		},
	];
	for (const mutate of mutations) {
		const save = seed();
		mutate(save);
		assert.throws(() => parse(JSON.stringify(save)), /存档无效/, String(mutate));
	}
	for (const key of ['__proto__', 'constructor', 'prototype']) {
		for (const field of ['positions', 'choices', 'trackReceipts']) {
			const save = seed();
			save[field] = JSON.parse(`{"${key}":0}`);
			assert.throws(() => parse(JSON.stringify(save)), /不安全/);
		}
		const save = seed();
		save.hotspots = [`start/${key}`];
		assert.throws(() => parse(JSON.stringify(save)), /不安全/);
	}
	assert.equal({}.polluted, undefined);
});

test('3 MB 限制以 UTF-8 字节计；导出拒绝非有限数', async () => {
	const storage = await fresh();
	assert.throws(() => storage.parseStoryImport(' '.repeat(3 * 1024 * 1024 + 1)), /3 MB/);
	const save = seed();
	save.notes = '页'.repeat(999999);
	save.evidence = [{ id: 'e', title: '', text: '纸'.repeat(60000) }];
	assert.throws(() => storage.parseStoryImport(JSON.stringify(save)), /3 MB/);
	for (const value of [NaN, Infinity, -Infinity]) {
		assert.throws(() => storage.exportStory({ ...seed(), activeSeconds: { ...seed().activeSeconds, music: value } }), /数值/);
	}
});

test('独立库、唯一 key；缺档返回 null，提交只在 transaction.complete 后成功', async () => {
	const storage = await fresh();
	assert.equal(await storage.loadStory(), null);
	const save = seed();
	await storage.commitStory(save);
	assert.equal(storage.backend.transactions.at(-1).state, 'complete');
	assert.deepEqual(storage.backend.value, save);
	assert.deepEqual(await storage.loadStory(), save);
	assert.ok(storage.backend.opened.every(([name, version]) => name === 'PhiCommunityYuye' && version === 1));
	assert.equal(storage.backend.opened.length, storage.backend.closed);
});

test('同 revision 同内容幂等；同 revision 异内容与旧 revision 拒绝', async () => {
	const storage = await fresh();
	const save = { ...seed(), revision: 5 };
	await storage.commitStory(save);
	await storage.commitStory(structuredClone(save));
	assert.equal(storage.backend.transactions.at(-1).written, false);
	await assert.rejects(storage.commitStory({ ...save, notes: '同号异档' }), /revision 冲突/);
	await assert.rejects(storage.commitStory({ ...save, revision: 4 }), /revision 冲突/);
	assert.deepEqual(storage.backend.value, save);
});

test('跨标签 CAS：即使另一标签的候选 revision 更大也不覆盖；重新加载才能继续', async () => {
	const a = await fresh();
	await a.commitStory(seed());
	const b = await fresh(a.backend);
	const first = await a.loadStory();
	const second = await b.loadStory();
	await a.commitStory({ ...first, revision: 1, notes: 'A' });
	await assert.rejects(b.commitStory({ ...second, revision: 20, notes: 'B' }), /其他标签页/);
	assert.equal(a.backend.value.notes, 'A');
	const reloaded = await b.loadStory();
	await b.commitStory({ ...reloaded, revision: 2, notes: 'B after reload' });
	assert.equal(a.backend.value.notes, 'B after reload');
});

test('跨标签并发提交仅一个成功；同标签队列保持提交顺序', async () => {
	const a = await fresh();
	await a.commitStory(seed());
	const b = await fresh(a.backend);
	await a.loadStory();
	await b.loadStory();
	const results = await Promise.allSettled([a.commitStory({ ...seed(), revision: 1, notes: 'A' }), b.commitStory({ ...seed(), revision: 1, notes: 'B' })]);
	assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
	assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
	await a.loadStory();
	await Promise.all([a.commitStory({ ...seed(), revision: 2, notes: '二' }), a.commitStory({ ...seed(), revision: 3, notes: '三' })]);
	assert.equal(a.backend.value.revision, 3);
	assert.equal(a.backend.value.notes, '三');
});

test('未加载既有档不能写；load 损坏明确拒绝并阻止后续覆盖', async () => {
	const backend = new YuyeDatabase();
	backend.value = seed();
	const storage = await fresh(backend);
	await assert.rejects(storage.commitStory({ ...seed(), revision: 10 }), /先加载/);
	backend.value = { broken: true };
	await assert.rejects(storage.loadStory(), /存档无效/);
	const opens = backend.opened.length;
	await assert.rejects(storage.commitStory({ ...seed(), revision: 20 }), /上次加载失败/);
	await assert.rejects(storage.replaceStory(seed()), /上次加载失败/);
	assert.equal(backend.opened.length, opens);
	assert.deepEqual(backend.value, { broken: true });
	backend.value = seed();
	await storage.loadStory();
	await storage.commitStory({ ...seed(), revision: 1 });
	assert.equal(backend.value.revision, 1);
});

test('存储中 null 也是损坏，不被当成缺档；缺档后外部创建同样产生冲突', async () => {
	const storage = await fresh();
	storage.backend.value = null;
	await assert.rejects(storage.loadStory(), /存档无效/);
	storage.backend.value = undefined;
	await storage.loadStory();
	storage.backend.value = { ...seed(), revision: 4 };
	await assert.rejects(storage.commitStory({ ...seed(), revision: 9 }), /其他标签页/);
});

test('显式 replace 使用本地 revision + 1；冲突和未加载时不替换', async () => {
	const storage = await fresh();
	await assert.rejects(storage.replaceStory(seed()), /必须先加载/);
	await storage.loadStory();
	await storage.commitStory({ ...seed(), revision: 8, notes: '现有档' });
	const imported = { ...seed(), notes: '导入档' };
	const replaced = await storage.replaceStory(imported);
	assert.equal(imported.revision, 0);
	assert.equal(replaced.revision, 9);
	assert.equal(storage.backend.value.notes, '导入档');
	await storage.commitStory({ ...replaced, revision: 10, notes: '继续' });
	storage.backend.value = { ...storage.backend.value, revision: 11, notes: '其他标签页' };
	await assert.rejects(storage.replaceStory(imported), /其他标签页/);
	assert.equal(storage.backend.value.notes, '其他标签页');
});

for (const fault of ['open', 'transaction-create', 'get', 'put', 'abort-after-put', 'transaction-error']) {
	test(`事务故障 ${fault}：拒绝、保留旧档、允许安全重试`, async () => {
		const storage = await fresh();
		const original = seed();
		await storage.commitStory(original);
		storage.backend.fault = fault;
		const candidate = { ...original, revision: 1, notes: '候选' };
		await assert.rejects(storage.commitStory(candidate), /injected/);
		assert.deepEqual(storage.backend.value, original);
		await storage.commitStory(candidate);
		assert.deepEqual(storage.backend.value, candidate);
	});
}

test('load 的事务在读取成功后出错仍拒绝；随后 commit 不覆盖旧档', async () => {
	const storage = await fresh();
	await storage.commitStory(seed());
	storage.backend.fault = 'transaction-error';
	await assert.rejects(storage.loadStory(), /injected/);
	await assert.rejects(storage.commitStory({ ...seed(), revision: 1 }), /上次加载失败/);
	assert.equal(storage.backend.value.revision, 0);
});

test('open blocked 立即拒绝且关闭迟到连接；成功 reload 后恢复保存', async () => {
	const storage = await fresh();
	await storage.commitStory(seed());
	storage.backend.fault = 'blocked';
	await assert.rejects(storage.loadStory(), /阻塞/);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(storage.backend.closed, storage.backend.opened.length);
	await assert.rejects(storage.commitStory({ ...seed(), revision: 1 }), /上次加载失败/);
	await storage.loadStory();
	await storage.commitStory({ ...seed(), revision: 1 });
});

test('IndexedDB 不可用时明确拒绝，不能报告已保存', async () => {
	const storage = await fresh();
	delete globalThis.indexedDB;
	await assert.rejects(storage.loadStory(), /不支持 IndexedDB/);
	await assert.rejects(storage.commitStory(seed()), /上次加载失败/);
});
