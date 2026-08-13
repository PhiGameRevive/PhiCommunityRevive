/**
 * IndexedDB 封装：成绩存储（兼容旧项目数据库结构与命名）。
 *
 * 库名 / objectStore 名：PhiCommunityPlayResults
 * keyPath：codename（值为 "<codename>-<level>"，level 为 ez/hd/in/at/sp）
 * 索引：level / levelRank / score / accuracy / rankingScore
 */

export interface PlayResult {
  codename: string;
  level: string;
  levelRank: number;
  score: number;
  accuracy: number;
  rankingScore: number;
}

const DB_NAME = 'PhiCommunityPlayResults';
const DB_VERSION = 2;
const INDEXES = ['level', 'levelRank', 'score', 'accuracy', 'rankingScore'];
const CHART_STORE = 'localCharts';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);

    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(DB_NAME)) {
        const objectStore = db.createObjectStore(DB_NAME, { keyPath: 'codename' });
        objectStore.createIndex('codename', 'codename', { unique: true });
        INDEXES.forEach((index) => {
          objectStore.createIndex(index, index, { unique: false });
        });
      }
      if (!db.objectStoreNames.contains(CHART_STORE)) {
        db.createObjectStore(CHART_STORE, { keyPath: 'codename' });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_NAME)) {
        db.close();
        indexedDB.deleteDatabase(DB_NAME);
        reject(new Error('Database corrupted, recreated'));
        return;
      }
      resolve(db);
    };
  });
}

function getStore(db: IDBDatabase): IDBObjectStore {
  return db.transaction([DB_NAME], 'readwrite').objectStore(DB_NAME);
}

function getChartStore(db: IDBDatabase): IDBObjectStore {
  return db.transaction([CHART_STORE], 'readwrite').objectStore(CHART_STORE);
}

export async function getResult(key: string): Promise<PlayResult | undefined> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = getStore(db).get(key);
      request.onsuccess = () => resolve(request.result as PlayResult | undefined);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function saveResult(result: PlayResult): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = getStore(db).put(result);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function getAllResults(): Promise<PlayResult[]> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = getStore(db).getAll();
      request.onsuccess = () => resolve(request.result as PlayResult[]);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/* ---------------- 本地谱面（自定义上传） ---------------- */

export interface LocalChartFile {
  name: string;
  blob: Blob;
}

export interface LocalChart {
  codename: string;
  name: string;
  artist: string;
  illustration?: string;
  musicFile?: string;
  chartFiles: Partial<Record<'ez' | 'hd' | 'in' | 'at' | 'sp', string>>;
  extraJson?: string;
  lineCsv?: string;
  files: LocalChartFile[];
}

export const LOCAL_PREFIX = 'local-';

export async function saveLocalChart(chart: LocalChart): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = getChartStore(db).put(chart);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function getLocalChart(codename: string): Promise<LocalChart | undefined> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = getChartStore(db).get(codename);
      request.onsuccess = () => resolve(request.result as LocalChart | undefined);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function getAllLocalCharts(): Promise<LocalChart[]> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = getChartStore(db).getAll();
      request.onsuccess = () => resolve(request.result as LocalChart[]);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function deleteLocalChart(codename: string): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = getChartStore(db).delete(codename);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}