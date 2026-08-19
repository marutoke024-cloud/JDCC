/*
 * cdfom.js — CDFOM研修(JDCCとは別カテゴリ)
 *
 * ・モジュール1〜11 と「試験 頻出箇所一覧」を読むビュー
 * ・ノート内の ==ハイライト== は試験の頻出箇所。まとめて繰り返し再生できる
 *   (走りながら耳で復習する用途を想定)
 */
import { state, esc, fmtNum, toast } from './state.js';
import * as db from './db.js';
import * as tts from './tts.js';

/* ============ 描画 ============ */

function segHtml(segs) {
  return segs
    .map((s) => {
      const t = esc(s.t);
      if (s.k === 'hl') return `<mark class="cd-hl">${t}</mark>`;
      if (s.k === 'b') return `<strong>${t}</strong>`;
      if (s.k === 'i') return `<em>${t}</em>`;
      return t;
    })
    .join('');
}

function blockHtml(b) {
  if (b.type === 'heading') {
    const tag = `h${b.level}`;
    return `<${tag} id="${esc(b.id)}" class="cd-h${b.level}">${segHtml(b.segs)}</${tag}>`;
  }
  const lines = b.lines.map((l) => `<span class="s">${segHtml(l)}</span>`).join('');
  return `<div class="para cd-para" id="${esc(b.id)}">${lines}</div>`;
}

/** CDFOMのトップ: モジュール一覧 */
export function renderCdfomHome(main) {
  const cd = state.cdfom;
  if (!cd) {
    main.innerHTML =
      '<div class="container"><div class="empty-state" style="padding-top:80px"><p>CDFOM研修のデータが読み込まれていません。</p></div></div>';
    return;
  }
  const totalHl = cd.examHighlights.length + cd.highlights.length;
  const cards = cd.modules
    .map(
      (m) => `
      <a class="cd-card" href="#/cdfom/m/${m.no}">
        <div class="cd-card-top">
          <span class="cd-card-no">M${m.no}</span>
          <span class="cd-card-hl">${cd.highlights.filter((h) => h.module === m.no).length} 頻出</span>
        </div>
        <div class="cd-card-title">${esc(m.title)}</div>
        <div class="cd-card-foot">${fmtNum(m.chars)}字</div>
      </a>`
    )
    .join('');

  main.innerHTML = `
    <div class="container">
      <header class="page-head">
        <div class="cd-kicker">CDFOM 研修ノート</div>
        <h1 class="page-title">試験対策</h1>
        <p class="page-sub">全11モジュールと頻出箇所一覧。ハイライトは試験に出やすい箇所です。</p>
      </header>

      <section class="cd-focus">
        <div class="cd-focus-head">
          <span class="cd-focus-title">頻出箇所の聞き流し</span>
          <span class="cd-focus-count">${totalHl} 項目</span>
        </div>
        <p class="cd-focus-note">
          ハイライト箇所だけを続けて読み上げます。繰り返し再生にすれば、画面を見ずに何周でも復習できます。
        </p>
        <div class="cd-focus-actions">
          <a class="btn btn-primary" href="#/cdfom/drill"><svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg>頻出箇所を聞く</a>
          <a class="btn" href="#/cdfom/exam"><svg viewBox="0 0 24 24"><path d="M6 3h12v18H6z"/><path d="M9.5 8h5M9.5 12h5M9.5 16h3"/></svg>頻出箇所一覧を読む</a>
        </div>
      </section>

      <div class="section-label"><span>モ ジ ュ ー ル</span><small>全${cd.modules.length}件</small></div>
      <div class="cd-grid">${cards}</div>
    </div>`;
}

/** モジュール本文 / 頻出箇所一覧 */
export function renderCdfomDoc(main, kind, no) {
  const cd = state.cdfom;
  if (!cd) return;
  const doc =
    kind === 'exam' ? cd.exam : cd.modules.find((m) => m.no === parseInt(no, 10));
  if (!doc) {
    main.innerHTML = '<div class="container"><p style="padding:60px 0">見つかりません。</p></div>';
    return;
  }
  const isExam = kind === 'exam';
  const label = isExam ? '試験 頻出箇所一覧' : `モジュール${doc.no}`;
  const hlCount = isExam
    ? cd.examHighlights.length
    : cd.highlights.filter((h) => h.module === doc.no).length;

  const prev = !isExam && cd.modules.find((m) => m.no === doc.no - 1);
  const next = !isExam && cd.modules.find((m) => m.no === doc.no + 1);

  main.innerHTML = `
    <article class="reader container">
      <header>
        <div class="cd-kicker">CDFOM ${esc(label)}</div>
        <h1 class="reader-title">${esc(doc.title)}</h1>
        <div class="reader-meta">
          <span>${fmtNum(doc.chars)} 字</span>
          <span>頻出 ${hlCount} 箇所</span>
        </div>
        <div class="cd-doc-actions">
          <button class="btn btn-sm" id="cd-speak">
            <svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg>このモジュールを読み上げ
          </button>
          <a class="btn btn-sm btn-ghost" href="#/cdfom/drill">頻出箇所だけ聞く</a>
        </div>
      </header>
      <hr class="reader-rule">
      <div class="prose cd-prose" id="prose">
        ${doc.blocks.map(blockHtml).join('')}
      </div>
      <nav class="reader-nav">
        ${
          prev
            ? `<a class="btn" href="#/cdfom/m/${prev.no}"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg><span>M${prev.no} ${esc(prev.title)}</span></a>`
            : '<a class="btn" href="#/cdfom"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg><span>モジュール一覧</span></a>'
        }
        ${
          next
            ? `<a class="btn" href="#/cdfom/m/${next.no}"><span>M${next.no} ${esc(next.title)}</span><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></a>`
            : '<span></span>'
        }
      </nav>
    </article>`;

  // reader.js とは相互参照になるため、押されたときに読み込む
  main.querySelector('#cd-speak').onclick = async () => {
    const r = await import('./reader.js');
    r.toggleSpeech();
  };
}

/* ============ モジュール本文の読み上げ ============ */

/** CDFOMの1文書 → 読み上げ単位。見出しも読み、章内の位置がわかるようにする */
export function docSpeechUnits(doc) {
  const units = [];
  for (const b of doc.blocks) {
    if (b.type === 'heading') {
      const t = b.segs.map((s) => s.t).join('').trim();
      if (t) units.push({ pid: b.id, text: t, heading: true });
      continue;
    }
    for (const line of b.lines) {
      const t = line.map((s) => s.t).join('').trim();
      if (t.length < 2) continue;
      units.push({ pid: b.id, text: t, heading: false });
    }
  }
  return units;
}

/** いま表示している文書(モジュール/頻出一覧)を特定する */
function currentDoc(kind, no) {
  const cd = state.cdfom;
  if (!cd) return null;
  return kind === 'exam' ? cd.exam : cd.modules.find((m) => m.no === parseInt(no, 10));
}

/** 次に読む文書。モジュールは順に進み、最後まで行ったら止まる */
export function nextDoc(kind, no) {
  const cd = state.cdfom;
  if (!cd || kind === 'exam') return null;
  const next = cd.modules.find((m) => m.no === parseInt(no, 10) + 1);
  return next ? { kind: 'module', no: next.no, title: `モジュール${next.no} ${next.title}` } : null;
}

export function cdfomDocInfo(kind, no) {
  const doc = currentDoc(kind, no);
  if (!doc) return null;
  return {
    doc,
    units: docSpeechUnits(doc),
    label: kind === 'exam' ? '試験 頻出箇所一覧' : `モジュール${doc.no} ${doc.title}`,
    next: nextDoc(kind, no),
  };
}

/* ============ 頻出箇所ドリル(聞き流し) ============ */

const DRILL_KEY = 'cdfom-drill';

/** 一覧側を優先し、モジュール由来で重複しないものを足す */
export function drillItems(scope = 'all') {
  const cd = state.cdfom;
  if (!cd) return [];
  const seen = new Set();
  const out = [];
  const push = (h) => {
    const key = h.text.replace(/\s+/g, '');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(h);
  };
  if (scope === 'all' || scope === 'exam') cd.examHighlights.forEach(push);
  if (scope === 'all' || scope === 'modules') cd.highlights.forEach(push);
  if (/^m\d+$/.test(scope)) {
    const no = parseInt(scope.slice(1), 10);
    cd.highlights.filter((h) => h.module === no).forEach(push);
  }
  return out;
}

export function renderCdfomDrill(main) {
  const cd = state.cdfom;
  if (!cd) return;
  const scope = localStorage.getItem(DRILL_KEY + '-scope') || 'all';
  const items = drillItems(scope);

  const scopeBtn = (v, label) =>
    `<button class="radio-pill${scope === v ? ' on' : ''}" data-scope="${v}">${label}</button>`;

  main.innerHTML = `
    <div class="container">
      <header class="page-head">
        <div class="cd-kicker">CDFOM 試験対策</div>
        <h1 class="page-title">頻出箇所の聞き流し</h1>
        <p class="page-sub">ハイライト箇所だけを順に読み上げます。繰り返しにすると何周でも流し続けます。</p>
      </header>

      <div class="drill-bar">
        <div class="drill-scope">
          ${scopeBtn('all', 'すべて')}
          ${scopeBtn('exam', '頻出一覧のみ')}
          ${scopeBtn('modules', 'モジュールのみ')}
        </div>
        <label class="drill-loop">
          <input type="checkbox" id="drill-loop" ${localStorage.getItem(DRILL_KEY + '-loop') !== '0' ? 'checked' : ''}>
          繰り返し
        </label>
        <label class="drill-gap">
          間
          <select id="drill-gap">
            ${[0, 500, 1000, 2000, 3000]
              .map(
                (g) =>
                  `<option value="${g}"${String(g) === (localStorage.getItem(DRILL_KEY + '-gap') || '1000') ? ' selected' : ''}>${g === 0 ? 'なし' : g / 1000 + '秒'}</option>`
              )
              .join('')}
          </select>
        </label>
        <span class="tts-awake" id="drill-awake" hidden title="再生中は画面を消さないようにしています">画面ON保持</span>
        <button class="btn btn-primary" id="drill-play">
          <svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg><span>再生</span>
        </button>
      </div>

      <p class="drill-count" id="drill-count">${items.length} 項目</p>
      <ol class="drill-list" id="drill-list">
        ${items
          .map(
            (h, i) => `
          <li class="drill-item" data-i="${i}">
            <span class="drill-no">${i + 1}</span>
            <div class="drill-body">
              <div class="drill-meta">${esc(h.source)}${h.heading ? ' ・ ' + esc(h.heading) : ''}</div>
              <div class="drill-text">${esc(h.text)}</div>
            </div>
          </li>`
          )
          .join('')}
      </ol>
    </div>`;

  bindDrill(main);
}

function bindDrill(main) {
  const gapSel = main.querySelector('#drill-gap');
  const loopBox = main.querySelector('#drill-loop');

  main.querySelectorAll('[data-scope]').forEach((b) => {
    b.onclick = () => {
      localStorage.setItem(DRILL_KEY + '-scope', b.dataset.scope);
      tts.stop();
      renderCdfomDrill(main);
    };
  });

  gapSel.onchange = () => {
    localStorage.setItem(DRILL_KEY + '-gap', gapSel.value);
    tts.ttsState.gap = parseInt(gapSel.value, 10);
  };
  loopBox.onchange = () => {
    localStorage.setItem(DRILL_KEY + '-loop', loopBox.checked ? '1' : '0');
    tts.setLoop(loopBox.checked);
  };

  // 項目をクリックしたらそこから読み上げ
  main.querySelectorAll('.drill-item').forEach((li) => {
    li.onclick = () => startDrill(main, parseInt(li.dataset.i, 10));
  });

  main.querySelector('#drill-play').onclick = () => {
    if (tts.isPlaying()) {
      tts.stop();
      paintDrillState(main, false);
      return;
    }
    startDrill(main, 0);
  };
}

function paintDrillState(main, playing) {
  const btn = main.querySelector('#drill-play');
  if (!btn) return;
  const awake = main.querySelector('#drill-awake');
  if (awake) awake.hidden = !(playing && tts.hasWakeLock());
  btn.querySelector('span').textContent = playing ? '停止' : '再生';
  btn.querySelector('svg').innerHTML = playing
    ? '<rect x="7" y="6" width="4" height="12" rx="1"/><rect x="13" y="6" width="4" height="12" rx="1"/>'
    : '<path d="M8 5l11 7-11 7z"/>';
  btn.querySelector('svg').setAttribute('fill', 'currentColor');
  if (!playing) main.querySelectorAll('.drill-item.on').forEach((e) => e.classList.remove('on'));
}

async function startDrill(main, from) {
  const scope = localStorage.getItem(DRILL_KEY + '-scope') || 'all';
  const items = drillItems(scope);
  if (!items.length) {
    toast('読み上げる項目がありません');
    return;
  }
  const loop = main.querySelector('#drill-loop').checked;
  const gap = parseInt(main.querySelector('#drill-gap').value, 10);

  // 見出しを前置きにすると、耳だけでも文脈がつかめる
  const units = items.map((h) => ({
    pid: h.id,
    text: h.heading ? `${h.heading}。${h.text}` : h.text,
    heading: false,
  }));

  const ok = await tts.play(units, from, {
    loop,
    gap,
    title: '頻出箇所の聞き流し',
    subtitle: 'CDFOM 試験対策',
    onUnit: (_u, i) => {
      main.querySelectorAll('.drill-item.on').forEach((e) => e.classList.remove('on'));
      const li = main.querySelector(`.drill-item[data-i="${i}"]`);
      if (li) {
        li.classList.add('on');
        const r = li.getBoundingClientRect();
        if (r.top < 80 || r.bottom > innerHeight - 100) {
          li.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
      db.kv.set('cdfom-drill-pos', { scope, i, at: Date.now() });
    },
    onLoop: () => toast('先頭に戻ってもう一周します'),
    onEnd: () => paintDrillState(main, false),
  });
  paintDrillState(main, ok);
  // 画面保持は非同期に確定するため、確定後にもう一度表示を合わせる
  document.addEventListener('tts-wakelock-changed', () => paintDrillState(main, tts.isPlaying()), {
    once: true,
  });
}
