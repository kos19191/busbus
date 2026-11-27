package ru.busbus.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.WebViewAssetLoader;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;

/**
 * BusBus для Android.
 *
 * Вся логика интерфейса — в общем веб-ядре, которое лежит в assets/index.html
 * (собирается из каталога web в single-file HTML). Здесь — платформенная обвязка:
 *
 *  • открываем локальную сборку через https://appassets.androidplatform.net,
 *    чтобы работали localStorage, service worker и запросы к внешним API;
 *  • просим разрешение на геолокацию и пробрасываем его в WebView;
 *  • добавляем CORS-заголовки к ответам официальных порталов, потому что они
 *    не отдают Access-Control-Allow-Origin — в браузере это ломает запросы,
 *    а в WebView мы можем переписать ответ на лету;
 *  • поддерживаем светлую/тёмную системную тему и edge-to-edge.
 */
public class MainActivity extends AppCompatActivity {

    private static final int REQ_LOCATION = 7;
    private static final String APP_ORIGIN = "https://appassets.androidplatform.net";
    private static final String ASSET_HOST = "appassets.androidplatform.net";

    private WebView webView;
    private String pendingGeoOrigin;
    private GeolocationPermissions.Callback pendingGeoCallback;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        applySystemBars();

        webView = new WebView(this);
        webView.setLayoutParams(new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        webView.setBackgroundColor(Color.parseColor("#0e1116"));

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " BusBusAndroid/" + BuildConfig.VERSION_NAME);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
        }

        FrameLayout root = new FrameLayout(this);
        root.addView(webView);
        setContentView(root);

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .setDomain(ASSET_HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.startsWith(APP_ORIGIN)) {
                    return assetLoader.shouldInterceptRequest(request.getUrl());
                }
                String host = request.getUrl().getHost();
                if (isTransitHost(host)) {
                    // запрос с CORS-обёрткой, браузерный fetch не сумеет иначе
                    WebResourceResponse proxy = proxyWithCors(url, request.getMethod());
                    if (proxy != null) return proxy;
                }
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.startsWith(APP_ORIGIN)) return false; // внутри приложения
                // Внешние ссылки (порталы, OSM, лицензии) открываем в системном браузере
                try {
                    startActivity(new android.content.Intent(android.content.Intent.ACTION_VIEW,
                            android.net.Uri.parse(url)));
                } catch (Exception ignored) {
                    // нет браузера — просто игнорируем
                }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (hasLocationPermission()) {
                    callback.invoke(origin, true, false);
                } else {
                    pendingGeoOrigin = origin;
                    pendingGeoCallback = callback;
                    ActivityCompat.requestPermissions(MainActivity.this,
                            new String[]{Manifest.permission.ACCESS_FINE_LOCATION,
                                    Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
                }
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.deny();
            }
        });

        applyInsets(root);

        if (savedInstanceState == null) {
            webView.loadUrl(APP_ORIGIN + "/assets/index.html");
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    private void applySystemBars() {
        Window window = getWindow();
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        boolean night = (getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK)
                == android.content.res.Configuration.UI_MODE_NIGHT_YES;
        View decor = window.getDecorView();
        int flags = decor.getSystemUiVisibility();
        if (night) {
            flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        } else {
            flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        }
        decor.setSystemUiVisibility(flags);
    }

    private void applyInsets(View root) {
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            String css = String.format(java.util.Locale.US,
                    ":root{--safe-top:%dpx;--safe-bottom:%dpx;}", bars.top, bars.bottom);
            webView.evaluateJavascript(
                    "(function(){var s=document.getElementById('busbus-safe');" +
                            "if(!s){s=document.createElement('style');s.id='busbus-safe';(document.head||document.documentElement).appendChild(s);}" +
                            "s.textContent=" + jsString(css) + ";})();", null);
            return insets;
        });
    }

    private static String jsString(String s) {
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + "\"";
    }

    private boolean isTransitHost(String host) {
        if (host == null) return false;
        return host.equals("map.nskgortrans.ru")
                || host.equals("m.nskgortrans.ru")
                || host.equals("mu-kgt.ru")
                || host.endsWith(".mu-kgt.ru");
    }

    /**
     * Прозрачный прокси: забираем ответ официального портала нативно и отдаём
     * в WebView с заголовком Access-Control-Allow-Origin. Официальные API
     * не отдают CORS, поэтому без этого живые данные в браузерном движке не работают.
     */
    private WebResourceResponse proxyWithCors(String url, String method) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(20000);
            conn.setRequestProperty("Accept", "application/json, text/html, */*");
            conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) BusBus/" + BuildConfig.VERSION_NAME);
            conn.setInstanceFollowRedirects(true);
            int code = conn.getResponseCode();
            String contentType = conn.getContentType();
            if (contentType == null) contentType = "application/json; charset=utf-8";
            InputStream stream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (stream == null) stream = new ByteArrayInputStream(new byte[0]);
            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", "*");
            headers.put("Access-Control-Allow-Methods", "GET, OPTIONS");
            headers.put("Access-Control-Allow-Headers", "*");
            headers.put("Cache-Control", "no-store");
            String reason = code == 200 ? "OK" : ("HTTP " + code);
            return new WebResourceResponse(contentType, "utf-8", code, reason, headers, stream);
        } catch (IOException e) {
            if (conn != null) conn.disconnect();
            try {
                byte[] msg = ("{\"error\":\"" + e.getClass().getSimpleName().replace("\"", "") + "\"}").getBytes("UTF-8");
                Map<String, String> headers = new HashMap<>();
                headers.put("Access-Control-Allow-Origin", "*");
                return new WebResourceResponse("application/json", "utf-8", 502, "Bad Gateway", headers,
                        new ByteArrayInputStream(msg));
            } catch (IOException ignored) {
                return null;
            }
        }
    }

    private boolean hasLocationPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_LOCATION && pendingGeoCallback != null) {
            boolean granted = false;
            for (int r : grantResults) if (r == PackageManager.PERMISSION_GRANTED) granted = true;
            pendingGeoCallback.invoke(pendingGeoOrigin, granted, false);
            pendingGeoCallback = null;
            pendingGeoOrigin = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(@NonNull Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
