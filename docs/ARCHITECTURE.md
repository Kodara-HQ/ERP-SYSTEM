# BAJOGO ERP architecture

Phase 1 decisions. Later modules extend this database and these services. They do not replace them.

## Application shape

One modular monolith:

- `frontend/` is a React, Vite, and TypeScript client. It talks only to the API.
- `backend/` is an Express and TypeScript API under `/api/v1`.
- PostgreSQL database `bajogo_erp` is the only system of record.
- Authentication, permissions, audit, and notifications are shared services. Modules do not keep private copies.

The browser is proxied to the API in development so session cookies stay on one origin. Production should keep that same-origin arrangement behind HTTPS.

## Identity

Three records stay separate:

- An employee is a person.
- A position is a job.
- A user is a login. A user may be linked to one employee.
- A role is a set of permissions on that login. It is not the job title.

An employee can hold substantive, acting, and temporary assignments at the same time. A transfer closes the current primary assignment and inserts a new row. The old row stays. Reporting lines work the same way and more than one can be open.

## Authority

Permissions are rows, not code branches. Each one has a sensitivity:

- `standard` — a technical administrator with role management may grant it.
- `technical` — only on a technical-administrator role. This covers structure changes and account administration.
- `confidential` — HR, payroll, legal, and company-profile edits. Only an account that already holds `permissions.manage_protected` may grant these.
- `expenditure` — `finance.approve_expenditure`. Same protected grant rule.

The CEO role is the only seeded role with final business authority. The system administrator role is technical and cannot approve expenditure. The approval policy in `backend/src/modules/approvals/policy.ts` rejects self-approval, rejects expenditure approval from a technical administrator, and reserves the final step for the CEO flag.

Record visibility follows the job, not a global grant on every role:

- A person sees the records of their own department. CEO, HR, accounts, and legal follow that same boundary for records.
- A manager, marked by a managerial position, sees every record in that department and the units under it.
- Each department has workspace rows in `department_workspaces`. The sidebar and the API open a module only when the person's department includes that workspace and their role allows it. The CEO's final authority follows the role's permissions across departments. A department that has no workspace rows yet keeps the role's permissions, so a new department can be configured before it is restricted.
- The system administrator sees the technical workspaces: organisation, administration, and standard employee records. Confidential HR, payroll, legal files, finance books, and purchasing stay out of that technical view. Employee records are limited to Human Resources and the system administrator. Other roles keep their own profile under Settings and do not open the employee directory.

The workflow engine calls that policy on every decision. A verification step is passed as a general decision, so accounts can verify a payment without receiving authority to approve the spend. The CEO step on an expenditure route is passed as expenditure and as the final business step, and it applies to every amount. A financial request cannot be submitted on a route that drops that step. Routes, thresholds, and role assignments are rows in `workflows` and `workflow_steps`. A submitted request copies the applicable steps onto `approval_request_steps`, so a later edit to the route does not rewrite history. `approval_actions` keeps the person, comment, and time of each decision.

Department managers can submit an organisational change request. Implementing that request, or editing departments and positions directly, requires the technical permissions. An administrator cannot implement their own request.

A role assignment is scoped `global`, `branch`, `department`, or `own`. List and detail queries apply that scope in SQL.

## Audit

Every structural and account change writes `audit_logs` in the same database transaction as the change. Passwords and national IDs are redacted. Triggers `audit_logs_block_update` and `audit_logs_block_delete` reject mutation even if a later bug adds a route.

## Schema map

Organisation: `companies`, `branches`, `locations`, `departments`, `positions`.

People: `employees`, `employment_records`, `employee_assignments`, `reporting_relationships`.

Security: `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `user_sessions`, `login_attempts`.

Control: `organisational_change_requests`, `notifications`, `audit_logs`, `system_settings`, `reference_sequences`.

`departments.parent_id` is the only hierarchy. There is no fixed depth. Reference numbers come from `reference_sequences` inside a transaction (`BJG-EMP-00001`, `BJG-ORG-00001`).

Approval tables in place: `workflows`, `workflow_steps`, `approval_requests`, `approval_request_steps`, `approval_actions`, and `approval_delegations`. A request can point at the business row that created it through `source_type` and `source_id`. Leave and vacancies listen for those decisions in the same transaction, so a balance or vacancy status cannot drift from the approval.

HR tables in place: `leave_types`, `leave_balances`, `leave_requests`, `attendance_records`, `vacancies`, `applicants`, `employment_contracts`, `promotions`, `disciplinary_records`, `appraisals`, `training_records`, `onboarding_tasks`, and `exit_records`.

Procurement and inventory tables in place: `suppliers`, `stock_categories`, `warehouses`, `stock_items`, `stock_balances`, `stock_lots`, `stock_movements`, `purchase_requisitions`, `purchase_requisition_lines`, `purchase_orders`, `purchase_order_lines`, `goods_received_notes`, `goods_received_lines`, and `supplier_invoices`. A requisition points at its approval through `source_type` `purchase_requisition`. Usable receipts increase `stock_balances` and a lot. Damaged quantity is received and then written off as a damage movement, so it counts against the order and does not stay available. Posting a supplier invoice writes a journal (expense and accounts payable). Paying it writes a second journal that clears accounts payable and reduces the amount still owed.

Finance tables in place: `ledger_accounts`, `cash_accounts`, `journals`, `journal_lines`, `customers`, `customer_invoices`, `customer_receipts`, `payment_requests`, `budgets`, and `reconciliations`. Every financial posting goes through one balanced journal. Triggers reject updates and deletes of journals and of journal-line amounts. Reconciliation may set `journal_lines.cleared_on` only. A payment request uses `source_type` `payment_request` on the PAYMENT route. A budget uses `source_type` `budget` on the BUDGET route. The journal is posted when an approved payment is executed, not when the request is submitted.

Planned product modules that are not separate applications yet: farm, haulage, sales, and marketing. Farm and haulage activity is recorded in the operations register. Payroll, legal review, and CEO departmental checks are part of the current system. Salary payments post journals to account 5100 and are not edited after they succeed.

## Opening data

The seed writes BAJOGO ENTERPRISE, the departments and positions named in the company structure, and the role catalogue. Currency defaults to USD and timezone to UTC until an authorised user sets the real values. Addresses and employee names are not invented.
