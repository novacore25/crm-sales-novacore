#Requires -Version 5.1
<#
.SYNOPSIS
    Dumps the live Supabase schema so it can be diffed against the Drizzle schema.

.DESCRIPTION
    The old repository's supabase/migrations/ folder is NOT a reliable source of
    truth - it drifted from the production database (see docs/MIGRATION.md).
    This script pulls the actual schema via pg_dump in a throwaway container, so
    no local PostgreSQL install is needed.

    Connection details are read from .pgdump.env in this directory. That file is
    gitignored and must never be committed.

    Requires Docker Desktop to be running.

.EXAMPLE
    .\dump-supabase.ps1
#>
[CmdletBinding()]
param(
    [string]$OutFile = ".\supabase-schema-live.sql",
    [string]$EnvFile = ".\.pgdump.env",
    [string]$Schema  = "public",
    # Empty = every table. Pass e.g. -Tables leads,funnel_history to narrow it.
    [string[]]$Tables = @()
)

$ErrorActionPreference = 'Stop'

function Fail($msg) {
    Write-Host ""
    Write-Host "  $msg" -ForegroundColor Red
    Write-Host ""
    exit 1
}

function Ok($msg)  { Write-Host "  $msg" -ForegroundColor Green }
function Info($msg) { Write-Host "  $msg" -ForegroundColor Cyan }
function Warn($msg) { Write-Host "  $msg" -ForegroundColor Yellow }

# --- 1. Docker ---------------------------------------------------------------
Write-Host ""
Info "Checking Docker..."

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Fail "Docker is not on PATH. Install Docker Desktop: https://docs.docker.com/get-docker/"
}

# `docker info` writes its failure to stderr. With ErrorActionPreference = Stop
# that surfaces as a raw PowerShell error dump before Fail() ever runs, so the
# error action is lifted for this one call and the exit code checked instead.
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
docker info --format "{{.ServerVersion}}" 2>$null | Out-Null
$dockerExit = $LASTEXITCODE
$ErrorActionPreference = $prevEap

if ($dockerExit -ne 0) {
    Fail @"
Docker is installed but the daemon is not responding.

Start Docker Desktop and wait for it to finish booting, then run this again.
"@
}
Ok "Docker is running."

# --- 2. Connection details ----------------------------------------------------
# Read from a KEY=VALUE file, ignoring comments and blank lines. Values may be
# quoted; surrounding quotes are stripped.
if (-not (Test-Path $EnvFile)) {
    Fail @"
Connection file not found: $EnvFile

Create it by copying the template and filling in the four values:

    Copy-Item .pgdump.env.example .pgdump.env
    notepad .pgdump.env

Then run this script again.
"@
}

$cfg = @{}
foreach ($line in Get-Content $EnvFile) {
    $t = $line.Trim()
    if ($t -eq '' -or $t.StartsWith('#')) { continue }
    $eq = $t.IndexOf('=')
    if ($eq -lt 1) { continue }
    $k = $t.Substring(0, $eq).Trim()
    $v = $t.Substring($eq + 1).Trim()
    if ($v.Length -ge 2 -and (($v[0] -eq '"' -and $v[-1] -eq '"') -or ($v[0] -eq "'" -and $v[-1] -eq "'"))) {
        $v = $v.Substring(1, $v.Length - 2)
    }
    $cfg[$k] = $v
}

$Host_ = $cfg['SUPABASE_DB_HOST']
$User_ = $cfg['SUPABASE_DB_USER']
$Pass_ = $cfg['SUPABASE_DB_PASSWORD']
$Port_ = if ($cfg.ContainsKey('SUPABASE_DB_PORT') -and $cfg['SUPABASE_DB_PORT']) { $cfg['SUPABASE_DB_PORT'] } else { '5432' }

# Preferred path: the whole connection string pasted as one value. The Supabase
# dashboard shows it ready to copy, and splitting it by hand is where people go
# wrong - the pooler URI puts the username BEFORE the colon, which is the
# opposite of the more familiar postgresql://user:pass@host form.
if ($cfg['SUPABASE_DB_URL']) {
    $uri = $cfg['SUPABASE_DB_URL']
    if ($uri -notmatch '^(postgres|postgresql)://') {
        Fail "SUPABASE_DB_URL must start with postgres:// or postgresql://"
    }
    try {
        $parsed = [Uri]$uri
    } catch {
        Fail "Could not parse SUPABASE_DB_URL as a connection string."
    }

    $userinfo = $parsed.UserInfo -split ':', 2
    $Host_ = $parsed.Host
    $User_ = [Uri]::UnescapeDataString($userinfo[0])
    if ($userinfo.Count -gt 1) { $Pass_ = [Uri]::UnescapeDataString($userinfo[1]) }
    # Only override the port if the URI carries an explicit non-default one.
    if ($parsed.Port -gt 0) { $Port_ = [string]$parsed.Port }
}

$missing = @()
if (-not $Host_) { $missing += 'SUPABASE_DB_HOST (or SUPABASE_DB_URL)' }
if (-not $User_) { $missing += 'SUPABASE_DB_USER (or SUPABASE_DB_URL)' }
if (-not $Pass_) { $missing += 'SUPABASE_DB_PASSWORD (or SUPABASE_DB_URL)' }
if ($missing.Count -gt 0) {
    Fail "Missing in ${EnvFile}: $($missing -join ', ')"
}

Write-Host ""
Info "Target : $User_@${Host_}:$Port_"
Info "Schema : $Schema"
Info "Output : $OutFile"
Write-Host ""

if ($Port_ -eq '6543') {
    Warn "Port 6543 is Supabase's TRANSACTION-mode pooler."
    Warn "pg_dump holds one long-lived connection, which that mode does not support."
    Warn "Use 5432 (session mode) instead - see the template file."
    Write-Host ""
}

# --- 3. Dump -----------------------------------------------------------------
$outDir = Split-Path -Parent $OutFile
if (-not $outDir) { $outDir = (Get-Location).Path }
$outDir = (Resolve-Path $outDir).Path
$fileName = Split-Path -Leaf $OutFile
if (-not $fileName) { $fileName = 'supabase-schema-live.sql' }

Info "Running pg_dump (this takes a few seconds)..."

$dumpArgs = @(
    'run', '--rm',
    '-e', "PGPASSWORD=$Pass_",
    '-v', "${outDir}:/out",
    'postgres:17-alpine',
    'pg_dump',
    '-h', $Host_,
    '-p', $Port_,
    '-U', $User_,
    '-d', 'postgres',
    '--schema-only',
    '--no-owner',
    '--no-privileges',
    '--schema', $Schema,
    '-f', "/out/$fileName"
)
foreach ($t in $Tables) { $dumpArgs += @('-t', $t) }

docker @dumpArgs
if ($LASTEXITCODE -ne 0) {
    Fail @"
pg_dump failed.

Most likely causes:
  - Wrong password, or you have not rotated it yet
  - Port 6543 (transaction pooler) instead of 5432 (session pooler)
  - Your IP is not in the Supabase project's allowed IP list
    (Dashboard -> Settings -> Database -> Connection -> Restrictions)
"@
}

# --- 4. Report ---------------------------------------------------------------
$target = Join-Path $outDir $fileName
if (-not (Test-Path $target)) { Fail "pg_dump reported success but $target was not created." }

$sizeKB = [math]::Round((Get-Item $target).Length / 1KB, 1)
$lineCount = (Get-Content $target | Measure-Object -Line).Lines

Write-Host ""
Ok "Done."
Info "File  : $target"
Info "Size  : $sizeKB KB ($lineCount lines)"
Write-Host ""

$tables = Select-String -Path $target -Pattern 'CREATE TABLE "public"\."([^"]+)"' -AllMatches |
    ForEach-Object { $_.Matches } | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique

if ($tables) {
    Info "Tables found ($($tables.Count)):"
    $tables | ForEach-Object { "      - $_" }
    Write-Host ""
}

$funcs = Select-String -Path $target -Pattern 'CREATE (OR REPLACE )?FUNCTION "public"\."([^"]+)"' -AllMatches |
    ForEach-Object { $_.Matches } | ForEach-Object { $_.Groups[2].Value } | Sort-Object -Unique
if ($funcs) {
    Info "Functions found ($($funcs.Count)):"
    $funcs | ForEach-Object { "      - $_" }
    Write-Host ""
}

Info "Next: send this file over so it can be diffed against src/db/schema.ts."
Write-Host ""
