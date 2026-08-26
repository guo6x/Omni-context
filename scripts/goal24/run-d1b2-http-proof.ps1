$runtimeRoot = Join-Path $PSScriptRoot '..\..\brain-server\.tmp-d1b2-http'
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
$env:PORT = '3321'
$env:HOST = '127.0.0.1'
$env:DB_PATH = Join-Path $runtimeRoot 'omni-context.db'
$env:NATIVE_BRIDGE_SECRET = 'd1b2-test-native-secret'
$env:OMNI_D1B2_E2E_FIXTURE = '1'
$env:OMNI_D1B2_E2E_FIXTURE_OUTPUT = Join-Path $runtimeRoot 'fixture.json'
$brainRoot = Join-Path $PSScriptRoot '..\..\brain-server'
$process = Start-Process -FilePath 'npm.cmd' -ArgumentList @('run', 'api') -WorkingDirectory $brainRoot -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput (Join-Path $runtimeRoot 'server.out.log') `
  -RedirectStandardError (Join-Path $runtimeRoot 'server.err.log')
try {
  $ready = $false
  for ($i = 0; $i -lt 50; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3321/health' -TimeoutSec 2
      if ($health.ok) { $ready = $true; break }
    } catch {}
  }
  if (-not $ready) {
    Get-Content (Join-Path $runtimeRoot 'server.out.log') -ErrorAction SilentlyContinue
    Get-Content (Join-Path $runtimeRoot 'server.err.log') -ErrorAction SilentlyContinue
    throw 'Brain HTTP fixture did not start'
  }
  $mint = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3321/internal/control/session/verify' `
    -Headers @{ Authorization = 'Bearer d1b2-test-native-secret'; Host = '127.0.0.1:3321' } `
    -ContentType 'application/json' -Body '{}'
  $verifyHeaders = @{ Authorization = "Bearer $($mint.data.token)"; Host = '127.0.0.1:3321' }
  $ids = Get-Content (Join-Path $runtimeRoot 'fixture.json') -Raw | ConvertFrom-Json
  $verified = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3321/api/control/verify' -Headers $verifyHeaders -ContentType 'application/json' -Body (@{ plan_id = $ids.verified_plan_id } | ConvertTo-Json -Compress)
  $mismatch = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3321/api/control/verify' -Headers $verifyHeaders -ContentType 'application/json' -Body (@{ plan_id = $ids.mismatch_plan_id } | ConvertTo-Json -Compress)
  $inconclusive = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3321/api/control/verify' -Headers $verifyHeaders -ContentType 'application/json' -Body (@{ plan_id = $ids.inconclusive_plan_id } | ConvertTo-Json -Compress)
  [pscustomobject]@{ fixture = $ids; verified = $verified.data; mismatch = $mismatch.data; inconclusive = $inconclusive.data } | ConvertTo-Json -Depth 8
} finally {
  if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
}
