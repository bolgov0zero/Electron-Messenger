package app.electronchat

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import okhttp3.*
import org.json.JSONObject
import java.util.concurrent.TimeUnit

// Держит соединение с сервером (WebView не получает Web Push) и показывает уведомления, пока приложение закрыто или свёрнуто.
// Сервер присылает ровно то, что отправил бы в push (тихие часы и отключённые чаты он уже учёл), а звонки приходят событием call_incoming
class NotifyService : Service() {
    private val http = OkHttpClient.Builder().pingInterval(30, TimeUnit.SECONDS).readTimeout(0, TimeUnit.MILLISECONDS).build()
    private val h = Handler(Looper.getMainLooper())
    private var sock: WebSocket? = null
    private var delay = 3000L
    private var stopped = false

    companion object {
        fun start(c: Context) { try { c.startForegroundService(Intent(c, NotifyService::class.java)) } catch (_: Exception) {} }
        fun stop(c: Context) { c.stopService(Intent(c, NotifyService::class.java)) }
    }

    override fun onBind(i: Intent?): IBinder? = null

    override fun onStartCommand(i: Intent?, f: Int, id: Int): Int {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("conn", "Приём уведомлений", NotificationManager.IMPORTANCE_MIN))
        nm.createNotificationChannel(NotificationChannel("msg", "Сообщения", NotificationManager.IMPORTANCE_HIGH))
        nm.createNotificationChannel(NotificationChannel("ring", "Входящие звонки", NotificationManager.IMPORTANCE_HIGH).apply { enableVibration(true) })
        val n = Notification.Builder(this, "conn").setSmallIcon(R.drawable.ic_stat).setContentTitle("Electron").setContentText("Приём уведомлений").setOngoing(true).build()
        startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        connect()
        return START_STICKY
    }

    override fun onDestroy() { stopped = true; h.removeCallbacksAndMessages(null); sock?.cancel(); super.onDestroy() }

    private fun connect() {
        if (stopped) return
        val url = getSharedPreferences("app", Context.MODE_PRIVATE).getString("ws", "").orEmpty()
        if (url.isEmpty()) { stopSelf(); return }
        sock?.cancel()
        sock = http.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
            override fun onOpen(w: WebSocket, r: Response) { delay = 3000 }
            override fun onMessage(w: WebSocket, text: String) { h.post { handle(text) } }
            override fun onClosed(w: WebSocket, code: Int, reason: String) { retry(code) }
            override fun onFailure(w: WebSocket, t: Throwable, r: Response?) { retry(r?.code ?: 0) }
        })
    }

    private fun retry(code: Int) {
        if (stopped) return
        // 1008: токен недействителен (выход или отозванная сессия) — до нового входа не пытаемся
        if (code == 1008 || code == 401) return
        h.postDelayed({ connect() }, delay); delay = minOf(delay * 2, 60000L)
    }

    private fun open(chat: String?, call: String?): PendingIntent {
        val i = Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        chat?.let { i.putExtra("chatId", it) }; call?.let { i.putExtra("call", it) }
        return PendingIntent.getActivity(this, (chat ?: call ?: "0").hashCode(), i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun handle(text: String) {
        if (MainActivity.visible) return   // приложение открыто: всё видно в нём
        val nm = getSystemService(NotificationManager::class.java)
        val j = try { JSONObject(text) } catch (_: Exception) { return }
        when (j.optString("type")) {
            "native_push" -> {
                val p = j.optJSONObject("payload") ?: return
                if (p.has("call")) return   // звонки приходят событием call_incoming
                val chat = p.opt("chatId")?.toString()
                val n = Notification.Builder(this, "msg").setSmallIcon(R.drawable.ic_stat)
                    .setContentTitle(p.optString("title", "Новое сообщение")).setContentText(p.optString("body"))
                    .setStyle(Notification.BigTextStyle().bigText(p.optString("body"))).setAutoCancel(true).setContentIntent(open(chat, null)).build()
                nm.notify("m" + (chat ?: ""), 0, n)
            }
            "call_incoming" -> {
                val id = j.optString("call_id"); val chat = j.opt("chat_id")?.toString()
                val name = j.optJSONObject("from")?.optString("name").orEmpty()
                val pi = open(chat, id)
                val n = Notification.Builder(this, "ring").setSmallIcon(R.drawable.ic_stat)
                    .setContentTitle(if (j.optBoolean("video")) "Входящий видеозвонок" else "Входящий аудиозвонок").setContentText(name)
                    .setCategory(Notification.CATEGORY_CALL).setContentIntent(pi).setFullScreenIntent(pi, true)
                    .setTimeoutAfter(j.optLong("timeout", 30) * 1000).setAutoCancel(true).build()
                nm.notify("c$id", 0, n)
            }
            "call_ended", "call_answered", "call_accepted" -> nm.cancel("c" + j.optString("call_id"), 0)
        }
    }
}
