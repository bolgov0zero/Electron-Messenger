package app.electronchat

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import kotlin.concurrent.thread

// «Отклонить» в уведомлении о звонке: запрос серверу с тем же входом, что у фоновой службы
class DeclineReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        val id = i.getStringExtra("call") ?: return
        c.getSystemService(NotificationManager::class.java).cancel("c$id", 0)
        val ws = c.getSharedPreferences("app", Context.MODE_PRIVATE).getString("ws", "").orEmpty()
        val m = Regex("^ws(s?)://([^/]+)/ws\\?.*token=([^&]+)").find(ws) ?: return
        val base = (if (m.groupValues[1] == "s") "https://" else "http://") + m.groupValues[2]
        val pending = goAsync()
        thread {
            try {
                OkHttpClient().newCall(Request.Builder().url("$base/api/calls/$id/decline").header("Authorization", "Bearer " + m.groupValues[3])
                    .post("{}".toRequestBody("application/json".toMediaType())).build()).execute().close()
            } catch (_: Exception) {}
            pending.finish()
        }
    }
}
