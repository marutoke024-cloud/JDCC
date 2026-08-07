/*
 * Service Worker — オフライン対応
 * アプリシェルと原文データ(chapters.json)をプリキャッシュし、
 * ネット接続なしでも全章を閲覧できるようにする。
 */
const VERSION = 'jdcc-reader-v9';
const FONT_CACHE = 'jdcc-fonts-v1';

const PRECACHE = [
  './',
  'index.html',
  'manifest.json',
  'css/app.css',
  'js/app.js',
  'js/state.js',
  'js/reader.js',
  'js/format.js',
  'js/db.js',
  'js/sync.js',
  'js/art.js',
  'js/tts.js',
  'data/chapters.json',
  'data/glossary.json',
  'data/summaries.json',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      // HTTPキャッシュを経由すると古いファイルを再キャッシュしてしまうため、
      // プリキャッシュは必ずサーバーへ再検証させる
      .then((cache) => cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'no-cache' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== VERSION && k !== FONT_CACHE).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // Webフォントは stale-while-revalidate でランタイムキャッシュ
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.open(FONT_CACHE).then(async (cache) => {
        const cached = await cache.match(e.request);
        const fetching = fetch(e.request)
          .then((res) => {
            if (res.ok) cache.put(e.request, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || fetching;
      })
    );
    return;
  }

  if (url.origin !== location.origin) return;

  // ナビゲーションは index.html にフォールバック(SPA)
  if (e.request.mode === 'navigate') {
    e.respondWith(
      caches.match('index.html').then((cached) => cached || fetch(e.request))
    );
    return;
  }

  // 同一オリジンはキャッシュ優先(原文データを含めオフラインで完結)
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(
      (cached) =>
        cached ||
        fetch(e.request).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(VERSION).then((cache) => cache.put(e.request, clone));
          }
          return res;
        })
    )
  );
});
