<#
.SYNOPSIS
    Happy Session Creation Tracer — captures WHO creates each session

.DESCRIPTION
    When Happy's daemon registers a new session, the daemon log records the
    hostPid. This script tails the daemon log in real-time, and the INSTANT
    a new session appears, it captures the full process ancestry chain:

        PID → Parent PID → Grandparent PID → ... → root

    This reveals exactly what program/hook/script triggered each session.

    Additionally monitors the daemon's HTTP control port for raw webhook
    traffic using netstat snapshots.

.USAGE
    powershell -ExecutionPolicy Bypass -File happy-session-tracer.ps1

    Then in another terminal on Windows: happy
    Watch this terminal to see WHO creates each session.
#>

param(
    [int]$PollMs = 500
)

$ErrorActionPreference = 'Continue'

# ── Setup ────────────────────────────────────────────────────────────────────

$timestamp = Get-Date -Format 'yyyy-MM-dd-HH-mm-ss'
$logDir = Join-Path $env:USERPROFILE '.happy\logs'
$traceLog = Join-Path $logDir "session-tracer-$timestamp.log"

function Log {
    param([string]$Msg, [string]$Color = 'White')
    $ts = Get-Date -Format 'HH:mm:ss.fff'
    $line = "[$ts] $Msg"
    Write-Host $line -ForegroundColor $Color
    Add-Content -Path $traceLog -Value $line
}

function Get-ProcessAncestry {
    param([int]$Pid)
    $chain = @()
    $visited = @{}
    $current = $Pid

    for ($i = 0; $i -lt 20; $i++) {
        if ($visited.ContainsKey($current) -or $current -le 0) { break }
        $visited[$current] = $true

        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$current" -ErrorAction SilentlyContinue
        if (-not $proc) {
            $chain += "[PID $current: DEAD - process already exited]"
            break
        }

        $cmd = if ($proc.CommandLine) {
            $proc.CommandLine.Substring(0, [Math]::Min(250, $proc.CommandLine.Length))
        } else {
            "(no command line)"
        }

        $chain += "PID $current | $($proc.Name) | Parent: $($proc.ParentProcessId) | CMD: $cmd"
        $current = $proc.ParentProcessId
    }

    return $chain
}

# ── Find daemon log ──────────────────────────────────────────────────────────

$daemonState = Join-Path $env:USERPROFILE '.happy\daemon.state.json'
$daemonLogFile = $null
$daemonPort = $null

try {
    $state = Get-Content $daemonState -Raw | ConvertFrom-Json
    $daemonLogFile = $state.daemonLogPath
    $daemonPort = $state.httpPort
    Log "Daemon PID: $($state.pid) | Port: $daemonPort" 'Cyan'
    Log "Daemon log: $daemonLogFile" 'Cyan'
} catch {
    Log "ERROR: Cannot read daemon state: $_" 'Red'
    exit 1
}

if (-not (Test-Path $daemonLogFile)) {
    Log "ERROR: Daemon log not found at $daemonLogFile" 'Red'
    exit 1
}

# ── Banner ───────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════════════╗" -ForegroundColor Yellow
Write-Host "  ║  Happy Session Creation Tracer                          ║" -ForegroundColor Yellow
Write-Host "  ║  Traces process ancestry for every new session          ║" -ForegroundColor Yellow
Write-Host "  ║  Press Ctrl+C to stop                                   ║" -ForegroundColor Yellow
Write-Host "  ╚══════════════════════════════════════════════════════════╝" -ForegroundColor Yellow
Write-Host ""

Log "Trace log: $traceLog" 'DarkGray'
Log "Waiting for new sessions... Start 'happy' in another terminal." 'Green'
Write-Host ""

# ── Initial state ────────────────────────────────────────────────────────────

$lastLineCount = (Get-Content $daemonLogFile).Count
$sessionCount = 0
$seenPids = @{}

# Snapshot current claude/happy/bun/node processes for baseline
Log "── Baseline Process Snapshot ──" 'Cyan'
$baseline = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -match 'claude|happy|bun|node'
}
foreach ($p in $baseline) {
    $cmd = if ($p.CommandLine) { $p.CommandLine.Substring(0, [Math]::Min(150, $p.CommandLine.Length)) } else { "" }
    Log "  BASELINE: PID $($p.ProcessId) | $($p.Name) | $cmd" 'DarkGray'
}
Log "  Total baseline processes: $($baseline.Count)" 'DarkGray'
Write-Host ""

# ── Main Loop ────────────────────────────────────────────────────────────────

try {
    while ($true) {
        $currentLines = (Get-Content $daemonLogFile).Count

        if ($currentLines -gt $lastLineCount) {
            $newLines = Get-Content $daemonLogFile | Select-Object -Skip $lastLineCount

            foreach ($line in $newLines) {
                # Detect new session webhook
                if ($line -match 'Session webhook: (\S+), PID: (\d+)') {
                    $sessionId = $Matches[1]
                    $pid = [int]$Matches[2]
                    $sessionCount++

                    Write-Host ""
                    Log "═══════════════════════════════════════════════════" 'Yellow'
                    Log "NEW SESSION #$sessionCount: $sessionId" 'Yellow'
                    Log "HOST PID: $pid" 'Yellow'
                    Log "═══════════════════════════════════════════════════" 'Yellow'

                    # IMMEDIATELY trace the process ancestry
                    Log "── Process Ancestry Chain ──" 'Magenta'
                    $ancestry = Get-ProcessAncestry -Pid $pid
                    $depth = 0
                    foreach ($entry in $ancestry) {
                        $indent = "  " + ("  " * $depth)
                        $color = if ($depth -eq 0) { 'White' } elseif ($depth -eq 1) { 'Cyan' } else { 'DarkCyan' }
                        Log "$indent[$depth] $entry" $color
                        $depth++
                    }

                    # Check if we've seen this PID before
                    if ($seenPids.ContainsKey($pid)) {
                        Log "  !! PID REUSE: This PID was seen in session $($seenPids[$pid])" 'Red'
                    }
                    $seenPids[$pid] = $sessionId

                    # Check TCP connections from this PID to daemon port
                    try {
                        $conns = Get-NetTCPConnection -OwningProcess $pid -ErrorAction SilentlyContinue |
                            Where-Object { $_.RemotePort -eq $daemonPort -or $_.LocalPort -eq $daemonPort }
                        if ($conns) {
                            Log "  TCP to daemon port $daemonPort`:" 'DarkYellow'
                            foreach ($c in $conns) {
                                Log "    $($c.LocalAddress):$($c.LocalPort) → $($c.RemoteAddress):$($c.RemotePort) [$($c.State)]" 'DarkYellow'
                            }
                        }
                    } catch {}

                    Write-Host ""
                }

                # Detect session path/metadata
                if ($line -match '"path": "([^"]+)"') {
                    Log "  PATH: $($Matches[1])" 'Gray'
                }

                # Detect stale cleanup
                if ($line -match 'Removing stale session with PID (\d+)') {
                    Log "STALE CLEANUP: PID $($Matches[1])" 'DarkRed'
                }

                # Detect daemon spawn events
                if ($line -match 'Spawning session|spawnSession|spawn.*claude') {
                    Log "DAEMON SPAWN: $($line.Trim())" 'Green'
                }

                # Detect websocket events
                if ($line -match 'WebSocket|Connected to server|Keep-alive|Machine.*command') {
                    Log "WS EVENT: $($line.Trim())" 'Blue'
                }
            }

            $lastLineCount = $currentLines
        }

        Start-Sleep -Milliseconds $PollMs
    }
} finally {
    Write-Host ""
    Log "── Tracer Summary ──" 'Cyan'
    Log "Total sessions traced: $sessionCount" 'Cyan'
    Log "Unique PIDs: $($seenPids.Count)" 'Cyan'
    Log "Full trace log: $traceLog" 'Cyan'
    Write-Host ""
}
