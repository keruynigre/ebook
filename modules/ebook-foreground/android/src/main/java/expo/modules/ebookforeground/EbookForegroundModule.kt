package expo.modules.ebookforeground

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class EbookForegroundModule : Module() {
  private val context: Context?
    get() = appContext.reactContext?.applicationContext

  override fun definition() = ModuleDefinition {
    Name("EbookForeground")

    /** Starts the service. Returns false if Android refused (e.g. the app was already in the background). */
    Function("start") { title: String, text: String ->
      val ctx = context ?: return@Function false
      val intent = Intent(ctx, DownloadService::class.java)
        .putExtra(DownloadService.EXTRA_TITLE, title)
        .putExtra(DownloadService.EXTRA_TEXT, text)
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(intent) else ctx.startService(intent)
        true
      } catch (e: Exception) {
        false
      }
    }

    Function("update") { title: String, text: String, progress: Int, max: Int ->
      val ctx = context ?: return@Function Unit
      val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      try {
        nm.notify(DownloadService.NOTIFICATION_ID, DownloadService.buildNotification(ctx, title, text, progress, max))
      } catch (e: Exception) {
        // Notifications may be turned off; the service keeps running regardless.
      }
      Unit
    }

    Function("stop") {
      val ctx = context ?: return@Function Unit
      ctx.stopService(Intent(ctx, DownloadService::class.java))
      Unit
    }
  }
}
