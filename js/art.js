/*
 * art.js — 内容連動イラストレーション
 *
 * 「静かな紙面 × 進捗だけが色を持つ」の世界観を保つため、
 * すべて藍系1色の線画SVGで統一。CSS変数で描くのでダークモードにも追従する。
 * 章ヒーロー・節の挿絵・章カードのモチーフを、本文キーワードから自動選択する。
 * (原文には手を加えず、表示時に図版を差し込むだけ)
 */

/* ---------- モチーフ(48×48の線画) ---------- */

const M = {
  building: () => `
    <rect class="lnA flT" x="9" y="12" width="30" height="28" rx="1.5"/>
    <path class="lnA" d="M9 18h30"/>
    <path class="lnS" d="M14 23h4M22 23h4M30 23h4M14 28h4M22 28h4M30 28h4M14 33h4M22 33h4M30 33h4"/>
    <path class="lnA" d="M19 12V8h10v4"/>
    <path class="lnS" d="M24 8V4"/><circle class="flA" cx="24" cy="3.4" r="1.4"/>
    <path class="lnS" d="M5 40h38"/>`,

  rack: () => `
    <rect class="lnA flT" x="13" y="5" width="22" height="38" rx="2"/>
    <path class="lnA" d="M13 13h22M13 21h22M13 29h22M13 37h22"/>
    <circle class="flA" cx="17.5" cy="9" r="1.2"/><circle class="flA" cx="17.5" cy="17" r="1.2"/>
    <circle class="flA" cx="17.5" cy="25" r="1.2"/><circle class="flA" cx="17.5" cy="33" r="1.2"/>
    <path class="lnS" d="M25 9h6M25 17h6M25 25h6M25 33h6"/>`,

  services: () => `
    <rect class="lnA flT" x="14" y="6" width="24" height="9" rx="2"/>
    <rect class="lnA flT" x="11" y="18" width="24" height="9" rx="2"/>
    <rect class="lnA flT" x="8" y="30" width="24" height="9" rx="2"/>
    <circle class="flA" cx="18" cy="10.5" r="1.2"/><circle class="flA" cx="15" cy="22.5" r="1.2"/>
    <circle class="flA" cx="12" cy="34.5" r="1.2"/>
    <path class="lnS" d="M22 10.5h11M19 22.5h11M16 34.5h11"/>`,

  law: () => `
    <rect class="lnA flT" x="12" y="6" width="22" height="30" rx="2"/>
    <path class="lnS" d="M17 13h12M17 18h12M17 23h7"/>
    <circle class="lnA" cx="30" cy="32" r="6"/>
    <path class="lnA" d="M27.5 32l1.8 1.8 3.4-3.6"/>
    <path class="lnS" d="M27 38l-1.5 5 4.5-2.4 4.5 2.4-1.5-5"/>`,

  cert: () => `
    <circle class="lnA flT" cx="24" cy="19" r="10"/>
    <circle class="lnS" cx="24" cy="19" r="6.2"/>
    <path class="lnA" d="M21.4 19l2 2 3.4-3.8"/>
    <path class="lnA" d="M19 27.5L16 42l8-4.5 8 4.5-3-14.5"/>`,

  mgmt: () => `
    <path class="lnA" d="M9 8v30h30"/>
    <path class="lnA" d="M13 32l7-8 5 4 9-13"/>
    <circle class="flA" cx="20" cy="24" r="1.6"/><circle class="flA" cx="25" cy="28" r="1.6"/>
    <circle class="flA" cx="34" cy="15" r="1.6"/>
    <path class="lnS" d="M13 14h6M13 19h4"/>`,

  customer: () => `
    <circle class="lnA" cx="17" cy="15" r="5"/>
    <path class="lnA" d="M8 36c0-6 4-10 9-10s9 4 9 10"/>
    <circle class="lnS" cx="32" cy="17" r="4.2"/>
    <path class="lnS" d="M25.5 36c0-5.5 3-8.6 6.5-8.6s6.5 3 6.5 8.6"/>
    <path class="lnA" d="M30 7h10a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2l-2.4 2.6V15H34"/>`,

  floor: () => `
    <rect class="lnA" x="7" y="9" width="34" height="30" rx="1.5"/>
    <path class="lnS" d="M7 19h34M7 29h34M18.3 9v30M29.6 9v30"/>
    <rect class="flA" x="10" y="12" width="5" height="4" rx="0.8"/>
    <rect class="flA" x="21.5" y="22" width="5" height="4" rx="0.8"/>
    <rect class="flA" x="32.8" y="32" width="5" height="4" rx="0.8"/>`,

  monitor: () => `
    <rect class="lnA flT" x="8" y="8" width="32" height="22" rx="2.5"/>
    <path class="lnA" d="M12 21l5-5 4 3 6-8 4 5"/>
    <path class="lnS" d="M20 36h8M24 30v6"/>
    <path class="lnA" d="M16 40h16"/>`,

  terminal: () => `
    <rect class="lnA flT" x="8" y="9" width="32" height="26" rx="2.5"/>
    <path class="lnS" d="M8 15h32"/>
    <circle class="flA" cx="12" cy="12" r="1"/><circle class="flS" cx="15.5" cy="12" r="1"/>
    <path class="lnA" d="M13 21l4 3.5-4 3.5M20 28.5h8"/>
    <path class="lnS" d="M30 20v-1M33 20v-3M36 20v-2"/>`,

  network: () => `
    <circle class="lnA flT" cx="24" cy="10" r="4.5"/>
    <circle class="lnA flT" cx="10" cy="35" r="4.5"/>
    <circle class="lnA flT" cx="38" cy="35" r="4.5"/>
    <circle class="flA" cx="24" cy="25" r="2"/>
    <path class="lnS" d="M24 14.5V23M22 27l-9 4.6M26 27l9 4.6"/>`,

  cable: () => `
    <rect class="lnA flT" x="7" y="18" width="10" height="12" rx="2"/>
    <path class="lnS" d="M10 21v6M14 21v6"/>
    <path class="lnA" d="M17 24h6c6 0 4 12 10 12h8"/>
    <path class="lnS" d="M35 32v8M41 32v8"/>`,

  facility: () => `
    <circle class="lnA" cx="19" cy="27" r="11"/>
    <path class="lnA" d="M19 20v7l5 3"/>
    <path class="lnA" d="M31 9l5.5 5.5-4 4L27 13z"/>
    <path class="lnS" d="M34 17l6 6"/>`,

  power: () => `
    <rect class="lnA flT" x="11" y="15" width="24" height="18" rx="3"/>
    <path class="lnA" d="M35 20h4v8h-4"/>
    <path class="lnA flA" d="M24.5 18l-5 7h4l-2.5 6 6.5-7.5h-4z"/>
    <path class="lnS" d="M14 38h20"/>`,

  battery: () => `
    <rect class="lnA flT" x="10" y="17" width="26" height="16" rx="2.5"/>
    <path class="lnA" d="M36 21.5h3.5v7H36"/>
    <rect class="flA" x="13.5" y="20.5" width="5" height="9" rx="1"/>
    <rect class="flA" x="21" y="20.5" width="5" height="9" rx="1"/>
    <rect class="lnS" x="28.5" y="20.5" width="5" height="9" rx="1"/>
    <path class="lnS" d="M15 12l2-4M24 12V7M33 12l-2-4"/>`,

  genset: () => `
    <rect class="lnA flT" x="8" y="19" width="24" height="16" rx="2.5"/>
    <path class="lnS" d="M13 19v-4h6v4M12 35v4M28 35v4"/>
    <path class="lnA" d="M32 24h5a3 3 0 0 1 3 3v8"/>
    <path class="lnA flA" d="M20.5 22l-4 5.5h3.2l-2 4.8 5.2-6h-3.2z"/>
    <path class="lnS" d="M36 13c1.5-1.5 1.5-3 0-4.5M39.5 15c2.5-2.5 2.5-6 0-8.5"/>`,

  cooling: () => `
    <circle class="lnA" cx="21" cy="24" r="13"/>
    <circle class="flA" cx="21" cy="24" r="2.2"/>
    <path class="lnA" d="M21 21.5c0-4 -1.5-7 2.5-9M23.5 25.5c3.5 2 6.5 2 8 6M18 26c-3.5 2-7 1.5-9-2"/>
    <path class="lnS" d="M38 14c2 0 2 3 4 3M38 21c2 0 2 3 4 3M38 28c2 0 2 3 4 3"/>`,

  security: () => `
    <path class="lnA flT" d="M24 5l13 5v10.5C37 29 32 34.5 24 39 16 34.5 11 29 11 20.5V10z"/>
    <circle class="lnA" cx="24" cy="19" r="3.5"/>
    <path class="lnA" d="M24 22.5V28"/>`,

  reception: () => `
    <rect class="lnA flT" x="8" y="13" width="32" height="22" rx="2.5"/>
    <circle class="lnA" cx="17" cy="21" r="3.2"/>
    <path class="lnA" d="M11.5 30c0-3.5 2.5-5.5 5.5-5.5s5.5 2 5.5 5.5"/>
    <path class="lnS" d="M27 20h9M27 25h9M27 30h5"/>
    <path class="lnS" d="M21 13l3-6 3 6"/>`,

  cleaning: () => `
    <path class="lnA" d="M30 6L18 26"/>
    <path class="lnA flT" d="M18 26l-7 12c5 2 12 2 16-1z"/>
    <path class="lnS" d="M15 32l3 2M13 36l3 2"/>
    <path class="lnS" d="M35 12l1.2 3 3 1.2-3 1.2-1.2 3-1.2-3-3-1.2 3-1.2zM38 26l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>`,

  robot: () => `
    <rect class="lnA flT" x="11" y="15" width="26" height="20" rx="5"/>
    <circle class="flA" cx="19" cy="24" r="2.2"/><circle class="flA" cx="29" cy="24" r="2.2"/>
    <path class="lnA" d="M19 30.5h10"/>
    <path class="lnS" d="M24 15v-5"/><circle class="flA" cx="24" cy="8" r="1.8"/>
    <path class="lnS" d="M11 22H6.5v8H11M37 22h4.5v8H37"/>`,

  gears: () => `
    <circle class="lnA" cx="19" cy="20" r="8"/>
    <circle class="flA" cx="19" cy="20" r="2"/>
    <path class="lnA" d="M19 9.5V6M19 34v-3.5M8.5 20H5M33 20h-3.5M11.6 12.6L9 10M26.4 27.4l2.6 2.6M26.4 12.6L29 10M11.6 27.4L9 30"/>
    <circle class="lnS" cx="33" cy="33" r="5.5"/>
    <circle class="flS" cx="33" cy="33" r="1.5"/>
    <path class="lnS" d="M33 25.5v-2.2M33 43v-2.2M25.5 33h-2.2M43 33h-2.2"/>`,

  closure: () => `
    <path class="lnA flT" d="M10 22h28v16a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2z"/>
    <path class="lnA" d="M10 22l-4-7h17M38 22l4-7H25"/>
    <path class="lnS" d="M21 27h6"/>
    <path class="lnA" d="M24 18V5M20 9l4-4 4 4"/>`,

  book: () => `
    <path class="lnA flT" d="M24 11c-4-3-9-3.5-14-2.5v27c5-1 10-.5 14 2.5 4-3 9-3.5 14-2.5v-27C33 7.5 28 8 24 11z"/>
    <path class="lnA" d="M24 11v27"/>
    <path class="lnS" d="M14 15.5c2.5-.4 5-.4 7 .3M14 21c2.5-.4 5-.4 7 .3M27 15.8c2-.7 4.5-.7 7-.3M27 21.3c2-.7 4.5-.7 7-.3"/>`,

  clipboard: () => `
    <rect class="lnA flT" x="11" y="8" width="26" height="34" rx="2.5"/>
    <rect class="lnA" x="18" y="5" width="12" height="6" rx="2"/>
    <path class="lnA" d="M16 19l2.4 2.4 4-4.4"/><path class="lnS" d="M26 20h6"/>
    <path class="lnA" d="M16 28l2.4 2.4 4-4.4"/><path class="lnS" d="M26 29h6"/>
    <path class="lnS" d="M16 36.5h10"/>`,

  media: () => `
    <rect class="lnA flT" x="9" y="14" width="30" height="22" rx="2.5"/>
    <circle class="lnA" cx="24" cy="25" r="6"/>
    <circle class="flA" cx="24" cy="25" r="1.6"/>
    <path class="lnS" d="M9 20h30"/>
    <circle class="flS" cx="13" cy="17" r="1"/>`,

  shieldlock: () => `
    <rect class="lnA flT" x="13" y="20" width="22" height="18" rx="3"/>
    <path class="lnA" d="M17 20v-5a7 7 0 0 1 14 0v5"/>
    <circle class="flA" cx="24" cy="28" r="2.2"/>
    <path class="lnA" d="M24 30v4"/>`,
};

/* ---------- キーワード → モチーフ ---------- */

const KEYWORD_MAP = [
  [/受変電|変電|配電|受電|電気設備/, 'power'],
  [/UPS|無停電|蓄電池|バッテリ/, 'battery'],
  [/発電機|燃料|自家発/, 'genset'],
  [/空調|冷却|冷水|温湿度|フリークーリング|アイル|気流|熱/, 'cooling'],
  [/警備|セキュリティ|入退室|共連れ|防犯|施錠/, 'security'],
  [/受付|入館|来訪|訪問者/, 'reception'],
  [/清掃|塵埃|クリーニング/, 'cleaning'],
  [/ロボット|AI|自動化/, 'robot'],
  [/DCIM|ツール|システム化|省力/, 'gears'],
  [/閉鎖|撤去|移転|原状回復/, 'closure'],
  [/消去|記憶媒体|媒体|データの適正/, 'media'],
  [/法令|法律|建築基準|消防|届出/, 'law'],
  [/認証|ISMS|ティア|格付|規格/, 'cert'],
  [/ネットワーク|回線|相互接続|ミートミー|トラフィック|通信/, 'network'],
  [/ケーブル|配線|敷設/, 'cable'],
  [/監視|アラート|障害|死活|ログ/, 'monitor'],
  [/オペレーション|操作代行|作業|手順/, 'terminal'],
  [/フロア|ラック|床|搬入|配置/, 'floor'],
  [/点検|保全|保守|巡視|修繕/, 'facility'],
  [/事業計画|投資|需要予測|計画/, 'mgmt'],
  [/カスタマー|利用者|顧客|満足度|報告会/, 'customer'],
  [/SLA|契約|サービス|責任分界/, 'services'],
  [/情報セキュリティ|漏えい/, 'shieldlock'],
  [/体制|訓練|教育|要員/, 'clipboard'],
  [/コロケーション|ハウジング|ホスティング/, 'rack'],
  [/データセンターとは|概要|施設|建物/, 'building'],
  [/用語|定義|ガイドブック|本書/, 'book'],
  [/データセンター/, 'building'],
];

export function matchMotif(text) {
  for (const [re, key] of KEYWORD_MAP) if (re.test(text)) return key;
  return null;
}

/* ---------- 章 → 構成モチーフ ---------- */

const CHAPTER_MOTIFS = {
  1: ['building', 'book', 'rack'],
  2: ['services', 'customer', 'rack'],
  3: ['law', 'cert', 'clipboard'],
  4: ['mgmt', 'customer', 'building'],
  5: ['floor', 'rack', 'cooling'],
  6: ['terminal', 'rack', 'clipboard'],
  7: ['monitor', 'terminal', 'network'],
  8: ['network', 'cable', 'rack'],
  9: ['facility', 'clipboard', 'building'],
  10: ['power', 'cooling', 'genset'],
  11: ['reception', 'security', 'cleaning'],
  12: ['robot', 'gears', 'monitor'],
  13: ['closure', 'media', 'building'],
};

export function chapterMotifKey(no) {
  return (CHAPTER_MOTIFS[no] || ['building'])[0];
}

/* ---------- SVG 組み立て ---------- */

function motifGroup(key, x, y, scale, extraClass = '') {
  const fn = M[key] || M.building;
  return `<g class="${extraClass}" transform="translate(${x},${y}) scale(${scale})">${fn()}</g>`;
}

/** 単体アイコン(章カードなど) */
export function motifIcon(key, size = 34) {
  return `<svg class="art" viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true">${(M[key] || M.building)()}</svg>`;
}

/** 装飾: ドット列 */
function dots(x, y, n, gap = 7) {
  let out = '';
  for (let i = 0; i < n; i++) out += `<circle class="flS" cx="${x + i * gap}" cy="${y}" r="1.1"/>`;
  return out;
}

/**
 * 章ヒーロー(640×190)
 * 大きな主モチーフ + 従モチーフ2つ + 地平線と点の装飾で静かな扉絵に。
 */
export function chapterHero(no) {
  const [a, b, c] = CHAPTER_MOTIFS[no] || ['building', 'book', 'rack'];
  return `
  <svg class="art art-hero" viewBox="0 0 640 190" preserveAspectRatio="xMidYMid meet" role="img" aria-label="第${no}章の扉絵">
    <path class="lnS art-dash" d="M40 152h560"/>
    ${dots(64, 166, 14)}
    ${dots(438, 32, 8)}
    <circle class="lnS" cx="560" cy="60" r="22"/>
    <circle class="flS" cx="583" cy="38" r="2.2"/>
    ${motifGroup(a, 178, 22, 2.5)}
    ${motifGroup(b, 340, 58, 1.8, 'art-soft')}
    ${motifGroup(c, 452, 84, 1.3, 'art-faint')}
    <path class="lnS" d="M96 120c14-10 30-10 44 0" />
    <circle class="flA" cx="118" cy="106" r="2.4"/>
  </svg>`;
}

/**
 * ホームの扉絵(640×150)— データセンターの街並みのような静かな横長構図
 */
export function homeArt() {
  return `
  <svg class="art art-home" viewBox="0 0 640 150" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <path class="lnS art-dash" d="M28 122h584"/>
    ${dots(50, 136, 18)}
    ${motifGroup('building', 60, 26, 2.0)}
    ${motifGroup('rack', 190, 52, 1.45, 'art-soft')}
    ${motifGroup('network', 282, 40, 1.6, 'art-soft')}
    ${motifGroup('cooling', 392, 58, 1.3, 'art-faint')}
    ${motifGroup('security', 484, 44, 1.55, 'art-soft')}
    <circle class="lnS" cx="600" cy="40" r="16"/>
    <circle class="flA" cx="612" cy="24" r="2.2"/>
    ${dots(360, 28, 7)}
  </svg>`;
}

/**
 * 節の挿絵(280×88)— 見出しの内容にマッチしたモチーフの小さなヴィネット
 */
export function sectionVignette(key) {
  return `
  <svg class="art art-vignette" viewBox="0 0 280 88" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <path class="lnS art-dash" d="M24 70h232"/>
    ${dots(190, 26, 6)}
    ${motifGroup(key, 108, 12, 1.35)}
    <circle class="lnS" cx="216" cy="48" r="12"/>
    <circle class="flA" cx="70" cy="30" r="2"/>
  </svg>`;
}
