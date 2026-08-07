/*
 * reader.js — 章読書ビュー
 * 本文表示 / マーカー / 余白ノート / 用語ホバー解説 / 読了トラッキング / 章末サマリー
 */
import {
  state, esc, fmtNum, toast,
  markParagraphRead, saveBookmark, chapterProgress, setChapterDone, chapterShortTitle,
} from './state.js';
import * as db from './db.js';

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
  if (isTouch) {
    root.addEventListener('click', (e) => {
      const t = e.target.closest('.term');
      if (t) {
        e.preventDefault();
        showTermPopup(t);
      }
    });
  } else {
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
    document.addEventListener('scroll', hideTermPopup, { passive: true });
  }
}

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

/* ============ 章末サマリー ============ */

async function renderSummaryBox(el, chapterNo) {
  const rec = await db.summaries.get(chapterNo);
  const items = rec?.items || [];
  el.innerHTML = `
    <div class="summary-head">
      <span class="summary-title">この章のまとめ</span>
      <span class="summary-badge">原文外</span>
      <button class="btn btn-sm btn-ghost" data-act="edit">${items.length ? '編集' : '書く'}</button>
    </div>
    ${
      items.length
        ? `<ul class="summary-list">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
        : '<p class="summary-empty">この章の要点を自分の言葉でまとめておくと、復習のときに役立ちます。</p>'
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
}

/* ============ ブロック描画 ============ */

function blockHtml(b) {
  if (b.type === 'heading') {
    const tag = `h${b.level}`;
    return `<${tag} id="${esc(b.id)}"><span class="h-num">${esc(b.num)}</span><span>${esc(b.text)}</span></${tag}>`;
  }
  const sentences = b.sentences.map((s) => `<span class="s">${esc(s)}</span>`).join('');
  return `
    <div class="para" id="${esc(b.pid)}" data-pid="${esc(b.pid)}" data-chars="${b.chars}">
      ${sentences}
      <button class="note-pen" title="メモを書く" aria-label="この段落にメモ">
        <svg viewBox="0 0 24 24"><path d="M14.5 5.5l4 4L8 20l-4.7.7L4 16z"/><path d="M12.5 7.5l4 4"/></svg>
      </button>
    </div>`;
}

/* ============ メインの描画 ============ */

export async function renderReader(main, no, targetPid) {
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
      <div class="prose" id="prose">
        ${f.blocks.map(blockHtml).join('')}
      </div>
      ${
        f.appendix.length
          ? `<section class="appendix"><div class="appendix-label">付 録(学習対象外)</div>${f.appendix
              .map((b) => (b.type === 'para' ? `<div class="para">${b.sentences.map((s) => `<span class="s">${esc(s)}</span>`).join('')}</div>` : ''))
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

  main.querySelector('#btn-done').onclick = async () => {
    await setChapterDone(no, !prog.done);
    document.dispatchEvent(new CustomEvent('progress-changed'));
    toast(prog.done ? '読了を取り消しました' : '読了にしました');
    renderReader(main, no);
  };

  // 指定段落へスクロール
  if (targetPid) {
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

  return f;
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
