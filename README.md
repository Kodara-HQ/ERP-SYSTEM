# BAJOGO ERP

BAJOGO ERP is the business system for BAJOGO ENTERPRISE. Phase 1 is the company, organisation, employee, and access-control foundation. Later phases add the approval engine and the operating modules on the same PostgreSQL database.

## Phase 1

Working now:

- Company profile, branches, locations, departments, subdepartments, and positions.
- Employee registration, assignment history, transfers, and reporting lines.
- User accounts separate from employees and positions.
- Roles and permissions, including department, branch, and own-record scope.
- Login, session rotation, lockout, and forced password change.
- Organisational change requests that a manager can submit and only a system administrator can implement.
- Append-only audit log.
- Dashboards and search fed by the database.

Phase 2 adds the central approval engine on that same database: configurable routes, sequential and parallel steps, amount and department conditions, rejection, return and resubmission, delegation, reminders, and a full decision history.

Phase 3 adds human resources on that engine. Leave uses the LEAVE route and recruitment uses the RECRUITMENT route. Attendance, contracts, promotions, training, onboarding, appraisals, disciplinary records, and exits are HR records. A promotion closes the current primary assignment and keeps it. An exit closes the open assignment. Disciplinary records and appraisals require confidential HR permission, so IT and the system administrator do not receive them.

Phase 4 adds procurement and inventory on the same engine. A purchase requisition uses the PURCHASE route, so a purchase order cannot be raised until the supervisor, operations, accounts, and the CEO have approved it. Goods received update the order and write stock movements in one transaction. Issues, transfers, adjustments, and damaged quantities are movements too. Stock value is the weighted average cost.

Phase 5 adds the ledger. Journals are double-entry and stay posted: a correction is a reversing journal. Supplier invoices are posted as an expense and accounts payable, then a payment request uses the PAYMENT route (department manager, accounts verification, CEO). Accounts executes the payment after approval and the payable comes down. Customer invoices and receipts use accounts receivable. Budgets use the BUDGET route and the report compares the approved amount with the expense posted to that account and department. Petty cash and bank reconciliation are on the same books. Payroll calculation, farm, haulage, sales, legal casework, and marketing operations are later phases.

## Local setup

Requirements: Node.js 22 or later, npm, and PostgreSQL 14 or later.

This workstation runs a dedicated PostgreSQL 18 cluster for BAJOGO ERP from `.pgdata` on `127.0.0.1:5433`. Start it with:

```powershell
powershell -File scripts/start-postgres.ps1
```

The application role `bajogo_app` has `CREATEDB`, so `npm run migrate` creates the database when it is missing. The Windows PostgreSQL service on port 5432 belongs to another installation and is left alone.

```powershell
copy .env.example .env
npm install
npm run migrate
npm run seed
npm run dev
```

The API is `http://127.0.0.1:4000` by default. The web app is `http://127.0.0.1:5173`. API docs are at `http://127.0.0.1:4000/api/docs`. If port 4000 is already in use, set `PORT` in `.env` and `VITE_API_PROXY=http://127.0.0.1:<port>` in `frontend/.env.local`.

`npm run seed` creates the company, the opening departments and positions, the role catalogue, and one technical administrator. The temporary password is printed and written to `backend/.credentials/sysadmin-password.txt`, which is not committed. The account must change that password before it can work in the system.

No named employees are seeded. Register real people through HR.

## Tests

```powershell
npm test
```

Backend tests use the database `bajogo_erp_test` and require the local PostgreSQL cluster.

## Security notes

- Passwords are hashed with bcrypt.
- Access tokens last 15 minutes. Refresh tokens are hashed at rest and rotated.
- Browser sessions use HTTP-only cookies. Production must set `NODE_ENV=production` so the cookies are marked Secure, and the site must be served over HTTPS.
- Permission checks run in the API. Hiding a button is not the control.
- A system administrator cannot approve expenditure, cannot grant that authority to their own account, and cannot read confidential employee fields.
- Audit rows cannot be updated or deleted. Database triggers reject both.

See `docs/ARCHITECTURE.md` for the data model and the access rules.
