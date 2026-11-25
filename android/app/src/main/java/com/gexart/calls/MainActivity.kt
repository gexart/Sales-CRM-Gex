package com.gexart.calls

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.IntentFilter
import android.os.Environment
import android.os.Message
import android.util.Base64
import android.webkit.URLUtil
import android.webkit.WebResourceResponse
import androidx.core.content.FileProvider
import java.io.File
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
        // A leftover or odd saved address must never stop the app opening: fall back to the built-in one.
        home = prefs.baseUrl.takeIf { it.startsWith("https://") } ?: getString(R.string.default_crm_url)

        window.statusBarColor = Color.parseColor("#141E2E")
        window.navigationBarColor = Color.parseColor("#141E2E")
        web = try {
            WebView(this)
        } catch (e: Exception) {
            Toast.makeText(this, "Update Android System WebView from the Play Store, then reopen the app", Toast.LENGTH_LONG).show()
            finish()
            return
        }
        web.setBackgroundColor(Color.parseColor("#141E2E"))
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            setSupportZoom(false)
            javaScriptCanOpenWindowsAutomatically = true
            setSupportMultipleWindows(true)
            userAgentString = "$userAgentString GexartApp/2"
        }
        CookieManager.getInstance().setAcceptCookie(true)
        web.addJavascriptInterface(Bridge(), "GexartApp")

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = route(request.url)

            override fun onPageFinished(view: WebView, url: String?) {
                swipe.isRefreshing = false
                // Files the page builds itself (zip, CSV) arrive without a name; remember the one the page's link asked for.
                view.evaluateJavascript("if(!window.__gxHook){window.__gxHook=1;document.addEventListener('click',function(e){var a=e.target&&e.target.closest?e.target.closest('a[download]'):null;if(a)window.__gxName=a.getAttribute('download')||''},true)}", null)
            }

            // The web view's own process was killed (low memory): rebuild the screen instead of leaving it white.
            override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail): Boolean {
                runOnUiThread { recreate() }
                return true
            }

            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
                if (request.isForMainFrame && errorResponse.statusCode >= 500) showOffline(view)
            }

            // No signal: show a clear page with a retry link instead of the browser's error screen.
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (!request.isForMainFrame) return
                showOffline(view)
            }

            private fun showOffline(view: WebView) {
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
            override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
                val popup = WebView(this@MainActivity)
                popup.webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                        handleLink(request.url)
                        v.destroy()
                        return true
                    }
                    override fun onPageStarted(v: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                        if (!url.isNullOrBlank() && url != "about:blank") {
                            handleLink(Uri.parse(url))
                            v.stopLoading()
                            v.destroy()
                        }
                    }
                }
                (resultMsg.obj as WebView.WebViewTransport).webView = popup
                resultMsg.sendToTarget()
                return true
            }

            override fun onConsoleMessage(m: android.webkit.ConsoleMessage): Boolean {
                if (m.messageLevel() == android.webkit.ConsoleMessage.MessageLevel.ERROR) lastJsError = "${m.message()} (${m.sourceId().substringAfterLast('/')}:${m.lineNumber()})"
                return true
            }

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
        web.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ -> download(url, userAgent, contentDisposition, mimeType) }
        registerDownloadDone()

        // Pull down at the top of a page to reload it.
        swipe = SwipeRefreshLayout(this).apply {
            // Must fill the container: with the default wrap-content size the web view reports 0 for every vh/dvh unit, and the whole app collapses to nothing.
            addView(web, android.view.ViewGroup.LayoutParams(android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.MATCH_PARENT))
            setColorSchemeColors(Color.parseColor("#F47A20"))
            setProgressBackgroundColorSchemeColor(Color.parseColor("#1E2A3F"))
            setOnChildScrollUpCallback { _, _ -> web.scrollY > 0 }
            setOnRefreshListener { web.reload() }
        }
        // Keep the page clear of the status bar, the gesture bar and the keyboard. The padding goes on a plain wrapper, never on the
        // pull-to-refresh layout or the WebView, which can stop the page repainting.
        val frame = android.widget.FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#141E2E"))
            addView(swipe, android.widget.FrameLayout.LayoutParams(-1, -1))
            setOnApplyWindowInsetsListener { v, insets ->
                val top = if (Build.VERSION.SDK_INT >= 30) insets.getInsets(android.view.WindowInsets.Type.systemBars()).top else insets.systemWindowInsetTop
                val sysBottom = if (Build.VERSION.SDK_INT >= 30) insets.getInsets(android.view.WindowInsets.Type.systemBars()).bottom else insets.systemWindowInsetBottom
                val ime = if (Build.VERSION.SDK_INT >= 30) insets.getInsets(android.view.WindowInsets.Type.ime()).bottom else 0
                v.setPadding(0, top, 0, maxOf(sysBottom, ime))
                @Suppress("DEPRECATION")
                if (Build.VERSION.SDK_INT >= 30) android.view.WindowInsets.CONSUMED else insets.consumeSystemWindowInsets()
            }
        }
        setContentView(frame)
        frame.requestApplyInsets()
        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) web.loadUrl(deepLink() ?: home)
        // Light status-bar icons on the dark header.
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = window.decorView.systemUiVisibility and android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR.inv()
        if (prefs.configured) {
            CallSyncWorker.schedulePeriodic(this)
            NotifyWorker.schedule(this)
        }
        askNotificationPermission()
        watchForBlank()
    }

    private var lastJsError = ""
    private val handler = android.os.Handler(android.os.Looper.getMainLooper())

    private var blankStrikes = 0
    private var healed = false

    /**
     * Every 10 seconds: has the page drawn any text? Two empty checks in a row (a white screen) clear the saved web files and reload once;
     * if it is still empty, say why instead of leaving a blank screen.
     */
    private fun watchForBlank() {
        handler.postDelayed({
            if (isFinishing || isDestroyed) return@postDelayed
            web.evaluateJavascript("(function(){var r=document.getElementById('root');return r?r.innerText.trim().length:-1})()") { v ->
                val n = (v ?: "0").trim().toIntOrNull() ?: 0
                if (n >= 3) {
                    blankStrikes = 0
                } else if (++blankStrikes >= 2) {
                    blankStrikes = 0
                    if (!healed) {
                        healed = true
                        web.clearCache(true)
                        android.webkit.WebStorage.getInstance().deleteAllData()
                        web.loadUrl(home)
                    } else {
                        val why = android.text.Html.escapeHtml(lastJsError.ifBlank { "the page did not respond" })
                        web.loadDataWithBaseURL(null,
                            "<html><body style='font-family:sans-serif;background:#141E2E;color:#fff;padding:48px 24px'>" +
                                "<h2>The app could not start</h2><p style='opacity:.7'>Please update Android System WebView and Google Chrome from the Play Store, then reopen.</p>" +
                                "<p style='font-size:12px;opacity:.5'>$why</p><p><a href='$home' style='color:#F47A20;font-size:18px'>Try again</a></p></body></html>",
                            "text/html", "UTF-8", null)
                    }
                }
            }
            watchForBlank()
        }, 10000)
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

    // ---- Files: PDFs, receipts, Word, zip, CSV and Tally files ----
    private val waiting = mutableMapOf<Long, String>()
    private var doneReceiver: BroadcastReceiver? = null

    private fun registerDownloadDone() {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context, i: Intent) {
                val id = i.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L)
                if (waiting.remove(id) == null) return
                val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                val uri = dm.getUriForDownloadedFile(id)
                if (uri == null) {
                    Toast.makeText(this@MainActivity, "The file could not be downloaded", Toast.LENGTH_LONG).show()
                    return
                }
                openFile(uri, dm.getMimeTypeForDownloadedFile(id))
            }
        }
        doneReceiver = receiver
        val filter = IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED) else registerReceiver(receiver, filter)
    }

    private fun openFile(uri: Uri, mime: String?) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime ?: "*/*").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, "Saved in Downloads. Install a PDF viewer to open it.", Toast.LENGTH_LONG).show()
        }
    }

    /** The server names its files (GX_21_26-27.pdf); take that name, and make sure a PDF ends in .pdf. */
    private fun fileNameFor(url: String, contentDisposition: String?, mimeType: String?): String {
        val fromHeader = contentDisposition?.let { Regex("filename\\*?=(?:UTF-8'')?\"?([^\";]+)\"?", RegexOption.IGNORE_CASE).find(it)?.groupValues?.get(1)?.trim() }
        var name = fromHeader?.takeIf { it.isNotBlank() } ?: URLUtil.guessFileName(url, contentDisposition, mimeType)
        if ((mimeType ?: "").contains("pdf", true) && !name.endsWith(".pdf", true)) name = name.substringBeforeLast('.', name) + ".pdf"
        return name
    }

    /** Files need the signed-in session, so the app downloads them itself instead of handing the link to the browser. */
    private fun download(url: String, userAgent: String?, contentDisposition: String?, mimeType: String?) {
        if (url.startsWith("blob:")) {
            // Files the page builds itself (the zip of invoices, CSV exports): read them out of the page.
            web.evaluateJavascript("(window.__gxName||'')") { raw ->
                val picked = try { org.json.JSONTokener(raw ?: "\"\"").nextValue() as? String } catch (e: Exception) { null }
                val name = picked?.takeIf { it.isNotBlank() } ?: fileNameFor(url, contentDisposition, mimeType)
                val js = "(function(){fetch('" + url + "').then(function(r){return r.blob()}).then(function(b){var f=new FileReader();f.onloadend=function(){GexartApp.saveBlob(" +
                    org.json.JSONObject.quote(name) + "," + org.json.JSONObject.quote(mimeType ?: "application/octet-stream") + ",f.result)};f.readAsDataURL(b)})})()"
                web.evaluateJavascript(js, null)
            }
            return
        }
        try {
            val name = fileNameFor(url, contentDisposition, mimeType)
            val req = DownloadManager.Request(Uri.parse(url))
                .setTitle(name)
                .setMimeType(mimeType)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, name)
            CookieManager.getInstance().getCookie(url)?.let { req.addRequestHeader("Cookie", it) }
            if (!userAgent.isNullOrBlank()) req.addRequestHeader("User-Agent", userAgent)
            val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            waiting[dm.enqueue(req)] = name
            Toast.makeText(this, "Downloading $name", Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Toast.makeText(this, "The file could not be downloaded", Toast.LENGTH_LONG).show()
        }
    }

    /** A link the page opened in a new window: files download, other pages of this app load here, anything else opens in its own app. */
    private fun handleLink(uri: Uri) {
        val sameApp = (uri.scheme == "https" || uri.scheme == "http") && uri.host == Uri.parse(home).host
        val path = uri.path.orEmpty()
        val isFile = path.endsWith("/pdf") || path.endsWith("/docx") || path.endsWith("/thermal") || path.endsWith("/receipt") || path.endsWith("/tally-xml") || path.endsWith(".pdf")
        when {
            sameApp && isFile -> {
                // The page adds ?name=<invoice or receipt number>; it becomes the file name.
                val ext = when { path.endsWith("/docx") -> "docx"; path.endsWith("/tally-xml") -> "xml"; else -> "pdf" }
                val mime = when (ext) { "docx" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document"; "xml" -> "application/xml"; else -> "application/pdf" }
                val base = uri.getQueryParameter("name")?.replace(Regex("[\\/:*?\"<>|]"), "-")?.takeIf { it.isNotBlank() }
                download(uri.toString(), web.settings.userAgentString, base?.let { "attachment; filename=\"$it.$ext\"" }, mime)
            }
            sameApp -> web.loadUrl(uri.toString())
            else -> openExternal(uri)
        }
    }

    override fun onDestroy() {
        doneReceiver?.let { try { unregisterReceiver(it) } catch (e: Exception) { } }
        super.onDestroy()
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

        /** The page hands over a file it built (zip, CSV): save it and open it. */
        @JavascriptInterface
        fun saveBlob(name: String, mime: String, dataUrl: String) {
            try {
                val bytes = Base64.decode(dataUrl.substringAfter(','), Base64.DEFAULT)
                val dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: cacheDir
                val safe = name.replace(Regex("[\\\\/:*?\"<>|]"), "-")
                val file = File(dir, safe)
                file.writeBytes(bytes)
                val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.files", file)
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "Saved $safe", Toast.LENGTH_SHORT).show()
                    openFile(uri, mime)
                }
            } catch (e: Exception) {
                runOnUiThread { Toast.makeText(this@MainActivity, "The file could not be saved", Toast.LENGTH_LONG).show() }
            }
        }

        /** Folder, permissions and activity log for the call recorder. */
        @JavascriptInterface
        fun openRecorderSettings() {
            runOnUiThread { startActivity(Intent(this@MainActivity, RecorderActivity::class.java)) }
        }
    }
}
