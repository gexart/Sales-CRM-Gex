package com.gexart.calls

import android.content.ContentResolver
import android.net.Uri
import org.json.JSONObject
import java.io.DataOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** Minimal HTTPS client for the CRM device API (bearer device token). */
class CrmClient(private val baseUrl: String, private val token: String) {

    class CrmException(val status: Int, message: String) : Exception(message)

    private fun open(path: String, method: String): HttpURLConnection {
        val c = URL("$baseUrl/api/v1/device$path").openConnection() as HttpURLConnection
        c.requestMethod = method
        c.connectTimeout = 15_000
        c.readTimeout = 120_000
        c.setRequestProperty("Authorization", "Bearer $token")
        c.setRequestProperty("Accept", "application/json")
        return c
    }

    private fun read(c: HttpURLConnection): JSONObject {
        val code = c.responseCode
        val body = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
        val json = runCatching { JSONObject(body) }.getOrElse { JSONObject() }
        if (code !in 200..299) {
            val msg = json.optJSONObject("error")?.optString("message") ?: "HTTP $code"
            throw CrmException(code, msg)
        }
        return json.optJSONObject("data") ?: JSONObject()
    }

    /** Returns the signed-in user's name if the token is valid. */
    fun ping(): String = read(open("/ping", "GET")).optString("user")

    /** Whether the number belongs to a CRM contact or prospect, and their name. */
    fun lookup(phone: String): Pair<Boolean, String?> {
        val r = read(open("/lookup?phone=${URLEncoder.encode(phone, "UTF-8")}", "GET"))
        return r.optBoolean("known") to r.optString("name").takeIf { it.isNotBlank() && it != "null" }
    }

    /** Uploads call metadata and (optionally) the recording. Idempotent on clientRef. */
    fun uploadCall(
        resolver: ContentResolver,
        phone: String,
        direction: String,
        startedAtIso: String,
        durationSeconds: Long,
        clientRef: String,
        audio: Uri?,
        audioName: String?,
        audioMime: String?,
    ): JSONObject {
        val boundary = "----gexart${System.currentTimeMillis()}"
        val c = open("/calls", "POST")
        c.doOutput = true
        c.setChunkedStreamingMode(64 * 1024)
        c.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
        DataOutputStream(c.outputStream).use { out ->
            fun field(name: String, value: String) {
                out.writeBytes("--$boundary\r\nContent-Disposition: form-data; name=\"$name\"\r\n\r\n")
                out.write(value.toByteArray(Charsets.UTF_8))
                out.writeBytes("\r\n")
            }
            field("phone_number", phone)
            field("direction", direction)
            field("started_at", startedAtIso)
            field("duration_seconds", durationSeconds.toString())
            field("client_ref", clientRef)
            if (audio != null) {
                val safeName = (audioName ?: "recording").replace("\"", "")
                out.writeBytes("--$boundary\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"$safeName\"\r\n")
                out.writeBytes("Content-Type: ${audioMime ?: "application/octet-stream"}\r\n\r\n")
                resolver.openInputStream(audio)?.use { it.copyTo(out, 64 * 1024) }
                out.writeBytes("\r\n")
            }
            out.writeBytes("--$boundary--\r\n")
        }
        return read(c)
    }
}
