package com.gexart.calls

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CallLog
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit

/**
 * Reads new entries from the call log, finds each call's recording, and uploads it
 * to the CRM. Calls are processed once (keyed by call-log id + start time); the server
 * is also idempotent on client_ref, so retries never create duplicates.
 */
class CallSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val ctx = applicationContext
        val prefs = Prefs(ctx)
        if (!prefs.configured) return@withContext Result.success()
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_CALL_LOG) != PackageManager.PERMISSION_GRANTED) {
            prefs.log("Call-log permission missing; open the app to grant it")
            return@withContext Result.success()
        }
        val client = CrmClient(prefs.baseUrl, prefs.token)
        val now = System.currentTimeMillis()
        val projection = arrayOf(CallLog.Calls._ID, CallLog.Calls.NUMBER, CallLog.Calls.TYPE, CallLog.Calls.DATE, CallLog.Calls.DURATION)
        val cursor = ctx.contentResolver.query(
            CallLog.Calls.CONTENT_URI, projection,
            "${CallLog.Calls.DATE} >= ?", arrayOf(prefs.syncFrom.toString()),
            "${CallLog.Calls.DATE} ASC",
        ) ?: return@withContext Result.success()
        var retry = false
        cursor.use { c ->
            while (c.moveToNext()) {
                val id = c.getLong(0)
                val number = c.getString(1) ?: continue
                val type = c.getInt(2)
                val start = c.getLong(3)
                val duration = c.getLong(4)
                val key = "$id-$start"
                if (prefs.isProcessed(key)) continue
                val direction = when (type) {
                    CallLog.Calls.INCOMING_TYPE -> "incoming"
                    CallLog.Calls.OUTGOING_TYPE -> "outgoing"
                    CallLog.Calls.MISSED_TYPE, CallLog.Calls.REJECTED_TYPE -> "missed"
                    else -> "unknown"
                }
                // Skip unanswered calls and give the recorder time to finish writing the file.
                if (direction == "missed" || duration <= 0) {
                    prefs.markProcessed(key); continue
                }
                if (now - (start + duration * 1000) < 60_000) {
                    retry = true; continue
                }
                try {
                    val (known, name) = client.lookup(number)
                    if (prefs.onlyKnownNumbers && !known) {
                        prefs.markProcessed(key); continue
                    }
                    val rec = RecordingFinder.find(ctx, prefs.recordingsTree, number, start, duration)
                    val res = client.uploadCall(ctx.contentResolver, number, direction, iso(start), duration, key, rec?.uri, rec?.name, rec?.mime)
                    prefs.markProcessed(key)
                    val who = name ?: number
                    prefs.log(
                        when {
                            res.optBoolean("duplicate") -> "Already uploaded: $who"
                            rec == null -> "Logged call with $who (no recording found)"
                            else -> "Uploaded call with $who"
                        },
                    )
                } catch (e: CrmClient.CrmException) {
                    prefs.log("CRM error for $number: ${e.message}")
                    if (e.status == 401) return@withContext Result.failure()
                    retry = true
                } catch (e: Exception) {
                    prefs.log("Upload failed for $number: ${e.message}")
                    retry = true
                }
            }
        }
        if (retry) Result.retry() else Result.success()
    }

    companion object {
        private const val PERIODIC = "gexart-call-sync"
        private const val ONE_OFF = "gexart-call-sync-now"
        private val network = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        fun iso(millis: Long): String =
            SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date(millis))

        fun schedulePeriodic(context: Context) {
            val req = PeriodicWorkRequestBuilder<CallSyncWorker>(15, TimeUnit.MINUTES).setConstraints(network).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, req)
        }

        fun syncSoon(context: Context, delaySeconds: Long = 90) {
            val req = OneTimeWorkRequestBuilder<CallSyncWorker>().setInitialDelay(delaySeconds, TimeUnit.SECONDS).setConstraints(network).build()
            WorkManager.getInstance(context).enqueueUniqueWork(ONE_OFF, ExistingWorkPolicy.REPLACE, req)
        }
    }
}
