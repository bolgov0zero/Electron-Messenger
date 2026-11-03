package app.electronchat

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.PowerManager
import android.provider.Settings
import android.text.InputType
import android.view.KeyEvent
import android.webkit.*
import android.view.Gravity
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

// Оболочка вокруг мобильного клиента /m: сам интерфейс — страница сервера, здесь только то, чего не умеет браузер
// (динамик и датчик приближения в звонке, уведомления при закрытом приложении)
class MainActivity : Activity() {
    private lateinit var web: WebView
    private var fileCb: ValueCallback<Array<Uri>>? = null
    private val prefs by lazy { getSharedPreferences("app", Context.MODE_PRIVATE) }

    companion object {
        @Volatile var visible = false
        const val REQ_FILE = 11
        const val REQ_PERM = 12
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        web = WebView(this)
        setContentView(web)
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            userAgentString = userAgentString + " ElectronAndroid/1"
        }
        web.addJavascriptInterface(Bridge(this), "AndroidApp")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean {
                val host = Uri.parse(base()).host
                if (r.url.host == host) return false
                try { startActivity(Intent(Intent.ACTION_VIEW, r.url)) } catch (_: Exception) {}
                return true
            }
            override fun onReceivedError(v: WebView, r: WebResourceRequest, e: WebResourceError) {
                if (r.isForMainFrame) runOnUiThread { showServerScreen("Не удалось открыть сервер. Проверьте адрес.") }
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(r: PermissionRequest) { runOnUiThread { r.grant(r.resources) } }
            override fun onShowFileChooser(v: WebView, cb: ValueCallback<Array<Uri>>, p: FileChooserParams): Boolean {
                fileCb?.onReceiveValue(null); fileCb = cb
                return try { startActivityForResult(p.createIntent(), REQ_FILE); true } catch (_: Exception) { fileCb = null; false }
            }
        }
        web.setDownloadListener { url, ua, cd, mime, _ ->
            try {
                val rq = DownloadManager.Request(Uri.parse(url))
                rq.addRequestHeader("User-Agent", ua)
                rq.addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url) ?: "")
                rq.setMimeType(mime)
                rq.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                rq.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, URLUtil.guessFileName(url, cd, mime))
                (getSystemService(DOWNLOAD_SERVICE) as DownloadManager).enqueue(rq)
                Toast.makeText(this, "Загрузка начата", Toast.LENGTH_SHORT).show()
            } catch (_: Exception) {}
        }
        askPermissions()
        if (base().isEmpty()) showServerScreen(null) else open(intent)
        if (prefs.getString("ws", "").orEmpty().isNotEmpty()) NotifyService.start(this)
    }

    private fun base() = prefs.getString("server", "").orEmpty()

    private fun open(i: Intent?) {
        val u = StringBuilder(base().trimEnd('/') + "/m/")
        val chat = i?.getStringExtra("chatId"); val call = i?.getStringExtra("call")
        val q = listOfNotNull(chat?.let { "chatId=$it" }, call?.let { "call=$it" }, if (call != null && i.getBooleanExtra("answer", false)) "answer=1" else null)
        if (q.isNotEmpty()) u.append('?').append(q.joinToString("&"))
        web.loadUrl(u.toString())
    }

    // Первый экран: адрес сервера. Приложение ни к какому серверу не привязано, адрес можно сменить на экране входа
    private fun showServerScreen(msg: String?) {
        val d = resources.displayMetrics.density
        fun dp(v: Int) = (v * d).toInt()
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
            setBackgroundColor(Color.parseColor("#12171d")); setPadding(dp(28), dp(96), dp(28), dp(28))
        }
        fun tv(t: String, sp: Float, c: String) = TextView(this).apply { text = t; textSize = sp; setTextColor(Color.parseColor(c)); gravity = Gravity.CENTER }
        col.addView(tv("Electron", 30f, "#ffffff").apply { setTypeface(typeface, Typeface.BOLD) })
        col.addView(tv("Корпоративный мессенджер", 15f, "#9aa7b3"), LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6); bottomMargin = dp(36) })
        val et = EditText(this).apply {
            hint = "Адрес сервера"; setText(base()); setSingleLine(); inputType = InputType.TYPE_TEXT_VARIATION_URI
            setTextColor(Color.WHITE); setHintTextColor(Color.parseColor("#6b7885")); setPadding(dp(16), dp(14), dp(16), dp(14))
            background = GradientDrawable().apply { cornerRadius = dp(14).toFloat(); setColor(Color.parseColor("#1c242d")) }
            imeOptions = EditorInfo.IME_ACTION_GO
        }
        col.addView(et, LinearLayout.LayoutParams(-1, -2))
        col.addView(tv("Например, chat.example.com или 192.168.1.10:3000", 12f, "#6b7885"), LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
        val err = tv(msg.orEmpty(), 13f, "#ff6b6b")
        col.addView(err, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) })
        val go = Button(this).apply {
            text = "Подключиться"; isAllCaps = false; textSize = 16f; setTextColor(Color.WHITE)
            background = GradientDrawable().apply { cornerRadius = dp(26).toFloat(); setColor(Color.parseColor("#1a8a8c")) }
        }
        col.addView(go, LinearLayout.LayoutParams(-1, dp(52)).apply { topMargin = dp(16) })
        val submit = {
            var u = et.text.toString().trim().trimEnd('/')
            // как в самом клиенте: адрес с портом — обычное соединение, без порта — защищённое
            if (u.isNotEmpty() && !u.startsWith("http")) u = (if (Regex(":\\d+$").containsMatchIn(u)) "http://" else "https://") + u
            if (u.isEmpty()) err.text = "Введите адрес сервера"
            else { prefs.edit().putString("server", u).apply(); setContentView(web); open(null) }
        }
        go.setOnClickListener { submit() }
        et.setOnEditorActionListener { _, _, _ -> submit(); true }
        setContentView(col)
        et.requestFocus()
    }

    fun changeServer() = runOnUiThread {
        prefs.edit().remove("server").remove("ws").apply()
        NotifyService.stop(this)
        web.loadUrl("about:blank")
        showServerScreen(null)
    }

    private fun askPermissions() {
        val need = mutableListOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA)
        if (Build.VERSION.SDK_INT >= 33) need.add(Manifest.permission.POST_NOTIFICATIONS)
        val miss = need.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (miss.isNotEmpty()) requestPermissions(miss.toTypedArray(), REQ_PERM)
        // Android 14+: полноэкранное уведомление о звонке разрешается отдельно (один раз открываем настройку)
        if (Build.VERSION.SDK_INT >= 34 && !getSystemService(android.app.NotificationManager::class.java).canUseFullScreenIntent() && !prefs.getBoolean("fsi_asked", false)) {
            prefs.edit().putBoolean("fsi_asked", true).apply()
            try { startActivity(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:$packageName"))) } catch (_: Exception) {}
        }
        // Чтобы система не усыпляла службу уведомлений, просим исключить приложение из экономии батареи (один раз)
        val pm = getSystemService(PowerManager::class.java)
        if (!pm.isIgnoringBatteryOptimizations(packageName) && !prefs.getBoolean("battery_asked", false)) {
            prefs.edit().putBoolean("battery_asked", true).apply()
            try { startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))) } catch (_: Exception) {}
        }
    }

    // Приложение уже открыто: страницу не перезагружаем (иначе оборвётся идущий звонок), а сообщаем ей, что открыть
    override fun onNewIntent(i: Intent) {
        super.onNewIntent(i)
        if (base().isEmpty()) return
        val chat = i.getStringExtra("chatId"); val call = i.getStringExtra("call"); val ans = i.getBooleanExtra("answer", false)
        val loaded = web.url?.startsWith(base()) == true
        if (!loaded) { open(i); return }
        fun js(s: String?) = if (s == null) "null" else "'" + s.replace("'", "") + "'"
        web.evaluateJavascript("(function(){var B=window.B;if(!B)return;if(" + js(chat) + "&&B.onOpenChat)B.onOpenChat(parseInt(" + js(chat) + ",10));if(" + js(call) + "&&B.onOpenCall)B.onOpenCall(" + js(call) + "," + ans + ");})()", null)
    }
    override fun onStart() {
        super.onStart(); visible = true
        // Приложение открыто: звонок виден в нём, карточки в шторке больше не нужны
        val nm = getSystemService(android.app.NotificationManager::class.java)
        nm.activeNotifications.filter { it.tag?.startsWith("c") == true }.forEach { nm.cancel(it.tag, it.id) }
    }
    override fun onStop() { super.onStop(); visible = false }
    override fun onKeyDown(k: Int, e: KeyEvent): Boolean {
        if (k == KeyEvent.KEYCODE_BACK && web.canGoBack()) { web.goBack(); return true }
        return super.onKeyDown(k, e)
    }
    @Deprecated("") override fun onActivityResult(rq: Int, rs: Int, d: Intent?) {
        if (rq == REQ_FILE) { fileCb?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(rs, d)); fileCb = null }
        else super.onActivityResult(rq, rs, d)
    }

    fun saveSession(ws: String) {
        prefs.edit().putString("ws", ws).apply()
        if (ws.isEmpty()) NotifyService.stop(this) else NotifyService.start(this)
    }
}

// Что страница может попросить у оболочки
class Bridge(private val a: MainActivity) {
    @JavascriptInterface fun callMode(on: Boolean, video: Boolean, speaker: Boolean) = CallAudio.mode(a, on, video, speaker)
    @JavascriptInterface fun setSpeaker(on: Boolean) = CallAudio.speaker(a, on)
    @JavascriptInterface fun setSession(ws: String) = a.saveSession(ws)
    @JavascriptInterface fun changeServer() = a.changeServer()
}
