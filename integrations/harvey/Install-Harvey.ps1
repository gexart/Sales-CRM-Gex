# Installs Harvey (github.com/ethanplusai/harvey) for the Gexart Harvey app and adds a desktop shortcut.
# Safe to re-run: it updates Harvey and reuses what is already installed. Run "Install Harvey.cmd".

$ErrorActionPreference = "Stop"
$AppDir = $PSScriptRoot
$Target = Join-Path $env:USERPROFILE "harvey"

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") }

Write-Host "Gexart Harvey installer" -ForegroundColor Yellow
Write-Host "Harvey will be installed in $Target"

Step "Python 3.11+"
$py = $null
foreach ($v in "3.13", "3.12", "3.11") { try { $p = (& py "-$v" -c "import sys; print(sys.executable)" 2>$null); if ($LASTEXITCODE -eq 0 -and $p) { $py = $v; break } } catch { } }
if (-not $py) {
  if (-not (Have winget)) { throw "Install Python 3.13 from https://www.python.org/downloads/ (tick 'Add to PATH'), then run this again." }
  winget install --id Python.Python.3.13 -e --accept-source-agreements --accept-package-agreements
  Refresh-Path; $py = "3.13"
}
Write-Host "Using Python $py"

Step "Git"
if (-not (Have git)) {
  if (-not (Have winget)) { throw "Install Git from https://git-scm.com/download/win, then run this again." }
  winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements; Refresh-Path
}

Step "Claude Code CLI (Harvey thinks with your Claude subscription)"
if (-not (Have claude)) {
  if (-not (Have npm)) {
    if (-not (Have winget)) { throw "Install Node.js LTS from https://nodejs.org, then run this again." }
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements; Refresh-Path
  }
  npm install -g @anthropic-ai/claude-code
  Refresh-Path
}
claude --version

Step "Harvey"
if (Test-Path (Join-Path $Target ".git")) { git -C $Target pull --ff-only } else { git clone --depth 1 https://github.com/ethanplusai/harvey.git $Target }
if (-not (Test-Path (Join-Path $Target ".venv\Scripts\python.exe"))) { & py "-$py" -m venv (Join-Path $Target ".venv") }
& (Join-Path $Target ".venv\Scripts\python.exe") -m pip install -q --upgrade pip
& (Join-Path $Target ".venv\Scripts\python.exe") -m pip install -q -e $Target

Step "Remember where Harvey is"
$dataDir = Join-Path $env:APPDATA "GexartHarvey"; New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$settings = Join-Path $dataDir "settings.json"
$s = if (Test-Path $settings) { Get-Content -Raw $settings | ConvertFrom-Json } else { [pscustomobject]@{} }
$s | Add-Member -NotePropertyName harveyDir -NotePropertyValue $Target -Force
$s | ConvertTo-Json | Set-Content -Encoding UTF8 $settings

Step "Desktop shortcut"
$lnk = Join-Path ([Environment]::GetFolderPath("Desktop")) "Gexart Harvey.lnk"
$sh = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$sh.TargetPath = "powershell.exe"
$sh.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $AppDir 'GexartHarvey.ps1')`""
$sh.WorkingDirectory = $AppDir
$sh.IconLocation = (Join-Path $AppDir "gexart.ico")
$sh.Save()

Write-Host "`nDone. Open 'Gexart Harvey' on your desktop." -ForegroundColor Green
Write-Host "First: Sign in to Claude, teach Harvey your website, set your niche, and link the CRM."
