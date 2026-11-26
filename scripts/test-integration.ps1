$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$line = Get-Content (Join-Path $root '.env') | Where-Object { $_.StartsWith('DATABASE_URL=') } | Select-Object -First 1
if (-not $line) { throw 'DATABASE_URL missing from .env' }
$url = [UriBuilder]::new($line.Substring(13))
$url.Path = '/money_tracker_test'
$env:TEST_DATABASE_URL = $url.Uri.AbsoluteUri
try {
    Push-Location $root
    npm run test:integration
    $testExit = $LASTEXITCODE
} finally {
    Pop-Location
    Remove-Item Env:TEST_DATABASE_URL
}
exit $testExit
