#!/usr/bin/env bash
# Sets a new temporary password for one ERP user. The password is typed here and never shown.
# The user must choose their own password at the next sign-in, and existing sign-ins are ended.
# Use it when nobody can sign in to reset the password from the ERP (for example the only system administrator).
# Usage:  bash /var/www/bajogo-erp/deploy/reset-password.sh sysadmin
set -euo pipefail

USERNAME="${1:-sysadmin}"
APP=/var/www/bajogo-erp
cd "$APP"
set -a; . ./.env; set +a

read -r -s -p "New temporary password for $USERNAME (at least 12 characters): " P1; echo
read -r -s -p "Type it again: " P2; echo
if [ "$P1" != "$P2" ]; then echo "The two entries are different. Nothing was changed." >&2; exit 1; fi
if [ "${#P1}" -lt 12 ]; then echo "Use at least 12 characters. Nothing was changed." >&2; exit 1; fi

RESET_USERNAME="$USERNAME" RESET_PASSWORD="$P1" node -e '
const bcrypt = require("bcryptjs");
const { Client } = require("pg");
(async () => {
  const client = new Client({ host: process.env.DB_HOST || "127.0.0.1", port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  await client.connect();
  const hash = await bcrypt.hash(process.env.RESET_PASSWORD, Number(process.env.BCRYPT_ROUNDS || 12));
  const result = await client.query(
    `UPDATE users SET password_hash = $1, must_change_password = 1, failed_login_attempts = 0,
       locked_until = NULL, token_version = token_version + 1, password_changed_at = now(), updated_at = now()
     WHERE lower(username) = lower($2) RETURNING id, username, status`,
    [hash, process.env.RESET_USERNAME]);
  await client.end();
  if (result.rowCount === 0) { console.error("No user is called " + process.env.RESET_USERNAME + ". Nothing was changed."); process.exit(1); }
  const user = result.rows[0];
  console.log("Password reset for " + user.username + " (status: " + user.status + ").");
  console.log("Sign in at https://bajogoenterprise.com/login; you will be asked to choose a new password.");
})().catch((error) => { console.error("Reset failed: " + error.message); process.exit(1); });
'
unset P1 P2
