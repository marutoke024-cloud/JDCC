/*
 * tts.js — 本文の読み上げ(Web Speech API)
 *
 * ・声はブラウザ/OSが持つ日本語音声を使う。女性の声を優先して選ぶ。
 * ・専門用語は glossary.json の reading で読みを補正してから発話する。
 * ・開始までのラグを抑えるため、音声リストの解決と最初の発話キューを
 *   あらかじめ用意しておく(プリウォーム)。
 * ・原文は変更しない。読み上げ用テキストは表示用データからの純粋な変換。
 */
import { state, toast } from './state.js';

const synth = window.speechSynthesis;
export const isSupported = !!synth;

/* ============ 音声の選択(女性優先) ============ */

let voices = [];
let voicesReady = null;

/** 既定で選びたい声。見つかればこれを最優先にする */
const PREFERRED_VOICE = /sayaka/i;

/** 女性らしさのスコア。既知の女性音声名を優先する */
const FEMALE_HINTS = [
  /kyoko/i, /o-ren/i,
  /nanami/i, /ayumi/i, /haruka/i, /sayaka/i,
  /female/i, /女性/, /woman/i,
  /google 日本語/i,
];
const MALE_HINTS = [/otoya/i, /ichiro/i, /male/i, /男性/, /hattori/i, /daichi/i, /keita/i];

function scoreVoice(v) {
  const name = `${v.name} ${v.voiceURI}`;
  let s = 0;
  if (/^ja(-|_)?/i.test(v.lang) || /japan/i.test(v.lang)) s += 100;
  else return -1; // 日本語以外は使わない
  if (PREFERRED_VOICE.test(name)) s += 200; // 既定の指定声
  if (v.localService) s += 12; // ローカル音声はオフラインでも動き、遅延も小さい
  for (const re of FEMALE_HINTS) if (re.test(name)) s += 20;
  for (const re of MALE_HINTS) if (re.test(name)) s -= 45;
  if (/kyoko/i.test(name)) s += 25; // macOS/iOSの標準的な女性音声
  if (/nanami|ayumi|haruka|sayaka/i.test(name)) s += 25; // Windowsの女性音声
  if (/google/i.test(name)) s += 10;
  return s;
}

/** 音声リストは非同期に埋まる。解決を待てる Promise を返す */
export function loadVoices() {
  if (voicesReady) return voicesReady;
  voicesReady = new Promise((resolve) => {
    const pick = () => {
      const list = synth.getVoices();
      if (!list.length) return false;
      voices = list;
      resolve(list);
      return true;
    };
    if (pick()) return;
    let tries = 0;
    const timer = setInterval(() => {
      if (pick() || ++tries > 40) {
        clearInterval(timer);
        resolve(voices);
      }
    }, 100);
    synth.addEventListener?.('voiceschanged', () => {
      if (pick()) clearInterval(timer);
    });
  });
  return voicesReady;
}

/** 日本語音声を、女性優先のスコア順で返す */
export function japaneseVoices() {
  return voices
    .map((v) => ({ v, s: scoreVoice(v) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.v);
}

/** 女性音声とみなせるか(選択UIの目印に使う) */
export function isFemaleVoice(v) {
  const name = `${v.name} ${v.voiceURI}`;
  if (MALE_HINTS.some((re) => re.test(name))) return false;
  return FEMALE_HINTS.some((re) => re.test(name));
}

export function pickVoice() {
  const saved = localStorage.getItem('tts-voice');
  const list = japaneseVoices();
  if (saved) {
    const hit = list.find((v) => v.voiceURI === saved) || voices.find((v) => v.voiceURI === saved);
    if (hit) return hit;
  }
  return list[0] || null;
}

/* ============ 読み補正 ============ */

let readingRules = null;

/**
 * 用語集の reading から読み補正の置換ルールを組み立てる。
 * 誤読しやすい英略語・漢字熟語を、かなに置き換えてから発話する。
 */
function buildReadingRules() {
  if (readingRules) return readingRules;
  const rules = [];
  for (const g of state.glossary || []) {
    if (!g.reading || g.reading === g.term) continue;
    // 読みが漢字を含む場合は補正にならないので使わない
    if (/[一-龥]/.test(g.reading)) continue;
    rules.push({ term: g.term, reading: g.reading });
  }
  // 長い語から先に置換して、部分一致による取りこぼしを防ぐ
  rules.sort((a, b) => b.term.length - a.term.length);
  readingRules = rules.map((r) => ({
    re: new RegExp(r.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
    to: r.reading,
  }));
  return readingRules;
}

/** 記号や番号など、読み上げに向かない表記を整える */
function normalizeForSpeech(text) {
  let t = text;
  for (const r of buildReadingRules()) t = t.replace(r.re, r.to);
  return t
    .replace(/【[^】]*】/g, '') // 原文の英字正式名称は読み上げない
    .replace(/[／/]/g, '、')
    .replace(/[()（）]/g, ' ')
    .replace(/[―—–\-]{2,}/g, '、')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** 段落ブロック → 読み上げ単位。表や極端に短い断片は飛ばす */
export function speechUnits(blocks) {
  const units = [];
  for (const b of blocks) {
    if (b.type === 'heading') {
      if (b.text) units.push({ pid: b.id, text: normalizeForSpeech(b.text), heading: true });
      continue;
    }
    if (b.type !== 'para' || b.table) continue; // 表は音読に向かないので飛ばす
    const t = normalizeForSpeech(b.text);
    if (t.length < 2) continue;
    units.push({ pid: b.pid, text: t, heading: false });
  }
  return units;
}

/* ============ 再生制御 ============ */

const st = {
  units: [],
  i: 0,
  playing: false,
  rate: parseFloat(localStorage.getItem('tts-rate') || '1.45'),
  voice: null,
  onUnit: null,
  onEnd: null,
  warmed: false,
  loop: false, // 最後まで読んだら先頭へ戻る(頻出箇所の繰り返し用)
  gap: 0, // 各項目のあとに置く間(ミリ秒)
};

export const ttsState = st;

/**
 * プリウォーム: 音声リストを解決し、無音の発話を1度通して
 * エンジンを起動しておく。これで「再生」を押してから声が出るまでの
 * 待ちがほぼなくなる。
 */
export async function prewarm() {
  if (!isSupported || st.warmed) return;
  await loadVoices();
  st.voice = pickVoice();
  buildReadingRules();
  try {
    const u = new SpeechSynthesisUtterance('');
    u.volume = 0; // 聞こえない
    u.rate = 2;
    if (st.voice) u.voice = st.voice;
    synth.speak(u);
    synth.cancel(); // キューはすぐ捨てる。エンジンの初期化だけが目的
  } catch {
    /* 初期化に失敗しても再生自体には影響しない */
  }
  st.warmed = true;
}

function utterFor(unit) {
  const u = new SpeechSynthesisUtterance(unit.text);
  u.lang = 'ja-JP';
  u.rate = st.rate;
  u.pitch = 1;
  if (st.voice) u.voice = st.voice;
  return u;
}

let gapTimer = null;

function speakFrom(i) {
  if (!st.playing) return;
  if (i >= st.units.length) {
    if (st.loop && st.units.length) {
      // 繰り返し再生: 先頭へ戻る
      st.onLoop?.();
      speakFrom(0);
      return;
    }
    stop();
    st.onEnd?.();
    return;
  }
  st.i = i;
  const unit = st.units[i];
  st.onUnit?.(unit, i);

  const u = utterFor(unit);
  u.onend = () => {
    if (!st.playing) return;
    if (st.gap > 0) {
      clearTimeout(gapTimer);
      gapTimer = setTimeout(() => st.playing && speakFrom(i + 1), st.gap);
    } else {
      speakFrom(i + 1);
    }
  };
  u.onerror = (e) => {
    // interrupted / canceled は stop() 由来なので無視
    if (e.error && !/interrupted|canceled/i.test(e.error)) {
      console.warn('TTS error', e.error);
      stop();
    }
  };
  synth.speak(u);

  // 次の1件を先読みしてキューへ積む(発話の切れ目を詰める)
  const next = st.units[i + 1];
  if (next) {
    // ここでは speak せず、テキスト整形だけ済ませておく
    next._ready = true;
  }
}

/** 読み上げ開始。startIndex 省略時は先頭から */
export async function play(units, startIndex = 0, handlers = {}) {
  if (!isSupported) {
    toast('この端末では読み上げに対応していません');
    return false;
  }
  await prewarm();
  if (!st.voice) {
    toast('日本語の音声が見つかりませんでした');
    return false;
  }
  synth.cancel();
  st.units = units;
  st.onUnit = handlers.onUnit || null;
  st.onEnd = handlers.onEnd || null;
  st.onLoop = handlers.onLoop || null;
  st.loop = !!handlers.loop;
  st.gap = handlers.gap ?? 0;
  st.playing = true;

  // 画面が消えて止まらないように保持をかける(効果は端末による)
  acquireWakeLock();
  startSilentAudio();
  if (handlers.title) {
    setMediaSession(handlers.title, handlers.subtitle, {
      pause: () => stop(),
      stop: () => stop(),
      next: () => next(),
      prev: () => prev(),
    });
  }

  speakFrom(Math.max(0, Math.min(startIndex, units.length - 1)));
  return true;
}

export function stop() {
  st.playing = false;
  st.loop = false;
  clearTimeout(gapTimer);
  releaseWakeLock();
  stopSilentAudio();
  clearMediaSession();
  try {
    synth.cancel();
  } catch {
    /* noop */
  }
}

/** 再生中でも繰り返しの有無を切り替える */
export function setLoop(on) {
  st.loop = !!on;
}

export function isPlaying() {
  return st.playing;
}

export function next() {
  if (!st.playing) return;
  synth.cancel();
  speakFrom(st.i + 1);
}

export function prev() {
  if (!st.playing) return;
  synth.cancel();
  speakFrom(Math.max(0, st.i - 1));
}

export function setRate(r) {
  st.rate = r;
  localStorage.setItem('tts-rate', String(r));
  if (st.playing) {
    synth.cancel();
    speakFrom(st.i); // 現在の段落から新しい速度で読み直す
  }
}

export function setVoice(uri) {
  localStorage.setItem('tts-voice', uri);
  st.voice = voices.find((v) => v.voiceURI === uri) || st.voice;
  if (st.playing) {
    synth.cancel();
    speakFrom(st.i);
  }
}

/** 設定画面での試聴。選んだ声と速度をその場で確かめられる */
export async function preview(voiceURI, rate) {
  if (!isSupported) return;
  await loadVoices();
  synth.cancel();
  const u = new SpeechSynthesisUtterance(
    'データセンターの価値の9割は運用が生み出しています。'
  );
  u.lang = 'ja-JP';
  u.rate = rate ?? st.rate;
  const v = voices.find((x) => x.voiceURI === voiceURI);
  if (v) u.voice = v;
  synth.speak(u);
}

/* ============ 画面スリープ・バックグラウンド対策 ============ */

/*
 * Web Speech API は「メディア再生」ではなく読み上げ機能として扱われるため、
 * 画面を消すと OS 側で止められることが多い。完全に防ぐ手段はブラウザにないが、
 * 次の2つで実用上の継続性を上げる。
 *   1. Screen Wake Lock — 再生中は画面を消させない(いちばん確実)
 *   2. 無音のオーディオ再生 — オーディオセッションを保持して停止を起きにくくする
 * どちらも再生を止めたら解放する。
 */

let wakeLock = null;

/** 画面を消させない保持が効いているか(UI表示用) */
export function hasWakeLock() {
  return !!wakeLock;
}

async function acquireWakeLock() {
  if (!('wakeLock' in navigator) || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener?.('release', () => {
      wakeLock = null;
      document.dispatchEvent(new CustomEvent('tts-wakelock-changed'));
    });
    document.dispatchEvent(new CustomEvent('tts-wakelock-changed'));
  } catch {
    wakeLock = null; // 権限やバッテリー状況で失敗することがある
  }
}

function releaseWakeLock() {
  try {
    wakeLock?.release?.();
  } catch {
    /* noop */
  }
  wakeLock = null;
}

let audioCtx = null;
let silentNode = null;

/** 無音を流し続けて、オーディオセッションを保持する */
function startSilentAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    if (silentNode) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    gain.gain.value = 0.0001; // 聞こえないが、無音すぎると止められることがある
    osc.frequency.value = 30;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    silentNode = { osc, gain };
  } catch {
    /* 使えない環境ではそのまま続行 */
  }
}

function stopSilentAudio() {
  try {
    silentNode?.osc.stop();
    silentNode?.osc.disconnect();
    silentNode?.gain.disconnect();
  } catch {
    /* noop */
  }
  silentNode = null;
  try {
    if (audioCtx && audioCtx.state === 'running') audioCtx.suspend();
  } catch {
    /* noop */
  }
}

/** ロック画面や通知領域に、いま読んでいるものを出す */
export function setMediaSession(title, artist, handlers = {}) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new window.MediaMetadata({
      title,
      artist: artist || 'DC運用ガイド 読本',
      album: '読み上げ',
      artwork: [
        { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    });
    navigator.mediaSession.playbackState = 'playing';
    const set = (a, fn) => {
      try {
        navigator.mediaSession.setActionHandler(a, fn);
      } catch {
        /* 未対応のアクションは無視 */
      }
    };
    set('play', handlers.play || null);
    set('pause', handlers.pause || null);
    set('stop', handlers.stop || null);
    set('nexttrack', handlers.next || null);
    set('previoustrack', handlers.prev || null);
  } catch {
    /* noop */
  }
}

function clearMediaSession() {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.playbackState = 'none';
  } catch {
    /* noop */
  }
}

/* 画面を戻したときに Wake Lock を取り直す(タブ切り替えで失われるため) */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && st.playing) acquireWakeLock();
});

/* Chromeは長時間の発話で内部的に停止することがあるため、
   再生中は定期的に resume を呼んで取りこぼしを防ぐ */
setInterval(() => {
  if (st.playing && synth.paused) {
    try {
      synth.resume();
    } catch {
      /* noop */
    }
  }
}, 5000);

// ページを離れるときは必ず止める(読み上げが残り続けるのを防ぐ)
addEventListener('beforeunload', stop);
