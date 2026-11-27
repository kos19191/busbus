/// <reference lib="webworker" />
/**
 * Сервис-воркер BusBus: офлайн-оболочка + быстрый старт.
 * Стратегия: сеть с фолбэком в кэш (данные всегда свежие, интерфейс доступен офлайн).
 */
const sw = self as unknown as ServiceWorkerGlobalScope;
const VERSION = '__VERSION__';
const CACHE = `busbus-${VERSION}`;
const SHELL = ['./', './index.html'];

sw.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL).catch(() => undefined)).then(() => sw.skipWaiting()),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Данные транспорта и тайлы карты не кэшируем — нужны свежими
  if (/markers\.php|listmarsh\.php|getMarshData|tile\.openstreetmap/.test(url.href)) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && url.origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => undefined);
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === 'navigate') {
          const shell = await caches.match('./index.html');
          if (shell) return shell;
        }
        return new Response('Офлайн', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }),
  );
});
