$ErrorActionPreference = 'Stop'
$taskProject = $PSScriptRoot
$taskNode = (Get-Command node.exe -ErrorAction Stop).Source
$taskRuntime = Join-Path $taskProject '.runtime'
New-Item -ItemType Directory -Path $taskRuntime -Force | Out-Null
$taskConfigPath = Join-Path $taskRuntime 'config.json'
if (Test-Path -LiteralPath $taskConfigPath) {
    $taskConfig = Get-Content -LiteralPath $taskConfigPath -Raw | ConvertFrom-Json
    try {
        $taskStatus = Invoke-RestMethod -Uri "http://127.0.0.1:$($taskConfig.port)/_status" -Headers @{ Authorization = "Bearer $($taskConfig.token)" } -TimeoutSec 2
        if ($taskStatus.server -eq 'notion-roblox-studio' -and $taskStatus.ok) {
            $taskExistingConnection = Join-Path $taskRuntime 'connection.json'
            $taskHttpsRunning = $false
            if (Test-Path -LiteralPath $taskExistingConnection) {
                try { $taskHttpsRunning = (Get-Content -LiteralPath $taskExistingConnection -Raw | ConvertFrom-Json).running -eq $true } catch { }
            }
            if ($taskHttpsRunning) { Write-Output 'Roblox MCP HTTPS already running. Open connection.md; verify Studio with npm run verify.' }
            else { Write-Output 'Local Roblox MCP is running. Use stop.ps1 before starting HTTPS.' }
            return
        }
    } catch { }
}
$taskLaunch = [DateTimeOffset]::UtcNow
$taskLauncher = Join-Path $taskProject 'src/launcher.mjs'
$taskProcess = Start-Process -FilePath $taskNode -ArgumentList @(('"' + $taskLauncher + '"')) -WorkingDirectory $taskProject -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRuntime 'server.log') -RedirectStandardError (Join-Path $taskRuntime 'tunnel.log') -PassThru
$taskProcess.Id | Set-Content -LiteralPath (Join-Path $taskRuntime 'launcher.pid')
$taskDeadline = (Get-Date).AddSeconds(45)
while ((Get-Date) -lt $taskDeadline) {
    $taskProcess.Refresh()
    if ($taskProcess.HasExited) { throw 'Launcher exited; inspect .runtime/server.log and tunnel.log. Install Roblox Studio, npm dependencies, and cloudflared first.' }
    $taskConnectionPath = Join-Path $taskRuntime 'connection.json'
    if (Test-Path -LiteralPath $taskConnectionPath) {
        try {
            $taskConnection = Get-Content -LiteralPath $taskConnectionPath -Raw | ConvertFrom-Json
            if ($taskConnection.running -and $taskConnection.serverUrl -and ([DateTimeOffset]::Parse($taskConnection.startedAt) -ge $taskLaunch)) {
                Write-Output "Roblox MCP HTTPS ready: $($taskConnection.serverUrl)"
                Write-Output "Connection key: $(Join-Path $taskProject 'connection.md')"
                Write-Output 'Studio must be open with MCP enabled to use Place tools.'
                return
            }
        } catch { }
    }
    Start-Sleep -Milliseconds 500
}
Write-Output 'The helper is running; HTTPS still connecting. Check .runtime logs and connection.md.'
