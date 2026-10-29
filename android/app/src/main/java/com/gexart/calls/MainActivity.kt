package com.gexart.calls

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast

/** Single-screen setup: CRM address + device token, recordings folder, permissions, status. */
class MainActivity : Activity() {
    private lateinit var prefs: Prefs
    private lateinit var status: TextView
    private lateinit var folderLabel: TextView
    private lateinit var logView: TextView
    private val pickFolder = 41

    private val brand = Color.parseColor("#141E2E")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        val pad = dp(20)
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad, pad, pad) }

        col.addView(TextView(this).apply { text = "Gexart"; textSize = 26f; setTypeface(typeface, Typeface.BOLD); setTextColor(brand) })
        col.addView(TextView(this).apply {
            text = "Uploads recordings of your client calls to the Gexart CRM, where they are matched to the contact, transcribed and summarised."
            setTextColor(Color.DKGRAY); setPadding(0, dp(4), 0, dp(16))
        })

        col.addView(label("1 · Connect to the CRM"))
        val url = edit("https://your-crm.workers.dev", prefs.baseUrl, InputType.TYPE_TEXT_VARIATION_URI)
        val token = edit("Device token from Settings → Phone app (gxd_…)", prefs.token, InputType.TYPE_TEXT_VARIATION_PASSWORD)
        col.addView(url); col.addView(token)
        status = TextView(this).apply { setPadding(0, dp(6), 0, dp(6)) }
        col.addView(button("Save & test connection") {
            prefs.baseUrl = url.text.toString()
            prefs.token = token.text.toString()
            if (!prefs.configured) { setStatus("Use an https:// address and a token starting with gxd_", false); return@button }
            setStatus("Testing…", true)
            Thread {
                val result = runCatching { CrmClient(prefs.baseUrl, prefs.token).ping() }
                runOnUiThread {
                    result.onSuccess { name ->
                        if (prefs.syncFrom == 0L) prefs.syncFrom = System.currentTimeMillis()
                        CallSyncWorker.schedulePeriodic(this)
                        setStatus("Connected as $name. Calls from now on will sync.", true)
                    }.onFailure { setStatus("Could not connect: ${it.message}", false) }
                }
            }.start()
        })
        col.addView(status)

        col.addView(label("2 · Choose your call-recordings folder"))
        col.addView(TextView(this).apply {
            text = "Turn on call recording in your phone's dialer first (Phone → Settings → Record calls). Then pick the folder it saves to, e.g. Recordings/Call or Music/Recordings/Call Recordings."
            setTextColor(Color.DKGRAY)
        })
        folderLabel = TextView(this).apply { setPadding(0, dp(6), 0, 0) }
        col.addView(folderLabel)
        col.addView(button("Choose folder") {
            startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE), pickFolder)
        })

        col.addView(label("3 · Permissions"))
        col.addView(button("Grant call-log & phone permissions") { requestPerms() })

        col.addView(label("4 · Privacy"))
        col.addView(Switch(this).apply {
            text = "Only upload calls with numbers in the CRM"
            isChecked = prefs.onlyKnownNumbers
            setOnCheckedChangeListener { _, v -> prefs.onlyKnownNumbers = v }
        })
        col.addView(TextView(this).apply {
            text = "Personal calls are skipped when this is on. Tell the people you call that the call is recorded."
            setTextColor(Color.GRAY); textSize = 12f
        })

        col.addView(label("Activity"))
        col.addView(button("Sync now") { CallSyncWorker.syncSoon(this, 0); toast("Sync started") })
        logView = TextView(this).apply { setTextColor(Color.DKGRAY); textSize = 12f; typeface = Typeface.MONOSPACE }
        col.addView(logView)

        setContentView(ScrollView(this).apply { addView(col) })
        refresh()
        if (prefs.configured) CallSyncWorker.schedulePeriodic(this)
    }

    override fun onResume() {
        super.onResume()
        refresh()
    }

    @Deprecated("Activity result API is not used to keep the app dependency-free")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == pickFolder && resultCode == RESULT_OK) {
            val uri = data?.data ?: return
            contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            prefs.recordingsTree = uri.toString()
            refresh()
        }
    }

    private fun requestPerms() {
        val perms = mutableListOf(Manifest.permission.READ_CALL_LOG, Manifest.permission.READ_PHONE_STATE)
        if (Build.VERSION.SDK_INT >= 33) perms += Manifest.permission.POST_NOTIFICATIONS
        requestPermissions(perms.toTypedArray(), 7)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        refresh()
    }

    private fun refresh() {
        val callLog = checkSelfPermission(Manifest.permission.READ_CALL_LOG) == PackageManager.PERMISSION_GRANTED
        folderLabel.text = if (prefs.recordingsTree.isBlank()) "No folder chosen — calls will be logged without audio." else "Folder: ${android.net.Uri.parse(prefs.recordingsTree).lastPathSegment}"
        if (!callLog) setStatus("Call-log permission is needed (step 3).", false)
        else if (prefs.configured && status.text.isNullOrBlank()) setStatus("Configured. Calls sync automatically after they end.", true)
        logView.text = prefs.logLines().joinToString("\n").ifBlank { "No uploads yet." }
    }

    private fun setStatus(msg: String, ok: Boolean) {
        status.text = msg
        status.setTextColor(if (ok) Color.parseColor("#047857") else Color.parseColor("#B91C1C"))
    }

    private fun label(t: String) = TextView(this).apply {
        text = t; textSize = 15f; setTypeface(typeface, Typeface.BOLD); setTextColor(Color.BLACK); setPadding(0, dp(18), 0, dp(6))
    }

    private fun edit(hint: String, value: String, type: Int) = EditText(this).apply {
        this.hint = hint; setText(value); inputType = InputType.TYPE_CLASS_TEXT or type; isSingleLine = true
    }

    private fun button(t: String, onClick: () -> Unit) = Button(this).apply {
        text = t; isAllCaps = false; gravity = Gravity.CENTER; setOnClickListener { onClick() }
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    private fun toast(t: String) = Toast.makeText(this, t, Toast.LENGTH_SHORT).show()
}
