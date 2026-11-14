import archiveReadme from '../../../story-evidence/yuye/edition-01/README.md?raw';
import rainNight from '../../../story-evidence/yuye/edition-01/records/rain-night.txt?raw';
import baiYuRights from '../../../story-evidence/yuye/edition-01/rights/bai-yu.txt?raw';
import collate from '../../../story-evidence/yuye/edition-01/runtime/collate.ts?raw';
import type { StorySave } from './types';

export interface PuzzleQuestion {
	id: string;
	prompt: string;
	options: { id: string; label: string }[];
	answer: string;
}

export interface Puzzle {
	id: string;
	title: string;
	question: string;
	evidence: { title: string; text: string }[];
	questions: PuzzleQuestion[];
	hints: string[];
	explanation: string;
}

/** 标题与全屏／手机装订签抄本可共用这一故事字段。 */
export const BINDING_TITLE = '西桥｜余页';
export const ARCHIVE_FILES: { path: string; text: string }[] = [
	{ path: 'README.md', text: archiveReadme },
	{ path: 'records/rain-night.txt', text: rainNight },
	{ path: 'rights/bai-yu.txt', text: baiYuRights },
	{ path: 'runtime/collate.ts', text: collate },
];

// 完整 SHA 只是格式校验；提交是否已发布由发行流程确认，不在客户端伪造或联网猜测。
const configuredRevision = String(import.meta.env.VITE_STORY_ARCHIVE_REVISION ?? '').trim();
export const ARCHIVE_REVISION: string | null = /^[0-9a-f]{40}$/i.test(configuredRevision) && !/^0{40}$/.test(configuredRevision) ? configuredRevision.toLowerCase() : null;
export const ARCHIVE_BASE: string | null = ARCHIVE_REVISION ? `https://github.com/PhiGameRevive/PhiCommunityRevive/blob/${ARCHIVE_REVISION}/story-evidence/yuye/edition-01/` : null;

function question(id: string, prompt: string, options: [string, string][], answer: string): PuzzleQuestion {
	return { id, prompt, options: options.map(([id, label]) => ({ id, label })), answer };
}

const stations: [string, string][] = [
	['white', '白页站'],
	['center', '版心街'],
	['proof', '校样馆'],
	['transfer', '城内换乘点'],
];
const editions: [string, string][] = [
	['street', '街本'],
	['stage', '幕本'],
	['discard', '删去这份记录'],
];
const reservoirEvents: [string, string][] = [
	['permission', '入库许可'],
	['withdrawal', '退场请求'],
	['fallback', '旧稿被调用'],
];

export const PUZZLES: Record<string, Puzzle> = {
	P00: {
		id: 'P00',
		title: '没有写目的地的票',
		question: '把票和候车图例并排：三个孔形指向怎样的路线，应该乘哪条线？',
		evidence: [
			{ title: '已收票据 · 从左到右', text: '圆 → 双横线 → 缺口方框。票上没有写目的地。请按孔形出现的顺序对照。' },
			{ title: '候车图例', text: '圆＝白页站；双横线＝版心街；缺口方框＝城内换乘点。图例仅适用于故事内线路。' },
			{ title: '月台表', text: 'A 线：白页站 → 版心街 → 城内换乘点。\nB 线：白页站 → 校样馆 → 城内换乘点。' },
		],
		questions: [
			question('first', '路线第 1 站：圆', stations, 'white'),
			question('second', '路线第 2 站：双横线', stations, 'center'),
			question('third', '路线第 3 站：缺口方框', stations, 'transfer'),
			question(
				'line',
				'按这个顺序选择月台',
				[
					['a', 'A 线'],
					['b', 'B 线'],
				],
				'a',
			),
		],
		hints: ['先收好票，再找候车图例。本面板已把票、图例和月台表放在一起。', '孔形表示站名，左右顺序表示行程；两条线路的中间站不同。', '完整操作：第 1 站选白页站，第 2 站选版心街，第 3 站选城内换乘点；月台选 A 线，提交。'],
		explanation: '白页站 → 版心街 → 城内换乘点，与 A 线完全对应。调音室的入口开放；物件、图例和地图可以相互核对。',
	},
	P01: {
		id: 'P01',
		title: '装订签没有改口',
		question: '维修单需要的是来稿中的桥名。当前标牌与来稿索引各自能证明什么？',
		evidence: [
			{ title: '街头指示牌与白榆的说明', text: '当前标牌：东桥。\n白榆：“地图经过统一校订。”这是当前舞台的称呼，不能直接代替来稿原名。' },
			{ title: '地图桌 · 装订说明', text: '正文可以重排；装订签照抄来稿原名。此页的签在浏览器最上方的页签上。维修单问的是“来稿中的桥名”。' },
			{ title: '装订签抄本 · 与故事页签同一字段', text: BINDING_TITLE },
		],
		questions: [
			question(
				'source',
				'维修单应优先对照哪一类记录？',
				[
					['sign', '当前街头指示牌'],
					['binding', '照抄来稿原名的装订签'],
					['preference', '我比较喜欢的名字'],
				],
				'binding',
			),
			question(
				'name',
				'来稿中的桥名',
				[
					['east', '东桥'],
					['west', '西桥'],
					['both', '来稿原名同时是东桥和西桥'],
				],
				'west',
			),
			question(
				'scope',
				'这个结论的范围',
				[
					['limited', '证明来稿原名为西桥，不证明东桥称呼毫无出处'],
					['erase', '证明东桥毫无出处，应该删掉所有相关记录'],
					['invalid', '两个名字不同，所以整张地图无效'],
				],
				'limited',
			),
		],
		hints: [
			'查看地图桌的装订说明；全屏或手机可以直接读装订签抄本。',
			'区分“当前标牌”和“来稿索引”。题目指定的是来稿原名，不是评价哪一个称呼更正确。',
			'完整操作：证据来源选“装订签”，桥名选“西桥”，结论选“仅证明来稿原名，不否认东桥出处”。俗称附注不参与判题。',
		],
		explanation: '装订签写“西桥｜余页”，故维修单填写西桥。交通恢复；是否附注俗称“东桥”属于后续地图讨论，不改变这里的判定。',
	},
	P02: {
		id: 'P02',
		title: '一人为什么有两个有效地址',
		question: '按纸角版记给四份记录分卷，再说明两卷之间的关系。不要把两个版本拼成一天。',
		evidence: [
			{ title: 'A1 · 栞的街区来稿', text: '地址：版心街 04。\n纸角版记：街本。' },
			{ title: 'A2 · 茶摊收件单', text: '收件地址：版心街 04。\n纸角版记：街本。' },
			{ title: 'B1 · 栞的剧院来稿', text: '地址：侧门 02。\n纸角版记：幕本。' },
			{ title: 'B2 · 剧院值班单', text: '值班地址：侧门 02。\n纸角版记：幕本。' },
			{ title: '授权柜说明', text: '街本、幕本均获准独立排演。没有一份撤销另一份的说明。地址必须连同版记与来源保留。' },
		],
		questions: [
			question('a1', 'A1 · 街区来稿放入哪卷？', editions, 'street'),
			question('a2', 'A2 · 茶摊收件单放入哪卷？', editions, 'street'),
			question('b1', 'B1 · 剧院来稿放入哪卷？', editions, 'stage'),
			question('b2', 'B2 · 剧院值班单放入哪卷？', editions, 'stage'),
			question(
				'relation',
				'两卷关系',
				[
					['versions', '不同版本，保留出处，不强行合并'],
					['move', '同一天从版心街搬到侧门'],
					['latest', '按验收顺序删掉旧的一卷'],
				],
				'versions',
			),
		],
		hints: ['在校样馆看四份纸角版记和授权柜。本面板保留了全部原始字样。', '同版记录的地址相互支持；两本都获准独立排演，不能凭不同地址补出搬家经历。', '完整操作：A1、A2 选街本；B1、B2 选幕本；关系选“不同版本，保留出处，不强行合并”。'],
		explanation: 'A1+A2 属于街本，B1+B2 属于幕本。两卷都有效，不需要选出一个“真正的栞”；两个版本分别获得带版记的入口。',
	},
	P03: {
		id: 'P03',
		title: '布景回来，书签留下',
		question: '先保存排练书签并重开页面，再将留下的书签与新舞台对照。重开到底改变了什么？',
		evidence: [
			{ title: 'A · 排练书签《暴雨夜·留桥》', text: '白榆留在折脊高架，协助封路。\n状态：来稿有效。版别：排练。\n这是重开之前展示的版本。' },
			{ title: 'B · 后台说明', text: '重新打开页面装入定稿；校听员已保存的书签不回到原点。先保存证据与检查点，确认成功后才刷新。' },
			{ title: 'C · 重开后的舞台《暴雨夜·离城》', text: '白榆从白页站离城。\n状态：来稿有效。版别：定稿。\n排练书签仍在，可与此稿并排。' },
		],
		questions: [
			question(
				'changed',
				'此次重新载入改变了什么？',
				[
					['display', '舞台当前展示的版本'],
					['bookmark', '删掉了已保存的排练书签'],
					['permission', '自动撤销了排练稿的有效状态'],
				],
				'display',
			),
			question(
				'relation',
				'《留桥》和《离城》的关系',
				[
					['parallel', '同一题材的两份有效、互斥来稿'],
					['same-night', '白榆在同一晚同时留桥又离城'],
					['invalid', '定稿出现，排练稿必定无效'],
				],
				'parallel',
			),
			question(
				'retained',
				'哪些材料仍可作为调查证据？',
				[
					['both', '排练书签和定稿都保留，连同各自版别'],
					['last', '只能保留当前舞台的定稿'],
					['lost', '应认定玩家丢失了存档'],
				],
				'both',
			),
		],
		hints: [
			'先在排练台保存《留桥》书签。可以使用下面的“保存书签并重新开页”；存储不可用时选“重开布景（不刷新）”。',
			'重开只改变展示版本，不会让留下的书签失效。返回后把有效状态和版别并排看。',
			'完整操作：先完成真实重返或明确标记的等价重开；“改变”选舞台展示，“关系”选两份有效、互斥来稿，“保留”选两份及其版别。',
		],
		explanation: '当前显示不是全部材料。重开装入《离城》，已保存的《留桥》仍有效；它们是两份许可演绎，不能拼成同一晚，也不意味着存档丢失。',
	},
	P04: {
		id: 'P04',
		title: '第五响不是没有到达',
		question: '把前台结果、有效到达记录和故事诊断对照：该修硬件，还是查筛除规则？',
		evidence: [
			{ title: '前台面板', text: '第五响缺失。\n前台只报告当前排演结果。' },
			{ title: '抄时纸带', text: '第五响：有效到达。\n第六响：有效到达。\n两条记录都留有各自出处。' },
			{ title: '维护纸条', text: "后台保留收到但未上台的记录。故事诊断固定查询：window.yuye.inspect('clock')。\n也可直接使用本页“检查钟楼”按钮，返回完全相同的文本。" },
		],
		questions: [
			question(
				'fault',
				'故障分类',
				[
					['filter', '版本筛除'],
					['hardware', '钟楼硬件没有收到第五响'],
					['network', '必须根据现实网络状态判定丢包'],
				],
				'filter',
			),
			question(
				'proof',
				'支撑分类的证据',
				[
					['received', '第五响与第六响都有有效到达记录'],
					['front', '前台没有第五响，所以它从未到达'],
					['loud', '当前声音听起来比较响'],
				],
				'received',
			),
			question(
				'action',
				'接下来怎样处理？',
				[
					['trace', '保留两份回声出处，检查版本关系与筛除规则'],
					['all', '不作区分，同时播放所有回声'],
					['replace', '立即更换正常的钟楼设备'],
				],
				'trace',
			),
		],
		hints: [
			'维护纸条指向后台。按“检查钟楼”，或从浏览器菜单打开开发者工具的 Console 进行固定只读查询。',
			'比较“有效收到”和“当前排演”。没有上台不等于没有到达；后台说明了第五响被筛除的原因。',
			"完整操作：查询 window.yuye.inspect('clock') 或点站内“检查钟楼”；分类选版本筛除，证据选两次有效到达，处理选保留出处并检查版本关系。",
		],
		explanation: '设备正常，两个回声都已有效到达。第五响因与最后验收版本不一致而未上台；岑可以停止无意义的硬件修理，转向讨论排演规则。',
	},
	P05: {
		id: 'P05',
		title: '留下记录不等于继续营业',
		question: '按纸面序号恢复镜像投影的事件顺序，再判断季的旧问候是否仍获准排演。',
		evidence: [
			{ title: '01 · 旧入库单（正向原件）', text: '版记：初次来稿。许可：允许排演书店问候。' },
			{ title: '02 · 后来的退场单（正向原件）', text: '停止全部排演，包括旧片段、匿名背影和临时补位；只保留一张允许展示的闭店说明。' },
			{ title: '03 · 旧稿调用单（正向原件）', text: '调用内容：季／书店问候。纸面序号 03，位于退场单 02 之后。' },
			{ title: '水面投影 · 无障碍正向对照', text: '水面从左至右映成：03 旧稿被调用 ｜ 02 退场请求 ｜ 01 入库许可。\n投影框的纸面序号保持正向。恢复事件链时按 01 → 02 → 03，不比较现实时间。' },
		],
		questions: [
			question('first', '事件链第 1 项', reservoirEvents, 'permission'),
			question('second', '事件链第 2 项', reservoirEvents, 'withdrawal'),
			question('third', '事件链第 3 项', reservoirEvents, 'fallback'),
			question(
				'permission',
				'目前的旧问候调用',
				[
					['stop', '发生在退场之后，应停止；旧许可已受明确退场请求限制'],
					['continue', '旧稿已入库，因此永久允许演出'],
					['anonymous', '去掉名字再继续调用就符合退场请求'],
				],
				'stop',
			),
			question(
				'remain',
				'允许留下什么？',
				[
					['notice', '她明确允许展示的闭店说明'],
					['greeting', '旧问候的冻结播放副本'],
					['silhouette', '匿名背影和临时补位'],
				],
				'notice',
			),
		],
		hints: [
			'检查投影框的正向纸面序号、旧入库单与退场单；全部正向原文都在证据栏。',
			'01 的许可不能越过 02 的明确限制。03 的调用在退场之后，保留记录与继续排演是两件事。',
			'完整操作：排序为入库许可 → 退场请求 → 旧稿被调用；当前调用选“应停止”；允许留下选“闭店说明”。',
		],
		explanation: '季已明确停止全部排演，旧问候的再次调用违反当前要求。下一步应查是谁还在调用她，而不是把她拉回书店；闭店说明是特别允许保留的文本。',
	},
	P06: {
		id: 'P06',
		title: '这座城为何只剩最后一份稿',
		question: '阅读同一目录中的来稿、授权、工作规则，分别归位证据，再提出不混剪历史的修正。',
		evidence: [
			{ title: '维护台 · 完整源码目录', text: 'story-evidence/yuye/edition-01/\n  README.md\n  records/rain-night.txt\n  rights/bai-yu.txt\n  runtime/collate.ts\n\n以下源码阅览室提供这些虚构故事资料的同版全文及互相参照的路径。' },
			{ title: '三种职责', text: '来稿：发生了什么／属于哪一版。\n授权：材料可以怎样使用。\n工作规则：排演器实际选了什么。\n请逐份核对；不需要修改源码或提交代码。' },
		],
		questions: [
			question(
				'records',
				'来稿槽 · records/rain-night.txt 证明什么？',
				[
					['valid', '《留桥》《离城》均验收通过，属于不同演绎'],
					['invalid', '只有后验收的《离城》有效'],
					['single', '两份材料描述同一晚连续发生的事'],
				],
				'valid',
			),
			question(
				'rights',
				'授权槽 · rights/bai-yu.txt 证明什么？',
				[
					['both', '两稿允许带版记分卷；后验收不自动撤销先前授权'],
					['revoke', '《离城》自动撤销《留桥》'],
					['forever', '许可一经取得，以后明确撤回也不用理会'],
				],
				'both',
			),
			question(
				'runtime',
				'工作规则槽 · 缺席发生在哪里？',
				[
					['last-hide', 'retain-last 只选最后验收者，hide 隐藏早期版本'],
					['lost', '源文件丢失，无法找到《留桥》'],
					['rights', '授权文件要求删除所有旧稿'],
				],
				'last-hide',
			),
			question(
				'proposal',
				'修订提案',
				[
					['indexed', '按当前授权建立多个带出处的版本索引，不覆盖、不混剪'],
					['merged', '把两稿拼成白榆在同一晚的完整经历'],
					['everything', '忽略后续撤回，永久排演全部库存'],
				],
				'indexed',
			),
			question(
				'safety',
				'留桥／离城演绎能否证明现在可以通行？',
				[
					['separate', '不能；当前路线安全需独立核验'],
					['bridge', '《留桥》有效，所以现在桥一定安全'],
					['station', '《离城》后验收，所以现在只准从白页站走'],
				],
				'separate',
			),
		],
		hints: [
			'在下方源码阅览室依次读 README 和三个完整文件；已配置真实冻结提交的发行版也可打开对应 GitHub 文件。',
			'把“验收通过”“当前获准”“实际进入索引”分开。前两项都允许保留时，去找工作规则是在哪里隐藏早期稿的。',
			'完整操作：来稿选两稿均有效；授权选允许分卷且不自动互相撤销；规则选 retain-last → hide；提案选按当前授权建立带出处的多版本索引；路线安全选独立核验。',
		],
		explanation: '两稿均有效且允许分卷，但校订器 retain-last → hide 使早稿缺席。应按当前授权维护带出处的多个索引，而不混剪经历。演绎不是现场安全报告；修正版本索引仍不能自动消除季的旧稿补位。',
	},
	P07: {
		id: 'P07',
		title: '她离开了名单，却没有离开调用表',
		question: '读取当前故事存档的排演清单：季不在出场名单，为什么书店仍可能调用她？',
		evidence: [
			{ title: '街角书店', text: '门牌：店主退出排演。\n只看当前出场名单还不够，旧稿补位是另一个调用入口。' },
			{ title: '季的明确退场请求', text: '停止全部排演，包括旧片段、匿名背影和临时补位。只允许闭店说明留存。' },
			{ title: '故事存档阅读器', text: "下方清单来自当前 StorySave。电脑可用 window.yuye.inspect('cast') 得到同样内容；面板与控制台均只读。完成处理后再读，旧稿补位应消失。" },
		],
		questions: [
			question(
				'entry',
				'还需要清除的是哪一个调用入口？',
				[
					['fallback', '季／书店问候的旧稿补位'],
					['cast', '栞、白榆、岑的当前出场'],
					['notice', '仅供阅读的闭店说明'],
				],
				'fallback',
			),
			question(
				'action',
				'怎样落实退场？',
				[
					['stop', '停止季的当前出演与所有旧稿补位'],
					['rename', '将旧稿改成匿名背影后继续'],
					['again', '再放一次问候，然后才考虑退场'],
				],
				'stop',
			),
			question(
				'allowed',
				'处理之后保留什么？',
				[
					['notice', '仍可查看她明确允许的闭店说明'],
					['loop', '循环播放被冻结的旧问候'],
					['nothing', '连允许保留的闭店说明也删掉'],
				],
				'notice',
			),
		],
		hints: [
			"打开下方故事存档阅读器，或查询 window.yuye.inspect('cast')，不要只看书店门牌。",
			'当前出场与旧稿补位是两个入口。名单移除并不自动阻止补位；退场请求明确包含后者。',
			'完整操作：入口选“季／书店问候的旧稿补位”；处理选停止当前出演和所有补位；保留选闭店说明。提交由岑确认处理，再读清单核对。',
		],
		explanation: '名单已移除季，fallback 仍可能调用她。岑确认撤销这个补位入口，闭店说明继续可读；重进书店不再复演问候。只读查询本身不会修改存档。',
	},
	P08: {
		id: 'P08',
		title: '三份请求，不是一条万能规则',
		question: '分别配置并列、改写和退出的试演规则，运行预演、核对结果，再确认实施。席位有限也不能擅自删稿。',
		evidence: [
			{ title: '栞 · 协商原文', text: '“街本和幕本我都愿意留下。请给我们各自有版记的入口，可以协商轮换，不要把两本拼成我的同一天。”' },
			{ title: '白榆 · 协商原文', text: '“旧图署名留下，作为修订记录；新图也署名，写清适用状态。现在怎么走，要用新核验的安全信息，不能拿演绎作证。”' },
			{ title: '季 · 协商原文', text: '“停止全部排演，包括旧片段、匿名背影和临时补位。只保留我允许展示的闭店说明。”' },
			{ title: '校订员 · 席位约束', text: '活动席位有限。可协商轮换与停演时段；不能以新稿验收为由删旧稿，也不能强迫所有获准版本同时上台。角色保有否决权。' },
		],
		questions: [
			question(
				'shiori',
				'案例一 · 栞的两个版本',
				[
					['editions', '两个带版记的独立入口，按当前授权分卷，不混成同一日'],
					['merged', '合并成唯一“真正的栞”'],
					['last', '只保留最新验收的一本'],
				],
				'editions',
			),
			question(
				'baiyu',
				'案例二 · 白榆的新旧图',
				[
					['signed', '两图署名、适用状态明确；旧图作修订记录，新安全信息用于导航'],
					['erase', '删除旧图，不再保留修订责任'],
					['old', '新旧图都永久作为现行导航路线'],
				],
				'signed',
			),
			question(
				'ji',
				'案例三 · 季的退出',
				[
					['withdraw', '当前出演与旧稿补位都停止，仅保留闭店说明'],
					['silhouette', '用匿名背影替代，继续播放'],
					['archive', '冻结旧问候，但仍可当作排演调用'],
				],
				'withdraw',
			),
			question(
				'seats',
				'有限席位怎样安排？',
				[
					['rotation', '协商轮换和停演时段，尊重否决，不删除仍获授权的版本'],
					['delete', '删掉暂时排不上台的版本'],
					['force', '强迫全部版本同时上台'],
				],
				'rotation',
			),
		],
		hints: [
			'回看三人的原文请求和席位约束，每个案例分别配置。站内验收器与 window.yuye.verify() 可以复查已确认的存档状态。',
			'栞要分卷并列，白榆要区分历史与现行，季要完整退出。任何一种默认规则都不能代替其他人的请求；容量问题交给协商。',
			'完整操作：栞选两个独立带版记入口；白榆选两图署名、旧图留作修订而新安全信息导航；季选出演和补位全部停止、只留闭店说明；席位选协商轮换。运行预演，四项均符合后按“确认实施”。',
		],
		explanation: '三案例分别执行：按当前授权分卷；署名改写并区分历史与现行；完整执行退出。席位以协商轮换处理。实施后重新进入各场景应与清单一致，结局选择不能撤销这些请求。',
	},
};

function normalized(value: string): string {
	return value.normalize('NFKC').trim().toLowerCase();
}

/** 只判定结构化选择；重载和预演步骤由面板控制，不从答案反推玩家设备行为。 */
export function puzzleCorrect(id: string, answers: Record<string, string>): boolean {
	if (typeof id !== 'string' || !answers || typeof answers !== 'object') return false;
	const puzzleId = normalized(id).toUpperCase();
	if (!Object.prototype.hasOwnProperty.call(PUZZLES, puzzleId)) return false;
	return PUZZLES[puzzleId].questions.every((item) => Object.prototype.hasOwnProperty.call(answers, item.id) && typeof answers[item.id] === 'string' && normalized(answers[item.id]) === item.answer);
}

export const DIAGNOSTIC_HELP = [
	'余页／故事诊断（只读）',
	'window.yuye.help()：显示此帮助。',
	"window.yuye.inspect('clock')：钟楼有效到达、当前排演和筛除原因。",
	"window.yuye.inspect('cast')：当前出场、旧稿补位与退场许可。",
	'window.yuye.verify()：三案例已确认实施的存档状态。',
	'站内诊断端口提供相同查询；答案与实施均在故事界面提交。',
].join('\n');

/** 仅返回明确的虚构故事数据，不访问浏览器、网络、真实时钟或其他存储。 */
export function diagnostic(save: StorySave, target: 'clock' | 'cast' | 'verify'): string {
	if (target === 'clock') {
		return [
			'余页／故事诊断，仅限本章',
			'钟楼设备：正常',
			'有效收到：第五响、第六响',
			'当前排演：第六响',
			'第五响未上台的原因：与最后验收版本不一致',
			`处理记录：${save.puzzles.includes('P04') ? '已确认版本筛除，保留两份回声出处' : '尚未提交版本筛除判断'}`,
		].join('\n');
	}
	if (target === 'cast') {
		return ['余页／故事排演清单', '当前出场：栞、白榆、岑', `旧稿补位：${save.puzzles.includes('P07') ? '无（季／书店问候的调用已停止）' : '季／书店问候'}`, '已确认退场：季／全部排演（含旧稿补位）', '允许留下：闭店说明'].join('\n');
	}
	if (target === 'verify') {
		const applied = save.puzzles.includes('P08');
		return [
			'余页／三案例验收',
			`实施记录：${applied ? '已确认实施' : '尚未确认实施；以下为待验收目标'}`,
			`栞：${applied ? '已执行' : '待验收'}／街本、幕本独立带版记，不混剪、不自动删旧版`,
			`白榆：${applied ? '已执行' : '待验收'}／新旧图署名并区分适用状态；旧图留作修订，新安全信息用于导航`,
			`季：${applied ? '已执行' : '待验收'}／当前出演和旧稿补位均停止，仅保留闭店说明`,
			`席位：${applied ? '已执行' : '待验收'}／协商轮换与停演时段，尊重角色否决`,
		].join('\n');
	}
	return DIAGNOSTIC_HELP;
}
