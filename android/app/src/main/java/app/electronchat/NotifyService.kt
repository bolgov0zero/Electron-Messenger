package app.electronchat

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.app.Person
import android.os.Build
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
        nm.deleteNotificationChannel("conn")
        // Постоянное уведомление службы без точки на значке приложения: точка должна означать только настоящие сообщения
        nm.createNotificationChannel(NotificationChannel("conn2", "Приём уведомлений", NotificationManager.IMPORTANCE_MIN).apply { setShowBadge(false) })
        nm.createNotificationChannel(NotificationChannel("msg", "Сообщения", NotificationManager.IMPORTANCE_HIGH))
        nm.createNotificationChannel(NotificationChannel("ring2", "Входящие звонки", NotificationManager.IMPORTANCE_HIGH).apply {
            enableVibration(true); vibrationPattern = longArrayOf(0, 700, 500, 700)
            setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE), AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        })
        val n = Notification.Builder(this, "conn2").setSmallIcon(R.drawable.ic_stat).setContentTitle("Electron").setContentText("Приём уведомлений").setOngoing(true).build()
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

    private fun open(chat: String?, call: String?, answer: Boolean = false): PendingIntent {
        val i = Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        chat?.let { i.putExtra("chatId", it) }; call?.let { i.putExtra("call", it) }; if (answer) i.putExtra("answer", true)
        return PendingIntent.getActivity(this, (chat ?: call ?: "0").hashCode() + (if (answer) 1 else 0), i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun handle(text: String) {
        val nm = getSystemService(NotificationManager::class.java)
        val j = try { JSONObject(text) } catch (_: Exception) { return }
        // Звонок принят, отклонён или закончился где угодно: уведомление убираем, даже если приложение открыто
        when (j.optString("type")) { "call_ended", "call_answered", "call_accepted" -> { nm.cancel("c" + j.optString("call_id"), 0); return } }
        if (MainActivity.visible) return   // приложение открыто: всё видно в нём
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
                val name = j.optJSONObject("from")?.optString("name").orEmpty().ifEmpty { "Звонок" }
                val video = j.optBoolean("video")
                val pi = open(chat, id); val ans = open(chat, id, true)
                val b = Notification.Builder(this, "ring2").setSmallIcon(R.drawable.ic_stat)
                    .setCategory(Notification.CATEGORY_CALL).setContentIntent(pi).setFullScreenIntent(pi, true)
                    .setOngoing(true).setVisibility(Notification.VISIBILITY_PUBLIC)
                    .setTimeoutAfter(j.optLong("timeout", 30) * 1000)
                val decline = PendingIntent.getBroadcast(this, id.hashCode(), Intent(this, DeclineReceiver::class.java).putExtra("call", id), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
                if (Build.VERSION.SDK_INT >= 31) {
                    val p = Person.Builder().setName(name).setImportant(true).build()
                    b.setStyle(Notification.CallStyle.forIncomingCall(p, decline, ans))
                } else {
                    b.setContentTitle(if (video) "Входящий видеозвонок" else "Входящий аудиозвонок").setContentText(name)
                    b.addAction(Notification.Action.Builder(null, "Ответить", ans).build())
                    b.addAction(Notification.Action.Builder(null, "Отклонить", decline).build())
                }
                val n = b.build()
                n.flags = n.flags or Notification.FLAG_INSISTENT   // звонит и вибрирует, пока не ответят
                nm.notify("c$id", 0, n)
            }
            "call_ended", "call_answered", "call_accepted" -> nm.cancel("c" + j.optString("call_id"), 0)
        }
    }
}
