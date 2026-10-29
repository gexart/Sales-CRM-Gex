package com.gexart.calls

import android.content.Context
import android.content.SharedPreferences
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Local settings. The device token is stored in private app storage only. */
class Prefs(context: Context) {
    private val p: SharedPreferences = context.getSharedPreferences("gexart_calls", Context.MODE_PRIVATE)

    var baseUrl: String
        get() = p.getString("base_url", "") ?: ""
        set(v) = p.edit().putString("base_url", v.trim().trimEnd('/')).apply()

    var token: String
        get() = p.getString("token", "") ?: ""
        set(v) = p.edit().putString("token", v.trim()).apply()

    /** content:// tree URI of the folder where the phone's call recorder saves files. */
    var recordingsTree: String
        get() = p.getString("tree", "") ?: ""
        set(v) = p.edit().putString("tree", v).apply()

    /** Only upload calls whose number matches a CRM contact or prospect. */
    var onlyKnownNumbers: Boolean
        get() = p.getBoolean("only_known", true)
        set(v) = p.edit().putBoolean("only_known", v).apply()

    /** Calls that started before this moment are never uploaded (no historical backfill). */
    var syncFrom: Long
        get() = p.getLong("sync_from", 0L)
        set(v) = p.edit().putLong("sync_from", v).apply()

    fun isProcessed(key: String) = p.getStringSet("processed", emptySet())!!.contains(key)

    fun markProcessed(key: String) {
        val set = p.getStringSet("processed", emptySet())!!.toMutableSet()
        set.add(key)
        // Keep the set bounded; entries are "<callLogId>-<startMillis>".
        val trimmed = if (set.size > 500) set.sortedBy { it.substringAfter('-').toLongOrNull() ?: 0L }.takeLast(400).toMutableSet() else set
        p.edit().putStringSet("processed", trimmed).apply()
    }

    val configured get() = baseUrl.startsWith("https://") && token.startsWith("gxd_")

    fun log(line: String) {
        val stamp = SimpleDateFormat("dd MMM HH:mm", Locale.getDefault()).format(Date())
        val lines = (listOf("$stamp  $line") + logLines()).take(40)
        p.edit().putString("log", lines.joinToString("\n")).apply()
    }

    fun logLines(): List<String> = (p.getString("log", "") ?: "").split("\n").filter { it.isNotBlank() }
}
