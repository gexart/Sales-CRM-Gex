package com.gexart.calls

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

/**
 * The one Gexart app: the full CRM and billing (the same mobile-first web app) with the call recorder built in.
 * Anything that is not the CRM itself (WhatsApp, the dialer, UPI apps, email, other sites) opens in its own app.
 */
class MainActivity : Activity() {
    private lateinit var prefs: Prefs
    private lateinit var web: WebView
    private lateinit var swipe: SwipeRefreshLayout
    private var home: String = ""
    private var chooser: ValueCallback<Array<Uri>>? = null
    private val pickFile = 51

    @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        home = prefs.baseUrl.ifBlank { getString(R.string.default_crm_url) }
        if (!home.startsWith("https://")) {
            // No CRM address yet: the setup screen asks for it (and the recorder token).
            startActivity(Intent(this, RecorderActivity::class.java))
            finish()
            return
        }

        window.statusBarColor = Color.parseColor("#141E2E")
        web = WebView(this)
        web.setBackgroundColor(Color.parseColor("#141E2E"))
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            setSupportZoom(false)
            userAgentString = "$userAgentString GexartApp/2"
        }
        CookieManager.getInstance().setAcceptCookie(true)
        web.addJavascriptInterface(Bridge(), "GexartApp")

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = route(request.url)

            override fun onPageFinished(view: WebView, url: String?) {
                swipe.isRefreshing = false
            }

            // No signal: show a clear page with a retry link instead of the browser's error screen.
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (!request.isForMainFrame) return
                view.loadDataWithBaseURL(
                    null,
                    "<html><body style='font-family:sans-serif;background:#141E2E;color:#fff;text-align:center;padding:64px 24px'>" +
                        "<h2>No connection</h2><p style='opacity:.7'>Gexart needs the internet to open. Invoice requests you make offline are saved and sent later.</p>" +
                        "<p><a href='$home' style='color:#F47A20;font-size:18px'>Try again</a></p></body></html>",
                    "text/html", "UTF-8", null,
                )
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                chooser?.onReceiveValue(null)
                chooser = callback
                return try {
                    startActivityForResult(params.createIntent(), pickFile)
                    true
                } catch (e: ActivityNotFoundException) {
                    chooser = null
                    false
                }
            }
        }
        // PDFs and Word files the CRM generates: hand them to the phone's viewer.
        web.setDownloadListener { url, _, _, _, _ -> openExternal(Uri.parse(url)) }

        // Pull down at the top of a page to reload it.
        swipe = SwipeRefreshLayout(this).apply {
            addView(web)
            setColorSchemeColors(Color.parseColor("#F47A20"))
            setProgressBackgroundColorSchemeColor(Color.parseColor("#1E2A3F"))
            setOnChildScrollUpCallback { _, _ -> web.scrollY > 0 }
            setOnRefreshListener { web.reload() }
        }
        setContentView(swipe)
        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(deepLink() ?: home)
        if (prefs.configured) {
            CallSyncWorker.schedulePeriodic(this)
            NotifyWorker.schedule(this)
        }
        askNotificationPermission()
    }

    /** Opened from an app shortcut or a link to this CRM: go straight there. */
    private fun deepLink(): String? {
        val path = intent?.getStringExtra("path")
        if (!path.isNullOrBlank() && path.startsWith("/")) return home + path
        val d = intent?.data ?: return null
        val homeHost = Uri.parse(home).host
        return if (d.scheme == "https" && d.host == homeHost) d.toString() else null
    }

    /** A tap on a notification while the app is open goes straight to that screen. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val path = intent.getStringExtra("path")
        if (::web.isInitialized && !path.isNullOrBlank() && path.startsWith("/")) web.loadUrl(home + path)
    }

    private fun askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 9)
        }
    }

    /** true = handled outside the app; false = load inside the WebView. */
    private fun route(uri: Uri): Boolean {
        val scheme = uri.scheme ?: return false
        if ((scheme == "https" || scheme == "http") && uri.host == Uri.parse(home).host) return false
        openExternal(uri)
        return true
    }

    private fun openExternal(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, "No app found to open this", Toast.LENGTH_SHORT).show()
        }
    }

    @Deprecated("Activity result API is not used to keep the app dependency-free")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == pickFile) {
            chooser?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            chooser = null
        }
    }

    @Deprecated("Back handling kept simple to stay dependency-free")
    override fun onBackPressed() {
        if (::web.isInitialized && web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (::web.isInitialized) web.saveState(outState)
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    /** What the web app can ask of the phone. Only the CRM's own pages can reach it (other sites open outside the app). */
    inner class Bridge {
        @JavascriptInterface fun isApp(): Boolean = true

        @JavascriptInterface fun recorderConfigured(): Boolean = prefs.configured

        /** One-tap setup: the web app creates a device token and hands it over here. */
        @JavascriptInterface
        fun configure(url: String, token: String): Boolean {
            prefs.baseUrl = url
            prefs.token = token
            if (!prefs.configured) return false
            if (prefs.syncFrom == 0L) prefs.syncFrom = System.currentTimeMillis()
            CallSyncWorker.schedulePeriodic(this@MainActivity)
            NotifyWorker.schedule(this@MainActivity)
            return true
        }

        /** Folder, permissions and activity log for the call recorder. */
        @JavascriptInterface
        fun openRecorderSettings() {
            runOnUiThread { startActivity(Intent(this@MainActivity, RecorderActivity::class.java)) }
        }
    }
}
