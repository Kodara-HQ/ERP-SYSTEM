# Farm Operations: completion report

Date: 19 November 2026. Migration `021_farm_operations.sql`. Database `bajogo_erp`; no table was dropped and no existing record was removed.

## What was reused

| Existing part of the ERP | How Farm Operations uses it |
|---|---|
| Inventory: `stock_items`, `stock_categories`, `warehouses`, `stock_balances`, `stock_lots`, `stock_movements`, and the `changeStock` routine | Produce and farm inputs are stock items. Verified harvests are stock receipts; dispatches and resource fulfilment are stock issues. Weighted average cost, lots, and the negative-stock refusal are the existing ones. |
| Approval engine, limits, delegation, separation-of-duty rules, escalation | Resource requests run on a new `FARM_RESOURCE` route: Operations Manager approval within their financial limit, CEO above it or when special approval is asked. |
| `supporting_documents` | Photographs and files on daily reports and incidents (immutable). |
| `notifications`, `audit_logs` | Every event notifies and audits through the existing services; scheduled farm notices run with the hourly governance jobs. |
| Employees, positions, departments, workspaces | Supervisors and workers are employees on farm teams; access follows the `operations` workspace. |
| Report export (`reportFiles.ts`) | PDF and Excel for all 17 farm reports. |

The farm-plot, crop-activity, harvest, equipment, and haulage-trip registers were generic JSON lists without foreign keys. They became proper tables (`farms`, `farm_activities`, `farm_harvests`, `equipment_assets`, `haulage_trips`); any entries were copied across, and the registers no longer appear on screen. Processing batches and quality checks stay as registers.

## Database (migration 021)

New tables: `farms`, `farm_team_members`, `farm_crop_cycles`, `farm_activities`, `farm_daily_reports`, `farm_inspections`, `farm_production_targets`, `farm_harvests`, `farm_resource_requests`, `farm_incidents`, `equipment_assets`, `equipment_events`, `haulage_trips`, `farm_dispatches`. All have foreign keys to farms, employees, users, stock items, stores, vehicles, approvals, and stock movements, plus check constraints (areas, quantities, dates, ratings).

Extended: `stock_movements.farm_id` (consumption and expenses per farm), with a unique index so a harvest can be received into stock only once. Daily reports keep `activity_date` (when the work was done) separately from `submitted_at` and `created_at`, so backdated records are clear.

Every manager is an employee: the CEO position now belongs to a new **Executive Office** department, so HR can register the CEO like anyone else.

Seed: stock categories *Farm produce*, *Seeds*, *Fertilisers*, *Pesticides*, *Herbicides*, *Irrigation materials*, *Other farm inputs*; the `FARM_RESOURCE` approval route; a `DISPATCH_REQUESTER_NOT_AUTHORISER` rule (off by default; switch on when several managers authorise dispatch).

## Permissions

`farm.view`, `farm.report`, `farm.manage`, `farm.assign`, `farm.review`, `farm.approve`, `farm.export`.

- **Operations Manager**: all seven, across every farm. Still no payroll, salaries, user administration, organisation structure, or governance configuration (tested).
- **Farm Supervisor**: view and report, for the farms they supervise only (as the farm's supervisor or an active team supervisor).
- **CEO**: view and export across all farms; final approval on resource requests above the Operations Manager's limit.
- HR, finance, stores, legal, IT, and the system administrator are refused farm records.

## Workflows

- **Daily reports**: supervisor submits (backdating allowed, future dates refused), with photos; Operations Manager acknowledges or returns with a reason; supervisor corrects and resubmits. A reviewer cannot review their own report.
- **Harvest → stock**: supervisor records; someone other than the recorder verifies into a *Farm produce* stock item and store in one transaction. Verification happens once; a rejected harvest never enters stock.
- **Resource requests**: approval engine (approve / recommend / return / reject with reasons, delegation and escalation apply); fulfilment issues stock to the farm, by someone other than the requester.
- **Dispatch → haulage**: request (checked against stock not already requested) → authorise and assign an existing planned trip or a new trip with vehicle and driver → load and depart (stock issued, trip in transit, one transaction, once only) → delivered (trip delivered). Cancel only before departure.
- **Incidents**: report → assign → investigate/in progress → resolve (remarks required) → close (Operations Manager).

## Notifications

On submission of a daily report, resource request (through the approval engine), harvest to verify, produce ready for dispatch, dispatch to authorise, incident reported or assigned. Hourly: overdue activities, harvests due in 7 days, production below target, equipment due for service. Each record is notified at most once a day (targets once a week).

## Screens

An expandable **Farm Operations** menu with 18 pages (overview dashboard with period filters and six charts, locations with record pages, supervisors and teams, schedule calendar and list, daily activities, inspections, crop production, targets, harvests, yield, equipment, inputs, resource requests, produce and storage, pending reviews, incidents, dispatch, reports), plus **Haulage & trips** under Operations. Tables are searchable, filterable, and paginated with loading, empty, and error states; sensitive actions confirm first.

## Testing

`backend/tests/farm.test.ts` runs the full flow with separate CEO, Operations Manager, Farm Supervisor, storekeeper, HR, and system administrator accounts: farm setup → team → crop and target → activity → backdated daily report with photo → return → correction → acknowledgement → harvest → wrong-category refusal → verification into stock (4,000 kg) → second verification refused → resource request within limit (approved, fulfilled, stock 100 → 70) → request above limit (Operations Manager recommends, CEO approves) → dispatch over stock refused → dispatch authorised with a new truck trip → departed (stock 4,000 → 2,500) → second departure refused → delivered → incident reported, assigned, resolved → dashboard figures checked → all 17 reports with filters, PDF and Excel → supervisor export refused → notices sent once → audit trail checked. A second test checks the access limits. All 54 backend tests and 10 frontend tests pass, and the frontend builds.

The screens were checked in the browser against a temporary copy database (since dropped) as the Operations Manager and as a farm supervisor, including phone width.

## Known limits

- Farm expenses come from inputs issued (stock value), equipment maintenance and repair costs, and fulfilled non-stock requests; journals are not yet tagged by farm.
- Equipment utilisation assumes an 8-hour working day.
- The approve button reads "Approve / recommend" because the screen does not know the approver's limit; the engine decides and the request shows the next step.
