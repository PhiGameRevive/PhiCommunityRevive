/**
 * Phira chart（formatVersion 3）→ PhiZone RPE 格式转换器。
 * Phira 谱面：顶层 { formatVersion, offset, judgeLineList }，无 META；
 * 时间用秒，坐标归一化（判定线位置 0~1，0.5 为中心；note positionX 相对线）。
 */
import { beatToArray } from '$lib/player/utils';
import type { Bpm, Event, JudgeLine, Note, RpeJson, SpeedEvent } from '$lib/types';

interface PhiraNote {
  type: number;
  time: number;
  positionX: number;
  holdTime?: number;
  speed?: number;
  floorPosition?: number;
  isAbove?: boolean;
  isFake?: boolean;
}

interface PhiraEvent {
  startTime: number;
  endTime: number;
  start: number;
  end: number;
  start2?: number;
  end2?: number;
}

interface PhiraSpeed {
  startTime: number;
  endTime: number;
  value: number;
}

interface PhiraLine {
  bpm?: number;
  notesAbove?: PhiraNote[];
  notesBelow?: PhiraNote[];
  speedEvents?: PhiraSpeed[];
  judgeLineMoveEvents?: PhiraEvent[];
  judgeLineRotateEvents?: PhiraEvent[];
  judgeLineDisappearEvents?: PhiraEvent[];
}

export function convertPhiraChart(chart: {
  formatVersion?: number;
  offset?: number;
  judgeLineList: PhiraLine[];
}): RpeJson {
  const bpm = chart.judgeLineList?.[0]?.bpm ?? 120;
  // Phira 时间单位为毫秒 → 秒 → 拍（基于谱面 BPM）
  const s2b = (ms: number) => beatToArray((ms / 1000 / 60) * bpm);

  const BPMList: Bpm[] = [
    { bpm, startTime: [0, 0, 1], startBeat: 0, startTimeSec: 0 },
  ];

  // 坐标缩放：Phira note positionX 归一化（小值）→ RPE -675~675
  let maxNoteX = 1;
  for (const line of chart.judgeLineList ?? []) {
    for (const n of [...(line.notesAbove ?? []), ...(line.notesBelow ?? [])]) {
      maxNoteX = Math.max(maxNoteX, Math.abs(n.positionX ?? 0));
    }
  }
  const noteScale = maxNoteX > 100 ? 1 : 675 / maxNoteX;

  // 判定线位置：Phira 0~1（0.5 中心）→ RPE -675~675
  const posToRpe = (pos: number) => (pos - 0.5) * 1350;

  const judgeLineList: JudgeLine[] = (chart.judgeLineList ?? []).map((line, i) => {
    const noteToRpe = (n: PhiraNote, above: number, mirrorX = false): Note => ({
      type: n.type,
      above,
      startTime: s2b(n.time),
      startBeat: (n.time / 1000 / 60) * bpm,
      endTime: s2b(n.time + (n.holdTime ?? 0)),
      endBeat: ((n.time + (n.holdTime ?? 0)) / 1000 / 60) * bpm,
      // Phira 渲染时 notesBelow 的 positionX 会取反（镜像），RPE 不取反 → 转换时对 below 取反
      positionX: (n.positionX ?? 0) * noteScale * (mirrorX ? -1 : 1),
      speed: n.speed ?? 1,
      isFake: n.isFake ? 1 : 0,
      alpha: 255,
      size: 1,
      visibleTime: 999999,
      yOffset: 0,
      judgeSize: 1,
    });

    const mkEvent = (e: PhiraEvent, start: number, end: number): Event => ({
      startTime: s2b(e.startTime),
      endTime: s2b(e.endTime),
      start,
      end,
      easingLeft: 0,
      easingRight: 1,
      easingType: 0,
      bezier: 0,
      bezierPoints: [0, 0, 1, 1],
      linkgroup: 0,
      startBeat: 0,
      endBeat: 0,
    });

    const moveXEvents = (line.judgeLineMoveEvents ?? []).map((e) =>
      mkEvent(e, posToRpe(e.start), posToRpe(e.end)),
    );
    const moveYEvents = (line.judgeLineMoveEvents ?? []).map((e) =>
      mkEvent(e, posToRpe(e.start2 ?? 0.5), posToRpe(e.end2 ?? 0.5)),
    );
    const rotateEvents = (line.judgeLineRotateEvents ?? []).map((e) =>
      mkEvent(e, e.start, e.end),
    );
    const alphaEvents = (line.judgeLineDisappearEvents ?? []).map((e) =>
      mkEvent(e, e.start * 255, e.end * 255),
    );
    const speedEvents: SpeedEvent[] = (line.speedEvents ?? []).map((e) => ({
      easingLeft: 0,
      easingRight: 1,
      easingType: 0,
      start: e.value,
      end: e.value,
      startTime: s2b(e.startTime),
      endTime: s2b(e.endTime),
      startBeat: (e.startTime / 1000 / 60) * bpm,
      endBeat: (e.endTime / 1000 / 60) * bpm,
      linkgroup: 0,
    }));

    const notes = [
      ...(line.notesAbove ?? []).map((n) => noteToRpe(n, 1)),
      ...(line.notesBelow ?? []).map((n) => noteToRpe(n, 0, true)),
    ];

    return {
      Group: 0,
      Name: `Line ${i}`,
      Texture: 'asset-line.png',
      bpmfactor: 1,
      father: -1,
      zOrder: i,
      numOfNotes: notes.length,
      notes,
      isCover: 0,
      eventLayers: [
        { moveXEvents, moveYEvents, rotateEvents, alphaEvents, speedEvents },
      ],
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
        { x: 0, y: 0, easing: 1 },
        { x: 9999999, y: 0, easing: 1 },
      ],
    };
  });

  return {
    BPMList,
    META: {
      RPEVersion: 1,
      id: '',
      name: '',
      composer: '',
      charter: '',
      level: '',
      offset: chart.offset ?? 0,
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
