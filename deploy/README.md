# Deploying BAJOGO ERP on an Ubuntu server

This guide puts BAJOGO ERP on a server that already runs other applications. Each application keeps:

- its own **subdomain**, for example `erp.example.com`,
- its own **internal port**, reachable only from the server itself,
- its own **PostgreSQL role and database**,
- its own **Nginx site file** and **systemd service**.

Nginx is the only thing that listens on the public IP (ports 80 and 443). It reads the domain in each request and hands it to the right application.

```
                    ┌──────────── Ubuntu server (public IP) ────────────┐
 erp.example.com ─┐ │  Nginx :443 ─┬─ erp.example.com → BAJOGO web files │
 app2.example.com ┼─┼──────────────┤                   + /api → :4100   │
 app3.example.com ┘ │              ├─ app2.example.com → :3000           │
                    │              └─ app3.example.com → :8080           │
                    │  PostgreSQL :5432 (localhost only)                  │
                    │    bajogo_erp (bajogo_app) · app2_db (app2) · …     │
                    └─────────────────────────────────────────────────────┘
```

Replace `erp.example.com` with your subdomain and `4100` with a free port throughout.

### The public website on the same server

The company website (`website/`) runs on the same server and the same API process. It needs no extra service, port or database:

```
 www.example.com ─┐   Nginx ─┬─ www.example.com → website/dist  + /api/v1/public → :4100
 example.com ─────┘          │    (example.com redirects to www)
 erp.example.com ────────────┴─ erp.example.com → frontend/dist + /api          → :4100
```

The website's domain only reaches the public website routes (`/api/v1/public/…`). Staff sign-in and ERP data are served on the ERP subdomain alone. Website content is edited in the ERP under **Website management**.

## 1. DNS

At your domain registrar, add **A records** pointing to the server's public IP:

| Name | Purpose |
| --- | --- |
| `erp` | The ERP |
| `@` (the bare domain) | The website (redirects to `www`) |
| `www` | The website |

Wait until `ping erp.example.com` and `ping www.example.com` answer with that IP.

## 2. Check what is already on the server

```bash
sudo ss -ltnp
```

This lists the ports in use. Choose a port for the BAJOGO API that is not in the list (the files here use `4100`). Also note whether Nginx is already installed. If another web server (Apache, Caddy) owns ports 80/443, add BAJOGO to that one instead, or ask before switching.

## 3. Install Node.js 22, Nginx and Certbot

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs nginx certbot python3-certbot-nginx git postgresql-client
node -v
```

## 4. Database

Make sure PostgreSQL only listens locally. In `/etc/postgresql/<version>/main/postgresql.conf`, `listen_addresses` should be `'localhost'`. Then create BAJOGO's own role and database. Edit the password in the file first:

```bash
sudo -u postgres psql -f deploy/postgres-setup.sql
```

If PostgreSQL is on a different machine, set `DB_HOST` to that machine and allow only this server's IP in its `pg_hba.conf`.

## 5. Get the code

```bash
sudo adduser --system --group --home /srv/bajogo-erp bajogo
sudo -u bajogo git clone https://github.com/Kodara-HQ/ERP-SYSTEM.git /srv/bajogo-erp
```

The repository is private, so the server needs access: a GitHub deploy key for the `bajogo` user is the cleanest way.

## 6. Settings

```bash
sudo -u bajogo cp /srv/bajogo-erp/deploy/env.production.example /srv/bajogo-erp/.env
sudo -u bajogo nano /srv/bajogo-erp/.env
sudo chmod 600 /srv/bajogo-erp/.env
```

Fill in the database password, the domain in `CLIENT_ORIGIN`, the port, and a new `JWT_ACCESS_SECRET`. Set `ERP_PUBLIC_URL` to the ERP address and `WEBSITE_PUBLIC_URL` to the website address (`https://www.example.com`); the website's Staff Login link, sitemap and robots.txt use them.

## 7. Build, migrate, seed

```bash
cd /srv/bajogo-erp
sudo -u bajogo npm ci
sudo -u bajogo npm run build
cd backend
sudo -u bajogo node dist/database/migrate.js
sudo -u bajogo node dist/database/seed.js
```

The seed prints the first administrator's temporary password and saves it in `backend/.credentials/`. Run it **once only**.

`npm run build` builds the API, the ERP (`frontend/dist`) and the website (`website/dist`). Migrating also loads the website's opening pages and photographs from `backend/assets/website/`; running it again later never overwrites content staff have edited.

## 8. Start the API as a service

```bash
sudo cp /srv/bajogo-erp/deploy/systemd/bajogo-erp-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bajogo-erp-api
curl http://127.0.0.1:4100/api/v1/health
```

The last line should print `"status":"ok"`. Logs: `journalctl -u bajogo-erp-api -f`.

## 9. Nginx site and HTTPS

```bash
sudo cp /srv/bajogo-erp/deploy/nginx/bajogo-erp.conf /etc/nginx/sites-available/bajogo-erp
sudo nano /etc/nginx/sites-available/bajogo-erp      # set server_name and port
sudo ln -s /etc/nginx/sites-available/bajogo-erp /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d erp.example.com
```

`nginx -t` checks every site file, including your other apps, before reloading, so a mistake won't take them down. Certbot adds HTTPS and renews it automatically.

### The website

```bash
sudo cp /srv/bajogo-erp/deploy/nginx/bajogo-website.conf /etc/nginx/sites-available/bajogo-website
sudo nano /etc/nginx/sites-available/bajogo-website  # set the domain (3 places) and port
sudo ln -s /etc/nginx/sites-available/bajogo-website /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d example.com -d www.example.com
```

Check it:

```bash
curl -s https://www.example.com/api/v1/public/website/bootstrap | head -c 200   # website content
curl -s -o /dev/null -w "%{http_code}\n" https://www.example.com/api/v1/auth/me  # 404: staff API not exposed here
curl -s https://www.example.com/robots.txt
```

Then sign in to the ERP, open **Website management → Settings**, and enter the company telephone, email, address and social links. They appear on the website straight away.

## 10. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

Only SSH, 80 and 443 are open. The API port and PostgreSQL stay private. Check that your other apps don't need a port opened directly before enabling this.

## 11. Backups

```bash
chmod +x /srv/bajogo-erp/deploy/*.sh
sudo -u bajogo crontab -e
```

Add:

```
30 2 * * * /srv/bajogo-erp/deploy/backup.sh >> /srv/bajogo-erp/backups/backup.log 2>&1
```

Copy the `backups` folder off the server regularly, and test a restore once:

```bash
pg_restore -h 127.0.0.1 -U bajogo_app -d bajogo_erp_restore_test --create backups/<file>.dump
```

## Updating later

Let the `bajogo` user restart its own service without a password:

```bash
echo 'bajogo ALL=NOPASSWD: /usr/bin/systemctl restart bajogo-erp-api' | sudo tee /etc/sudoers.d/bajogo-erp
```

Then each update is:

```bash
sudo -u bajogo bash /srv/bajogo-erp/deploy/update.sh
```

It pulls, builds, backs up the database, migrates, and restarts the API. The rebuilt ERP and website files are served by Nginx at once; no Nginx reload is needed.
