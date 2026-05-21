# setup-windows.ps1
# Run from PowerShell (as normal user, not admin) after cloning the repo.
# Usage: .\setup-windows.ps1 -ClientId "..." -ClientSecret "..."

param(
    [Parameter(Mandatory=$true)]  [string]$ClientId,
    [Parameter(Mandatory=$true)]  [string]$ClientSecret,
    [string]$Environment   = "production",
    [string]$RedirectUri   = "https://qbo-oauth-callback-orcin.vercel.app/api/qbo/callback"
)

$ErrorActionPreference = "Stop"

# ── Paths ──────────────────────────────────────────────────────────────────
$ClaudeSupport = "$env:APPDATA\Claude"
$ExtDir        = "$ClaudeSupport\Claude Extensions\local.quickbooks-online-mcp"
$SettingsDir   = "$ClaudeSupport\Claude Extensions Settings"
$InstallFile   = "$ClaudeSupport\extensions-installations.json"
$RepoRoot      = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "`n── Step 1: Build ─────────────────────────────────────────────" -ForegroundColor Cyan
Set-Location $RepoRoot
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

# ── Step 2: Create extension folder ───────────────────────────────────────
Write-Host "`n── Step 2: Creating extension folder ────────────────────────" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $ExtDir        | Out-Null
New-Item -ItemType Directory -Force -Path $SettingsDir   | Out-Null

# ── Step 3: Copy runtime files ────────────────────────────────────────────
Write-Host "`n── Step 3: Copying runtime files ────────────────────────────" -ForegroundColor Cyan
Copy-Item -Recurse -Force "$RepoRoot\dist"          "$ExtDir\"
Copy-Item -Recurse -Force "$RepoRoot\node_modules"  "$ExtDir\"
Copy-Item -Force          "$RepoRoot\package.json"  "$ExtDir\"
if (Test-Path "$RepoRoot\package-lock.json") {
    Copy-Item -Force "$RepoRoot\package-lock.json" "$ExtDir\"
}

# ── Step 4: Write .env ────────────────────────────────────────────────────
Write-Host "`n── Step 4: Writing .env ──────────────────────────────────────" -ForegroundColor Cyan
@"
QUICKBOOKS_CLIENT_ID=$ClientId
QUICKBOOKS_CLIENT_SECRET=$ClientSecret
QUICKBOOKS_REFRESH_TOKEN=
QUICKBOOKS_REALM_ID=
QUICKBOOKS_ENVIRONMENT=$Environment
QUICKBOOKS_REDIRECT_URI=$RedirectUri
"@ | Set-Content -Encoding UTF8 "$ExtDir\.env"

# ── Step 5: Write manifest.json ───────────────────────────────────────────
Write-Host "`n── Step 5: Writing manifest.json ─────────────────────────────" -ForegroundColor Cyan
$manifest = @{
    manifest_version = "0.3"
    name             = "quickbooks-online-mcp"
    display_name     = "QuickBooks Online MCP"
    version          = "1.0.0"
    description      = "QuickBooks Online MCP server for Claude Desktop."
    author           = @{ name = "EricGrill / local install" }
    server           = @{
        type        = "node"
        entry_point = "dist/index.js"
        mcp_config  = @{
            command = "node"
            args    = @('${__dirname}/dist/index.js')
            env     = @{
                QUICKBOOKS_CLIENT_ID     = $ClientId
                QUICKBOOKS_CLIENT_SECRET = $ClientSecret
                QUICKBOOKS_REFRESH_TOKEN = ""
                QUICKBOOKS_REALM_ID      = ""
                QUICKBOOKS_ENVIRONMENT   = $Environment
                QUICKBOOKS_REDIRECT_URI  = $RedirectUri
            }
        }
    }
    tools           = @()
    compatibility   = @{
        platforms = @("darwin", "win32")
        runtimes  = @{ node = ">=18.0.0" }
    }
} | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText("$ExtDir\manifest.json", $manifest, [System.Text.UTF8Encoding]::new($false))

# ── Step 6: Register in extensions-installations.json ─────────────────────
Write-Host "`n── Step 6: Registering extension ────────────────────────────" -ForegroundColor Cyan
$timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")

if (Test-Path $InstallFile) {
    $installs = Get-Content $InstallFile -Raw | ConvertFrom-Json
} else {
    $installs = @{ extensions = @{} }
}

$installs.extensions | Add-Member -Force -MemberType NoteProperty -Name "local.quickbooks-online-mcp" -Value @{
    id            = "local.quickbooks-online-mcp"
    version       = "1.0.0"
    hash          = ""
    installedAt   = $timestamp
    manifest      = ($manifest | ConvertFrom-Json)
    signatureInfo = @{ status = "unsigned" }
    source        = "local"
}
$installs | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $InstallFile

# ── Step 7: Enable extension ──────────────────────────────────────────────
Write-Host "`n── Step 7: Enabling extension ───────────────────────────────" -ForegroundColor Cyan
'{ "isEnabled": true }' | Set-Content -Encoding UTF8 "$SettingsDir\local.quickbooks-online-mcp.json"

# ── Done ──────────────────────────────────────────────────────────────────
Write-Host "`n✓ Extension installed at: $ExtDir" -ForegroundColor Green
Write-Host "✓ manifest.json, .env, registry, settings all written`n" -ForegroundColor Green
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Quit and reopen Claude Desktop"
Write-Host "  2. cd `"$ExtDir`""
Write-Host "     node dist\auth.js    ← run once per QBO company"
Write-Host "  3. After OAuth, restart Claude Desktop once more`n"
