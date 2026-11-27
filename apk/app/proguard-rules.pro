# Приложение почти целиком — WebView; JS не минифицируется отдельно.
-keep class ru.busbus.app.** { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
