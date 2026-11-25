package expo.modules.ebookforeground

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
import android.os.PowerManager

/**
 * A foreground service with an ongoing notification. While it runs, Android keeps the
 * app's process (and its JavaScript) alive, so chapter downloads continue when the
 * app is in the background or the screen is off.
 */
class DownloadService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Bölümler indiriliyor"
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: ""
    val notification = buildNotification(this, title, text, 0, 0)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    if (wakeLock == null) {
      val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
      wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ebook:download").apply {
        setReferenceCounted(false)
        acquire(MAX_WAKE_MS)
      }
    }
    return START_NOT_STICKY
  }

  // Android 15+ limits data sync services; stop cleanly when the system asks.
  override fun onTimeout(startId: Int, fgsType: Int) {
    stopSelf()
  }

  override fun onDestroy() {
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    super.onDestroy()
  }

  companion object {
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    const val CHANNEL_ID = "downloads"
    const val NOTIFICATION_ID = 4711
    private const val MAX_WAKE_MS = 6L * 60 * 60 * 1000

    private fun ensureChannel(ctx: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (nm.getNotificationChannel(CHANNEL_ID) != null) return
      val channel = NotificationChannel(CHANNEL_ID, "Bölüm indirme", NotificationManager.IMPORTANCE_LOW)
      channel.description = "İndirme sürerken gösterilir"
      channel.setShowBadge(false)
      nm.createNotificationChannel(channel)
    }

    fun buildNotification(ctx: Context, title: String, text: String, progress: Int, max: Int): Notification {
      ensureChannel(ctx)
      val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
      val contentIntent = launch?.let {
        PendingIntent.getActivity(ctx, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      }
      val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(ctx, CHANNEL_ID)
      } else {
        @Suppress("DEPRECATION")
        Notification.Builder(ctx)
      }
      builder
        .setSmallIcon(android.R.drawable.stat_sys_download)
        .setContentTitle(title)
        .setContentText(text)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setContentIntent(contentIntent)
      if (max > 0) builder.setProgress(max, progress, false) else builder.setProgress(0, 0, true)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
      }
      return builder.build()
    }
  }
}
