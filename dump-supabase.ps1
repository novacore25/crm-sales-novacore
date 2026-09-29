#Requires -Version 5.1
<#
.SYNOPSIS
    Dumps the live Supabase schema so it can be diffed against the Drizzle schema.

.DESCRIPTION
    The old repository's supabase/migrations/ folder is NOT a reliable source of
    truth - it drifted from the production database (see docs/MIGRATION.md). This
    script pulls the actual schema via pg_dump in a throwaway container, so no
    local PostgreSQL install is needed.

    Requires Docker Desktop to be running.

.EXAMPLE
    .\dump-supabase.ps1
    .\dump-supabase.ps1 -OutFile .\supabase-schema-live.sql
#>
[CmdletBinding()]
param(
    [string]$OutFile = ".\supabase-schema-live.sql",
    [string]$Schema  = "public",
    # Empty array = every table. Pass e.g. -Tables leads,funnel_history to narrow it.
    [string[]]$Tables = @()
)

$ErrorActionPreference = 'Stop'

function Fail($msg) {
    Write-Host ""
    Write-Host "  $msg" -ForegroundColor Red
    Write-Host ""
    exit 1
}

# --- Docker ------------------------------------------------------------------
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Fail "Docker is not on PATH. Install Docker Desktop: https://docs.docker.com/get-docker/"
}

docker info --format "{{.ServerVersion}}" *> $null
if ($LASTEXITCODE -ne 0) {
    Fail "Docker is installed but the daemon is not responding. Start Docker Desktop and retry."
}

# --- Connection details ------------------------------------------------------
# The connection string that was committed to the old repo's
# scripts/add_pic_name_column.cjs. Kept here only as a fallback; prefer .env.
$Host_ = $env:SUPABASE_DB_HOST
$Port_ = if ($env:SUPABASE_DB_PORT) { $env:SUPABASE_DB_PORT } else { "5432" }
$User_ = $env:SUPABASE_DB_USER
$Pass_ = $env:SUPABASE_DB_PASSWORD

if (-not $Host_ -or -not $User_ -or -not $Pass_) {
    Write-Host ""
    Write-Host "  Supabase connection details not found." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Set them as environment variables, then re-run:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "    `$env:SUPABASE_DB_HOST     = 'aws-0-ap-southeast-1.pooler.supabase.com'"
    Write-Host "    `$env:SUPABASE_DB_USER     = 'postgres.<project-ref>'"
    Write-Host "    `$env:SUPABASE_DB_PASSWORD = '<password>'"
    Write-Host "    `$env:SUPABASE_DB_PORT     = '5432'   # direct, not the 6543 pooler"
    Write-Host ""
    Fail "Missing SUPABASE_DB_* environment variables."
}

Write-Host ""
Write-Host "  Dumping schema '$Schema' from $User_@$Host_`:$Port_" -ForegroundColor Cyan
Write-Host ""

# Build the pg_dump argument list.
$image    = "postgres:17-alpine"
$outPath  = (Resolve-Path -Path (Split-Path -Parent $OutFile) -ErrorAction SilentlyContinue)
if (-not $outPath) { $outPath = (Get-Location).Path }
$fileName = Split-Path -Leaf $OutFile
if (-not $fileName) { $fileName = "supabase-schema-live.sql" }

$dumpArgs = @(
    "run", "--rm",
    "-e", "PGPASSWORD=$Pass_",
    "-v", "${outPath}:/out",
    $image,
    "pg_dump",
    "-h", $Host_,
    "-p", $Port_,
    "-U", $User_,
    "-d", "postgres",
    "--schema-only",
    "--no-owner",
    "--no-privileges",
    "--schema", $Schema
)

if ($Tables.Count -gt 0) {
    foreach ($t in $Tables) { $dumpArgs += @("-t", $t) }
}

# pg_dump writes to stdout; redirect inside the container so PowerShell does not
# mangle the encoding, then copy the file out.
$dumpArgs += @("-f", "/out/$fileName")

docker @dumpArgs
if ($LASTEXITCODE -ne 0) {
    Fail "pg_dump failed. Check the host, port (use 5432, not the 6543 pooler) and credentials."
}

# --- Report ------------------------------------------------------------------
$target = Join-Path $outPath $fileName
if (-not (Test-Path $target)) { Fail "pg_dump reported success but $target was not created." }

$size = [math]::Round((Get-Item $target).Length / 1KB, 1)
$lines = (Get-Content $target | Measure-Object -Line).Lines

Write-Host ""
Write-Host "  Done." -ForegroundColor Green
Write-Host "    File  : $target"
Write-Host "    Size  : $size KB ($lines lines)"
Write-Host ""

# --- Quick sanity summary ----------------------------------------------------
Write-Host "  Tables found:" -ForegroundColor Cyan
Select-String -Path $target -Pattern 'CREATE TABLE "public"\."([^"]+)"' -AllMatches |
    ForEach-Object { $_.Matches } |
    ForEach-Object { $_.Groups[1].Value } |
    Sort-Object -Unique |
    ForEach-Object { "    - $_" }

Write-Host ""
Write-Host "  Next: send this file over so it can be diffed against src/db/schema.ts." -ForegroundColor Cyan
Write-Host ""
