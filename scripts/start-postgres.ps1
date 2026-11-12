# Start the local PostgreSQL cluster used by BAJOGO ERP.
# The server listens only on 127.0.0.1:5433. This is a workstation database.

$pgctl = "C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe"
$data = "C:\Users\user\ERP\.pgdata"

if (-not (Test-Path $pgctl)) {
  Write-Error "PostgreSQL 18 is not installed at $pgctl"
  exit 1
}

if (-not (Test-Path $data)) {
  Write-Error "The BAJOGO database cluster is not initialized at $data"
  exit 1
}

& $pgctl status -D $data | Out-Null
if ($LASTEXITCODE -eq 0) {
  Write-Output "PostgreSQL is already running."
  exit 0
}

& $pgctl start -D $data -l "$data\server.log" -w
if ($LASTEXITCODE -ne 0) {
  Write-Error "PostgreSQL did not start. See $data\server.log"
  exit 1
}
