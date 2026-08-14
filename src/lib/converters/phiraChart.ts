/**
 * Phigros 官方谱面（formatVersion 1 / 3）→ PhiZone RPE 格式转换器。
 *
 * 所有单位换算都对照两个已知正确的渲染实现推导，而非估算：
 *   - 本仓库 legacy 渲染器：legacy/whilePlaying/script.phi.community.core.js
 *   - phi-chart-render：src/chart/convert/official.js + src/game/index.js
 *
 * 关键换算
 * - 时间：官方 time 单位是 1/32 拍。
 *   legacy/phi-chart-render 均为 realTimeSec = time / bpm * 1.875（1.875 = 60/32），
 *   故 beat = realTimeSec * bpm / 60 = time / 32（与该线 bpm 无关）。
 *   本转换器把所有线折算到第一条线的 bpm 上：beat = time / 32 * (baseBpm / lineBpm)。
 * - note.positionX：legacy 渲染 x = (width/18) * positionX（phi-chart-render 为 width*9/160，等价）；
 *   RPE 为 x = width * positionX / 1350 → 系数 1350/18 = 75。
 *   交叉验证：PEC 的 x ∈ ±1024 时 legacy 取 x*9/1024，RPE 侧转换器取 x*675/1024，比例一致。
 * - judgeLineMoveEvents：start/start2 归一化 0~1 → RPE moveX ±675（×1350）、moveY ±450（×900）。
 * - judgeLineRotateEvents：官方正值为视觉逆时针（legacy rotation = -deg*value），RPE 相反 → 取负。
 * - judgeLineDisappearEvents：0~1 → RPE alpha 0~255。
 * - speedEvents.value：legacy/phi-chart-render 流速基准为 0.6*height，RPE d() 基准为 (2/15)*height
 *   → 系数 0.6 / (2/15) = 4.5。交叉验证：PEC cv 值 legacy 取 /7，RPE 侧取 *9/14，比例一致。
 * - note.type：官方 1=Tap 2=Drag 3=Hold 4=Flick；RPE 1=Tap 2=Hold 3=Flick 4=Drag，必须重映射。
 * - notesBelow 仅上下翻转（RPE above=0 即此语义），positionX 不取反。
 *
 * 已知取舍：官方 Hold 头部定位不乘 note.speed（只有 body 长度乘），而 RPE 引擎对 Hold 头尾统一
 * 乘 speed。这里把 Hold 的 speed 记为 1，保证头部与判定位置正确；代价是 speed≠1 的 Hold
 * body 长度不随 speed 放大（官方谱面绝大多数 Hold 的 speed 为 1，不受影响）。
 */
import type { Bpm, Event, JudgeLine, Note, RpeJson, SpeedEvent } from '$lib/types';

interface PhiraNote {
	type: number;
	time: number;
	positionX: number;
	holdTime?: number;
	speed?: number;
	isFake?: boolean | number;
}

interface PhiraEvent {
	startTime: number;
	endTime: number;
	start: number;
	end: number;
	start2?: number;
	end2?: number;
}

interface PhiraSpeedEvent {
	startTime: number;
	endTime: number;
	value: number;
}

interface PhiraLine {
	bpm?: number;
	notesAbove?: PhiraNote[];
	notesBelow?: PhiraNote[];
	speedEvents?: PhiraSpeedEvent[];
	judgeLineMoveEvents?: PhiraEvent[];
	judgeLineRotateEvents?: PhiraEvent[];
	judgeLineDisappearEvents?: PhiraEvent[];
}

export interface OfficialChart {
	formatVersion?: number;
	offset?: number;
	judgeLineList: PhiraLine[];
}

/** 官方时间单位：1/32 拍。 */
const UNITS_PER_BEAT = 32;
/** note.positionX（±9 为屏幕边缘）→ RPE（±675）。 */
const NOTE_X_SCALE = 75;
/** judgeLineMoveEvents 的 X（0~1）→ RPE ±675。 */
const LINE_X_SCALE = 1350;
/** judgeLineMoveEvents 的 Y（0~1）→ RPE ±450。 */
const LINE_Y_SCALE = 900;
/** speedEvents.value：官方流速基准 0.6H → RPE 基准 (2/15)H。 */
const SPEED_SCALE = 4.5;
/** 官方 note 类型 → RPE note 类型。 */
const NOTE_TYPE_MAP: Record<number, number> = { 1: 1, 2: 4, 3: 2, 4: 3 };
/** PEC → 官方格式时用 time + 1e9 标记 fake note（见 legacy/whilePlaying/pec2json.js）。 */
const FAKE_NOTE_FLAG = 1e9;
/** 拍数分母，1e-6 拍在 200 BPM 下约 0.3 微秒，足够精确且避免浮点字符串解析。 */
const BEAT_DENOMINATOR = 1e6;

/**
 * 生成 RPE 的拍数三元组。
 * 不使用 beatToArray：它靠字符串切分小数部分，遇到科学计数法（1e-14）会得出 NaN，
 * 进而让 note 位置变成 NaN——正是音符乱跳的根因之一。
 */
const toBeatTuple = (beat: number): { time: [number, number, number]; beat: number } => {
	const safe = Number.isFinite(beat) ? Math.max(0, beat) : 0;
	const integer = Math.floor(safe);
	const numerator = Math.round((safe - integer) * BEAT_DENOMINATOR);
	if (numerator >= BEAT_DENOMINATOR) {
		return { time: [integer + 1, 0, 1], beat: integer + 1 };
	}
	return {
		time: [integer, numerator, BEAT_DENOMINATOR],
		beat: integer + numerator / BEAT_DENOMINATOR,
	};
};

/**
 * formatVersion 1 → 3：移动事件把 X、Y 编码进同一个数字，
 * 且 disappear / rotate 事件缺少 start2 / end2。
 * 与 phi-chart-render 的 convertOfficialVersion 及 legacy 的 chart123 一致。
 */
const upgradeFormatV1 = (chart: OfficialChart): void => {
	for (const line of chart.judgeLineList ?? []) {
		for (const event of line.judgeLineMoveEvents ?? []) {
			event.start2 = (event.start % 1e3) / 520;
			event.end2 = (event.end % 1e3) / 520;
			event.start = Math.trunc(event.start / 1e3) / 880;
			event.end = Math.trunc(event.end / 1e3) / 880;
		}
		for (const event of [...(line.judgeLineDisappearEvents ?? []), ...(line.judgeLineRotateEvents ?? [])]) {
			event.start2 = 0;
			event.end2 = 0;
		}
	}
};

export function convertPhiraChart(chart: OfficialChart): RpeJson {
	const version = chart.formatVersion ?? 3;
	if (version !== 1 && version !== 3 && version !== 3473) {
		throw new Error(`Unsupported formatVersion: ${chart.formatVersion}`);
	}
	if (version === 1) upgradeFormatV1(chart);

	// 官方格式每条线各有自己的 BPM，RPE 只有一个全局 BPM 列表：
	// 取第一条线的 BPM 作为基准，其余线按比例折算拍数，保证时间轴统一。
	const baseBpm = chart.judgeLineList?.[0]?.bpm ?? 120;
	const BPMList: Bpm[] = [{ bpm: baseBpm, startTime: [0, 0, 1], startBeat: 0, startTimeSec: 0 }];

	const judgeLineList: JudgeLine[] = (chart.judgeLineList ?? []).map((line, index) => {
		const lineBpm = line.bpm && line.bpm > 0 ? line.bpm : baseBpm;
		const bpmRatio = baseBpm / lineBpm;
		const toBeat = (units: number) => toBeatTuple((units / UNITS_PER_BEAT) * bpmRatio);

		const mkEvent = (event: PhiraEvent, start: number, end: number): Event => {
			const from = toBeat(event.startTime);
			const rawTo = toBeat(event.endTime);
			const to = rawTo.beat < from.beat ? from : rawTo;
			return {
				startTime: from.time,
				startBeat: from.beat,
				endTime: to.time,
				endBeat: to.beat,
				start,
				end,
				easingType: 1, // 官方格式事件一律线性
				easingLeft: 0,
				easingRight: 1,
				bezier: 0,
				bezierPoints: [0, 0, 1, 1],
				linkgroup: 0,
			};
		};

		const moveEvents = line.judgeLineMoveEvents ?? [];
		const moveXEvents = moveEvents.map((e) => mkEvent(e, (e.start - 0.5) * LINE_X_SCALE, (e.end - 0.5) * LINE_X_SCALE));
		const moveYEvents = moveEvents.map((e) => mkEvent(e, ((e.start2 ?? 0.5) - 0.5) * LINE_Y_SCALE, ((e.end2 ?? 0.5) - 0.5) * LINE_Y_SCALE));
		const rotateEvents = (line.judgeLineRotateEvents ?? []).map((e) => mkEvent(e, -e.start, -e.end));
		const alphaEvents = (line.judgeLineDisappearEvents ?? []).map((e) => mkEvent(e, e.start * 255, e.end * 255));

		const speedEvents: SpeedEvent[] = (line.speedEvents ?? []).map((e) => {
			const from = toBeat(e.startTime);
			const rawTo = toBeat(e.endTime);
			const to = rawTo.beat < from.beat ? from : rawTo;
			return {
				startTime: from.time,
				startBeat: from.beat,
				endTime: to.time,
				endBeat: to.beat,
				start: e.value * SPEED_SCALE,
				end: e.value * SPEED_SCALE,
				easingType: 1,
				easingLeft: 0,
				easingRight: 1,
				linkgroup: 0,
			};
		});

		const toNote = (raw: PhiraNote, above: number): Note => {
			const flagged = raw.time >= FAKE_NOTE_FLAG;
			const time = flagged ? raw.time - FAKE_NOTE_FLAG : raw.time;
			const type = NOTE_TYPE_MAP[raw.type] ?? 1;
			const from = toBeat(time);
			// 只有 Hold（RPE type 2）有长度
			const rawTo = type === 2 ? toBeat(time + (raw.holdTime ?? 0)) : from;
			const to = rawTo.beat < from.beat ? from : rawTo;
			return {
				type,
				above,
				startTime: from.time,
				startBeat: from.beat,
				endTime: to.time,
				endBeat: to.beat,
				positionX: (raw.positionX ?? 0) * NOTE_X_SCALE,
				// 官方渲染只对非 Hold 使用 note.speed 定位（legacy realgetY 与 phi-chart-render
				// note.js 的 useOfficialSpeed 分支都是如此），Hold 头部固定按 floorPosition 走。
				// RPE 对头尾统一乘 speed，因此 Hold 记为 1 以保证头部与判定位置正确。
				speed: type === 2 ? 1 : Number.isFinite(raw.speed) ? (raw.speed as number) : 1,
				isFake: flagged || raw.isFake ? 1 : 0,
				alpha: 255,
				size: 1,
				judgeSize: 1,
				visibleTime: 999999,
				yOffset: 0,
			};
		};

		const notes = [...(line.notesAbove ?? []).map((n) => toNote(n, 1)), ...(line.notesBelow ?? []).map((n) => toNote(n, 0))].sort((a, b) => a.startBeat - b.startBeat);

		return {
			Group: 0,
			Name: `Line ${index}`,
			Texture: 'line.png',
			bpmfactor: 1,
			father: -1,
			zOrder: index,
			numOfNotes: notes.length,
			notes,
			isCover: 1, // 官方渲染遮挡判定线背面的 note
			eventLayers: [{ moveXEvents, moveYEvents, rotateEvents, alphaEvents, speedEvents }],
			alphaControl: [
				{ x: 0, alpha: 255, easing: 1 },
				{ x: 9999999, alpha: 255, easing: 1 },
			],
			posControl: [
				{ x: 0, pos: 1, easing: 1 },
				{ x: 9999999, pos: 1, easing: 1 },
			],
			sizeControl: [
				{ x: 0, size: 1, easing: 1 },
				{ x: 9999999, size: 1, easing: 1 },
			],
			skewControl: [
				{ x: 0, skew: 0, easing: 1 },
				{ x: 9999999, skew: 0, easing: 1 },
			],
			yControl: [
				{ x: 0, y: 1, easing: 1 },
				{ x: 9999999, y: 1, easing: 1 },
			],
		};
	});

	return {
		BPMList,
		META: {
			RPEVersion: 100,
			id: '',
			name: '',
			composer: '',
			charter: '',
			level: '',
			// 官方 offset 单位为秒，RPE 为毫秒
			offset: (chart.offset ?? 0) * 1000,
			song: '',
			background: '',
			illustration: '',
		},
		chartTime: 0,
		judgeLineGroup: [],
		judgeLineList,
		multiLineString: '',
		multiScale: 0,
	};
}
