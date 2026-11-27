import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Две цели сборки:
 *  1) обычная PWA для GitHub Pages (dist/);
 *  2) single-file HTML для Android-приложения (dist-android/index.html),
 *     который кладётся в assets и открывается в WebView без сервера.
 */
const singleFile = process.env.BUSBUS_SINGLE === '1';
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string };

function versionPlugin(): Plugin {
  return {
    name: 'busbus-version',
    transformIndexHtml(html) {
      return html.replaceAll('__APP_VERSION__', pkg.version);
    },
  };
}

function androidAssets(): Plugin {
  return {
    name: 'busbus-android-assets',
    closeBundle() {
      if (!singleFile) return;
      const out = resolve(__dirname, 'dist-android');
      const apkAssets = resolve(__dirname, '../apk/app/src/main/assets');
      mkdirSync(apkAssets, { recursive: true });
      copyFileSync(join(out, 'index.html'), join(apkAssets, 'index.html'));
      const icons = resolve(__dirname, 'public/icons');
      const target = join(apkAssets, 'icons');
      mkdirSync(target, { recursive: true });
      if (existsSync(icons)) {
        for (const name of readdirSync(icons)) {
          const src = join(icons, name);
          if (statSync(src).isFile()) copyFileSync(src, join(target, name));
        }
      }
      // служебная метка версии — пригодится в «Настройках» и для отладки
      writeFileSync(join(out, 'version.txt'), pkg.version, 'utf8');
      console.log(`BusBus ${pkg.version}: single-file bundle → apk/app/src/main/assets/index.html`);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [versionPlugin(), viteSingleFile({ useRecommendedBuildConfig: true }), androidAssets()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: singleFile ? 'dist-android' : 'dist',
    emptyOutDir: true,
    target: 'es2019',
    cssCodeSplit: false,
    sourcemap: false,
    assetsInlineLimit: 100_000_000,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    // превью-домены песочницы и локальные адреса
    allowedHosts: true,
    // живые данные источников не поддерживают CORS — проксируем их в dev-режиме,
    // чтобы можно было проверить реальный режим прямо в браузере
    proxy: {
      '/dev-proxy/nsk': {
        target: 'https://map.nskgortrans.ru',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/dev-proxy\/nsk/, ''),
      },
      '/dev-proxy/krsk': {
        target: 'https://mu-kgt.ru',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/dev-proxy\/krsk/, ''),
      },
      '/dev-proxy/nskwap': {
        target: 'https://m.nskgortrans.ru',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/dev-proxy\/nskwap/, ''),
      },
    },
  },
});
