/*
 * app.js — 起動・ルーティング・ホーム / 一覧ページ / 設定 / PWA
 */
import {
  state, loadAll, esc, fmtNum, toast,
  chapterProgress, chapterState, totalReadChars,
  dailyTarget, remainingDaysEstimate, todayPlan, chapterShortTitle,
} from './state.js';
import * as db from './db.js';
import {
  renderReader, readerRightPanel, openSheet, closeSheet, toggleSpeech, bindTtsBar,
} from './reader.js';
import * as tts from './tts.js';
import { initSync } from './sync.js';
import { motifIcon, chapterMotifKey, matchMotif, homeArt } from './art.js';

const $ = (s) => document.querySelector(s);
const main = () => $('#main');

/* ============ テーマ ============ */

function applyTheme() {
  const pref = localStorage.getItem('theme');
  const dark = pref ? pref === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
applyTheme();

/* ============ 本文の幅 ============ */

// [本文の上限, レイアウトの上限]
const READING_WIDTHS = {
  narrow: ['980px', '2200px'],
  wide: ['1320px', '2400px'],
  full: ['1800px', '100%'],
};

function currentReadingWidth() {
  const k = localStorage.getItem('reading-width');
  return READING_WIDTHS[k] ? k : 'full';
}

function applyReadingWidth(key) {
  const w = READING_WIDTHS[key] || READING_WIDTHS.full;
  localStorage.setItem('reading-width', key);
  const s = document.documentElement.style;
  s.setProperty('--reading-width', w[0]);
  s.setProperty('--layout-max', w[1]);
}

/* ============ 本文の文字サイズ ============ */

const FONT_SIZES = { small: '15px', medium: '16.5px', large: '18.5px' };

function currentFontSize() {
  const k = localStorage.getItem('font-size');
  return FONT_SIZES[k] ? k : 'medium';
}

function applyFontSize(key) {
  localStorage.setItem('font-size', key);
  document.documentElement.style.setProperty('--prose-size', FONT_SIZES[key] || FONT_SIZES.medium);
}

/* ============ ルーター ============ */

function parseHash() {
  const h = location.hash || '#/';
  if (!h.startsWith('#/')) return null; // ページ内アンカー
  const [path, query] = h.slice(2).split('?');
  const params = new URLSearchParams(query || '');
  const seg = path.split('/').filter(Boolean);
  return { seg, params };
}

let currentRoute = '';

async function route() {
  const r = parseHash();
  if (!r) return; // アンカースクロールに任せる
  const key = location.hash;
  currentRoute = key;
  closeSheet();
  closeDrawer();
  $('#popover').hidden = true;

  const [p0, p1] = r.seg;
  let nav = 'home';

  if (p0 === 'ch' && p1) {
    nav = '';
    const no = parseInt(p1, 10);
    // ?resume=1 のときは、前回閉じた位置まで戻す
    const resume =
      r.params.get('resume') && state.lastPosition && state.lastPosition.chapter === no
        ? state.lastPosition
        : null;
    await renderReader(main(), no, r.params.get('p'), resume);
    setRightPanel(readerRightPanel(no));
    bindTocSpy();
  } else if (p0 === 'glossary') {
    nav = 'glossary';
    renderGlossary(r.params.get('q') || '');
    setRightPanel(homeRightPanel());
  } else if (p0 === 'highlights') {
    nav = 'highlights';
    await renderHighlightsPage();
    setRightPanel(homeRightPanel());
  } else if (p0 === 'notes') {
    nav = 'notes';
    await renderNotesPage();
    setRightPanel(homeRightPanel());
  } else {
    await renderHome();
    setRightPanel(homeRightPanel());
  }

  document.querySelectorAll('[data-nav]').forEach((a) => {
    a.classList.toggle('active', a.dataset.nav === nav);
  });
  renderSidebar();
  updateQuotaBar();
}

/* ============ トップバー:今日のノルマ ============ */

let celebratedToday = false;

function updateQuotaBar() {
  const plan = todayPlan();
  const wrap = $('#topbar-quota');
  wrap.hidden = false;
  const fill = $('#quota-fill');
  fill.style.width = `${plan.pct}%`;
  fill.classList.toggle('done', plan.achieved);
  $('#quota-label').textContent = plan.achieved
    ? '今日のノルマ達成'
    : `今日 ${fmtNum(plan.todayChars)} / ${fmtNum(plan.target)} 字`;

  if (plan.achieved && !celebratedToday && plan.todayChars > 0) {
    celebratedToday = true;
    const key = `celebrated:${db.todayKey()}`;
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, '1');
      toast('今日のノルマを達成しました');
    }
  }
}

/* ============ サイドバー:章一覧 ============ */

function renderSidebar() {
  const cur = parseHash();
  const curCh = cur && cur.seg[0] === 'ch' ? parseInt(cur.seg[1], 10) : null;
  const html = state.chapters
    .map((ch) => {
      const st = chapterState(ch.chapter);
      const prog = chapterProgress(ch.chapter);
      return `
        <a class="side-ch ${st} ${curCh === ch.chapter ? 'current' : ''}" href="#/ch/${ch.chapter}">
          <span class="side-ch-no">${ch.chapter}</span>
          <span class="side-ch-title">${esc(chapterShortTitle(ch.chapter))}</span>
          ${
            st === 'done'
              ? '<svg class="side-check" viewBox="0 0 24 24"><path d="M4.5 12.5l5 5 10-11"/></svg>'
              : `<span class="side-ch-pct">${prog.pct > 0 ? `${prog.pct}%` : ''}</span>`
          }
        </a>`;
    })
    .join('');
  $('#sidebar-inner').innerHTML = `<div class="side-title">章 一 覧</div>${html}`;
}

/* ============ 右パネル ============ */

function setRightPanel(html) {
  $('#rightpanel-inner').innerHTML = html;
}

function homeRightPanel() {
  const read = totalReadChars();
  const pct = state.totalChars ? Math.round((read / state.totalChars) * 100) : 0;
  const days = remainingDaysEstimate();
  return `
    <div class="rp-section">
      <div class="rp-title">全体の進捗</div>
      <div class="rp-stat"><span>読了</span><strong>${fmtNum(read)} 字</strong></div>
      <div class="rp-stat"><span>全体</span><strong>${fmtNum(state.totalChars)} 字</strong></div>
      <div class="rp-stat"><span>達成率</span><strong>${pct}%</strong></div>
      <div class="rp-stat"><span>読了見込み</span><strong>あと約${days}日</strong></div>
    </div>
    <div class="rp-section">
      <div class="rp-title">継続</div>
      <div class="rp-stat"><span>ストリーク</span><strong>${state.streak.count} 日</strong></div>
      <div class="rp-stat"><span>1日の目安</span><strong>${fmtNum(dailyTarget())} 字</strong></div>
    </div>`;
}

/* ============ ホーム ============ */

async function renderHome() {
  const plan = todayPlan();
  const bm = state.bookmark;
  const lastPos = state.lastPosition;

  const rangeHtml = plan.start
    ? `今日は <span class="range-em">第${plan.start.chapter}章${plan.start.num ? ` ${plan.start.num}` : ''}</span> から
       <span class="range-em">${plan.end.chapter !== plan.start.chapter ? `第${plan.end.chapter}章 ` : ''}${plan.end.num || '章末'}</span> まで`
    : plan.achieved
      ? 'すべての範囲を読み終えています'
      : '未読の範囲はありません';

  // 前回閉じた位置があればそこへ、なければしおり(最後に読んだ段落)へ戻す
  const resumeCh = lastPos ? lastPos.chapter : bm?.chapter;
  const resumeHref = lastPos
    ? `#/ch/${lastPos.chapter}?resume=1`
    : bm
      ? `#/ch/${bm.chapter}?p=${encodeURIComponent(bm.pid)}`
      : null;
  const resumeHtml = resumeHref
    ? `
      <a class="resume-card" href="${resumeHref}">
        <span class="resume-icon"><svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4z"/></svg></span>
        <span class="resume-text">
          <span class="resume-label">${lastPos ? '前回の続きから' : '続きから読む'}</span>
          <span class="resume-loc">第${resumeCh}章 ${!lastPos && bm?.num ? `${bm.num} ` : ''}${esc(chapterShortTitle(resumeCh))}</span>
        </span>
        <span class="resume-arrow"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></span>
      </a>`
    : '';

  const cards = state.chapters
    .map((ch) => {
      const st = chapterState(ch.chapter);
      const prog = chapterProgress(ch.chapter);
      const stateLabel =
        st === 'done'
          ? '<svg viewBox="0 0 24 24"><path d="M4.5 12.5l5 5 10-11"/></svg>読了'
          : st === 'reading'
            ? '学習中'
            : '未読';
      return `
        <a class="ch-card ${st}" href="#/ch/${ch.chapter}">
          <span class="ch-card-art">${motifIcon(chapterMotifKey(ch.chapter), 46)}</span>
          <div class="ch-card-top">
            <span class="ch-card-no">${String(ch.chapter).padStart(2, '0')}</span>
            <span class="ch-card-state">${stateLabel}</span>
          </div>
          <div class="ch-card-title">${esc(chapterShortTitle(ch.chapter))}</div>
          <div class="ch-card-foot">
            <span class="ch-card-chars">${fmtNum(state.formatted.get(ch.chapter)?.charTotal || 0)}字</span>
            <span class="ch-mini-track"><span class="ch-mini-fill" style="width:${prog.pct}%"></span></span>
            <span class="ch-card-pct">${prog.pct}%</span>
          </div>
        </a>`;
    })
    .join('');

  const today = new Date();
  const wd = ['日', '月', '火', '水', '木', '金', '土'][today.getDay()];

  main().innerHTML = `
    <div class="container">
      <section class="home-hero">
        <div class="home-date">${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日(${wd})</div>
        <h1 class="home-greeting">データセンター運用ガイドブックを、毎日すこしずつ。</h1>
        <p class="home-sub">全13章・${fmtNum(state.totalChars)}字。今日の分だけ、静かに読み進めましょう。</p>
        <figure class="home-figure">${homeArt()}</figure>
      </section>

      <section class="today-card" aria-label="今日の学習">
        <div class="today-head">
          <span class="today-title">今日の学習</span>
          <span class="today-streak">継続 <strong>${state.streak.count}</strong> 日</span>
        </div>
        <p class="today-range">${rangeHtml}</p>
        <p class="today-meta">目安 ${fmtNum(plan.target)} 字 / 日</p>
        <div class="today-bar">
          <div class="bar-track"><div class="bar-fill ${plan.achieved ? 'done' : ''}" style="width:${plan.pct}%"></div></div>
          <span class="bar-pct ${plan.achieved ? 'done' : ''}">${plan.achieved ? '達成' : `${plan.pct}%`}</span>
        </div>
        ${plan.achieved && plan.todayChars > 0 ? '<p class="today-done-msg">今日のノルマを達成しました。おつかれさまです。</p>' : ''}
        <div class="today-actions">
          ${
            plan.start
              ? `<a class="btn btn-primary" href="#/ch/${plan.start.chapter}?p=${encodeURIComponent(plan.start.pid)}">
                   <svg viewBox="0 0 24 24"><path d="M8 5l8 7-8 7"/></svg>今日の範囲を読む</a>`
              : ''
          }
          ${
            lastPos
              ? `<a class="btn" href="#/ch/${lastPos.chapter}?resume=1">
                   <svg viewBox="0 0 24 24"><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3 4.5V9h4.5"/></svg>前回の続きから</a>`
              : ''
          }
          <button class="btn" id="btn-open-settings">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>目標を設定</button>
        </div>
      </section>

      ${resumeHtml}

      ${
        state.isSample
          ? `<div class="sample-banner"><strong>サンプルデータで動作中です。</strong>
             JDCC「データセンター運用ガイドブック」の原文を抽出した <code>chapters.json</code> を
             <code>data/</code> ディレクトリに配置すると、全13章・約58万字で学習できます。原文ファイルは読み取り専用として扱われます。</div>`
          : ''
      }

      <div class="section-label"><span>章 一 覧</span><small>全${state.chapters.length}章 ・ ${fmtNum(state.totalChars)}字</small></div>
      <div class="ch-grid">${cards}</div>
    </div>`;

  $('#btn-open-settings').onclick = openSettings;
}

/* ============ 用語集ページ ============ */

let occIndex = null;

/**
 * 用語 → 登場箇所の索引を、本文1パスで構築する。
 * 用語ごとに全文を走査すると語数×段落数の総当たりになり、
 * 語数が増えたときに用語集ページが開かなくなるため、
 * 全用語をまとめた1本の正規表現で一度だけ走査する。
 */
function buildOccIndex() {
  if (occIndex) return occIndex;
  occIndex = new Map();
  const terms = [...state.glossary].sort((a, b) => b.term.length - a.term.length);
  if (!terms.length) return occIndex;

  for (const g of terms) occIndex.set(g.term, []);
  const re = new RegExp(
    terms.map((t) => t.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'g'
  );
  // 同じ節に複数回出る用語は、最初の段落だけを代表として残す
  const seen = new Set();

  for (const f of state.formatted.values()) {
    let num = null;
    for (const b of f.blocks) {
      if (b.type === 'heading') {
        num = b.num;
        continue;
      }
      if (b.type !== 'para') continue;
      re.lastIndex = 0;
      let m;
      const hitsHere = new Set();
      while ((m = re.exec(b.text))) {
        if (hitsHere.has(m[0])) continue;
        hitsHere.add(m[0]);
        const key = `${m[0]}|${f.chapter}|${num || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        occIndex.get(m[0])?.push({ chapter: f.chapter, pid: b.pid, num });
      }
    }
  }
  return occIndex;
}

function termOccurrences(term) {
  return buildOccIndex().get(term) || [];
}

function renderGlossary(query) {
  const q = query.trim();
  const list = state.glossary.filter(
    (g) => !q || g.term.includes(q) || g.reading.includes(q) || g.desc.includes(q)
  );

  const items = list
    .map((g) => {
      const occ = termOccurrences(g.term);
      const chips = occ
        .slice(0, 8)
        .map(
          (o) =>
            `<a class="gl-occ-link" href="#/ch/${o.chapter}?p=${encodeURIComponent(o.pid)}">第${o.chapter}章${o.num ? ` ${o.num}` : ''}</a>`
        )
        .join('');
      const more = occ.length > 8 ? `<span class="gl-occ-more">ほか${occ.length - 8}箇所</span>` : '';
      const motif = matchMotif(g.term) || matchMotif(g.desc);
      return `
        <div class="gl-item">
          ${motif ? `<span class="gl-item-art">${motifIcon(motif, 40)}</span>` : ''}
          <div class="gl-item-body">
            <div class="gl-term">${esc(g.term)}<span class="gl-reading">${esc(g.reading)}</span></div>
            <div class="gl-desc">${esc(g.desc)}</div>
            ${occ.length ? `<div class="gl-occ">${chips}${more}</div>` : ''}
          </div>
        </div>`;
    })
    .join('');

  main().innerHTML = `
    <div class="container">
      <header class="page-head">
        <h1 class="page-title">用語集</h1>
        <p class="page-sub">${state.glossary.length}語を収録。本文中の点線下線の用語からも参照できます。</p>
      </header>
      <div class="search-box">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>
        <input id="gl-search" type="search" placeholder="用語・読み・解説文を検索" value="${esc(q)}" autocomplete="off">
      </div>
      <div id="gl-list">${items || '<div class="empty-state"><p>該当する用語がありません。</p></div>'}</div>
    </div>`;

  const input = $('#gl-search');
  input.addEventListener('input', () => {
    const nq = input.value;
    history.replaceState(null, '', `#/glossary${nq ? `?q=${encodeURIComponent(nq)}` : ''}`);
    const scroll = scrollY;
    renderGlossary(nq);
    $('#gl-search').focus();
    const el = $('#gl-search');
    el.setSelectionRange(el.value.length, el.value.length);
    scrollTo(0, scroll);
  });
  if (q) input.focus();
}

/* ============ マーカー一覧ページ ============ */

async function renderHighlightsPage() {
  const all = (await db.highlights.all()).sort((a, b) => b.createdAt - a.createdAt);

  const items = all
    .map((h) => {
      const f = state.formatted.get(h.chapterId);
      const block = f?.blocks.find((b) => b.type === 'para' && b.pid === h.paragraphId);
      let quote = esc(h.excerpt || '');
      if (block) {
        const t = block.text;
        const s = Math.max(0, h.startOffset - 40);
        const e = Math.min(t.length, h.endOffset + 40);
        quote =
          (s > 0 ? '…' : '') +
          esc(t.slice(s, h.startOffset)) +
          `<mark>${esc(t.slice(h.startOffset, h.endOffset))}</mark>` +
          esc(t.slice(h.endOffset, e)) +
          (e < t.length ? '…' : '');
      }
      const d = new Date(h.createdAt);
      return `
        <a class="mark-item" href="#/ch/${h.chapterId}?p=${encodeURIComponent(h.paragraphId)}">
          <div class="item-loc">第${h.chapterId}章 ${esc(chapterShortTitle(h.chapterId))}</div>
          <div class="mark-quote">${quote}</div>
          <div class="item-date">${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}</div>
        </a>`;
    })
    .join('');

  main().innerHTML = `
    <div class="container">
      <header class="page-head">
        <h1 class="page-title">マーカー</h1>
        <p class="page-sub">本文を選択して引いたマーカーの一覧。タップで該当箇所へ移動します。</p>
      </header>
      ${
        items ||
        `<div class="empty-state">
           <svg viewBox="0 0 24 24"><path d="M9 15l-4 5h6l1-2M9 15L18 4l3 3-9 11M9 15l3 3"/></svg>
           <p>まだマーカーがありません。<br>本文のテキストを選択すると、マーカーを引けます。</p>
         </div>`
      }
    </div>`;
}

/* ============ メモ一覧ページ ============ */

async function renderNotesPage() {
  const all = (await db.notes.all()).sort((a, b) => b.updatedAt - a.updatedAt);

  const items = all
    .map((n) => {
      const f = state.formatted.get(n.chapterId);
      const block = f?.blocks.find((b) => b.type === 'para' && b.pid === n.paragraphId);
      const quote = block ? block.text.slice(0, 64) + (block.text.length > 64 ? '…' : '') : '';
      const d = new Date(n.updatedAt);
      return `
        <a class="note-item" href="#/ch/${n.chapterId}?p=${encodeURIComponent(n.paragraphId)}">
          <div class="item-loc">第${n.chapterId}章 ${esc(chapterShortTitle(n.chapterId))}</div>
          ${quote ? `<div class="note-quote">${esc(quote)}</div>` : ''}
          <div class="note-body">${esc(n.body)}</div>
          <div class="item-date">${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} 更新</div>
        </a>`;
    })
    .join('');

  main().innerHTML = `
    <div class="container">
      <header class="page-head">
        <h1 class="page-title">余白ノート</h1>
        <p class="page-sub">段落の余白に書いたメモの一覧。タップで該当箇所へ移動します。</p>
      </header>
      ${
        items ||
        `<div class="empty-state">
           <svg viewBox="0 0 24 24"><path d="M5 4h14v13l-4 3H5z"/><path d="M15 20v-3h4"/></svg>
           <p>まだメモがありません。<br>段落にポインタを重ねるとペンアイコンが現れます。</p>
         </div>`
      }
    </div>`;
}

/* ============ 学習設定モーダル ============ */

function openSettings() {
  const s = state.settings;
  const bd = $('#modal-backdrop');
  const modal = $('#modal');
  bd.hidden = false;

  const render = (mode) => {
    const isChars = mode === 'chars';
    modal.innerHTML = `
      <h2>学習の目標</h2>
      <p class="modal-sub">1日の目安から、今日読む範囲(章・節)を自動で提案します。</p>
      <div class="field">
        <div class="radio-row">
          <label class="radio-pill ${isChars ? 'on' : ''}" data-mode="chars"><input type="radio" name="mode" ${isChars ? 'checked' : ''}>1日あたりの文字数</label>
          <label class="radio-pill ${!isChars ? 'on' : ''}" data-mode="days"><input type="radio" name="mode" ${!isChars ? 'checked' : ''}>目標日数</label>
        </div>
      </div>
      <div class="field">
        <label for="goal-value">${isChars ? '1日に読む目安(字)' : '読み終えるまでの日数(日)'}</label>
        <input id="goal-value" type="number" min="${isChars ? 200 : 1}" max="${isChars ? 50000 : 730}"
               value="${isChars ? (s.mode === 'chars' ? s.value : 3000) : s.mode === 'days' ? s.value : 90}">
        <p class="field-note" id="goal-preview"></p>
      </div>
      <div class="field">
        <label>本文の幅</label>
        <div class="radio-row" id="width-row">
          <label class="radio-pill" data-w="narrow">標準</label>
          <label class="radio-pill" data-w="wide">広い</label>
          <label class="radio-pill" data-w="full">最大</label>
        </div>
        <p class="field-note" id="width-note"></p>
      </div>
      <div class="field">
        <label>文字の大きさ</label>
        <div class="radio-row" id="font-row">
          <label class="radio-pill" data-f="small" style="font-size:11.5px">小</label>
          <label class="radio-pill" data-f="medium" style="font-size:13px">標準</label>
          <label class="radio-pill" data-f="large" style="font-size:15px">大</label>
        </div>
        <p class="field-note" id="font-note"></p>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="settings-cancel">キャンセル</button>
        <button class="btn btn-primary" id="settings-save">保存</button>
      </div>`;

    // 本文の幅はその場で反映して、見ながら選べるようにする
    const widthNotes = {
      narrow: '1行あたり約60文字。読みやすさを優先します。',
      wide: '1行あたり約80文字。広い画面の余白を減らします。',
      full: '画面の横幅をほぼ使い切ります。ワイドモニター向け。',
    };
    const paintWidth = (key) => {
      modal.querySelectorAll('#width-row .radio-pill').forEach((p) => {
        p.classList.toggle('on', p.dataset.w === key);
      });
      $('#width-note').textContent = widthNotes[key];
    };
    paintWidth(currentReadingWidth());
    modal.querySelectorAll('#width-row .radio-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        applyReadingWidth(pill.dataset.w);
        paintWidth(pill.dataset.w);
      });
    });

    // 文字の大きさも、その場で反映して見ながら選べるようにする
    const fontNotes = {
      small: '本文 15px。1画面に多くを収めたいとき。',
      medium: '本文 16.5px。長く読んでも疲れにくい標準。',
      large: '本文 18.5px。大きめの文字でゆったり読みたいとき。',
    };
    const paintFont = (key) => {
      modal.querySelectorAll('#font-row .radio-pill').forEach((p) => {
        p.classList.toggle('on', p.dataset.f === key);
      });
      $('#font-note').textContent = fontNotes[key];
    };
    paintFont(currentFontSize());
    modal.querySelectorAll('#font-row .radio-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        applyFontSize(pill.dataset.f);
        paintFont(pill.dataset.f);
      });
    });

    const input = $('#goal-value');
    const preview = $('#goal-preview');
    const updatePreview = () => {
      const v = Math.max(1, input.value | 0);
      const remaining = Math.max(0, state.totalChars - totalReadChars());
      preview.textContent = isChars
        ? `残り${fmtNum(remaining)}字 → 約${Math.ceil(remaining / Math.max(200, v))}日で読了の見込み`
        : `残り${fmtNum(remaining)}字 → 1日あたり約${fmtNum(Math.ceil(remaining / v))}字`;
    };
    input.addEventListener('input', updatePreview);
    updatePreview();

    // 目標モードの切り替えは data-mode を持つピルのみ
    // (幅・文字サイズのピルまで拾うと、クリックのたびにモーダルが壊れる)
    modal.querySelectorAll('.radio-pill[data-mode]').forEach((pill) => {
      pill.addEventListener('click', () => render(pill.dataset.mode));
    });
    $('#settings-cancel').onclick = close;
    $('#settings-save').onclick = async () => {
      const v = Math.max(1, input.value | 0);
      state.settings = { mode, value: v };
      await db.kv.set('settings', state.settings);
      close();
      toast('目標を保存しました');
      route();
    };
  };

  const close = () => (bd.hidden = true);
  bd.onclick = (e) => {
    if (e.target === bd) close();
  };
  render(s.mode);
}

/* ============ 目次スパイ(右パネル) ============ */

let tocObserver = null;

function bindTocSpy() {
  if (tocObserver) tocObserver.disconnect();
  const headings = document.querySelectorAll('#prose h2, #prose h3, #prose h4');
  if (!headings.length) return;
  tocObserver = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (en.isIntersecting) {
          document.querySelectorAll('.rp-toc a').forEach((a) => {
            a.classList.toggle('current', a.dataset.toc === en.target.id);
          });
        }
      }
    },
    { rootMargin: '-10% 0px -70% 0px' }
  );
  headings.forEach((h) => tocObserver.observe(h));
}

/* ============ ドロワー / 集中モード ============ */

function closeDrawer() {
  document.body.classList.remove('drawer-open');
  document.body.classList.remove('panel-open');
}

/* ============ メモパッド ============ */

let notepadTimer = null;

async function initNotepad() {
  const body = $('#notepad-body');
  const status = $('#notepad-status');
  const count = $('#notepad-count');

  const saved = await db.kv.get('notepad');
  body.value = saved || '';
  const updateCount = () => (count.textContent = `${fmtNum(body.value.length)} 字`);
  updateCount();

  body.addEventListener('input', () => {
    updateCount();
    status.textContent = '入力中…';
    status.style.opacity = '1';
    clearTimeout(notepadTimer);
    notepadTimer = setTimeout(async () => {
      await db.kv.set('notepad', body.value);
      status.textContent = '保存しました';
      setTimeout(() => (status.style.opacity = '0'), 1400);
    }, 600);
  });

  $('#notepad-close').onclick = () => toggleNotepad(false);
  $('#notepad-clear').onclick = async () => {
    if (!body.value.trim() || !confirm('メモパッドの内容をすべて消去しますか?')) return;
    body.value = '';
    updateCount();
    await db.kv.set('notepad', '');
    toast('メモパッドを消去しました');
  };

  if (localStorage.getItem('notepad-open')) toggleNotepad(true);
}

let notepadHideTimer = null;

function toggleNotepad(open) {
  const el = $('#notepad');
  const on = open ?? !document.body.classList.contains('notepad-open');
  $('#btn-notepad').classList.toggle('active', on);
  localStorage.setItem('notepad-open', on ? '1' : '');
  clearTimeout(notepadHideTimer);

  if (on) {
    // 閉じている間は DOM から外しておく(画面幅の計算に影響させないため)
    el.hidden = false;
    requestAnimationFrame(() => {
      document.body.classList.add('notepad-open');
      setTimeout(() => $('#notepad-body').focus(), 320);
    });
  } else {
    document.body.classList.remove('notepad-open');
    notepadHideTimer = setTimeout(() => {
      if (!document.body.classList.contains('notepad-open')) el.hidden = true;
    }, 340);
  }
}

function bindChrome() {
  $('#btn-drawer').onclick = () => document.body.classList.toggle('drawer-open');
  $('#drawer-backdrop').onclick = () => {
    closeDrawer();
    document.body.classList.remove('panel-open');
  };
  $('#btn-panel').onclick = () => document.body.classList.toggle('panel-open');
  $('#btn-notepad').onclick = () => toggleNotepad();

  const btnTts = $('#btn-tts');
  if (tts.isSupported) {
    bindTtsBar();
    // ポインタが乗った時点で音声エンジンを温めておき、押した瞬間に声が出るようにする
    btnTts.addEventListener('pointerenter', () => tts.prewarm(), { once: true });
    btnTts.onclick = () => {
      const r = parseHash();
      const no = r && r.seg[0] === 'ch' ? parseInt(r.seg[1], 10) : null;
      if (!no) {
        toast('章を開いてから読み上げを始めてください');
        return;
      }
      toggleSpeech(no);
    };
  } else {
    btnTts.hidden = true;
  }
  $('#rightpanel').addEventListener('click', (e) => {
    if (e.target.closest('a')) document.body.classList.remove('panel-open');
  });
  $('#sidebar').addEventListener('click', (e) => {
    if (e.target.closest('a')) closeDrawer();
  });

  $('#btn-theme').onclick = () => {
    const cur = document.documentElement.dataset.theme;
    const next = cur === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', next);
    applyTheme();
  };

  $('#btn-focus').onclick = () => {
    const on = document.body.classList.toggle('focus-mode');
    localStorage.setItem('focus', on ? '1' : '');
    $('#btn-focus').classList.toggle('active', on);
  };
  if (localStorage.getItem('focus')) {
    document.body.classList.add('focus-mode');
    $('#btn-focus').classList.add('active');
  }

  $('#btn-settings').onclick = openSettings;

  // スマホ用ボトムナビ
  const nav = document.createElement('nav');
  nav.className = 'bottom-nav';
  nav.innerHTML = `
    <a href="#/" data-nav="home"><svg viewBox="0 0 24 24"><path d="M5 4h14v16l-7-4-7 4z"/></svg>章一覧</a>
    <a href="#/glossary" data-nav="glossary"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>用語集</a>
    <a href="#/highlights" data-nav="highlights"><svg viewBox="0 0 24 24"><path d="M9 15l-4 5h6l1-2M9 15L18 4l3 3-9 11M9 15l3 3"/></svg>マーカー</a>
    <a href="#/notes" data-nav="notes"><svg viewBox="0 0 24 24"><path d="M5 4h14v13l-4 3H5z"/><path d="M15 20v-3h4"/></svg>メモ</a>`;
  document.body.appendChild(nav);
}

/* ============ iOS ホーム画面追加の案内 ============ */

function iosInstallHint() {
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (!isIos || standalone || localStorage.getItem('ios-hint-done')) return;
  setTimeout(() => {
    openSheet(`
      <div style="font-size:14px;font-weight:700;margin-bottom:8px">ホーム画面に追加できます</div>
      <p style="font-size:13px;line-height:1.8;color:var(--ink-soft)">
        Safari の共有ボタン(<span style="display:inline-block;transform:translateY(2px)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3v12M8 7l4-4 4 4M5 12v8h14v-8"/></svg></span>)から
        「ホーム画面に追加」を選ぶと、アプリとしてオフラインでも読めます。
      </p>
      <div class="note-box-foot" style="margin-top:14px">
        <button class="btn btn-sm btn-primary" id="ios-hint-ok">わかりました</button>
      </div>`);
    $('#ios-hint-ok').onclick = () => {
      localStorage.setItem('ios-hint-done', '1');
      closeSheet();
    };
  }, 2200);
}

/* ============ 起動 ============ */

async function boot() {
  try {
    await loadAll();
  } catch (e) {
    console.error(e);
    main().innerHTML = `
      <div class="container"><div class="empty-state" style="padding-top:100px">
        <p>データの読み込みに失敗しました。<br><code>data/chapters.json</code> が配置されているか確認してください。</p>
      </div></div>`;
    return;
  }

  bindChrome();
  initNotepad();
  addEventListener('hashchange', route);
  document.addEventListener('progress-changed', () => {
    updateQuotaBar();
    renderSidebar();
  });
  await route();
  iosInstallHint();
  initSync(); // Firebase設定があれば端末間同期を開始(なければローカルのみ)

  // 音声リストの解決はブラウザ側が非同期に行うため、起動直後に始めておく。
  // これで最初の「再生」を押したときの待ちがほぼなくなる。
  if (tts.isSupported) {
    requestIdleCallback
      ? requestIdleCallback(() => tts.loadVoices())
      : setTimeout(() => tts.loadVoices(), 300);
  }

  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('sw.js');
    } catch (e) {
      console.warn('SW registration failed', e);
    }
  }
}

boot();
