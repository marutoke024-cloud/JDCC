// PWAアイコン生成: 依存ライブラリなしで PNG を書き出す (node tools/gen-icons.mjs)
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

// --- 最小限のPNGエンコーダ ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- 描画ヘルパー(アンチエイリアスはスーパーサンプリングで) ---
function hex(c) {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

function roundRectSDF(px, py, x, y, w, h, r) {
  const cx = Math.max(x + r, Math.min(px, x + w - r));
  const cy = Math.max(y + r, Math.min(py, y + h - r));
  const dx = px - cx;
  const dy = py - cy;
  return Math.sqrt(dx * dx + dy * dy) - r;
}

/**
 * size×size のアイコンを描く。
 * デザイン: 藍(#2C4A63)の角丸タイル + オフホワイトの本 + 藍の罫線
 */
function drawIcon(size, { maskable = false } = {}) {
  const SS = 3; // supersample
  const S = size * SS;
  const img = Buffer.alloc(size * size * 4);
  const accent = hex('#2C4A63');
  const paper = hex('#FAF9F7');
  const soft = hex('#8FB0CC');

  // タイル余白: maskable はセーフゾーンを広く
  const pad = maskable ? 0 : 0;
  const tileR = maskable ? 0 : S * 0.22;
  const bookScale = maskable ? 0.72 : 1;

  // 本の座標(64グリッド基準)
  const g = (v) => ((v - 32) * bookScale + 32) * (S / 64);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, gc = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x * SS + sx + 0.5;
          const py = y * SS + sy + 0.5;
          let cr, cg, cb, ca = 255;

          // 背景タイル
          const dTile = roundRectSDF(px, py, pad, pad, S - pad * 2, S - pad * 2, tileR);
          if (dTile > 0 && !maskable) {
            ca = 0;
            cr = cg = cb = 0;
          } else {
            [cr, cg, cb] = accent;
            // 本(ページ)
            if (roundRectSDF(px, py, g(16), g(12), g(48) - g(16), g(52) - g(12), S * 0.055 * bookScale) <= 0) {
              [cr, cg, cb] = paper;
              // 背表紙
              if (px <= g(22)) [cr, cg, cb] = soft;
              // 罫線
              const lineH = (2.6 * bookScale * S) / 64;
              const lines = [
                { x1: 27, x2: 43, y: 21, c: accent },
                { x1: 27, x2: 43, y: 28, c: accent },
                { x1: 27, x2: 37, y: 35, c: soft },
              ];
              for (const L of lines) {
                if (px >= g(L.x1) && px <= g(L.x2) && py >= g(L.y) && py <= g(L.y) + lineH) {
                  [cr, cg, cb] = L.c;
                }
              }
            }
          }
          r += cr; gc += cg; b += cb; a += ca;
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      img[i] = Math.round(r / n);
      img[i + 1] = Math.round(gc / n);
      img[i + 2] = Math.round(b / n);
      img[i + 3] = Math.round(a / n);
    }
  }
  return encodePNG(size, size, img);
}

mkdirSync('icons', { recursive: true });
writeFileSync('icons/icon-192.png', drawIcon(192));
writeFileSync('icons/icon-512.png', drawIcon(512));
writeFileSync('icons/icon-maskable-512.png', drawIcon(512, { maskable: true }));
writeFileSync('icons/apple-touch-icon.png', drawIcon(180, { maskable: true }));
console.log('icons generated');
