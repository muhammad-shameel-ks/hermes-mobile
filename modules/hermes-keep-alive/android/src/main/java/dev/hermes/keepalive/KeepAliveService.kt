package dev.hermes.keepalive

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log

/**
 * Keeps the app process running, and with it the gateway socket, while a turn
 * streams or waits on the reader and the app is out of sight. It does no work
 * of its own: the JS side starts it when the app leaves the foreground with live
 * work, refreshes its line as that work changes, and stops it when the work is
 * done or the app is back.
 */
class KeepAliveService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Hermes"
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: ""
    val notification = buildNotification(title, text)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (error: Exception) {
      Log.w(TAG, "Could not hold the app in the foreground", error)
      stopSelf()
    }
    // a process the system killed has no socket to come back to
    return START_NOT_STICKY
  }

  /** Android 15's data-sync budget ran out: let the app go like any other backgrounded one */
  override fun onTimeout(startId: Int, fgsType: Int) {
    stopSelf()
  }

  private fun buildNotification(title: String, text: String): Notification {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      if (manager.getNotificationChannel(CHANNEL_ID) == null) {
        val channel = NotificationChannel(CHANNEL_ID, "Background connection", NotificationManager.IMPORTANCE_LOW).apply {
          description = "Shown while Hermes stays connected to finish a reply or to hear when it needs you."
          setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
      }
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this).setPriority(Notification.PRIORITY_LOW)
    }

    val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val open = launch?.let { PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT) }

    return builder
      .setSmallIcon(smallIcon())
      .setContentTitle(title)
      .setContentText(text)
      .setContentIntent(open)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setCategory(Notification.CATEGORY_SERVICE)
      .build()
  }

  /** the monochrome glyph expo-notifications writes into the app's resources, else the launcher icon */
  private fun smallIcon(): Int {
    val glyph = resources.getIdentifier("notification_icon", "drawable", packageName)
    return if (glyph != 0) glyph else applicationInfo.icon
  }

  companion object {
    private const val TAG = "HermesKeepAlive"
    const val CHANNEL_ID = "hermes-background"
    const val NOTIFICATION_ID = 7301
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
  }
}
