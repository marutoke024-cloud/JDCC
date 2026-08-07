/*
 * db.js — 付随データストア(BUILD_PROMPT §5)
 *
 * 原文(source)は data/chapters.json をビルド時同梱・読み取り専用で扱い、
 * ここには保存しない。進捗・しおり・マーカー・メモ・まとめ等の
 * ユーザーデータのみを IndexedDB に保存する。
 */

const DB_NAME = 'jdcc-reader';
const DB_VERSION = 1;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('progress'))
        db.createObjectStore('progress', { keyPath: 'chapter' });
      if (!db.objectStoreNames.contains('highlights')) {
        const st = db.createObjectStore('highlights', { keyPath: 'id', autoIncrement: true });
        st.createIndex('byParagraph', 'paragraphId');
        st.createIndex('byChapter', 'chapterId');
      }
      if (!db.objectStoreNames.contains('notes')) {
        const st = db.createObjectStore('notes', { keyPath: 'paragraphId' });
        st.createIndex('byChapter', 'chapterId');
      }
      if (!db.objectStoreNames.contains('summaries'))
        db.createObjectStore('summaries', { keyPath: 'chapter' });
      if (!db.objectStoreNames.contains('readlog'))
        db.createObjectStore('readlog', { keyPath: 'date' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const st = t.objectStore(store);
        const out = fn(st);
        t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
        t.onerror = () => reject(t.error);
      })
  );
}

function reqValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/* ---- 汎用 KV(しおり・設定・ストリーク) ---- */
export const kv = {
  async get(key) {
    const db = await open();
    return reqValue(db.transaction('kv').objectStore('kv').get(key));
  },
  async set(key, value) {
    await tx('kv', 'readwrite', (st) => st.put(value, key));
    notify('kv', key);
  },
};

/* ---- 進捗 ---- */
export const progress = {
  async get(chapter) {
    const db = await open();
    return reqValue(db.transaction('progress').objectStore('progress').get(chapter));
  },
  async all() {
    const db = await open();
    return reqValue(db.transaction('progress').objectStore('progress').getAll());
  },
  async put(rec) {
    rec.updatedAt = Date.now();
    await tx('progress', 'readwrite', (st) => st.put(rec));
    notify('progress', rec.chapter);
  },
};

/* ---- マーカー ---- */
export const highlights = {
  async byParagraph(pid) {
    const db = await open();
    return reqValue(
      db.transaction('highlights').objectStore('highlights').index('byParagraph').getAll(pid)
    );
  },
  async all() {
    const db = await open();
    return reqValue(db.transaction('highlights').objectStore('highlights').getAll());
  },
  async add(rec) {
    rec.createdAt = Date.now();
    const id = await tx('highlights', 'readwrite', (st) => st.add(rec));
    notify('highlights');
    return id;
  },
  async remove(id) {
    await tx('highlights', 'readwrite', (st) => st.delete(id));
    notify('highlights');
  },
};

/* ---- 余白ノート ---- */
export const notes = {
  async get(pid) {
    const db = await open();
    return reqValue(db.transaction('notes').objectStore('notes').get(pid));
  },
  async all() {
    const db = await open();
    return reqValue(db.transaction('notes').objectStore('notes').getAll());
  },
  async put(rec) {
    rec.updatedAt = Date.now();
    await tx('notes', 'readwrite', (st) => st.put(rec));
    notify('notes');
  },
  async remove(pid) {
    await tx('notes', 'readwrite', (st) => st.delete(pid));
    notify('notes');
  },
};

/* ---- 章末サマリー ---- */
export const summaries = {
  async get(chapter) {
    const db = await open();
    return reqValue(db.transaction('summaries').objectStore('summaries').get(chapter));
  },
  async put(rec) {
    rec.updatedAt = Date.now();
    await tx('summaries', 'readwrite', (st) => st.put(rec));
    notify('summaries');
  },
  async remove(chapter) {
    await tx('summaries', 'readwrite', (st) => st.delete(chapter));
    notify('summaries');
  },
};

/* ---- 日次読了ログ(ノルマ達成度・ストリーク) ---- */
export const readlog = {
  async get(date) {
    const db = await open();
    return reqValue(db.transaction('readlog').objectStore('readlog').get(date));
  },
  async all() {
    const db = await open();
    return reqValue(db.transaction('readlog').objectStore('readlog').getAll());
  },
  async addChars(date, chars) {
    const cur = (await this.get(date)) || { date, chars: 0 };
    cur.chars += chars;
    await tx('readlog', 'readwrite', (st) => st.put(cur));
    notify('readlog');
    return cur;
  },
};

/* ---- 変更通知(ビュー更新・同期レイヤ用) ---- */
const listeners = new Set();
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify(store, key) {
  for (const fn of listeners) {
    try {
      fn(store, key);
    } catch (e) {
      console.error(e);
    }
  }
}

export function todayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
