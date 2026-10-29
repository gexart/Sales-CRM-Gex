package com.gexart.calls

import android.content.Context
import android.net.Uri
import androidx.documentfile.provider.DocumentFile

/**
 * Finds the recording that the phone's own call recorder saved for a given call,
 * inside the folder the user picked. Matches on file timestamp (the recorder writes
 * the file when the call ends) and, when present, digits of the number in the name.
 */
object RecordingFinder {
    private val AUDIO_EXT = setOf("mp3", "m4a", "aac", "amr", "3gp", "3gpp", "ogg", "opus", "wav", "awb", "mp4")

    data class Match(val uri: Uri, val name: String, val mime: String?)

    fun find(context: Context, treeUri: String, number: String, startMillis: Long, durationSeconds: Long): Match? {
        if (treeUri.isBlank()) return null
        val root = DocumentFile.fromTreeUri(context, Uri.parse(treeUri)) ?: return null
        val files = mutableListOf<DocumentFile>()
        collect(root, files, depth = 0)
        val endMillis = startMillis + durationSeconds * 1000
        val digits = number.filter { it.isDigit() }.takeLast(10)
        return files
            .filter { f ->
                val m = f.lastModified()
                // Written at or shortly after the call ended (allow clock skew and slow encoders).
                m in (startMillis - 60_000)..(endMillis + 5 * 60_000)
            }
            .sortedWith(compareByDescending<DocumentFile> { digits.isNotEmpty() && (it.name ?: "").filter { c -> c.isDigit() }.contains(digits) }
                .thenBy { kotlin.math.abs(it.lastModified() - endMillis) })
            .firstOrNull()
            ?.let { Match(it.uri, it.name ?: "recording", it.type) }
    }

    private fun collect(dir: DocumentFile, out: MutableList<DocumentFile>, depth: Int) {
        for (f in dir.listFiles()) {
            if (f.isDirectory && depth < 2) collect(f, out, depth + 1)
            else if (f.isFile && (f.name?.substringAfterLast('.', "")?.lowercase() in AUDIO_EXT)) out.add(f)
        }
    }
}
