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
  let rest = m[2].trim();

  if (!rest) return { num, title: '', body: '' };

  // 本文(句点を含む文)が続かない短いテキスト → 段落全体が見出し
  if (!rest.includes('。') && rest.length <= 60) {
    return { num, title: tightenSpaces(rest), body: '' };
  }

  // 見出しと本文が同じ段落に連結しているケース:
  // PDF抽出では見出しタイトルと本文の間に空白が残っているため、
  // 最初の空白区切りまでを見出しタイトルとして切り出す。
  const ws = rest.search(/[\s　]/);
  if (ws > 0 && ws <= 40) {
    return {
      num,
      title: tightenSpaces(rest.slice(0, ws)),
      body: rest.slice(ws + 1).trim(),
    };
  }

  // 空白が見つからない場合は切り出しを諦め、番号のみ見出しとして扱う
  return { num, title: '', body: rest };
}

/** 段落ID(データ設計 §5): ch{2桁}-p{4桁} */
export function paragraphId(chapterNo, index) {
  return `ch${String(chapterNo).padStart(2, '0')}-p${String(index).padStart(4, '0')}`;
}

/** 第13章の奥付開始を検出する(§3-5) */
function isColophonStart(text) {
  return (
    text.includes('データセンター運用ガイドブック') &&
    (text.includes('初版発行') || text.includes('2020年12月1日'))
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

  (chapterData.paragraphs || []).forEach((raw, i) => {
    const pid = paragraphId(no, i);

    if (no === 13 && !inAppendix && isColophonStart(raw)) {
      inAppendix = true;
    }
    const target = inAppendix ? appendix : blocks;

    const h = inAppendix ? null : splitHeading(raw, no);
    if (h) {
      const headingBlock = {
        type: 'heading',
        level: headingLevel(h.num),
        num: h.num,
        text: h.title,
        id: `${pid}-h`,
      };
      target.push(headingBlock);
      toc.push({ num: h.num, text: h.title, level: headingBlock.level, id: headingBlock.id });
      if (!h.body) return;
      const body = tightenSpaces(h.body);
      const sentences = splitSentences(body);
      const text = sentences.join('');
      target.push({ type: 'para', id: pid, pid, sentences, text, chars: raw.length });
      if (!inAppendix) charTotal += raw.length;
      return;
    }

    const body = tightenSpaces(raw.trim());
    const sentences = splitSentences(body);
    const text = sentences.join('');
    target.push({ type: 'para', id: pid, pid, sentences, text, chars: raw.length });
    if (!inAppendix) charTotal += raw.length;
  });

  return { chapter: no, title: chapterData.title, blocks, appendix, toc, charTotal };
}

/** 全章を整形し、章番号→整形済みデータの Map を返す */
export function formatAll(chapters) {
  const map = new Map();
  for (const ch of chapters) map.set(ch.chapter, formatChapter(ch));
  return map;
}
