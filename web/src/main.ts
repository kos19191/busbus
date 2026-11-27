import 'leaflet/dist/leaflet.css';
import '../../core/src/ui/theme.css';
import { BusApp } from '../../core/src/ui/app';
import { h } from '../../core/src/ui/dom';

const root = document.getElementById('root');
if (!root) throw new Error('Нет #root');

const app = new BusApp({
  version: `v${__APP_VERSION__}`,
  platform: 'web',
  extraSettings: () => [
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'row__title' }, 'Android-приложение'),
      h(
        'div',
        { class: 'card__hint', style: { marginTop: '6px' } },
        'APK с живыми данными без ограничений браузера. Если в этой веб-версии не грузятся живые данные — скачайте APK.',
      ),
      h(
        'div',
        { style: { marginTop: '12px' } },
        h(
          'a',
          { class: 'btn btn--sm btn--primary', href: './busbus.apk', download: 'busbus.apk' },
          '⬇️ Скачать APK',
        ),
      ),
    ),
  ],
});

app.mount(root);

// PWA: регистрируем сервис-воркер только при обычной сборке (не в APK)
if ('serviceWorker' in navigator && !/BusBusAndroid/.test(navigator.userAgent)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('./sw.ts', import.meta.url), { type: 'module' }).catch(() => {
      /* офлайн-режим необязателен */
    });
  });
}
