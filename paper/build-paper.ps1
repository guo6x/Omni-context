param(
  [string]$Tectonic = $env:TECTONIC_BIN,
  [string]$CacheDir = $env:TECTONIC_CACHE_DIR
)
$ErrorActionPreference = 'Stop'
$PaperRoot = $PSScriptRoot
$RepoRoot = Split-Path $PaperRoot -Parent
if (-not $Tectonic) {
  $candidate = 'D:\OmniContext-research-env\external\tectonic-0.16.9\bin\tectonic.exe'
  if (Test-Path -LiteralPath $candidate) { $Tectonic = $candidate } else { $Tectonic = (Get-Command tectonic -ErrorAction Stop).Source }
}
if (-not $CacheDir) { $CacheDir = 'D:\OmniContext-research-env\external\tectonic-cache-0.16.9' }
$version = (& $Tectonic --version).Trim()
if ($version -ne 'Tectonic 0.16.9') { throw "Expected Tectonic 0.16.9, received $version" }
$env:TECTONIC_CACHE_DIR = $CacheDir
New-Item -ItemType Directory -Force -Path $CacheDir, (Join-Path $PaperRoot 'build') | Out-Null
Push-Location (Join-Path $PaperRoot 'manuscript')
try {
  & $Tectonic -X compile main.tex --outdir (Join-Path $PaperRoot 'build') --keep-logs --keep-intermediates --reruns 2
  if ($LASTEXITCODE -ne 0) { throw "Tectonic failed with exit code $LASTEXITCODE" }
} finally { Pop-Location }
node (Join-Path $PaperRoot 'check-latex-log.mjs')
if ($LASTEXITCODE -ne 0) { throw 'LaTeX log audit failed' }
Get-FileHash (Join-Path $PaperRoot 'build\main.pdf') -Algorithm SHA256
