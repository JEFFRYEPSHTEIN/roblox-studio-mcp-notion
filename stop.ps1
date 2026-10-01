$ErrorActionPreference = 'Stop'
$taskConfigPath = Join-Path $PSScriptRoot '.runtime/config.json'
if (-not (Test-Path -LiteralPath $taskConfigPath)) { Write-Output 'Roblox MCP has no local configuration yet.'; return }
$taskConfig = Get-Content -LiteralPath $taskConfigPath -Raw | ConvertFrom-Json
try {
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$($taskConfig.port)/_shutdown" -Headers @{ Authorization = "Bearer $($taskConfig.token)" } -TimeoutSec 15 | Out-Null
    Write-Output 'Graceful shutdown requested. Roblox Studio remains open.'
} catch { throw 'Cannot reach local shutdown API. No MCP process was terminated manually.' }
