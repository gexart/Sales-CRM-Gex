# Gexart Harvey: a small Windows control panel for Harvey (github.com/ethanplusai/harvey), linked to the
# Gexart CRM. Start it with "Gexart Harvey.cmd". Windows PowerShell 5.1, no extra installs.
#
# Settings live in %APPDATA%\GexartHarvey\settings.json. The CRM token is encrypted with Windows DPAPI
# (only your Windows user can read it). Harvey's own files are edited only through harvey_config.py,
# which keeps a .bak of every change.

Set-StrictMode -Version 2
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$AppDir = $PSScriptRoot
$DataDir = Join-Path $env:APPDATA "GexartHarvey"
$SettingsFile = Join-Path $DataDir "settings.json"
$LogDir = Join-Path $DataDir "logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# ---------- settings ----------
function Get-Settings {
  $s = [ordered]@{ harveyDir = ""; crmUrl = "https://sales-crm-gexart.tech-gexart.workers.dev"; token = ""; autoSync = $true; lastSync = "" }
  if (Test-Path $SettingsFile) {
    $j = Get-Content -Raw $SettingsFile | ConvertFrom-Json
    foreach ($k in @($s.Keys)) { if ($j.PSObject.Properties.Name -contains $k -and $null -ne $j.$k) { $s[$k] = $j.$k } }
  }
  if (-not $s.harveyDir) {
    foreach ($c in @((Join-Path (Split-Path (Split-Path (Split-Path $AppDir))) "harvey"), "C:\harvey", (Join-Path $env:USERPROFILE "harvey"))) {
      if (Test-Path (Join-Path $c "harvey.yaml")) { $s.harveyDir = $c; break }
    }
  }
  return $s
}
function Save-Settings($s) { $s | ConvertTo-Json | Set-Content -Encoding UTF8 $SettingsFile }
function Protect-Token([string]$t) { if (-not $t) { return "" }; ConvertTo-SecureString $t -AsPlainText -Force | ConvertFrom-SecureString }
function Unprotect-Token([string]$t) {
  if (-not $t) { return "" }
  try { $ss = ConvertTo-SecureString $t; return [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($ss)) } catch { return "" }
}

$S = Get-Settings

# ---------- helpers ----------
function Py { Join-Path $S.harveyDir ".venv\Scripts\python.exe" }
function HarveyExe { Join-Path $S.harveyDir ".venv\Scripts\harvey.exe" }
function Log([string]$msg) {
  $line = "[{0:HH:mm}] {1}" -f (Get-Date), $msg
  $script:logBox.AppendText($line + "`r`n")
  Add-Content -Path (Join-Path $LogDir "app.log") -Value $line
}
function Run-Capture([string]$exe, [string[]]$argv, [hashtable]$envVars = @{}) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $exe
  $psi.Arguments = ($argv | ForEach-Object { '"' + ($_ -replace '"', '\"') + '"' }) -join " "
  $psi.WorkingDirectory = $S.harveyDir
  $psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.CreateNoWindow = $true
  $psi.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8"
  foreach ($k in $envVars.Keys) { $psi.EnvironmentVariables[$k] = $envVars[$k] }
  $p = [System.Diagnostics.Process]::Start($psi)
  $out = $p.StandardOutput.ReadToEnd(); $err = $p.StandardError.ReadToEnd(); $p.WaitForExit()
  return @{ code = $p.ExitCode; out = $out.Trim(); err = $err.Trim() }
}
function Open-Console([string]$title, [string]$command) {
  # A visible window for things you watch or answer (Claude sign-in, training, discovery).
  Start-Process -FilePath "cmd.exe" -WorkingDirectory $S.harveyDir -ArgumentList "/k", "title $title && call .venv\Scripts\activate.bat && $command"
}
function Harvey-Pid {
  $f = Join-Path $S.harveyDir "data\harvey.pid"
  if (-not (Test-Path $f)) { return $null }
  $id = 0; [int]::TryParse(((Get-Content -Raw $f) -replace '\D', ''), [ref]$id) | Out-Null
  if ($id -gt 0 -and (Get-Process -Id $id -ErrorAction SilentlyContinue)) { return $id }
  return $null
}
function Claude-Installed { return [bool](Get-Command claude -ErrorAction SilentlyContinue) }
function Claude-SignedIn {
  # Claude Code stores the login in ~/.claude/.credentials.json (or a token in the environment).
  return (Test-Path (Join-Path $env:USERPROFILE ".claude\.credentials.json")) -or [bool]$env:CLAUDE_CODE_OAUTH_TOKEN
}
function Harvey-Config {
  if (-not (Test-Path (Py))) { return $null }
  $r = Run-Capture (Py) @((Join-Path $AppDir "harvey_config.py"), "--harvey-dir", $S.harveyDir, "show")
  if ($r.code -ne 0) { return $null }
  return $r.out | ConvertFrom-Json
}

# ---------- UI ----------
$navy = [Drawing.Color]::FromArgb(20, 30, 46); $orange = [Drawing.Color]::FromArgb(244, 122, 32)
$canvas = [Drawing.Color]::FromArgb(246, 247, 249); $muted = [Drawing.Color]::FromArgb(100, 112, 138)
$font = New-Object Drawing.Font("Segoe UI", 9.5)
$bold = New-Object Drawing.Font("Segoe UI Semibold", 10)

$form = New-Object Windows.Forms.Form
$form.Text = "Gexart Harvey"; $form.Size = New-Object Drawing.Size(860, 760); $form.StartPosition = "CenterScreen"
$form.BackColor = $canvas; $form.Font = $font; $form.MinimumSize = New-Object Drawing.Size(820, 700)
$ico = Join-Path $AppDir "gexart.ico"; if (Test-Path $ico) { try { $form.Icon = New-Object Drawing.Icon($ico) } catch { } }

$header = New-Object Windows.Forms.Panel; $header.Dock = "Top"; $header.Height = 74; $header.BackColor = $navy
$form.Controls.Add($header)
$markPng = Join-Path $AppDir "gexart-mark.png"
if (Test-Path $markPng) { $pic = New-Object Windows.Forms.PictureBox; $pic.Image = [Drawing.Image]::FromFile($markPng); $pic.SizeMode = "Zoom"; $pic.BackColor = $navy; $pic.SetBounds(18, 13, 48, 48); $header.Controls.Add($pic) }
$title = New-Object Windows.Forms.Label; $title.Text = "Gexart  x  Harvey"; $title.ForeColor = "White"; $title.Font = New-Object Drawing.Font("Segoe UI Semibold", 15); $title.SetBounds(76, 12, 500, 30); $header.Controls.Add($title)
$subtitle = New-Object Windows.Forms.Label; $subtitle.Text = "Your AI sales agent, linked to the Gexart CRM"; $subtitle.ForeColor = [Drawing.Color]::FromArgb(170, 182, 200); $subtitle.SetBounds(78, 42, 600, 20); $header.Controls.Add($subtitle)

function New-Group([string]$text, [int]$x, [int]$y, [int]$w, [int]$h) {
  $g = New-Object Windows.Forms.GroupBox; $g.Text = $text; $g.Font = $bold; $g.SetBounds($x, $y, $w, $h); $g.BackColor = "White"; $form.Controls.Add($g); return $g
}
function New-Label($parent, [string]$text, [int]$x, [int]$y, [int]$w) { $l = New-Object Windows.Forms.Label; $l.Text = $text; $l.Font = $font; $l.SetBounds($x, $y, $w, 20); $parent.Controls.Add($l); return $l }
function New-Box($parent, [int]$x, [int]$y, [int]$w, [string]$value = "") { $t = New-Object Windows.Forms.TextBox; $t.Font = $font; $t.SetBounds($x, $y, $w, 24); $t.Text = $value; $parent.Controls.Add($t); return $t }
function New-Btn($parent, [string]$text, [int]$x, [int]$y, [int]$w, [bool]$primary = $false) {
  $b = New-Object Windows.Forms.Button; $b.Text = $text; $b.Font = $font; $b.SetBounds($x, $y, $w, 30); $b.FlatStyle = "Flat"
  if ($primary) { $b.BackColor = $orange; $b.ForeColor = "White"; $b.FlatAppearance.BorderSize = 0 } else { $b.BackColor = "White"; $b.FlatAppearance.BorderColor = [Drawing.Color]::FromArgb(214, 219, 228) }
  $parent.Controls.Add($b); return $b
}

# Status
$gStatus = New-Group "Status" 16 86 812 112
$stHarvey = New-Label $gStatus "" 16 26 380; $stClaude = New-Label $gStatus "" 16 50 380; $stCrm = New-Label $gStatus "" 410 26 390; $stRun = New-Label $gStatus "" 410 50 390
$btnStart = New-Btn $gStatus "Start Harvey" 16 74 130 $true
$btnStop = New-Btn $gStatus "Stop" 152 74 70
$btnDash = New-Btn $gStatus "Open Harvey dashboard" 228 74 180
$btnClaude = New-Btn $gStatus "Sign in to Claude" 414 74 150
$btnCrm = New-Btn $gStatus "Open CRM" 570 74 100

# Niche
$gNiche = New-Group "Your niche: who Harvey should find" 16 206 404 190
New-Label $gNiche "Industries (separate with ;)" 14 26 370 | Out-Null
$tbInd = New-Box $gNiche 14 46 374
New-Label $gNiche "Cities / regions (separate with ;)" 14 76 370 | Out-Null
$tbGeo = New-Box $gNiche 14 96 374
$btnNiche = New-Btn $gNiche "Save niche" 14 132 110 $true
$btnFind = New-Btn $gNiche "Find leads now" 130 132 130
$nicheHint = New-Label $gNiche "Free lead source (OpenStreetMap), no API key needed." 14 164 380; $nicheHint.ForeColor = $muted

# Business
$gBiz = New-Group "Your business" 428 206 400 190
New-Label $gBiz "Website (Harvey learns your services from it)" 14 26 370 | Out-Null
$tbSite = New-Box $gBiz 14 46 260 "https://"
$btnTrain = New-Btn $gBiz "Teach Harvey" 280 44 106
New-Label $gBiz "Postal address (required under every cold email)" 14 78 370 | Out-Null
$tbPostal = New-Box $gBiz 14 98 372
$btnPostal = New-Btn $gBiz "Save address" 14 132 110
$btnSetup = New-Btn $gBiz "Mailbox setup wizard" 130 132 160

# CRM link
$gLink = New-Group "Gexart CRM link" 16 404 812 104
New-Label $gLink "CRM address" 14 26 120 | Out-Null
$tbUrl = New-Box $gLink 14 46 300 $S.crmUrl
New-Label $gLink "Harvey bridge token (CRM > Autopilot > Setup)" 324 26 330 | Out-Null
$tbTok = New-Box $gLink 324 46 260; $tbTok.UseSystemPasswordChar = $true
if ($S.token) { $tbTok.Text = "(saved)" }
$btnLink = New-Btn $gLink "Save and test" 592 44 110 $true
$btnSync = New-Btn $gLink "Sync now" 708 44 90
$cbAuto = New-Object Windows.Forms.CheckBox; $cbAuto.Text = "Sync automatically every 15 minutes while this app is open"; $cbAuto.Checked = [bool]$S.autoSync; $cbAuto.SetBounds(14, 76, 420, 22); $gLink.Controls.Add($cbAuto)
$lastSync = New-Label $gLink "" 440 78 360; $lastSync.ForeColor = $muted

# Log
$logBox = New-Object Windows.Forms.TextBox; $logBox.Multiline = $true; $logBox.ReadOnly = $true; $logBox.ScrollBars = "Vertical"
$logBox.Font = New-Object Drawing.Font("Consolas", 9); $logBox.SetBounds(16, 516, 812, 190); $logBox.Anchor = "Top,Bottom,Left,Right"; $logBox.BackColor = "White"
$form.Controls.Add($logBox); $script:logBox = $logBox

function Set-Status($label, [bool]$ok, [string]$text) { $label.Text = $(if ($ok) { [char]0x2714 } else { [char]0x25CB }) + "  " + $text; $label.ForeColor = $(if ($ok) { [Drawing.Color]::FromArgb(5, 150, 105) } else { $muted }) }

function Refresh-Status {
  $installed = $S.harveyDir -and (Test-Path (HarveyExe))
  Set-Status $stHarvey $installed $(if ($installed) { "Harvey installed: $($S.harveyDir)" } else { "Harvey not found. Run Install-Harvey.cmd first." })
  $ci = Claude-Installed; $cs = Claude-SignedIn
  Set-Status $stClaude ($ci -and $cs) $(if (-not $ci) { "Claude Code CLI missing" } elseif ($cs) { "Signed in to Claude" } else { "Not signed in to Claude yet" })
  Set-Status $stCrm ([bool]$S.token) $(if ($S.token) { "Linked to " + ([uri]$S.crmUrl).Host } else { "Not linked to the CRM yet" })
  $hp = $(if ($installed) { Harvey-Pid } else { $null })
  Set-Status $stRun ([bool]$hp) $(if ($hp) { "Harvey is running (pid $hp)" } else { "Harvey is stopped" })
  $btnStart.Enabled = $installed -and -not $hp; $btnStop.Enabled = [bool]$hp
  $lastSync.Text = $(if ($S.lastSync) { "Last sync: " + $S.lastSync } else { "" })
}

function Do-Sync([bool]$quiet = $false) {
  if (-not $S.token) { if (-not $quiet) { Log "Link the CRM first (token)." }; return }
  $r = Run-Capture (Py) @((Join-Path $AppDir "crm_sync.py"), "--harvey-dir", $S.harveyDir, "--write-dnc") @{ GEXART_CRM_URL = $S.crmUrl; GEXART_CRM_TOKEN = (Unprotect-Token $S.token) }
  if ($r.code -eq 0) { $S.lastSync = (Get-Date).ToString("dd MMM HH:mm"); Save-Settings $S; Log ($r.out -replace '^\[[^\]]*\]\s*', 'Sync: ') }
  else { Log ("Sync failed: " + ($r.err + " " + $r.out).Trim()) }
  Refresh-Status
}

# ---------- actions ----------
$btnStart.Add_Click({
  $out = Join-Path $LogDir "harvey.log"; $err = Join-Path $LogDir "harvey.err.log"
  Start-Process -FilePath (HarveyExe) -ArgumentList "run" -WorkingDirectory $S.harveyDir -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err | Out-Null
  Log "Starting Harvey (it checks replies, writes, sends and prospects every 15 minutes). Log: $out"
  Start-Sleep -Seconds 3; Refresh-Status
})
$btnStop.Add_Click({ $hp = Harvey-Pid; if ($hp) { Stop-Process -Id $hp -Force; Log "Harvey stopped." }; Start-Sleep -Seconds 1; Refresh-Status })
$btnDash.Add_Click({
  Start-Process -FilePath (HarveyExe) -ArgumentList "dashboard" -WorkingDirectory $S.harveyDir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $LogDir "dashboard.log") -RedirectStandardError (Join-Path $LogDir "dashboard.err.log") | Out-Null
  Start-Sleep -Seconds 4
  $r = Run-Capture (HarveyExe) @("dashboard", "--url")
  $u = ([regex]::Match($r.out, 'https?://\S+')).Value
  if ($u) { Start-Process $u; Log "Opened Harvey's dashboard (approve emails in its Outbox)." } else { Log ("Dashboard: " + $r.out + " " + $r.err) }
})
$btnClaude.Add_Click({
  [Windows.Forms.MessageBox]::Show("A window opens with Claude Code. Sign in with your Claude account in the browser, then type /exit and close the window.", "Sign in to Claude") | Out-Null
  Open-Console "Claude sign-in" "claude"
})
$btnCrm.Add_Click({ Start-Process ($S.crmUrl.TrimEnd('/') + "/autopilot?tab=setup") })
$btnNiche.Add_Click({
  if (-not $tbInd.Text.Trim() -or -not $tbGeo.Text.Trim()) { Log "Enter at least one industry and one city."; return }
  $r = Run-Capture (Py) @((Join-Path $AppDir "harvey_config.py"), "--harvey-dir", $S.harveyDir, "set-niche", "--industries", $tbInd.Text, "--geography", $tbGeo.Text)
  if ($r.code -eq 0) { Log "Niche saved: $($tbInd.Text)  in  $($tbGeo.Text)" } else { Log ("Could not save niche: " + $r.out + $r.err) }
})
$btnFind.Add_Click({
  $cities = $tbGeo.Text.Split(';') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
  if (-not $cities) { Log "Save a niche with at least one city first."; return }
  $cmd = ($cities | ForEach-Object { "harvey discover --city `"$_`"" }) -join " && "
  Log "Finding leads in: $($cities -join ', ') (window opens; new leads sync to the CRM on the next sync)."
  Open-Console "Harvey: finding leads" $cmd
})
$btnTrain.Add_Click({
  $u = $tbSite.Text.Trim(); if ($u -notmatch '^https?://\S+\.\S+') { Log "Enter your website, e.g. https://gexart.com"; return }
  Log "Harvey is reading $u to learn your services (window opens; needs Claude sign-in)."
  Open-Console "Harvey: learning your business" "harvey train $u"
})
$btnPostal.Add_Click({
  if ($tbPostal.Text.Trim().Length -lt 10) { Log "Enter your full business address."; return }
  $r = Run-Capture (Py) @((Join-Path $AppDir "harvey_config.py"), "--harvey-dir", $S.harveyDir, "set-postal", $tbPostal.Text)
  if ($r.code -eq 0) { Log "Postal address saved." } else { Log ("Could not save address: " + $r.out + $r.err) }
})
$btnSetup.Add_Click({
  [Windows.Forms.MessageBox]::Show("Claude Code opens in the Harvey folder. Type: set up Harvey for me`r`n`r`nIt walks you through the sending mailbox (Gmail / Workspace on a separate domain), email verification and warm-up.", "Mailbox setup") | Out-Null
  Open-Console "Harvey setup wizard" "claude"
})
$btnLink.Add_Click({
  $url = $tbUrl.Text.Trim().TrimEnd('/')
  if ($url -notmatch '^https://') { Log "The CRM address must start with https://"; return }
  $tok = $tbTok.Text.Trim()
  if ($tok -and $tok -ne "(saved)") {
    if (-not $tok.StartsWith("gxd_")) { Log "That is not a bridge token (it starts with gxd_). Create one in CRM > Autopilot > Setup."; return }
    $S.token = Protect-Token $tok
  }
  $S.crmUrl = $url; Save-Settings $S
  try {
    $res = Invoke-RestMethod -Uri "$url/api/v1/device/harvey/do-not-contact" -Headers @{ Authorization = "Bearer " + (Unprotect-Token $S.token) } -TimeoutSec 20
    Log ("CRM link OK. Shared do-not-contact list: " + @($res.data).Count + " entries.")
    $tbTok.Text = "(saved)"
    Do-Sync
  } catch { Log ("CRM link failed: " + $_.Exception.Message) }
  Refresh-Status
})
$btnSync.Add_Click({ Log "Syncing with the CRM..."; Do-Sync })
$cbAuto.Add_CheckedChanged({ $S.autoSync = $cbAuto.Checked; Save-Settings $S })

$timer = New-Object Windows.Forms.Timer; $timer.Interval = 15 * 60 * 1000
$timer.Add_Tick({ if ($S.autoSync) { Do-Sync $true }; Refresh-Status })
$timer.Start()
$statusTimer = New-Object Windows.Forms.Timer; $statusTimer.Interval = 20 * 1000; $statusTimer.Add_Tick({ Refresh-Status }); $statusTimer.Start()

$form.Add_Shown({
  Refresh-Status
  $cfg = Harvey-Config
  if ($cfg) {
    $tbInd.Text = (@($cfg.industries) -join "; "); $tbGeo.Text = (@($cfg.geography) -join "; ")
    if ($cfg.postal_address) { $tbPostal.Text = $cfg.postal_address }
  }
  Log "Ready. Steps: 1) Sign in to Claude  2) Teach Harvey your website  3) Save niche + address  4) Link the CRM  5) Mailbox setup wizard  6) Start Harvey."
})
if ($env:GEXART_HARVEY_SELFTEST) {
  # Used by the repo's checks: open, load, report what the panel shows, close.
  $form.Add_Shown({ $form.Refresh(); Set-Content -Encoding UTF8 $env:GEXART_HARVEY_SELFTEST (@($stHarvey.Text, $stClaude.Text, $stCrm.Text, $stRun.Text, $tbInd.Text, $tbGeo.Text, $logBox.Text) -join "`n"); $form.Close() })
}
[void]$form.ShowDialog()
