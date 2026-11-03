package app.electronchat

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        if (c.getSharedPreferences("app", Context.MODE_PRIVATE).getString("ws", "").orEmpty().isNotEmpty()) NotifyService.start(c)
    }
}
