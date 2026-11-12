# Start the local MySQL 8.4 server used by BAJOGO ERP.
# The server listens only on 127.0.0.1:3306. This is a workstation database.

$mysqld = "C:\Users\user\mysql-8.4\mysql-8.4.7-winx64\bin\mysqld.exe"
$defaults = "C:\Users\user\mysql-8.4\my.ini"

if (-not (Test-Path $mysqld)) {
  Write-Error "MySQL 8.4 is not installed at $mysqld"
  exit 1
}

& $mysqld --defaults-file=$defaults --console
