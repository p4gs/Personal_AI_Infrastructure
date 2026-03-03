<#
.SYNOPSIS
    Happy Session Lifecycle Monitor — watches process events and Happy daemon
    activity in real-time to diagnose orphaned sessions on Windows.

.DESCRIPTION
    Monitors three things simultaneously:
    1. Windows process creation/exit events for Claude, Happy, Bun, Node
    2. Happy daemon log file (tail -f equivalent)
    3. Happy daemon's tracked session list

    Run this BEFORE starting a Happy session, then start/stop sessions
    while it's running. Review the timestamped log to see exactly what
    happens at each lifecycle point.

.USAGE
    powershell -ExecutionPolicy Bypass -File happy-session-monitor.ps1
    # Then in another terminal: happy (start a session)
    # Close the session, observe the monitor output
    # Press Ctrl+C to stop monitoring

.NOTES
    Output is written to both console and a log file at:
    ~\.happy\logs\session-monitor-{timestamp}.log
#>

param(
    [int]$PollIntervalMs = 2000,
    [switch]$Quiet
)

$ErrorActionPreference = 'Continue'

# ── Setup ────────────────────────────────────────────────────────────────────

$timestamp = Get-Date -Format 'yyyy-MM-dd-HH-mm-ss'
$logDir = Join-Path $env:USERPROFILE '.happy\logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$logFile = Join-Path $logDir "session-monitor-$timestamp.log"

$happyDaemonState = Join-Path $env:USERPROFILE '.happy\daemon.state.json'
$happyHome = Join-Path $env:USERPROFILE '.happy'

function Log {
    param([string]$Message, [string]$Level = 'INFO')
    $ts = Get-Date -Format 'HH:mm:ss.fff'
    $line = "[$ts] [$Level] $Message"
    if (-not $Quiet) {
        switch ($Level) {
            'EVENT'   { Write-Host $line -ForegroundColor Cyan }
            'WARN'    { Write-Host $line -ForegroundColor Yellow }
            'ERROR'   { Write-Host $line -ForegroundColor Red }
            'SESSION' { Write-Host $line -ForegroundColor Green }
            'EXIT'    { Write-Host $line -ForegroundColor Magenta }
            'DAEMON'  { Write-Host $line -ForegroundColor DarkYellow }
            default   { Write-Host $line }
        }
    }
    Add-Content -Path $logFile -Value $line
}

function Get-ProcessTree {
    param([int]$Pid)
    try {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$Pid" -ErrorAction SilentlyContinue
        if ($proc) {
            return @{
                PID = $proc.ProcessId
                Name = $proc.Name
                CommandLine = $proc.CommandLine
                ParentPID = $proc.ParentProcessId
                CreationDate = $proc.CreationDate
            }
        }
    } catch {}
    return $null
}

function Get-HappyDaemonSessions {
    try {
        $state = Get-Content $happyDaemonState -Raw | ConvertFrom-Json
        $port = $state.httpPort
        if ($port) {
            $response = Invoke-RestMethod -Uri "http://localhost:$port/sessions" -TimeoutSec 2 -ErrorAction SilentlyContinue
            return $response
        }
    } catch {}
    return $null
}

# ── Banner ───────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║     Happy Session Lifecycle Monitor                     ║" -ForegroundColor Cyan
Write-Host "  ║     Watching: claude, happy, bun, node processes        ║" -ForegroundColor Cyan
Write-Host "  ║     Log: $logFile  ║" -ForegroundColor DarkGray
Write-Host "  ║     Press Ctrl+C to stop                                ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

Log "Monitor started. Log file: $logFile"
Log "Poll interval: ${PollIntervalMs}ms"

# ── Snapshot current state ───────────────────────────────────────────────────

Log "── Initial Process Snapshot ──" 'INFO'

$watchNames = @('claude', 'happy', 'bun', 'node', 'claude-cli')
$initialProcs = Get-CimInstance Win32_Process | Where-Object {
    $name = $_.Name -replace '\.exe$', ''
    $watchNames | Where-Object { $name -match $_ }
} | Select-Object ProcessId, Name, CommandLine, ParentProcessId, CreationDate

$trackedPIDs = @{}

foreach ($p in $initialProcs) {
    $key = "$($p.ProcessId)"
    $trackedPIDs[$key] = @{
        Name = $p.Name
        CommandLine = $p.CommandLine
        StartTime = $p.CreationDate
        ParentPID = $p.ParentProcessId
    }
    Log "  PID $($p.ProcessId) | $($p.Name) | Parent: $($p.ParentProcessId) | Started: $($p.CreationDate)" 'EVENT'
    if ($p.CommandLine) {
        Log "    CMD: $($p.CommandLine.Substring(0, [Math]::Min(200, $p.CommandLine.Length)))" 'INFO'
    }
}

Log "Total watched processes: $($initialProcs.Count)" 'INFO'

# ── Get Happy daemon log file for tailing ────────────────────────────────────

$daemonLogFile = $null
try {
    $state = Get-Content $happyDaemonState -Raw | ConvertFrom-Json
    $daemonLogFile = $state.daemonLogPath
    if ($daemonLogFile -and (Test-Path $daemonLogFile)) {
        $daemonLogLines = (Get-Content $daemonLogFile).Count
        Log "Happy daemon log: $daemonLogFile ($daemonLogLines lines)" 'DAEMON'
    } else {
        Log "Happy daemon log not found at: $daemonLogFile" 'WARN'
        $daemonLogFile = $null
    }
} catch {
    Log "Could not read daemon state: $_" 'WARN'
}

$lastDaemonLineCount = if ($daemonLogFile) { (Get-Content $daemonLogFile).Count } else { 0 }

# ── WMI Event Subscriptions ─────────────────────────────────────────────────

Log "── Registering WMI Process Event Watchers ──" 'INFO'

# Process creation watcher
$createQuery = "SELECT * FROM __InstanceCreationEvent WITHIN 1 WHERE TargetInstance ISA 'Win32_Process' AND (TargetInstance.Name LIKE '%claude%' OR TargetInstance.Name LIKE '%happy%' OR TargetInstance.Name LIKE '%bun%' OR TargetInstance.Name LIKE '%node%')"

$deleteQuery = "SELECT * FROM __InstanceDeletionEvent WITHIN 1 WHERE TargetInstance ISA 'Win32_Process' AND (TargetInstance.Name LIKE '%claude%' OR TargetInstance.Name LIKE '%happy%' OR TargetInstance.Name LIKE '%bun%' OR TargetInstance.Name LIKE '%node%')"

try {
    Register-WmiEvent -Query $createQuery -SourceIdentifier 'ProcessCreated' -ErrorAction Stop
    Log "Registered process CREATION watcher" 'INFO'
} catch {
    Log "WMI creation watcher failed: $_ — falling back to polling" 'WARN'
}

try {
    Register-WmiEvent -Query $deleteQuery -SourceIdentifier 'ProcessDeleted' -ErrorAction Stop
    Log "Registered process DELETION watcher" 'INFO'
} catch {
    Log "WMI deletion watcher failed: $_ — falling back to polling" 'WARN'
}

Log "── Monitoring Active — start/stop Happy sessions now ──" 'SESSION'

# ── Main Loop ────────────────────────────────────────────────────────────────

try {
    while ($true) {
        # 1. Check WMI events for process creation
        $createEvent = Get-Event -SourceIdentifier 'ProcessCreated' -ErrorAction SilentlyContinue
        while ($createEvent) {
            $newProc = $createEvent.SourceEventArgs.NewEvent.TargetInstance
            $pid = $newProc.ProcessId
            $name = $newProc.Name
            $cmd = $newProc.CommandLine
            $parentPid = $newProc.ParentProcessId

            Log "PROCESS CREATED: PID $pid | $name | Parent: $parentPid" 'SESSION'
            if ($cmd) {
                Log "  CMD: $($cmd.Substring(0, [Math]::Min(300, $cmd.Length)))" 'INFO'
            }

            # Track parent info
            $parentInfo = Get-ProcessTree -Pid $parentPid
            if ($parentInfo) {
                Log "  PARENT: PID $parentPid | $($parentInfo.Name) | $($parentInfo.CommandLine)" 'INFO'
            }

            $trackedPIDs["$pid"] = @{
                Name = $name
                CommandLine = $cmd
                StartTime = Get-Date
                ParentPID = $parentPid
            }

            Remove-Event -SourceIdentifier 'ProcessCreated' -ErrorAction SilentlyContinue
            $createEvent = Get-Event -SourceIdentifier 'ProcessCreated' -ErrorAction SilentlyContinue
        }

        # 2. Check WMI events for process deletion
        $deleteEvent = Get-Event -SourceIdentifier 'ProcessDeleted' -ErrorAction SilentlyContinue
        while ($deleteEvent) {
            $deadProc = $deleteEvent.SourceEventArgs.NewEvent.TargetInstance
            $pid = $deadProc.ProcessId
            $name = $deadProc.Name

            $duration = ''
            if ($trackedPIDs.ContainsKey("$pid")) {
                $startTime = $trackedPIDs["$pid"].StartTime
                if ($startTime) {
                    $elapsed = (Get-Date) - $startTime
                    $duration = " | Lived: $($elapsed.ToString('hh\:mm\:ss'))"
                }
                $cmd = $trackedPIDs["$pid"].CommandLine
                $parentPid = $trackedPIDs["$pid"].ParentPID
                Log "PROCESS EXITED: PID $pid | $name | Parent: $parentPid$duration" 'EXIT'
                if ($cmd) {
                    Log "  CMD: $($cmd.Substring(0, [Math]::Min(300, $cmd.Length)))" 'INFO'
                }
                $trackedPIDs.Remove("$pid")
            } else {
                Log "PROCESS EXITED: PID $pid | $name (untracked)$duration" 'EXIT'
            }

            Remove-Event -SourceIdentifier 'ProcessDeleted' -ErrorAction SilentlyContinue
            $deleteEvent = Get-Event -SourceIdentifier 'ProcessDeleted' -ErrorAction SilentlyContinue
        }

        # 3. Tail Happy daemon log for new entries
        if ($daemonLogFile -and (Test-Path $daemonLogFile)) {
            $currentLines = (Get-Content $daemonLogFile).Count
            if ($currentLines -gt $lastDaemonLineCount) {
                $newLines = Get-Content $daemonLogFile | Select-Object -Skip $lastDaemonLineCount
                foreach ($line in $newLines) {
                    if ($line -match 'Session started|Session ended|stale session|webhook|lifecycle|Registered|Removing|error|failed') {
                        Log "DAEMON: $($line.Trim())" 'DAEMON'
                    }
                }
                $lastDaemonLineCount = $currentLines
            }
        }

        # 4. Periodic process health check (every 10 polls)
        if (($trackedPIDs.Count -gt 0) -and ((Get-Date).Second % 10 -eq 0)) {
            foreach ($pidStr in @($trackedPIDs.Keys)) {
                $pidInt = [int]$pidStr
                $alive = Get-Process -Id $pidInt -ErrorAction SilentlyContinue
                if (-not $alive) {
                    $info = $trackedPIDs[$pidStr]
                    Log "ZOMBIE DETECTED: PID $pidInt ($($info.Name)) no longer running but was not caught by WMI event" 'WARN'
                    $trackedPIDs.Remove($pidStr)
                }
            }
        }

        Start-Sleep -Milliseconds $PollIntervalMs
    }
} finally {
    # ── Cleanup ──────────────────────────────────────────────────────────────
    Log "── Monitor Shutting Down ──" 'INFO'

    Unregister-Event -SourceIdentifier 'ProcessCreated' -ErrorAction SilentlyContinue
    Unregister-Event -SourceIdentifier 'ProcessDeleted' -ErrorAction SilentlyContinue

    # Final snapshot
    Log "── Final Process Snapshot ──" 'INFO'
    $finalProcs = Get-CimInstance Win32_Process | Where-Object {
        $name = $_.Name -replace '\.exe$', ''
        $watchNames | Where-Object { $name -match $_ }
    }
    foreach ($p in $finalProcs) {
        Log "  PID $($p.ProcessId) | $($p.Name) | $($p.CommandLine)" 'INFO'
    }

    Log "Monitor stopped. Full log at: $logFile" 'INFO'
    Write-Host ""
    Write-Host "  Log saved to: $logFile" -ForegroundColor Green
    Write-Host ""
}
