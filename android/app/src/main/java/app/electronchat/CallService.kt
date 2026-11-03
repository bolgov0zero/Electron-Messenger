package app.electronchat

import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder

// Пока идёт звонок, служба не даёт системе отобрать у приложения микрофон, если экран выключен или приложение свёрнуто
class CallService : Service() {
    override fun onBind(i: Intent?): IBinder? = null
    override fun onStartCommand(i: Intent?, f: Int, id: Int): Int {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("call", "Идущий звонок", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE)
        val n = Notification.Builder(this, "call").setSmallIcon(R.drawable.ic_stat).setContentTitle("Идёт звонок").setContentText("Нажмите, чтобы вернуться").setContentIntent(open).setOngoing(true).build()
        startForeground(2, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        return START_NOT_STICKY
    }
}
