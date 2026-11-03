package app.electronchat

import android.content.Context
import android.content.Intent
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.PowerManager

// Звук звонка: по умолчанию разговорный динамик (в видеозвонке громкая связь); у уха экран гаснет датчиком приближения
object CallAudio {
    private var lock: PowerManager.WakeLock? = null
    private var video = false
    private var on = false

    fun mode(c: Context, enable: Boolean, vid: Boolean, speaker: Boolean) {
        val am = c.getSystemService(AudioManager::class.java)
        if (enable) {
            on = true; video = vid
            am.mode = AudioManager.MODE_IN_COMMUNICATION
            route(c, speaker)
            c.startForegroundService(Intent(c, CallService::class.java))
        } else {
            on = false
            release()
            if (Build.VERSION.SDK_INT >= 31) am.clearCommunicationDevice() else @Suppress("DEPRECATION") { am.isSpeakerphoneOn = false }
            am.mode = AudioManager.MODE_NORMAL
            c.stopService(Intent(c, CallService::class.java))
        }
    }

    fun speaker(c: Context, speaker: Boolean) { if (on) route(c, speaker) }

    private fun route(c: Context, speaker: Boolean) {
        val am = c.getSystemService(AudioManager::class.java)
        var near = false
        if (Build.VERSION.SDK_INT >= 31) {
            val devs = am.availableCommunicationDevices
            val ext = devs.firstOrNull { it.type in listOf(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BLE_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_USB_HEADSET) }
            val target = if (speaker) devs.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
                         else ext ?: devs.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE }
            if (target != null) am.setCommunicationDevice(target)
            near = !speaker && ext == null
        } else {
            @Suppress("DEPRECATION") { am.isSpeakerphoneOn = speaker }
            near = !speaker && !am.isWiredHeadsetOn && !am.isBluetoothScoOn
        }
        if (near && !video) acquire(c) else release()
    }

    private fun acquire(c: Context) {
        if (lock?.isHeld == true) return
        val pm = c.getSystemService(PowerManager::class.java)
        if (!pm.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) return
        lock = pm.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "electron:prox").also { it.acquire() }
    }
    private fun release() { try { if (lock?.isHeld == true) lock?.release() } catch (_: Exception) {}; lock = null }
}
