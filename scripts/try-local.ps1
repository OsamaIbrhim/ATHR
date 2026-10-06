# Starts the whole stack locally for manual testing:
# database (migrate + seed) -> backend :3000 -> admin :3001 -> POS (Electron).
# Requires: Node 24, PostgreSQL running locally, backend/.env configured.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\try-local.ps1 [-Reset]
#   -Reset  wipes and reseeds the development database first.
param([switch]$Reset)
$ErrorActionPreference = 'Continue'  # native tools write to stderr; failures are caught by Run

function Run([string]$label, [scriptblock]$step) {
  & $step
  if ($LASTEXITCODE -ne 0) { throw "$label failed (exit $LASTEXITCODE)" }
}
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path 'backend\.env')) { throw 'backend\.env is missing (copy backend\.env.example and set DATABASE_URL / JWT_SECRET).' }

if (-not (Test-Path 'node_modules')) {
  Write-Host '== Installing dependencies (first run only) =='
  Run 'npm ci' { npm ci --ignore-scripts }
  Run 'npm rebuild' { npm rebuild '@prisma/engines' prisma '@prisma/client' electron esbuild better-sqlite3 }
}

Write-Host '== Building shared packages =='
Run 'build:shared' { npm run build:shared }
Push-Location backend
Run 'prisma generate' { npx prisma generate }
if ($Reset) {
  Write-Host '== Recreating the development database (all migrations) =='
  Run 'migrate reset' { npx prisma migrate reset --force --skip-seed --skip-generate }
} else {
  Write-Host '== Applying pending database migrations =='
  Run 'migrate deploy' { npx prisma migrate deploy }
}
if ($Reset) {
  Write-Host '== Seeding development data =='
  $env:ALLOW_DEVELOPMENT_ACCOUNTING_RESET = 'reset-development-accounting'
  Run 'seed' { npm run prisma:seed }
}
Pop-Location

Write-Host '== Starting backend, admin and POS in separate windows =='
Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location '$root\backend'; npm run start:dev"
Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location '$root\admin-web'; npm run dev"
Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location '$root\pos-electron'; npm run dev:electron"

Start-Sleep -Seconds 20
Start-Process 'http://localhost:3001'
Write-Host 'Admin: http://localhost:3001  (dev login: +200100000000 / Bold1234)'
