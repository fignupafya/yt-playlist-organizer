package com.ypo.organizer

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebChromeClient
import android.webkit.JsResult
import android.app.AlertDialog
import java.io.ByteArrayInputStream
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

/**
 * Tek WebView'lı uygulama; akış kök-nedenlere göre kurgulanmıştır:
 *
 *  - AÇILIŞ: Giriş durumu ÇEREZDEN önceden kontrol edilir.
 *      • Giriş varsa  → doğrudan MASAÜSTÜ kimliği + www/feed/playlists (tek yükleme, hızlı).
 *      • Giriş yoksa  → MOBİL kimlik + m.youtube.com (Google'ın WebView giriş engelini geçer).
 *  - Giriş sonrası ypo.js → YPOAndroid.goDesktop() → masaüstüne geçer.
 *  - SPLASH: Başta native yükleme ekranı görünür; YouTube'un ham sayfaları KULLANICIYA
 *    GÖSTERİLMEZ (giriş ekranı hariç). Overlay hazır olunca ypo.js hideSplash() çağırır.
 *  - VIEWPORT: useWideViewPort=false → overlay cihaz genişliğinde, ZOOM YOK.
 *  - GERİ TUŞU: uygulama içinde gezinir; asla YouTube'u açmaz (onBackPressed + __ypoOnBack).
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private lateinit var splash: View
    private var appJs: String = ""
    private var desktopMode = false

    private val MOBILE_UA =
        "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36"
    private val DESKTOP_UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"

    // INSTANT yol: kendi minimal sayfamızı youtube.com kökeninde sun (ağır YT sayfası yüklenmez).
    private val APP_URL = "https://www.youtube.com/__ypoapp__"
    private val REAL_URL = "https://www.youtube.com/feed/playlists"
    private val APP_HTML =
        "<!doctype html><html><head><meta charset=\"utf-8\">" +
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1\">" +
        "<style>html,body{margin:0;background:#0f0f10}</style></head><body></body></html>"

    private val antiDetectJs = """
        (function(){
          try { Object.defineProperty(navigator, 'webdriver', { get: function(){ return undefined; } }); } catch(e){}
          try { if (!window.chrome) { window.chrome = { runtime: {} }; } } catch(e){}
        })();
    """.trimIndent()

    /** ypo.js -> native köprü. */
    inner class Bridge {
        @JavascriptInterface fun goDesktop() { runOnUiThread { showSplash(); switchToDesktop() } }
        @JavascriptInterface fun needLogin() { runOnUiThread { switchToMobileLogin() } }
        @JavascriptInterface fun hideSplash() { runOnUiThread { splash.visibility = View.GONE } }
        @JavascriptInterface fun showSplash() { runOnUiThread { splash.visibility = View.VISIBLE } }
        // INSTANT yol başarısız → kanıtlanmış v1.6 yoluna düş (gerçek YouTube sayfası).
        @JavascriptInterface fun fallbackToReal() {
            runOnUiThread { showSplash(); desktopMode = true; web.settings.userAgentString = DESKTOP_UA; web.loadUrl(REAL_URL) }
        }
        // Ayarların kalıcılığı: WebView localStorage'a güvenmek yerine native SharedPreferences.
        @JavascriptInterface fun saveData(key: String, value: String) {
            try { getSharedPreferences("ypo", android.content.Context.MODE_PRIVATE).edit().putString(key, value).apply() } catch (e: Exception) {}
        }
        @JavascriptInterface fun loadData(key: String): String {
            return try { getSharedPreferences("ypo", android.content.Context.MODE_PRIVATE).getString(key, "") ?: "" } catch (e: Exception) { "" }
        }
    }

    private fun switchToDesktop() {
        if (desktopMode) return
        desktopMode = true
        web.settings.userAgentString = DESKTOP_UA
        web.loadUrl(APP_URL)   // giriş sonrası da INSTANT yol
    }
    private fun switchToMobileLogin() {
        desktopMode = false
        web.settings.userAgentString = MOBILE_UA
        splash.visibility = View.GONE   // kullanıcı giriş ekranını görmeli
        web.loadUrl("https://m.youtube.com/")
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false)
        }

        appJs = try {
            assets.open("ypo.js").bufferedReader(Charsets.UTF_8).use { it.readText() }
        } catch (e: Exception) { "" }

        web = WebView(this)
        web.setBackgroundColor(Color.parseColor("#0F0F0F"))

        val s: WebSettings = web.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.databaseEnabled = true
        s.useWideViewPort = false        // cihaz genişliği → overlay doğru ölçek, ZOOM YOK
        s.loadWithOverviewMode = false
        s.mediaPlaybackRequiresUserGesture = true

        if (WebViewFeature.isFeatureSupported(WebViewFeature.REQUESTED_WITH_HEADER_ALLOW_LIST)) {
            try { WebSettingsCompat.setRequestedWithHeaderOriginAllowList(s, emptySet()) } catch (e: Exception) {}
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            try {
                WebViewCompat.addDocumentStartJavaScript(
                    web, antiDetectJs,
                    setOf("https://www.youtube.com", "https://m.youtube.com",
                          "https://accounts.google.com", "https://www.google.com")
                )
            } catch (e: Exception) {}
            // ypo.js'i sayfa BAŞLARKEN enjekte et → overlay erken açılır (hız).
            // onPageFinished enjeksiyonu da kalır (yedek; __ypoMobileLoaded çift çalışmayı önler).
            if (appJs.isNotEmpty()) {
                try {
                    WebViewCompat.addDocumentStartJavaScript(
                        web, appJs,
                        setOf("https://www.youtube.com", "https://m.youtube.com")
                    )
                } catch (e: Exception) {}
            }
        }

        web.addJavascriptInterface(Bridge(), "YPOAndroid")

        val cm = CookieManager.getInstance()
        cm.setAcceptCookie(true)
        cm.setAcceptThirdPartyCookies(web, true)

        web.webViewClient = object : WebViewClient() {
            // Kendi minimal sayfamızı youtube.com kökeninde sun → origin youtube.com,
            // çerez + same-origin youtubei çalışır, ağır YT sayfası HİÇ yüklenmez.
            override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
                val u = request?.url?.toString() ?: ""
                if (u.contains("/__ypoapp__")) {
                    return WebResourceResponse(
                        "text/html", "utf-8",
                        ByteArrayInputStream(APP_HTML.toByteArray(Charsets.UTF_8))
                    )
                }
                return super.shouldInterceptRequest(view, request)
            }
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                if (url == null) return
                if (url.contains("youtube.com")) {
                    if (appJs.isNotEmpty()) { view?.evaluateJavascript(appJs, null) }
                } else if (desktopMode && (url.contains("accounts.google.com") ||
                           url.contains("/ServiceLogin") || url.contains("/signin"))) {
                    // Masaüstü www oturumsuz → giriş sayfasına yönlendi → mobil girişe geç.
                    switchToMobileLogin()
                }
            }
        }

        // JS alert/confirm: WebChromeClient OLMADAN confirm() sessizce false döner
        // (canlı modda "Uygula" çalışmaz). Native AlertDialog ile gerçek onay.
        web.webChromeClient = object : WebChromeClient() {
            override fun onJsAlert(view: WebView?, url: String?, message: String?, result: JsResult?): Boolean {
                AlertDialog.Builder(this@MainActivity)
                    .setMessage(message)
                    .setPositiveButton(android.R.string.ok) { _, _ -> result?.confirm() }
                    .setOnCancelListener { result?.confirm() }
                    .show()
                return true
            }
            override fun onJsConfirm(view: WebView?, url: String?, message: String?, result: JsResult?): Boolean {
                AlertDialog.Builder(this@MainActivity)
                    .setMessage(message)
                    .setPositiveButton(android.R.string.ok) { _, _ -> result?.confirm() }
                    .setNegativeButton(android.R.string.cancel) { _, _ -> result?.cancel() }
                    .setOnCancelListener { result?.cancel() }
                    .show()
                return true
            }
        }

        // Kök kapsayıcı: WebView + üstünde splash; durum/gezinme çubuğu boşluğu burada.
        val root = FrameLayout(this)
        root.setBackgroundColor(Color.parseColor("#0F0F0F"))
        root.addView(
            web,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
            )
        )
        splash = buildSplash()
        root.addView(
            splash,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
            )
        )
        root.setOnApplyWindowInsetsListener { v, insets ->
            val left: Int; val top: Int; val right: Int; val bottom: Int
            if (Build.VERSION.SDK_INT >= 30) {
                val bars = insets.getInsets(
                    WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout()
                )
                left = bars.left; top = bars.top; right = bars.right; bottom = bars.bottom
            } else {
                @Suppress("DEPRECATION")
                run {
                    left = insets.systemWindowInsetLeft; top = insets.systemWindowInsetTop
                    right = insets.systemWindowInsetRight; bottom = insets.systemWindowInsetBottom
                }
            }
            v.setPadding(left, top, right, bottom)
            insets
        }
        setContentView(root)
        root.requestApplyInsets()

        // Güvenlik ağı: bir şey ters giderse splash en geç 12 sn'de kalkar.
        Handler(Looper.getMainLooper()).postDelayed({ splash.visibility = View.GONE }, 12000)

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState)
            splash.visibility = View.GONE
            return
        }

        // HEP masaüstü başla (girişli kullanıcı = tek yükleme, mobil dans yok).
        // Oturum yoksa www giriş sayfasına yönlenir; onPageFinished bunu yakalayıp
        // mobil girişe geçer. (Çerez ön-kontrolü soğuk açılışta güvenilmezdi → kaldırıldı.)
        desktopMode = true
        s.userAgentString = DESKTOP_UA
        web.loadUrl(APP_URL)   // INSTANT yol; başarısızsa ypo.js fallbackToReal() çağırır
    }

    private fun buildSplash(): View {
        val box = LinearLayout(this)
        box.orientation = LinearLayout.VERTICAL
        box.gravity = Gravity.CENTER
        box.setBackgroundColor(Color.parseColor("#0F0F0F"))
        box.isClickable = true   // altındaki WebView'a dokunma sızmasın
        val pb = ProgressBar(this)
        val tv = TextView(this)
        tv.text = "Liste Düzenleyici"
        tv.setTextColor(Color.parseColor("#F3F3F5"))
        tv.textSize = 16f
        tv.gravity = Gravity.CENTER
        tv.setPadding(0, 30, 0, 0)
        box.addView(pb)
        box.addView(tv)
        return box
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        web.evaluateJavascript("(window.__ypoOnBack ? window.__ypoOnBack() : 'YPO_NONE')") { r ->
            runOnUiThread {
                when {
                    r != null && r.contains("YPO_HANDLED") -> { /* uygulama içinde gezindi */ }
                    r != null && r.contains("YPO_ROOT") -> moveTaskToBack(true)  // kökte: geri al, YT gösterme
                    web.canGoBack() -> web.goBack()
                    else -> finish()
                }
            }
        }
    }
}
