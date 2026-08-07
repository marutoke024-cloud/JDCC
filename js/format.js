/*
 * format.js — 表示整形ロジック(BUILD_PROMPT §3)
 *
 * 原文データには一切変更を加えない。ここにあるのはすべて純粋関数であり、
 * 原文文字列を入力として「表示用の整形済みデータ」を返すだけである。
 * 書き込み経路は存在しない。
 */

/** 全角文字(和文)にマッチする範囲 */
const ZENKAKU =
  '\\u3000-\\u303F\\u3040-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\uFF00-\\uFF60\\uFFE0-\\uFFE6';

const RE_TIGHTEN = new RegExp(`(?<=[${ZENKAKU}]) (?=[${ZENKAKU}])`, 'g');

/**
 * §3-2: 全角文字に挟まれた単独の半角スペースを詰める。
 * 英数字間のスペースは保持する。
 */
export function tightenSpaces(text) {
  return text.replace(RE_TIGHTEN, '');
}

/**
 * §3-1: 句点「。」の直後で改行し、1文1行に近づける。
 * 閉じ括弧(」』)】)が句点の直後に続く場合は括弧の後で切る。
 * 戻り値は文の配列。
 */
export function splitSentences(text) {
  const out = [];
  let buf = '';
  for (let i = 0; i < text.length; i++) {
    buf += text[i];
    if (text[i] === '。') {
      // 直後の閉じ括弧類は同じ文に含める
      while (i + 1 < text.length && '」』)】〕》'.includes(text[i + 1])) {
        buf += text[++i];
      }
      out.push(buf.trim());
      buf = '';
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter((s) => s.length > 0);
}

/** 見出し番号 → 見出しレベル(§3-4: "1."=h2, "1.1"=h3, "1.1.1"=h4) */
export function headingLevel(num) {
  const depth = num.split('.').filter(Boolean).length;
  return Math.min(depth + 1, 4); // depth1→h2, depth2→h3, depth3→h4
}

/**
 * §3-3: 段落先頭の節見出し(例「1.1.1 データセンターとは」)を検出し、
 * 本文と連結している場合は切り出す。
 *
 * 戻り値: null(見出しなし) または { num, title, body }
 */
export function splitHeading(raw, chapterNo) {
  const text = raw.trim();
  // 「N.N」「N.N.N」形式。章番号と一致する先頭番号のみ見出しとみなす
  let m = text.match(/^(\d{1,2}(?:\.\d{1,2}){1,2})[.\s　]*([\s\S]*)$/);
  if (!m) {
    // 章レベル「N. タイトル」(末尾ピリオド必須で年号等と区別)
    m = text.match(/^(\d{1,2})\.[\s　]+([\s\S]*)$/);
    if (!m) return null;
  }
  const num = m[1];
  if (parseInt(num, 10) !== chapterNo) return null;
  const rest = m[2].trim();

  if (!rest) return { num, title: '', body: '' };

  // 見出しと本文が同じ段落に連結しているケース。
  // PDF抽出では見出しタイトルと本文の間に空白が残るため、
  // 最初の空白区切りまでを見出しタイトルとして切り出す。
  const ws = rest.search(/[\s　]/);
  if (ws > 0 && ws <= 40) {
    return {
      num,
      title: tightenSpaces(rest.slice(0, ws)),
      body: rest.slice(ws + 1).trim(),
    };
  }

  // 空白がない短いテキストは、段落全体が見出し
  if (ws < 0 && !rest.includes('。') && rest.length <= 60) {
    return { num, title: tightenSpaces(rest), body: '' };
  }

  // 見出しタイトルを特定できない場合は番号のみ見出しとし、本文は本文のまま残す
  return { num, title: '', body: rest };
}

/* ---------- 段落の連結(PDF行折り返しの復元) ---------- */

/** 文末とみなす文字で終わっているか */
const RE_SENTENCE_END = /[。！？!?」』】〕》]\s*$/;

/** 見出し番号で始まる段落か(章番号一致のみ) */
function looksLikeHeading(raw, chapterNo) {
  const m = raw.trim().match(/^(\d{1,2})(?:\.\d{1,2}){1,2}[\s　]/);
  return !!m && parseInt(m[1], 10) === chapterNo;
}

/**
 * 「10.1 建物/衛生設備」のように、見出し番号とタイトルだけで完結した行か。
 * この形は句点で終わらないが、次の本文と連結してはならない。
 */
function isHeadingOnlyLine(raw, chapterNo) {
  const m = raw.trim().match(/^(\d{1,2})(?:\.\d{1,2}){1,2}[\s　]+(.+)$/);
  if (!m || parseInt(m[1], 10) !== chapterNo) return false;
  const rest = m[2].trim();
  return rest.length <= 40 && !rest.includes('。') && !/[\s　]/.test(rest);
}

/**
 * 表・箇条書き・注記など、前後と連結すべきでない独立行か。
 * PDF抽出では、これらは先頭に空白が残るか記号で始まる。
 */
function isStandaloneLine(raw) {
  if (/^[\s　]/.test(raw)) return true;
  const t = raw.trim();
  return /^(表|図)[\s　]*\d/.test(t) || /^[・･▪●○◇◆■□※＊*\-–—]/.test(t);
}

/**
 * 表の本体行か。列がスペースで区切られ、文になっていない行を判定する。
 * この行のスペースは意味を持つため、詰めずに保つ。
 */
function looksLikeTableRow(text) {
  const spaces = (text.match(/[ 　]/g) || []).length;
  return spaces >= 4 && !text.includes('。');
}

/**
 * 句点で終わらない段落を次の段落と連結し、PDFの行折り返しで
 * 分断された文を復元する。原文は変更せず、表示用の配列を返すだけ。
 *
 * 戻り値: [{ text, index, chars }]
 *   index — 連結元の先頭段落インデックス(段落IDの基準)
 *   chars — 連結した全段落の原文文字数の合計
 */
export function mergeParagraphs(paragraphs, chapterNo) {
  const out = [];
  let cur = null;

  for (let i = 0; i < paragraphs.length; i++) {
    const raw = paragraphs[i];
    const standalone = isStandaloneLine(raw);
    const heading = looksLikeHeading(raw, chapterNo);
    const headingOnly = isHeadingOnlyLine(raw, chapterNo);

    // 連結中で、この行が独立行/見出しなら、いったん確定させる
    if (cur && (standalone || heading)) {
      out.push(cur);
      cur = null;
    }

    if (!cur) {
      cur = { text: raw.trim(), index: i, chars: raw.length, table: standalone };
    } else {
      // 連結: 行末の折り返しなので区切り文字は挟まない
      cur.text += raw.trim();
      cur.chars += raw.length;
    }

    // 文末で終わっていれば確定。独立行と見出しのみの行も単独で確定させる
    if (standalone || headingOnly || RE_SENTENCE_END.test(cur.text)) {
      if (!cur.table && looksLikeTableRow(cur.text)) cur.table = true;
      out.push(cur);
      cur = null;
    }
  }
  if (cur) {
    if (!cur.table && looksLikeTableRow(cur.text)) cur.table = true;
    out.push(cur);
  }
  return out;
}

/** 段落0に混ざる「第N章 タイトル」を取り除く */
function stripChapterTitle(text, chapterNo) {
  const re = new RegExp(`^第${chapterNo}章[\\s　]*`);
  if (!re.test(text)) return text;
  const rest = text.replace(re, '');
  // 章タイトルの直後は空白で本文が続く
  const ws = rest.search(/[\s　]/);
  return ws > 0 && ws <= 40 ? rest.slice(ws + 1).trim() : rest.trim();
}

/** 段落ID(データ設計 §5): ch{2桁}-p{4桁} */
export function paragraphId(chapterNo, index) {
  return `ch${String(chapterNo).padStart(2, '0')}-p${String(index).padStart(4, '0')}`;
}

/**
 * 第13章末尾の付録(索引・図表目次・謝辞・WG参加者名簿・奥付)の開始を
 * 検出する(§3-5)。実データでは
 * 索引 → 図表目次 → 執筆メンバー → 査読者 → WG参加者 → 奥付 の順に並ぶ。
 */
function isColophonStart(text) {
  const t = text.trim();
  return (
    /^索引$/.test(t) ||
    /\.{6,}/.test(t) || // ドットリーダー = 索引・図表目次
    /ワーキンググループ[\s　]*(執筆メンバー|（初版）|\(初版\))/.test(t) ||
    /初版発行/.test(t) ||
    /^データセンター運用ガイドブック$/.test(t)
  );
}

/**
 * 章オブジェクト(chapters.json の1要素)から表示用データを組み立てる。
 *
 * 戻り値:
 * {
 *   chapter, title, charTotal,
 *   blocks:   [ {type:'heading', level, num, text, id}
 *             | {type:'para', id, pid, sentences[], text, chars} ],
 *   appendix: [ 同上 ],           // 第13章の奥付以降(学習対象外)
 *   toc:      [ {num, text, level, id} ],
 * }
 */
export function formatChapter(chapterData) {
  const no = chapterData.chapter;
  const blocks = [];
  const appendix = [];
  const toc = [];
  let charTotal = 0;
  let inAppendix = false;

  // PDFの行折り返しで分断された段落を先に復元する
  const merged = mergeParagraphs(chapterData.paragraphs || [], no);

  merged.forEach((m, mi) => {
    const pid = paragraphId(no, m.index);

    if (no === 13 && !inAppendix && isColophonStart(m.text)) {
      inAppendix = true;
    }
    const target = inAppendix ? appendix : blocks;

    const pushPara = (raw) => {
      // 表・箇条書き行のスペースは列区切りなので詰めない
      const body = m.table ? raw : tightenSpaces(raw);
      const sentences = m.table ? [body] : splitSentences(body);
      if (!sentences.length || !body.trim()) return;
      target.push({
        type: 'para',
        id: pid,
        pid,
        table: !!m.table,
        sentences,
        text: sentences.join(''),
        chars: m.chars,
      });
      if (!inAppendix) charTotal += m.chars;
    };

    let text = m.text;
    // 章冒頭に混ざる「第N章 タイトル」は本文から取り除く
    if (mi === 0) text = stripChapterTitle(text, no);

    const h = inAppendix ? null : splitHeading(text, no);
    if (h) {
      const headingBlock = {
        type: 'heading',
        level: headingLevel(h.num),
        num: h.num,
        text: h.title,
        id: `${pid}-h`,
      };
      target.push(headingBlock);
      if (h.title) {
        toc.push({ num: h.num, text: h.title, level: headingBlock.level, id: headingBlock.id });
      }
      if (h.body) pushPara(h.body);
      return;
    }

    pushPara(text);
  });

  return { chapter: no, title: chapterData.title, blocks, appendix, toc, charTotal };
}

/** 全章を整形し、章番号→整形済みデータの Map を返す */
export function formatAll(chapters) {
  const map = new Map();
  for (const ch of chapters) map.set(ch.chapter, formatChapter(ch));
  return map;
}
