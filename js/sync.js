/*
 * sync.js — 端末間同期(Firebase / 任意)
 *
 * データ同期方針(BUILD_PROMPT §5):
 *   ローカルは IndexedDB。しおり・マーカー・メモ・進捗・まとめは
 *   Firebase(匿名認証 + Firestore)で端末間同期する。
 *
 * `data/firebase-config.json` に Firebase プロジェクトの設定
 * ({ apiKey, authDomain, projectId, ... })を置くと有効になる。
 * ファイルがなければ完全にローカルのみで動作する(オフライン優先)。
 * 原文(chapters.json)は同期対象外 — 読み取り専用のまま。
 */
import * as db from './db.js';
import { state } from './state.js';

const SYNC_STORES = ['kv', 'progress', 'highlights', 'notes', 'summaries'];

let fs = null; // firestore module
let docRef = null;
let importing = false;
let pushTimer = null;

export let syncStatus = 'off'; // off | connecting | on | error

export async function initSync() {
  let config;
  try {
    const res = await fetch('data/firebase-config.json');
    if (!res.ok) return;
    config = await res.json();
    if (!config.apiKey) return;
  } catch {
    return; // 設定なし → ローカルのみ
  }

  try {
    syncStatus = 'connecting';
    const [appMod, authMod, fsMod] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'),
    ]);
    fs = fsMod;
    const app = appMod.initializeApp(config);
    const auth = authMod.getAuth(app);
    const cred = await authMod.signInAnonymously(auth);
    const firestore = fsMod.getFirestore(app);
    docRef = fsMod.doc(firestore, 'readers', cred.user.uid);

    // 初回マージ + リモート変更の購読
    fs.onSnapshot(docRef, (snap) => {
      if (snap.exists() && !snap.metadata.hasPendingWrites) {
        mergeRemote(snap.data()).catch(console.error);
      }
    });

    // ローカル変更 → デバウンスして送信
    db.onChange(() => {
      if (importing) return;
      clearTimeout(pushTimer);
      pushTimer = setTimeout(pushLocal, 1500);
    });

    syncStatus = 'on';
  } catch (e) {
    console.warn('sync disabled:', e);
    syncStatus = 'error';
  }
}

/** ローカル全ストアのスナップショットを送信 */
async function pushLocal() {
  if (!docRef || !fs) return;
  try {
    const [bookmark, settings, streak, progressAll, highlightsAll, notesAll, readlogAll] =
      await Promise.all([
        db.kv.get('bookmark'),
        db.kv.get('settings'),
        db.kv.get('streak'),
        db.progress.all(),
        db.highlights.all(),
        db.notes.all(),
        db.readlog.all(),
      ]);
    const summariesAll = [];
    for (const ch of state.chapters) {
      const s = await db.summaries.get(ch.chapter);
      if (s) summariesAll.push(s);
    }
    await fs.setDoc(docRef, {
      bookmark: bookmark || null,
      settings: settings || null,
      streak: streak || null,
      progress: progressAll || [],
      highlights: highlightsAll || [],
      notes: notesAll || [],
      summaries: summariesAll,
      readlog: readlogAll || [],
      pushedAt: Date.now(),
    });
  } catch (e) {
    console.warn('sync push failed', e);
  }
}

/** リモートのデータをレコード単位のタイムスタンプでマージ */
async function mergeRemote(remote) {
  importing = true;
  try {
    // しおり: 新しい方を採用
    if (remote.bookmark && (!state.bookmark || remote.bookmark.savedAt > (state.bookmark.savedAt || 0))) {
      state.bookmark = remote.bookmark;
      await db.kv.set('bookmark', remote.bookmark);
    }
    if (remote.settings && !state.settings) {
      state.settings = remote.settings;
      await db.kv.set('settings', remote.settings);
    }
    if (remote.streak && remote.streak.count > (state.streak?.count || 0)) {
      state.streak = remote.streak;
      await db.kv.set('streak', remote.streak);
    }
    // 進捗: 既読集合を和集合に
    for (const rp of remote.progress || []) {
      const local = state.progressMap.get(rp.chapter);
      const merged = {
        chapter: rp.chapter,
        read: { ...(rp.read || {}), ...(local?.read || {}) },
        done: rp.done || local?.done || false,
      };
      state.progressMap.set(rp.chapter, merged);
      await db.progress.put(merged);
    }
    // メモ・まとめ: updatedAt の新しい方
    for (const rn of remote.notes || []) {
      const local = await db.notes.get(rn.paragraphId);
      if (!local || rn.updatedAt > local.updatedAt) await db.notes.put(rn);
    }
    for (const rs of remote.summaries || []) {
      const local = await db.summaries.get(rs.chapter);
      if (!local || rs.updatedAt > local.updatedAt) await db.summaries.put(rs);
    }
    // マーカー: 同一範囲がなければ追加
    const locals = await db.highlights.all();
    const key = (h) => `${h.paragraphId}:${h.startOffset}-${h.endOffset}`;
    const seen = new Set(locals.map(key));
    for (const rh of remote.highlights || []) {
      if (!seen.has(key(rh))) {
        const { id, ...rec } = rh;
        await db.highlights.add(rec);
      }
    }
    // 日次ログ: 文字数の大きい方
    for (const rl of remote.readlog || []) {
      const local = await db.readlog.get(rl.date);
      if (!local || rl.chars > local.chars) {
        await db.readlog.addChars(rl.date, rl.chars - (local?.chars || 0));
      }
    }
    document.dispatchEvent(new CustomEvent('progress-changed'));
  } finally {
    importing = false;
  }
}
