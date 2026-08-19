/*
 * CDFOM研修ノート(Obsidian markdown) → data/cdfom.json
 *
 * 原文ノートは変更しない。ここで行うのは表示用データへの変換だけ。
 *   - frontmatter を除去
 *   - ==ハイライト== を強調セグメントとして構造化(試験の頻出箇所)
 *   - 全角スペースによるぶら下げインデントを段落として整理
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = process.argv[2];
if (!SRC) {
  console.error('使い方: node tools/build-cdfom.mjs <CDFOMノートのディレクトリ>');
  process.exit(1);
}

const MODULE_TITLES = {
  1: 'サービスレベルマネジメント',
  2: '運用組織・人材マネジメント',
  3: '安全衛生管理(OH&S / WHS / EH&S)',
  4: '物理セキュリティ管理',
  5: '設備メンテナンス管理',
  6: '日常運用管理(ITIL / ISO 20000)',
  7: '監視と報告',
  8: 'プロジェクト管理',
  9: '環境の持続可能性',
  10: '事業継続性・災害復旧(BCM / DR)',
  11: 'ガバナンス・リスク・財務・資産管理',
};

/** 全角数字を半角に */
const toHalf = (s) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

function stripFrontmatter(text) {
  return text.startsWith('---') ? text.replace(/^---[\s\S]*?\n---\n?/, '') : text;
}

/** `==強調==` と `**太字**` を含む1行 → セグメント列 */
function parseInline(line) {
  const segs = [];
  const re = /==([^=]+)==|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(line))) {
    if (m.index > last) segs.push({ t: line.slice(last, m.index), k: 'n' });
    if (m[1] !== undefined) segs.push({ t: m[1], k: 'hl' }); // 頻出箇所
    else if (m[2] !== undefined) segs.push({ t: m[2], k: 'b' });
    else segs.push({ t: m[3], k: 'i' });
    last = m.index + m[0].length;
  }
  if (last < line.length) segs.push({ t: line.slice(last), k: 'n' });
  return segs.filter((s) => s.t.trim() || s.k !== 'n');
}

/** 先頭の全角/半角スペースぶら下げを、継続行として本文にたたむ */
function toBlocks(text, modNo) {
  const lines = stripFrontmatter(text).split('\n');
  const blocks = [];
  let idx = 0;

  for (let raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;

    const isIndented = /^[\s　]/.test(line);
    const body = line.replace(/^[\s　]+/, '');
    const prev = blocks[blocks.length - 1];

    // 「■」「▼」は頻出箇所一覧の見出し
    const headMatch = body.match(/^([■▼])\s*(.+)$/);
    if (headMatch) {
      blocks.push({
        type: 'heading',
        level: headMatch[1] === '■' ? 2 : 3,
        segs: parseInline(headMatch[2]),
        id: `cd${modNo}-h${idx++}`,
      });
      continue;
    }

    // ぶら下げ行は直前の段落へ続ける(元ノートの整形をそのまま活かす)
    if (isIndented && prev && prev.type === 'para') {
      prev.lines.push(parseInline(body));
      continue;
    }

    blocks.push({ type: 'para', id: `cd${modNo}-p${idx++}`, lines: [parseInline(body)] });
  }
  return blocks;
}

const files = readdirSync(SRC).filter((f) => f.endsWith('.md'));
const modules = [];
let exam = null;

for (const f of files) {
  const text = readFileSync(join(SRC, f), 'utf8');
  const m = toHalf(f).match(/モジュール\s*(\d+)/);
  if (m) {
    const no = parseInt(m[1], 10);
    modules.push({
      no,
      title: MODULE_TITLES[no] || `モジュール${no}`,
      blocks: toBlocks(text, no),
    });
  } else if (/頻出/.test(f)) {
    exam = { title: '試験 頻出箇所一覧', blocks: toBlocks(text, 0) };
  }
}
modules.sort((a, b) => a.no - b.no);

/** ハイライト(頻出箇所)を、読み上げ用に文脈つきで抜き出す */
function collectHighlights(blocks, source) {
  const out = [];
  let heading = null;
  for (const b of blocks) {
    const text = b.segs
      ? b.segs.map((s) => s.t).join('')
      : b.lines.map((l) => l.map((s) => s.t).join('')).join('');
    if (b.type === 'heading') {
      heading = text.trim();
      continue;
    }
    const segs = b.lines.flat().filter((s) => s.k === 'hl');
    if (!segs.length) continue;
    const joined = segs.map((s) => s.t.trim()).filter(Boolean).join(' ');
    if (!joined) continue;
    out.push({ id: b.id, source, heading, text: joined });
  }
  return out;
}

const highlights = [];
for (const mod of modules) {
  for (const h of collectHighlights(mod.blocks, `モジュール${mod.no}`)) {
    highlights.push({ ...h, module: mod.no });
  }
}
const examHighlights = exam ? collectHighlights(exam.blocks, '頻出箇所一覧') : [];

const chars = (bs) =>
  bs.reduce(
    (a, b) =>
      a +
      (b.segs
        ? b.segs.map((s) => s.t).join('').length
        : b.lines.map((l) => l.map((s) => s.t).join('')).join('').length),
    0
  );

const out = {
  _note: 'CDFOM研修の個人ノートを表示用に変換したもの。原文ノートは別途保管。',
  modules: modules.map((m) => ({ ...m, chars: chars(m.blocks) })),
  exam: exam ? { ...exam, chars: chars(exam.blocks) } : null,
  highlights,
  examHighlights,
};
writeFileSync('data/cdfom.json', JSON.stringify(out));
console.log(
  `モジュール${modules.length}件 / 頻出一覧${exam ? 'あり' : 'なし'} / ` +
    `ハイライト: モジュール${highlights.length}件・一覧${examHighlights.length}件 / ` +
    `総字数 ${modules.reduce((a, m) => a + chars(m.blocks), 0) + (exam ? chars(exam.blocks) : 0)}`
);
