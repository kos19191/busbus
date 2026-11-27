import 'leaflet/dist/leaflet.css';
import '../../core/src/ui/theme.css';
import { BusApp } from '../../core/src/ui/app';
import { h } from '../../core/src/ui/dom';
import { installAndroidBridge } from '../../core/src/transport/http';

// Внутри APK включаем нативный HTTP-мост — тогда живые данные работают без прокси.
const isAndroidApp = installAndroidBridge();

const root = document.getElementById('root');
if (!root) throw new Error('Нет #root');

// Город можно задать ссылкой (?city=krsk) — удобно для шорткатов PWA
const params = new URLSearchParams(location.search);
const cityParam = params.get('city');
const app = new BusApp({
  version: `v${__APP_VERSION__}`,
  platform: isAndroidApp ? 'android' : 'web',
  extraSettings: () =>
    isAndroidApp
      ? []
      : [
          h(
            'div',
            { class: 'card' },
            h('div', { class: 'row__title' }, 'Приложение для Android'),
            h(
              'div',
              { class: 'card__hint', style: { marginTop: '6px' } },
              'В APK живые данные идут напрямую от источника и обновляются каждые 12 секунд. Веб-версия читает срез данных, который собирается каждые 10 минут.',
            ),
            h(
              'div',
              { style: { marginTop: '12px' } },
              h('a', { class: 'btn btn--sm btn--primary', href: './busbus.apk', download: 'busbus.apk' }, '⬇️ Скачать APK'),
            ),
          ),
        ],
});

if (cityParam === 'krsk' || cityParam === 'nsk') app.setCityFromUrl(cityParam);
if (isAndroidApp) {
  // Диагностика моста: результат последнего нативного запроса виден в настройках
  (window as unknown as { __busbusBridge?: unknown }).__busbusBridge = true;
}

app.mount(root);

/** Офлайн-оболочка: регистрируем только в браузере (в APK файл не используется). */
if ('serviceWorker' in navigator && !isAndroidApp) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* отсутствие SW не критично */
    });
  });
}
