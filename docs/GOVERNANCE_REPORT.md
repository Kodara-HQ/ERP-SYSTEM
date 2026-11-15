# Management structure and governance: completion report

Date: 15 November 2026. Database: `bajogo_erp` (PostgreSQL, unchanged name). A backup of the database taken before any change is at `backups/bajogo_erp_before_governance_2026-11-15.dump` (not committed).

## 1. Existing functionality reused

The ERP already had most of the foundation, so this work extends it and does not rebuild it.

| Already in place | How it was reused |
|---|---|
| Login, sessions, lockout, password rules | Unchanged |
| Roles, permissions with sensitivity, scoped role grants | New permissions and roles added to the same catalogue |
| Department workspaces (`department_workspaces`) and record visibility (`visibility.ts`) | Every new module is gated by the same workspace and visibility checks in the API |
| Approval engine: routes, sequential and parallel steps, amount bands, department/branch conditions, return and resubmission, delegation, reminders, history | Extended with conditions, limits, escalation, documents, and segregation rules |
| Append-only audit log with database triggers | All new actions write to it; refused access is now recorded too |
| Payroll HR → accounts → CEO → payment flow | Split HR preparation from HR Manager submission; added payment segregation |
| Procurement, goods received, supplier invoices, payment requests | Added purchase-order and payment segregation; stores can now record receipts |
| Departments, positions, reporting lines, organisational change requests | Structure seeded with the six heads reporting to the CEO; only the system administrator can change it (unchanged rule) |
| Role dashboards, CEO reports, PDF/Excel export (`reportFiles.ts`) | Same export helper used for the new reports and registers |

## 2. New functionality

- **Configurable approval hierarchy.** The CEO is no longer forced onto every route. Each route step has a condition (`always`, `executive`, `special`, `standard`), an amount band, an optional requester position, and an escalation window. Executive approval is added when the amount reaches the company executive threshold, the request is marked for special management approval, or the amount exceeds the approving manager's financial limit. The reason is shown on the step.
- **Financial limits per role** (optionally per workflow and department). A manager approves within the limit; above it the request escalates to the CEO. Limits are also enforced at the moment of decision.
- **Automatic escalation**: no supervisor → department manager → CEO; requester holding the only approving role → CEO; only approver also the only verifier → CEO; a step left pending past its window opens to the escalation role (default CEO) and notifies it. The job runs hourly.
- **Separation-of-duty rules** (configurable, audited): no self-approval (mandatory), verifier ≠ approver, payroll preparer ≠ submitter, requester/approver ≠ payer, verifier ≠ payer (off by default), purchase-order issuer ≠ goods receiver, requester ≠ purchase-order issuer (off by default).
- **Supporting documents** on approval requests (PDF, images, Word, Excel, CSV, text; 5 MB; SHA-256; stored in the database; cannot be changed or deleted). A route can require a document before verification or approval.
- **Budget check** on expenditure requests for finance and the CEO: approved budget, spent, committed, available.
- **Departmental reporting**: daily, weekly, monthly, quarterly, and annual reports. Staff report to their manager; heads of department report to the CEO. Review or return with reasons. PDF and Excel export.
- **Departmental targets** with progress, and **department performance** for the CEO (all departments) and heads (own units).
- **Performance assessments** by managers for their own staff, visible only to the employee, the manager, HR, and the CEO.
- **Department registers** (database-backed, audited, exportable): farm plots, crop management, harvesting, processing, quality control, equipment and fleet, haulage trips; legal cases, licences/land/compliance with renewal alerts; IT support (self-service for all staff), backup monitoring, infrastructure, integrations; customers, campaigns, sales opportunities, market research, customer relations, branding.
- **Company dashboard** for every employee: headcount, departments, vacancies, announcements, own report status. No amounts or personal records.
- **Approval governance page**: threshold, escalation, limits, segregation rules, and the management structure chart.
- **Audit**: previous and new values on route, limit, setting, rule, request, register, report, and target changes; payment execution recorded; refused access attempts recorded as `security.access_denied`.

## 3. Database modifications

Migrations `017_governance_structure.sql`, `018_supporting_documents_no_update.sql`, `019_supporting_documents_no_delete.sql`. No table was dropped and no existing column was removed.

- New tables: `approval_authority_limits`, `segregation_rules`, `supporting_documents`, `announcements`, `department_reports`, `department_targets`, `performance_assessments`, `department_register_entries`.
- New columns: `workflows.requires_supporting_document`, `workflows.governance_version`; `workflow_steps.applies_to_position_code`, `condition_flag`, `escalate_after_hours`, `escalation_role_code`; `approval_requests.special_approval`; `approval_request_steps.escalate_after_hours`, `escalation_role_code`, `activated_at`, `escalated_at`, `added_reason`.
- Changed constraints: `approval_actions.action` also allows `escalate` and `attach`, and `actor_user_id` may be empty for system escalation; `legal_documents.document_type` also allows supplier agreements, customer agreements, land documents, and leases.
- Triggers block update and delete on `supporting_documents`.
- Seeded data (by `npm run seed`, idempotent): the new permissions and roles, the department "Processing and Quality Control", positions (Processing Supervisor, Quality Control Officer, Processing Operative, Accounts Clerk, Legal Assistant), IT and marketing workspaces, segregation rules, opening limits, settings (`executive_approval_threshold` 20,000; escalation after 72 hours to the CEO). Position titles "Accounts Officer" and "Legal Officer" were renamed to "Finance Manager / Accounts Officer" and "Head of Legal Affairs" only where unchanged.
- Six routes that still matched the first release were moved to the new routes once and audited (`workflow.governance_upgrade`): LEAVE, PURCHASE, PAYMENT, FUEL, VEHICLE_REPAIR, MARKETING_EXPENDITURE. PAYROLL, BUDGET, RECRUITMENT, and CONTRACT keep the CEO on every request.
- Live data after migration: 4 employees, 7 users, 1 approval request, 1 payroll run, 2 journals, and all audit rows are intact.

## 4. API modifications

- `/api/v1/governance`: `GET/PUT settings`, `GET/POST/PATCH authority-limits`, `GET/PUT segregation-rules/:code`, `GET organisation-chart`.
- `/api/v1/approvals`: `PATCH workflows/:id` (route settings), `POST escalations/run`, `GET/POST requests/:id/documents`, `GET requests/:id/documents/:documentId`. Requests accept `specialApproval`. Request detail returns `documents`, `budget`, and per step `addedReason`, `escalatedAt`. Workflow steps accept `conditionFlag`, `appliesToPositionCode`, `escalateAfterHours`, `escalationRoleCode`.
- `/api/v1/management`: `company-dashboard`, `performance`, `reports` (+ `.xlsx`, `.pdf`, submit, review), `targets`, `assessments`, `announcements`.
- `/api/v1/registers`: list, `alerts`, `summary`, `/:code` list/create, `/:code/:id` update, `/:code/export.xlsx|pdf`.
- `/api/v1/payroll/:id/submit` and `resubmit` now require `payroll.submit`.
- `/api/v1/procurement/receipts` and the order list are now open to the inventory workspace (storekeepers).

## 5. Permission changes

- New permissions: `payroll.submit` (confidential), `governance.view`, `governance.configure` (technical), `reports.submit`, `reports.review`, `targets.manage`, `assessments.manage` (confidential), `announcements.manage`, `support.request`, `it.view`, `it.manage`, `marketing.view`, `marketing.manage`.
- New roles: Accounts Clerk, IT Officer, Marketing Officer, Procurement Officer, Employee.
- HR Manager gains `payroll.submit`; HR Officer prepares but cannot submit. Every head of department gains report review, targets, and assessments. IT and Marketing Manager gains the IT and marketing registers. The CEO gains read access to governance, IT, and marketing. The system administrator gains `governance.configure` and still cannot approve spending or read confidential business records, including the new registers.

## 6. Approval workflow changes (opening configuration)

| Route | Steps | CEO joins when |
|---|---|---|
| Leave | Supervisor approval → HR confirmation | Special approval requested |
| Purchase | Supervisor review → Operations review → Finance budget verification → Manager approval | ≥ threshold, above the manager's limit, or special |
| Payment | Department manager → Accounts verification | ≥ threshold, above the limit, or special |
| Fuel, Vehicle repair | Fleet supervisor → Operations → Accounts verification | ≥ threshold, above the limit, or special |
| Marketing expenditure | Marketing approval → Accounts verification | ≥ threshold, above the limit, or special |
| Payroll, Budget, Recruitment, Contract | Unchanged | Always |

Opening limits: Operations Manager 10,000; HR Manager, Finance Manager, Legal Affairs, IT and Marketing Manager 5,000. Executive threshold 20,000. All amounts are in the company currency (currently set to USD in the company profile). These are starting values for the CEO and administrator to confirm.

## 7. Security testing results

Backend: 50 tests in 14 files pass against `bajogo_erp_test`, including a new `tests/governance.test.ts` with separate CEO, HR Manager, HR Officer, Finance Manager, Accounts Clerk, Operations Manager, Procurement Officer, Storekeeper, Driver, Legal Affairs, IT and Marketing Manager, IT Officer, and System Administrator accounts placed in the real structure. Frontend: 10 tests pass and the production build succeeds.

| Check | Result |
|---|---|
| 1. Separation of duties | Pass: verifier cannot approve; preparer cannot submit payroll; requester cannot pay; PO issuer cannot receive goods; rule changes only by the administrator; mandatory rule cannot be switched off |
| 2. Restricted approvals | Pass: self-approval, administrator approval, out-of-turn CEO approval, and over-limit approval are refused |
| 3. Payroll HR → Finance | Pass: officer prepares, HR Manager submits, accounts verifies, CEO approves, accounts pays |
| 4. Departmental confidentiality | Pass: HR and Legal refused finance journals; Operations and Finance refused employee files; IT refused payroll and legal registers; administrator refused legal registers and assessments; assessments hidden from other departments; staff see only their own IT tickets |
| 5. CEO company-wide visibility | Pass: all 19 registers, finance, legal, performance of every department |
| 6. Thresholds | Pass: a lower threshold set by the administrator brings the CEO into a smaller payment |
| 7. Routine without CEO | Pass: small fuel, purchase, and payment requests complete without the CEO |
| 8. Escalation | Pass: above the limit, at the threshold, special approval, no available approver, and time-based escalation |
| 9. Audit trail | Pass: decisions, governance changes with previous values, payment execution, register changes, and refused access are recorded; audit rows and documents cannot be updated or deleted |
| 10. Existing functionality | Pass: all earlier test files pass. Nine earlier tests were updated where they asserted the old rule that the CEO approves every amount, or a flow the new controls now separate |

The UI was checked in the browser against a temporary copy database (since dropped), not the live data: governance page (CEO read-only), approval detail with escalation reason, budget check and documents, department registers, and the company dashboard at phone width with no horizontal scrolling.

## 8. Remaining issues

- Live accounts: the HR managers in the live data who prepare payroll themselves can no longer submit it. Either an HR Officer prepares it or the administrator switches off "Payroll preparer cannot submit" with a reason.
- The one approval request already in progress keeps the route it was submitted with (the CEO stays on it).
- Thresholds and limits are opening values; the company currency is still USD in the company profile.
- The workflow page edits conditions, amounts, escalation hours, and the document requirement of existing steps. Adding or removing steps and changing approver roles is available in the API but not yet in the screen.
- Legal and IT/Marketing use the shared dashboard layout with a department-registers panel, not a dedicated designed dashboard like CEO, Finance, Operations, and HR.
- Manager assessments are separate from HR's formal appraisals.
- Pending-approval notifications are in-app only (no email or SMS).
- The hourly escalation job runs inside each API process. With more than one API instance, escalation notifications could be sent once per instance.
- Supporting documents attach to approval requests only, not directly to register entries.
- Nothing has been committed to git yet.
