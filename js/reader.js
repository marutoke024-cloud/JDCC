/*
 * reader.js — 章読書ビュー
 * 本文表示 / マーカー / 余白ノート / 用語ホバー解説 / 読了トラッキング / 章末サマリー
 */
import {
  state, esc, fmtNum, toast,
  markParagraphRead, saveBookmark, saveLastPosition,
  chapterProgress, setChapterDone, chapterShortTitle,
} from './state.js';
import * as db from './db.js';
import { chapterHero, sectionVignette, matchMotif } from './art.js';
import * as tts from './tts.js';

const isTouch = matchMedia('(pointer: coarse)').matches;

let currentObserver = null;
let currentChapter = null;
let pendingTimers = new Map();

/* ============ 用語マッチング ============ */

let termRegex = null;
let termIndex = new Map();

function buildTermRegex() {
  if (termRegex || !state.glossary.length) return;
  const terms = [...state.glossary].sort((a, b) => b.term.length - a.term.length);
  terms.forEach((t) => termIndex.set(t.term, t));
  const pattern = terms
    .map((t) => t.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  termRegex = new RegExp(pattern, 'g');
}

/** 要素内のテキストノードに用語の点線下線を付ける */
function annotateTerms(root) {
  buildTermRegex();
  if (!termRegex) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      if (n.parentElement.closest('.term')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  for (const node of nodes) {
    const text = node.nodeValue;
    termRegex.lastIndex = 0;
    let m;
    let last = 0;
    let frag = null;
    while ((m = termRegex.exec(text))) {
      if (!frag) frag = document.createDocumentFragment();
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const span = document.createElement('span');
      span.className = 'term';
      span.dataset.term = m[0];
      span.textContent = m[0];
      frag.appendChild(span);
      last = m.index + m[0].length;
    }
    if (frag) {
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    }
  }
}

/* ============ 用語ポップオーバー / シート ============ */

const popover = () => document.getElementById('popover');
let popTimer = null;

function showTermPopup(termEl) {
  const entry = termIndex.get(termEl.dataset.term);
  if (!entry) return;
  const html = `
    <div class="gl-term">${esc(entry.term)}<span class="gl-reading">${esc(entry.reading)}</span></div>
    <div class="gl-desc">${esc(entry.desc)}</div>
    <a class="popover-link" href="#/glossary?q=${encodeURIComponent(entry.term)}">用語集で見る →</a>`;

  if (isTouch && innerWidth < 768) {
    openSheet(`<div class="gl-item" style="border:0;padding:4px 0">${html}</div>`);
    return;
  }
  const pop = popover();
  pop.innerHTML = html;
  pop.hidden = false;
  const r = termEl.getBoundingClientRect();
  const pw = Math.min(320, innerWidth - 32);
  let left = r.left + scrollX + r.width / 2 - pw / 2;
  left = Math.max(16, Math.min(left, scrollX + innerWidth - pw - 16));
  let top = r.bottom + scrollY + 8;
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  const ph = pop.offsetHeight;
  if (r.bottom + 8 + ph > innerHeight) pop.style.top = `${r.top + scrollY - ph - 8}px`;
}

function hideTermPopup() {
  popover().hidden = true;
}

function bindTermEvents(root) {
  // タッチ/ペンは pointerup で拾う。
  // click はタップ中に文字選択が始まると発火しないことがあり、
  // iPadで「タップしても出ない」取りこぼしの原因になる。
  root.addEventListener(
    'pointerup',
    (e) => {
      if (e.pointerType === 'mouse') return; // マウスはホバーで表示する
      const t = e.target.closest('.term');
      if (!t) return;
      const sel = getSelection();
      if (sel && !sel.isCollapsed) return; // 文字を選択中なら邪魔しない
      showTermPopup(t);
    },
    true // 途中で止められないよう捕捉フェーズで受ける
  );

  // マウス: ホバーで表示
  root.addEventListener('mouseover', (e) => {
    const t = e.target.closest('.term');
    if (t) {
      clearTimeout(popTimer);
      popTimer = setTimeout(() => showTermPopup(t), 180);
    }
  });
  root.addEventListener('mouseout', (e) => {
    if (e.target.closest('.term')) {
      clearTimeout(popTimer);
      popTimer = setTimeout(() => {
        if (!popover().matches(':hover')) hideTermPopup();
      }, 250);
    }
  });
  popover().addEventListener('mouseleave', () => hideTermPopup());
}

/** 画面のどこかを触れば閉じる。スクロールでも閉じる(位置がずれるため) */
function bindPopupDismiss() {
  const dismiss = (e) => {
    const pop = popover();
    if (pop.hidden) return;
    const el = e && e.target && e.target.closest ? e.target : null;
    if (el) {
      if (el.closest('.popover')) return; // ポップアップ内の操作は残す
      if (el.closest('.term')) return; // 別の用語は表示側で差し替える
    }
    clearTimeout(popTimer);
    hideTermPopup();
  };
  document.addEventListener('pointerdown', dismiss, true);
  document.addEventListener('scroll', () => dismiss(), { passive: true, capture: true });
  addEventListener('resize', () => dismiss());
  addEventListener('hashchange', () => dismiss());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') dismiss();
  });
}
bindPopupDismiss();

/* ============ ボトムシート ============ */

export function openSheet(html) {
  const sheet = document.getElementById('sheet');
  const bd = document.getElementById('sheet-backdrop');
  sheet.innerHTML = `<div class="sheet-grip"></div>${html}`;
  sheet.hidden = false;
  bd.hidden = false;
  bd.onclick = closeSheet;
}

export function closeSheet() {
  document.getElementById('sheet').hidden = true;
  document.getElementById('sheet-backdrop').hidden = true;
}

/* ============ マーカー(範囲の保存と復元) ============ */

/** 段落要素内のテキスト位置 → Range 変換で <mark> を巻く */
function wrapRange(paraEl, start, end, hlId) {
  const walker = document.createTreeWalker(paraEl, NodeFilter.SHOW_TEXT);
  let offset = 0;
  const targets = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const len = node.nodeValue.length;
    const nodeStart = offset;
    const nodeEnd = offset + len;
    if (nodeEnd > start && nodeStart < end) {
      targets.push({ node, from: Math.max(0, start - nodeStart), to: Math.min(len, end - nodeStart) });
    }
    offset = nodeEnd;
    if (nodeStart >= end) break;
  }
  for (const t of targets) {
    if (t.node.parentElement.closest('mark.hl')) continue;
    const range = document.createRange();
    range.setStart(t.node, t.from);
    range.setEnd(t.node, t.to);
    const mark = document.createElement('mark');
    mark.className = 'hl';
    mark.dataset.hlid = hlId;
    try {
      range.surroundContents(mark);
    } catch {
      /* 分割不能なケースはスキップ */
    }
  }
}

/** Selection Range → 段落内オフセット */
function rangeOffsets(paraEl, range) {
  const pre = document.createRange();
  pre.selectNodeContents(paraEl);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  const len = range.toString().length;
  return { start, end: start + len };
}

async function applyStoredHighlights(chapterNo, proseEl) {
  const all = await db.highlights.all();
  const mine = all.filter((h) => h.chapterId === chapterNo);
  for (const h of mine) {
    const para = proseEl.querySelector(`[data-pid="${h.paragraphId}"]`);
    if (para) wrapRange(para, h.startOffset, h.endOffset, h.id);
  }
}

function bindSelectionTool(proseEl, chapterNo) {
  const tool = document.getElementById('selection-tool');
  const btn = document.getElementById('btn-mark');

  const hideTool = () => (tool.hidden = true);

  document.addEventListener('selectionchange', () => {
    const sel = getSelection();
    if (!sel || sel.isCollapsed) hideTool();
  });

  proseEl.addEventListener('pointerup', () => {
    setTimeout(() => {
      const sel = getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return hideTool();
      const range = sel.getRangeAt(0);
      const startPara = range.startContainer.parentElement?.closest('.para');
      const endPara = range.endContainer.parentElement?.closest('.para');
      if (!startPara || startPara !== endPara || !proseEl.contains(startPara)) return hideTool();
      if (!range.toString().trim()) return hideTool();

      const r = range.getBoundingClientRect();
      tool.hidden = false;
      const tw = tool.offsetWidth || 110;
      tool.style.left = `${Math.max(12, Math.min(r.left + scrollX + r.width / 2 - tw / 2, scrollX + innerWidth - tw - 12))}px`;
      tool.style.top = `${r.top + scrollY - 46}px`;

      btn.onclick = async () => {
        const offs = rangeOffsets(startPara, range);
        const rec = {
          chapterId: chapterNo,
          paragraphId: startPara.dataset.pid,
          startOffset: offs.start,
          endOffset: offs.end,
          color: 'accent', // 将来の複数色対応を見越したフィールド
          excerpt: range.toString().slice(0, 120),
        };
        const id = await db.highlights.add(rec);
        wrapRange(startPara, offs.start, offs.end, id);
        sel.removeAllRanges();
        hideTool();
        toast('マーカーを保存しました');
      };
    }, 10);
  });

  // 既存マーカーのタップ → 削除
  proseEl.addEventListener('click', async (e) => {
    const mark = e.target.closest('mark.hl');
    if (!mark) return;
    const id = Number(mark.dataset.hlid);
    if (!confirm('このマーカーを削除しますか?')) return;
    await db.highlights.remove(id);
    document.querySelectorAll(`mark.hl[data-hlid="${id}"]`).forEach((m) => {
      const parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      m.remove();
      parent.normalize();
    });
    toast('マーカーを削除しました');
  });
}

/* ============ 余白ノート ============ */

async function openNoteEditor(paraEl, chapterNo) {
  const pid = paraEl.dataset.pid;
  const existing = await db.notes.get(pid);
  const bodyHtml = `
    <div class="note-box" data-note-for="${esc(pid)}">
      <textarea placeholder="この段落についてのメモ…">${esc(existing?.body || '')}</textarea>
      <div class="note-box-foot">
        ${existing ? '<button class="btn btn-sm btn-ghost" data-act="delete">削除</button>' : ''}
        <button class="btn btn-sm btn-ghost" data-act="close">閉じる</button>
        <button class="btn btn-sm btn-primary" data-act="save">保存</button>
      </div>
    </div>`;

  const finish = async (box, act) => {
    if (act === 'save') {
      const body = box.querySelector('textarea').value.trim();
      if (body) {
        await db.notes.put({ chapterId: chapterNo, paragraphId: pid, body });
        toast('メモを保存しました');
      } else if (existing) {
        await db.notes.remove(pid);
      }
    } else if (act === 'delete') {
      await db.notes.remove(pid);
      toast('メモを削除しました');
    }
    updatePenState(paraEl, pid);
  };

  if (isTouch && innerWidth < 768) {
    openSheet(`<div style="font-size:13px;font-weight:600;margin-bottom:2px">余白ノート</div>${bodyHtml}`);
    const box = document.querySelector('#sheet .note-box');
    box.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      await finish(box, act);
      closeSheet();
    });
    box.querySelector('textarea').focus();
    return;
  }

  // PC / iPad: インライン展開(広幅時はCSSで右余白に配置)
  const old = document.querySelector(`.note-box[data-note-for="${CSS.escape(pid)}"]`);
  if (old) {
    old.remove();
    return;
  }
  paraEl.insertAdjacentHTML('afterend', bodyHtml);
  const box = paraEl.nextElementSibling;
  box.style.setProperty('--note-top', `${paraEl.offsetTop}px`);
  box.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    await finish(box, act);
    box.remove();
  });
  box.querySelector('textarea').focus();
}

async function updatePenState(paraEl, pid) {
  const pen = paraEl.querySelector('.note-pen');
  if (!pen) return;
  const note = await db.notes.get(pid);
  pen.classList.toggle('has-note', !!note);
  pen.title = note ? 'メモを編集' : 'メモを書く';
}

/* ============ 読了トラッキング & しおり ============ */

let bookmarkTimer = null;

function observeParagraphs(proseEl, chapterNo) {
  if (currentObserver) currentObserver.disconnect();
  pendingTimers.forEach((t) => clearTimeout(t));
  pendingTimers.clear();

  currentObserver = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        const pid = en.target.dataset.pid;
        const chars = Number(en.target.dataset.chars) || 0;
        if (en.isIntersecting && en.intersectionRatio >= 0.55) {
          // 1.4秒視界に留まったら既読
          if (!pendingTimers.has(pid)) {
            pendingTimers.set(
              pid,
              setTimeout(async () => {
                pendingTimers.delete(pid);
                const isNew = await markParagraphRead(chapterNo, pid, chars);
                if (isNew) document.dispatchEvent(new CustomEvent('progress-changed'));
              }, 1400)
            );
          }
          // しおり自動保存(最後に視界に入った段落)
          clearTimeout(bookmarkTimer);
          bookmarkTimer = setTimeout(() => saveBookmark(chapterNo, pid), 900);
        } else if (pendingTimers.has(pid)) {
          clearTimeout(pendingTimers.get(pid));
          pendingTimers.delete(pid);
        }
      }
    },
    { threshold: [0, 0.55, 1] }
  );
  proseEl.querySelectorAll('.para[data-pid]').forEach((p) => currentObserver.observe(p));
}

/* ============ 読書位置の記録 ============ */

let posTimer = null;
let posHandler = null;

/** 画面上端にいちばん近い段落と、そこからのずれを求める */
function currentReadingAnchor() {
  const paras = document.querySelectorAll('#prose .para[data-pid]');
  const top = (document.querySelector('.topbar')?.offsetHeight || 52) + 8;
  let anchor = null;
  for (const p of paras) {
    const r = p.getBoundingClientRect();
    if (r.bottom > top) {
      anchor = { pid: p.dataset.pid, offset: Math.round(r.top - top) };
      break;
    }
  }
  return anchor;
}

/** スクロールを追いかけて、前回位置として保存する */
function trackReadingPosition(chapterNo) {
  if (posHandler) removeEventListener('scroll', posHandler);
  posHandler = () => {
    clearTimeout(posTimer);
    posTimer = setTimeout(() => {
      const a = currentReadingAnchor();
      if (a) saveLastPosition(chapterNo, a.pid, a.offset, Math.round(scrollY));
    }, 350);
  };
  addEventListener('scroll', posHandler, { passive: true });
  // 閉じる直前にも取りこぼしなく残す
  addEventListener('pagehide', () => {
    const a = currentReadingAnchor();
    if (a) saveLastPosition(chapterNo, a.pid, a.offset, Math.round(scrollY));
  });
}

/** 保存した位置へ戻す。段落IDが基準なので文字サイズを変えていてもずれない */
export function restoreReadingPosition(pos) {
  const el = pos.pid ? document.getElementById(pos.pid) : null;
  if (el) {
    const top = (document.querySelector('.topbar')?.offsetHeight || 52) + 8;
    const y = scrollY + el.getBoundingClientRect().top - top - (pos.offset || 0);
    scrollTo({ top: Math.max(0, y), behavior: 'auto' });
  } else if (typeof pos.y === 'number') {
    scrollTo({ top: pos.y, behavior: 'auto' });
  }
}

/* ============ 章末サマリー ============ */

async function renderSummaryBox(el, chapterNo) {
  const rec = await db.summaries.get(chapterNo);
  const base = state.baseSummaries[String(chapterNo)] || [];
  const edited = !!rec?.items;
  const items = edited ? rec.items : base;

  el.innerHTML = `
    <div class="summary-head">
      <span class="summary-title">この章のまとめ</span>
      <span class="summary-badge">原文外</span>
      <span class="summary-source">${edited ? '自分で編集' : '本文の読解による要約'}</span>
      <button class="btn btn-sm btn-ghost" data-act="edit">編集</button>
      ${edited && base.length ? '<button class="btn btn-sm btn-ghost" data-act="reset">元に戻す</button>' : ''}
    </div>
    ${
      items.length
        ? `<ul class="summary-list">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
        : '<p class="summary-empty">この章のまとめはまだありません。</p>'
    }`;

  el.querySelector('[data-act="edit"]').onclick = () => {
    el.innerHTML = `
      <div class="summary-head">
        <span class="summary-title">この章のまとめ</span>
        <span class="summary-badge">原文外</span>
      </div>
      <textarea>${esc(items.join('\n'))}</textarea>
      <p class="summary-hint">1行が1項目になります。原文とは別に保存され、原文には影響しません。</p>
      <div class="note-box-foot" style="margin-top:10px">
        <button class="btn btn-sm btn-ghost" data-act="cancel">キャンセル</button>
        <button class="btn btn-sm btn-primary" data-act="save">保存</button>
      </div>`;
    el.querySelector('textarea').focus();
    el.querySelector('[data-act="cancel"]').onclick = () => renderSummaryBox(el, chapterNo);
    el.querySelector('[data-act="save"]').onclick = async () => {
      const lines = el
        .querySelector('textarea')
        .value.split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      await db.summaries.put({ chapter: chapterNo, items: lines });
      toast('まとめを保存しました');
      renderSummaryBox(el, chapterNo);
    };
  };

  const resetBtn = el.querySelector('[data-act="reset"]');
  if (resetBtn) {
    resetBtn.onclick = async () => {
      if (!confirm('編集内容を破棄して、もとのまとめに戻しますか?')) return;
      await db.summaries.remove(chapterNo);
      toast('もとのまとめに戻しました');
      renderSummaryBox(el, chapterNo);
    };
  }
}

/* ============ ブロック描画 ============ */

function blockHtml(b) {
  if (b.type === 'heading') {
    const tag = `h${b.level}`;
    return `<${tag} id="${esc(b.id)}"><span class="h-num">${esc(b.num)}</span><span>${esc(b.text)}</span></${tag}>`;
  }
  const sentences = b.sentences
    .map((s) => `<span class="s${s.em ? ' em' : ''}">${esc(s.t)}</span>`)
    .join('');
  return `
    <div class="para" id="${esc(b.pid)}" data-pid="${esc(b.pid)}" data-chars="${b.chars}">
      ${sentences}
      <button class="note-pen" title="メモを書く" aria-label="この段落にメモ">
        <svg viewBox="0 0 24 24"><path d="M14.5 5.5l4 4L8 20l-4.7.7L4 16z"/><path d="M12.5 7.5l4 4"/></svg>
      </button>
    </div>`;
}

/**
 * 本文ブロック列 → HTML。
 * 見出し(節)の内容にマッチした挿絵を、節の直後に差し込む。
 * 同じモチーフの連続は避け、章あたりの枚数も抑えて紙面を静かに保つ。
 */
function proseHtml(blocks) {
  const MAX_HEADING_VIGNETTES = 14;
  let html = '';
  let lastMotif = null;
  let used = 0;
  let firstHeading = true;
  let sinceLastArt = 99; // 直前の図版からのブロック数(密集を防ぐ)

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];

    // 図表キャプションの位置には、内容に合ったイラストを置く
    if (b.type === 'figure') {
      const key =
        matchMotif(b.caption) ||
        matchMotif(blocks[i - 1]?.type === 'para' ? blocks[i - 1].text.slice(-160) : '') ||
        lastMotif;
      // 同じ絵が続く場合や直前に図版を置いたばかりの場合は控える
      if (key && (key !== lastMotif || sinceLastArt > 6) && sinceLastArt >= 2) {
        html += `<figure class="vignette" aria-hidden="true">${sectionVignette(key)}</figure>`;
        lastMotif = key;
        sinceLastArt = 0;
      }
      continue;
    }

    html += blockHtml(b);
    sinceLastArt++;

    if (b.type !== 'heading' || used >= MAX_HEADING_VIGNETTES) continue;
    // 章の最初の節は扉絵と近すぎるため挿絵を入れない
    if (firstHeading) {
      firstHeading = false;
      continue;
    }
    // 見出し + 直後の段落テキストからモチーフを決める
    const nextPara = blocks[i + 1]?.type === 'para' ? blocks[i + 1].text : '';
    const key = matchMotif(b.text + ' ' + nextPara.slice(0, 120));
    if (key && key !== lastMotif && sinceLastArt >= 2) {
      html += `<figure class="vignette" aria-hidden="true">${sectionVignette(key)}</figure>`;
      lastMotif = key;
      used++;
      sinceLastArt = 0;
    }
  }
  return html;
}

/* ============ メインの描画 ============ */

export async function renderReader(main, no, targetPid, resumePos) {
  currentChapter = no;
  const f = state.formatted.get(no);
  if (!f) {
    main.innerHTML = '<div class="container"><p style="padding:60px 0">章が見つかりません。</p></div>';
    return;
  }
  const prog = chapterProgress(no);
  const prev = state.chapters.find((c) => c.chapter === no - 1);
  const next = state.chapters.find((c) => c.chapter === no + 1);

  main.innerHTML = `
    <article class="reader container">
      <header>
        <div class="reader-chapter-label">CHAPTER ${String(no).padStart(2, '0')}</div>
        <h1 class="reader-title">${esc(chapterShortTitle(no))}</h1>
        <div class="reader-meta">
          <span>${fmtNum(f.charTotal)} 字</span>
          <span>進捗 ${prog.pct}%</span>
        </div>
      </header>
      <hr class="reader-rule">
      <figure class="hero-figure">${chapterHero(no)}</figure>
      <div class="prose" id="prose">
        ${proseHtml(f.blocks)}
      </div>
      ${
        f.appendix.length
          ? `<section class="appendix"><div class="appendix-label">付 録(学習対象外)</div>${f.appendix
              .map((b) => (b.type === 'para' ? `<div class="para">${b.sentences.map((s) => `<span class="s">${esc(s.t)}</span>`).join('')}</div>` : ''))
              .join('')}</section>`
          : ''
      }
      <section class="summary-box" id="summary-box" aria-label="この章のまとめ(原文外)"></section>
      <div class="done-toggle">
        <button class="btn ${prog.done ? '' : 'btn-primary'}" id="btn-done">
          ${prog.done ? '読了を取り消す' : 'この章を読了にする'}
        </button>
      </div>
      <nav class="reader-nav">
        ${
          prev
            ? `<a class="btn" href="#/ch/${prev.chapter}"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg><span>${esc(chapterShortTitle(prev.chapter))}</span></a>`
            : '<span></span>'
        }
        ${
          next
            ? `<a class="btn" href="#/ch/${next.chapter}"><span>${esc(chapterShortTitle(next.chapter))}</span><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></a>`
            : '<span></span>'
        }
      </nav>
    </article>`;

  const prose = main.querySelector('#prose');

  // マーカー復元 → 用語注釈(この順序で、マーカーの内側にも下線が引ける)
  await applyStoredHighlights(no, prose);
  annotateTerms(prose);
  bindTermEvents(prose);
  bindSelectionTool(prose, no);
  observeParagraphs(prose, no);

  // ペンアイコンの状態と挙動
  const notes = (await db.notes.all()).filter((n) => n.chapterId === no);
  const noted = new Set(notes.map((n) => n.paragraphId));
  prose.querySelectorAll('.para[data-pid]').forEach((p) => {
    if (noted.has(p.dataset.pid)) {
      const pen = p.querySelector('.note-pen');
      pen.classList.add('has-note');
      pen.title = 'メモを編集';
    }
  });
  prose.addEventListener('click', (e) => {
    const pen = e.target.closest('.note-pen');
    if (pen) openNoteEditor(pen.closest('.para'), no);
  });

  renderSummaryBox(main.querySelector('#summary-box'), no);

  // 章が変わったら読み上げ単位を組み直す(再生中なら止める)
  if (ttsChapter !== no) {
    if (tts.isPlaying()) tts.stop();
    ttsUnits = tts.speechUnits(f.blocks);
    ttsChapter = no;
    setTtsUI(false);
  }

  main.querySelector('#btn-done').onclick = async () => {
    await setChapterDone(no, !prog.done);
    document.dispatchEvent(new CustomEvent('progress-changed'));
    toast(prog.done ? '読了を取り消しました' : '読了にしました');
    renderReader(main, no);
  };

  // 指定段落へスクロール / 前回位置の復元
  if (resumePos) {
    requestAnimationFrame(() => restoreReadingPosition(resumePos));
  } else if (targetPid) {
    requestAnimationFrame(() => {
      const el = document.getElementById(targetPid);
      if (el) {
        el.scrollIntoView({ block: 'center' });
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 2100);
      }
    });
  } else {
    scrollTo(0, 0);
  }

  // この章での読書位置を追いかけて記録する
  trackReadingPosition(no);

  return f;
}

/* ============ 読み上げ ============ */

let ttsChapter = null;
let ttsUnits = [];

/** 現在ビューの中心にある段落のインデックスを、読み上げ単位から探す */
function unitIndexAtView() {
  const mid = innerHeight / 2;
  let best = 0;
  let bestD = Infinity;
  ttsUnits.forEach((u, i) => {
    const el = document.getElementById(u.pid);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const d = Math.abs(r.top + r.height / 2 - mid);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

function highlightUnit(unit) {
  document.querySelectorAll('.speaking').forEach((e) => e.classList.remove('speaking'));
  const el = document.getElementById(unit.pid);
  if (!el) return;
  el.classList.add('speaking');
  const r = el.getBoundingClientRect();
  // 画面から外れそうなときだけ、静かに追従させる
  if (r.top < 90 || r.bottom > innerHeight - 120) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function setTtsUI(playing) {
  const bar = document.getElementById('tts-bar');
  bar.hidden = false;
  bar.classList.toggle('playing', playing);
  document.getElementById('btn-tts')?.classList.toggle('active', playing);
}

function updateTtsPos(i) {
  const pos = document.getElementById('tts-pos');
  if (pos) pos.textContent = `${i + 1} / ${ttsUnits.length}`;
}

/** 読み上げの開始/停止。章ビューから呼ばれる */
export async function toggleSpeech(chapterNo) {
  if (!tts.isSupported) {
    toast('この端末では読み上げに対応していません');
    return;
  }
  if (tts.isPlaying()) {
    tts.stop();
    setTtsUI(false);
    document.querySelectorAll('.speaking').forEach((e) => e.classList.remove('speaking'));
    return;
  }

  const f = state.formatted.get(chapterNo);
  if (!f) return;
  if (ttsChapter !== chapterNo || !ttsUnits.length) {
    ttsUnits = tts.speechUnits(f.blocks);
    ttsChapter = chapterNo;
  }
  if (!ttsUnits.length) {
    toast('読み上げる本文がありません');
    return;
  }

  const start = unitIndexAtView();
  setTtsUI(true);
  document.getElementById('tts-label').textContent = `第${chapterNo}章を読み上げ中`;

  const ok = await tts.play(ttsUnits, start, {
    onUnit: (unit, i) => {
      highlightUnit(unit);
      updateTtsPos(i);
      // 読み上げた段落はしおりとして記録しておく
      if (!unit.heading) saveBookmark(chapterNo, unit.pid);
    },
    onEnd: () => {
      setTtsUI(false);
      document.querySelectorAll('.speaking').forEach((e) => e.classList.remove('speaking'));
      toast('この章の読み上げが終わりました');
    },
  });
  if (!ok) setTtsUI(false);
}

/** 読み上げバーの操作を1度だけ結線する */
export function bindTtsBar() {
  const bar = document.getElementById('tts-bar');
  if (!bar || bar.dataset.bound) return;
  bar.dataset.bound = '1';

  document.getElementById('tts-toggle').onclick = () => toggleSpeech(ttsChapter ?? currentChapter);
  document.getElementById('tts-next').onclick = () => tts.next();
  document.getElementById('tts-prev').onclick = () => tts.prev();
  document.getElementById('tts-close').onclick = () => {
    tts.stop();
    bar.hidden = true;
    document.getElementById('btn-tts')?.classList.remove('active');
    document.querySelectorAll('.speaking').forEach((e) => e.classList.remove('speaking'));
  };

  const rate = document.getElementById('tts-rate');
  rate.value = tts.ttsState.rate;
  document.getElementById('tts-rate-val').textContent = `${Number(rate.value).toFixed(2)}×`;
  rate.oninput = () => {
    document.getElementById('tts-rate-val').textContent = `${Number(rate.value).toFixed(2)}×`;
  };
  rate.onchange = () => tts.setRate(parseFloat(rate.value));

  const sel = document.getElementById('tts-voice');
  sel.onchange = () => tts.setVoice(sel.value);
  // 音声リストは非同期に埋まるので、揃ってから流し込む
  tts.loadVoices().then(() => {
    const list = tts.japaneseVoices();
    const cur = tts.pickVoice();
    sel.innerHTML = list.length
      ? list.map((v) => `<option value="${esc(v.voiceURI)}">${esc(v.name)}</option>`).join('')
      : '<option>日本語の音声がありません</option>';
    if (cur) sel.value = cur.voiceURI;
  });
}

/** 右パネル用:章内目次 + 統計 */
export function readerRightPanel(no) {
  const f = state.formatted.get(no);
  if (!f) return '';
  const prog = chapterProgress(no);
  const toc = f.toc
    .map(
      (t) =>
        `<a href="#${esc(t.id)}" class="lv${t.level}" data-toc="${esc(t.id)}"><span class="h-num" style="margin-right:6px">${esc(t.num)}</span>${esc(t.text)}</a>`
    )
    .join('');
  return `
    <div class="rp-section">
      <div class="rp-title">この章の進捗</div>
      <div class="rp-stat"><span>読了段落</span><strong>${prog.readCount} / ${prog.total}</strong></div>
      <div class="rp-stat"><span>文字数</span><strong>${fmtNum(f.charTotal)}</strong></div>
      <div class="rp-stat"><span>進捗率</span><strong>${prog.pct}%</strong></div>
    </div>
    <div class="rp-section">
      <div class="rp-title">目 次</div>
      ${toc ? `<nav class="rp-toc">${toc}</nav>` : '<p class="rp-empty">この章には節見出しがありません。</p>'}
    </div>`;
}
