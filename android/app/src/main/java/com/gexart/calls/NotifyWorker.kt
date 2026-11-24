package com.gexart.calls

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

/**
 * Shows the CRM's own notifications (invoice waiting for approval, invoice approved or rejected, reminders) on the phone.
 * It asks the CRM every 15 minutes with the phone's device token, so no Google push service is needed.
 */
class NotifyWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    @SuppressLint("MissingPermission")
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val ctx = applicationContext
        val prefs = Prefs(ctx)
        if (!prefs.configured) return@withContext Result.success()
        // First run: start from now, so old notifications never flood the phone.
        if (prefs.notifySince.isBlank()) {
            prefs.notifySince = CallSyncWorker.iso(System.currentTimeMillis())
            return@withContext Result.success()
        }
        val items = try {
            CrmClient(prefs.baseUrl, prefs.token).notifications(prefs.notifySince)
        } catch (e: Exception) {
            return@withContext Result.retry()
        }
        if (items.length() == 0) return@withContext Result.success()

        val allowed = Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        ensureChannel(ctx)
        var latest = prefs.notifySince
        for (i in 0 until items.length()) {
            val n = items.getJSONObject(i)
            latest = n.optString("created_at", latest)
            if (!allowed) continue
            val path = if (n.optString("entity_type") == "billing_approval") "/billing/approvals" else "/"
            val open = Intent(ctx, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra("path", path)
            }
            val id = n.optString("id").hashCode()
            val pending = PendingIntent.getActivity(ctx, id, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            val body = n.optString("body").takeIf { it.isNotBlank() && it != "null" }
            val notification = NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(n.optString("title", "Gexart"))
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setContentIntent(pending)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .build()
            NotificationManagerCompat.from(ctx).notify(id, notification)
        }
        prefs.notifySince = latest
        Result.success()
    }

    companion object {
        private const val CHANNEL = "gexart-updates"
        private const val PERIODIC = "gexart-notify"
        private val network = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        fun ensureChannel(ctx: Context) {
            if (Build.VERSION.SDK_INT < 26) return
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(CHANNEL) == null) {
                nm.createNotificationChannel(NotificationChannel(CHANNEL, "Approvals and reminders", NotificationManager.IMPORTANCE_HIGH))
            }
        }

        fun schedule(context: Context) {
            val req = PeriodicWorkRequestBuilder<NotifyWorker>(15, TimeUnit.MINUTES).setConstraints(network).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, req)
        }
    }
}
