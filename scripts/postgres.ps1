param([ValidateSet('init','start','stop','status')][string]$Action = 'status', [int]$Port = 5433)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$clusterPath = Join-Path $projectRoot '.postgres'
$localPath = Join-Path $projectRoot '.local'
$envPath = Join-Path $projectRoot '.env'
$pgBin = Split-Path -Parent (Get-Command psql -ErrorAction Stop).Source
$pgCtl = Join-Path $pgBin 'pg_ctl.exe'
if (-not $clusterPath.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar)) { throw 'Invalid cluster path' }
if ($Action -eq 'init') {
    if ((Test-Path -LiteralPath $clusterPath) -or (Test-Path -LiteralPath $envPath)) { throw 'Cluster or .env already exists. Use start, or configure DATABASE_URL manually.' }
    New-Item -ItemType Directory -Force $localPath | Out-Null
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes = New-Object byte[] 24
    $rng.GetBytes($bytes)
    $password = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
    $passwordPath = Join-Path $localPath 'db-password'
    [IO.File]::WriteAllText($passwordPath, $password)
    & (Join-Path $pgBin 'initdb.exe') -D $clusterPath --username=money "--pwfile=$passwordPath" --auth=scram-sha-256 --encoding=UTF8 --locale=C
    if ($LASTEXITCODE -ne 0) { throw 'initdb failed' }
    [IO.File]::WriteAllText($envPath, "DATABASE_URL=postgresql://money:${password}@127.0.0.1:${Port}/money_tracker`nAPP_ORIGIN=http://localhost:3000`nCOOKIE_SECURE=false`nAPP_TIMEZONE=Asia/Jakarta`n")
    & $pgCtl -D $clusterPath -l (Join-Path $localPath 'postgres.log') -o "-h 127.0.0.1 -p $Port" -w start
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL failed to start' }
    $env:PGPASSWORD = $password
    try {
        foreach ($database in @('money_tracker','money_tracker_test')) {
            & (Join-Path $pgBin 'createdb.exe') -h 127.0.0.1 -p $Port -U money $database
            if ($LASTEXITCODE -ne 0) { throw 'Database creation failed' }
        }
    } finally { Remove-Item Env:PGPASSWORD }
    Write-Host 'PostgreSQL initialized. Run npm run db:migrate.'
} elseif ($Action -eq 'start') {
    & $pgCtl -D $clusterPath -l (Join-Path $localPath 'postgres.log') -o "-h 127.0.0.1 -p $Port" -w start
} elseif ($Action -eq 'stop') {
    & $pgCtl -D $clusterPath -m fast -w stop
} else {
    & $pgCtl -D $clusterPath status
}
