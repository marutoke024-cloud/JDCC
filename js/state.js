/*
 * state.js — アプリ共有状態と学習ロジック
 * 原文(chapters.json)は読み取り専用。ここでは一切書き換えない。
 */
import { formatAll } from './format.js';
import * as db from './db.js';

export const state = {
  chapters: [], // 原文(読み取り専用)
  formatted: new Map(), // 章番号 → 整形済み表示データ
  glossary: [],
  baseSummaries: {}, // 章番号 → 読解サマリー(原文外)
  cdfom: null, // CDFOM研修ノート(JDCCとは別カテゴリ)
  totalChars: 0,
  isSample: false,
  progressMap: new Map(), // 章番号 → {chapter, read:{pid:1}, done}
  settings: null, // {mode:'chars'|'days', value}
  bookmark: null, // {pid, chapter, headingNum}
  lastPosition: null, // 前回閉じたときの読書位置 {chapter, pid, offset, y, savedAt}
  streak: { count: 0, lastDate: null },
  todayChars: 0,
};

export async function loadAll() {
  const [chaptersRes, glossaryRes, summariesRes] = await Promise.all([
    fetch('data/chapters.json'),
    fetch('data/glossary.json'),
    fetch('data/summaries.json'),
  ]);
  state.chapters = await chaptersRes.json();
  state.glossary = await glossaryRes.json();
  const sum = await summariesRes.json();
  state.baseSummaries = sum.chapters || {};

  // CDFOM研修は任意データ。なければJDCCのみで動作する
  try {
    const res = await fetch('data/cdfom.json');
    if (res.ok) state.cdfom = await res.json();
  } catch {
    state.cdfom = null;
  }
  state.isSample = state.chapters.some((c) => c._sample);
  state.formatted = formatAll(state.chapters);
  state.totalChars = 0;
  for (const f of state.formatted.values()) state.totalChars += f.charTotal;

  const [progressAll, settings, bookmark, streak, todayLog, lastPos] = await Promise.all([
    db.progress.all(),
    db.kv.get('settings'),
    db.kv.get('bookmark'),
    db.kv.get('streak'),
    db.readlog.get(db.todayKey()),
    db.kv.get('lastPosition'),
  ]);
  state.progressMap = new Map((progressAll || []).map((p) => [p.chapter, p]));
  state.settings = settings || { mode: 'chars', value: 3000 };
  state.bookmark = bookmark || null;
  state.lastPosition = lastPos || null;
  state.streak = streak || { count: 0, lastDate: null };
  state.todayChars = todayLog ? todayLog.chars : 0;
}

/* ---------- 進捗 ---------- */

export function chapterParas(no) {
  const f = state.formatted.get(no);
  return f ? f.blocks.filter((b) => b.type === 'para') : [];
}

export function chapterProgress(no) {
  const paras = chapterParas(no);
  const rec = state.progressMap.get(no);
  const read = rec ? rec.read || {} : {};
  let readChars = 0;
  let readCount = 0;
  for (const p of paras) {
    if (read[p.pid]) {
      readChars += p.chars;
      readCount++;
    }
  }
  const total = paras.length;
  const f = state.formatted.get(no);
  return {
    readCount,
    total,
    readChars,
    chapterChars: f ? f.charTotal : 0,
    pct: total ? Math.round((readCount / total) * 100) : 0,
    done: rec?.done || (total > 0 && readCount === total),
  };
}

export function chapterState(no) {
  const p = chapterProgress(no);
  if (p.done) return 'done';
  if (p.readCount > 0) return 'reading';
  return 'unread';
}

export function totalReadChars() {
  let sum = 0;
  for (const ch of state.chapters) sum += chapterProgress(ch.chapter).readChars;
  return sum;
}

export async function markParagraphRead(no, pid, chars) {
  let rec = state.progressMap.get(no);
  if (!rec) rec = { chapter: no, read: {}, done: false };
  if (rec.read[pid]) return false;
  rec.read[pid] = 1;
  state.progressMap.set(no, rec);
  await db.progress.put(rec);
  await addTodayChars(chars);
  return true;
}

export async function setChapterDone(no, done) {
  let rec = state.progressMap.get(no) || { chapter: no, read: {}, done: false };
  rec.done = done;
  if (done) for (const p of chapterParas(no)) rec.read[p.pid] = 1;
  state.progressMap.set(no, rec);
  await db.progress.put(rec);
}

/* ---------- ストリークと日次ログ ---------- */

async function addTodayChars(chars) {
  const today = db.todayKey();
  const log = await db.readlog.addChars(today, chars);
  state.todayChars = log.chars;

  if (state.streak.lastDate !== today) {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const yesterday = db.todayKey(y);
    state.streak = {
      count: state.streak.lastDate === yesterday ? state.streak.count + 1 : 1,
      lastDate: today,
    };
    await db.kv.set('streak', state.streak);
  }
}

/* ---------- 1日の学習範囲(§4-2) ---------- */

export function dailyTarget() {
  const s = state.settings;
  if (!s) return 3000;
  if (s.mode === 'chars') return Math.max(200, s.value | 0);
  const remaining = Math.max(0, state.totalChars - totalReadChars());
  return Math.max(200, Math.ceil(remaining / Math.max(1, s.value | 0)));
}

export function remainingDaysEstimate() {
  const t = dailyTarget();
  const remaining = Math.max(0, state.totalChars - totalReadChars());
  return Math.ceil(remaining / t);
}

/** 各段落の位置ラベル(直前の節番号)を引くためのインデックス */
function positionLabel(f, blockIndex) {
  for (let i = blockIndex; i >= 0; i--) {
    if (f.blocks[i].type === 'heading') return f.blocks[i].num;
  }
  return null;
}

/**
 * 今日読む範囲の提案。しおり(なければ最初の未読段落)から
 * 目標文字数分を積み上げ、開始・終了位置(章・節)を返す。
 */
export function todayPlan() {
  const target = dailyTarget();
  const already = state.todayChars;
  const need = Math.max(200, target - already);

  // しおり以降の最初の未読段落から積み上げる。
  // しおり以降に未読がなければ、先頭からの未読で再計算する。
  const walk = (fromPid) => {
    let passed = !fromPid;
    let start = null;
    let end = null;
    let planned = 0;
    outer: for (const ch of state.chapters) {
      const no = ch.chapter;
      const f = state.formatted.get(no);
      if (!f) continue;
      const rec = state.progressMap.get(no);
      const read = rec ? rec.read || {} : {};
      for (let i = 0; i < f.blocks.length; i++) {
        const b = f.blocks[i];
        if (b.type !== 'para') continue;
        if (!passed) {
          if (b.pid === fromPid) passed = true;
          else continue;
        }
        if (read[b.pid]) continue;
        if (!start) start = { chapter: no, title: f.title, num: positionLabel(f, i), pid: b.pid };
        planned += b.chars;
        end = { chapter: no, title: f.title, num: positionLabel(f, i), pid: b.pid };
        if (planned >= need) break outer;
      }
    }
    return { start, end, planned };
  };

  const bmPid = state.bookmark?.pid || null;
  let r = walk(bmPid);
  if (!r.start && bmPid) r = walk(null);

  return {
    target,
    todayChars: already,
    pct: target ? Math.min(100, Math.round((already / target) * 100)) : 0,
    achieved: already >= target,
    start: r.start,
    end: r.end,
    plannedChars: r.planned,
  };
}

/* ---------- しおり ---------- */

/**
 * 前回閉じたときの読書位置。
 * スクロール量(y)だけだと文字サイズや幅を変えたときにずれるため、
 * 画面上端にいちばん近い段落IDと、その段落からのずれも一緒に持つ。
 */
export async function saveLastPosition(chapter, pid, offset, y) {
  state.lastPosition = { chapter, pid, offset, y, savedAt: Date.now() };
  await db.kv.set('lastPosition', state.lastPosition);
}

export async function saveBookmark(no, pid) {
  const f = state.formatted.get(no);
  let num = null;
  if (f) {
    const idx = f.blocks.findIndex((b) => b.type === 'para' && b.pid === pid);
    if (idx >= 0) num = positionLabel(f, idx);
  }
  state.bookmark = { chapter: no, pid, num, savedAt: Date.now() };
  await db.kv.set('bookmark', state.bookmark);
}

/* ---------- ユーティリティ ---------- */

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function fmtNum(n) {
  return (n | 0).toLocaleString('ja-JP');
}

let toastTimer = null;
export function toast(msg, ms = 2400) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

export function chapterShortTitle(no) {
  const ch = state.chapters.find((c) => c.chapter === no);
  if (!ch) return `第${no}章`;
  return ch.title.replace(/^第\d+章\s*/, '');
}
