import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ClipboardCheck, ClipboardList, PackageCheck, Truck, Wheat } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { Button, controlClass, ErrorText, Field, Modal } from '../components/ui';
import {
  amount, Attachments, ConfirmDialog, DataTable, FormModal, kg, label, LoadState, PageTitle, Panel, PeriodPicker, type PeriodValue, periodQuery, send, StatCard, StatusBadge,
  useFarmAction, useFarmQuery,
} from '../components/FarmKit';
import { farmFilter, farmOptions, options, statusFilter, useMeta } from './FarmPages';

const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- 11. Equipment and machinery

interface EquipmentRow {
  id: number; assetCode: string; name: string; assetType: string; registrationNumber: string | null; condition: string; status: string; farmId: number | null; farmName: string | null;
  lastServiceOn: string | null; nextServiceOn: string | null; usageHours: number; upkeepCost: number; repairs: number; notes: string | null; needsMaintenance: boolean;
}
interface EquipmentDetail extends EquipmentRow { events: Array<{ id: number; eventType: string; eventDate: string; farmName: string | null; description: string; cost: number | null; hours: number | null; recordedBy: string }> }

const assetTypes = ['truck', 'vehicle', 'tractor', 'harvester', 'irrigation_pump', 'sprayer', 'processing_machine', 'generator', 'tool', 'other'];

export function FarmEquipmentPage() {
  const { can } = useAuth();
  const meta = useMeta();
  const [params] = useSearchParams();
  const rows = useFarmQuery<EquipmentRow[]>(`/farm/equipment${params.get('maintenance') ? '?maintenance=true' : ''}`);
  const [editing, setEditing] = useState<EquipmentRow | 'new' | null>(null);
  const [history, setHistory] = useState<number | null>(null);
  const [event, setEvent] = useState<EquipmentRow | null>(null);
  const detail = useFarmQuery<EquipmentDetail>(`/farm/equipment/${history}`, history != null);
  const save = useFarmAction((body: Record<string, unknown>) => (editing === 'new' ? send('/farm/equipment', 'POST', body) : send(`/farm/equipment/${(editing as EquipmentRow).id}`, 'PUT', body)), { onDone: () => setEditing(null) });
  const record = useFarmAction((body: Record<string, unknown>) => send(`/farm/equipment/${event?.id}/events`, 'POST', body), { onDone: () => setEvent(null) });
  return (
    <section className="grid gap-4">
      <PageTitle title="Farm Equipment & Machinery" description="Machinery and vehicles: availability, allocation to farms, condition, service schedule, repairs, and hours of use."
        action={<>{params.get('maintenance') ? <Link to="/farm/equipment" className="self-center text-sm font-semibold text-pine">Show all</Link> : null}{can('farm.manage') ? <Button onClick={() => setEditing('new')}>Register equipment</Button> : null}</>} />
      <DataTable rows={rows.data} loading={rows.isLoading} error={rows.error} search={(row) => `${row.assetCode} ${row.name} ${row.registrationNumber ?? ''} ${row.farmName ?? ''}`}
        filters={[statusFilter(['available', 'in_use', 'maintenance', 'retired']), { label: 'Type', options: options(assetTypes), match: (row, value) => row.assetType === value },
          { label: 'Attention', options: [{ value: 'yes', label: 'Needs maintenance' }], match: (row) => row.needsMaintenance }]}
        columns={[
          { header: 'Equipment', cell: (row) => <div><div className="font-semibold">{row.name}</div><div className="text-xs text-slate-500">{row.assetCode} · {label(row.assetType)}{row.registrationNumber ? ` · ${row.registrationNumber}` : ''}</div></div> },
          { header: 'Allocated to', cell: (row) => row.farmName ?? 'Pool' },
          { header: 'Condition', cell: (row) => <StatusBadge value={row.condition} /> },
          { header: 'Service', cell: (row) => <span className={`text-xs ${row.needsMaintenance ? 'font-semibold text-[#8d2f2f]' : ''}`}>last {row.lastServiceOn ?? '—'} · next {row.nextServiceOn ?? '—'}</span> },
          { header: 'Hours', cell: (row) => row.usageHours, className: 'tabular-nums' },
          { header: 'Repairs / upkeep', cell: (row) => <span className="text-xs">{row.repairs} · {amount(row.upkeepCost)}</span> },
          { header: 'Status', cell: (row) => <StatusBadge value={row.status} /> },
          { header: '', cell: (row) => (
            <div className="flex flex-wrap gap-2 text-sm font-semibold">
              <button type="button" className="text-pine" onClick={() => setHistory(row.id)}>History</button>
              {(can('farm.manage') || can('farm.report')) && row.status !== 'retired' ? <button type="button" className="text-pine" onClick={() => setEvent(row)}>Record</button> : null}
              {can('farm.manage') ? <button type="button" className="text-pine" onClick={() => setEditing(row)}>Edit</button> : null}
            </div>
          ) },
        ]} />
      {editing ? (
        <FormModal title={editing === 'new' ? 'Register equipment' : `Edit ${editing.name}`} onClose={() => setEditing(null)} onSubmit={(body) => save.mutate(body)} pending={save.isPending} error={save.error}
          initial={editing === 'new' ? { condition: 'good', status: 'available' } : { ...editing, condition: (editing as EquipmentRow).condition }}
          fields={[
            { name: 'name', label: 'Name', required: true }, { name: 'assetType', label: 'Type', type: 'select', required: true, options: options(assetTypes) },
            { name: 'registrationNumber', label: 'Registration or serial' }, { name: 'condition', label: 'Condition', type: 'select', options: options(['good', 'fair', 'poor', 'out_of_service']) },
            { name: 'status', label: 'Status', type: 'select', options: options(['available', 'in_use', 'maintenance', 'retired']) }, { name: 'nextServiceOn', label: 'Next service due', type: 'date' },
            { name: 'notes', label: 'Notes', type: 'textarea' },
          ]} />
      ) : null}
      {event ? (
        <FormModal title={`Record for ${event.name}`} onClose={() => setEvent(null)} onSubmit={(body) => record.mutate(body)} pending={record.isPending} error={record.error}
          initial={{ eventType: can('farm.manage') ? 'maintenance' : 'usage', eventDate: today(), farmId: event.farmId ?? '' }}
          note="Allocation and release need assignment rights; maintenance, repairs, and condition need the Operations Manager. Supervisors can log hours of use."
          fields={[
            { name: 'eventType', label: 'What happened', type: 'select', required: true, options: options(can('farm.manage') ? ['allocation', 'release', 'usage', 'maintenance', 'repair', 'condition'] : ['usage']) },
            { name: 'eventDate', label: 'Date', type: 'date', required: true }, { name: 'farmId', label: 'Farm', type: 'select', options: farmOptions(meta.data) },
            { name: 'hours', label: 'Hours used', type: 'number' }, { name: 'cost', label: 'Cost', type: 'number' },
            { name: 'condition', label: 'Condition after', type: 'select', options: options(['good', 'fair', 'poor', 'out_of_service']) }, { name: 'nextServiceOn', label: 'Next service due', type: 'date' },
            { name: 'description', label: 'Description', type: 'textarea', required: true },
          ]} />
      ) : null}
      {history != null ? (
        <Modal title={detail.data ? `${detail.data.name} · history` : 'History'} onClose={() => setHistory(null)}>
          <LoadState loading={detail.isLoading} error={detail.error} empty={detail.data?.events.length === 0}>
            <ul className="grid gap-2 text-sm">
              {detail.data?.events.map((e) => (
                <li key={e.id} className="rounded-md border border-line p-2">
                  <div className="flex justify-between gap-2"><span className="font-semibold capitalize">{label(e.eventType)} · {e.eventDate}</span><span className="text-xs text-slate-500">{e.recordedBy}</span></div>
                  <div className="text-slate-700">{e.description}</div>
                  <div className="text-xs text-slate-500">{[e.farmName, e.hours != null ? `${e.hours} h` : null, e.cost != null ? `cost ${amount(e.cost)}` : null].filter(Boolean).join(' · ')}</div>
                </li>
              ))}
            </ul>
          </LoadState>
        </Modal>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- 12. Farm inputs and materials

interface InputsResponse { from: string; to: string; items: Array<{ id: number; sku: string; name: string; unit: string; category: string; onHand: number; reorderLevel: number; stockValue: number; reorder: boolean; consumed: number; consumedValue: number; byFarm: Array<{ farmId: number; farmName: string; quantity: number; value: number }> }> }

export function FarmInputsPage() {
  const [period, setPeriod] = useState<PeriodValue>({ period: 'year', from: `${today().slice(0, 4)}-01-01`, to: today() });
  const range = period.period === 'custom' ? `from=${period.from}&to=${period.to}` : (() => {
    const now = today();
    const start = { today: now, week: now, month: `${now.slice(0, 8)}01`, quarter: `${now.slice(0, 5)}${String(Math.floor((Number(now.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`, year: `${now.slice(0, 4)}-01-01`, custom: period.from }[period.period];
    return `from=${start}&to=${now}`;
  })();
  const data = useFarmQuery<InputsResponse>(`/farm/inputs?${range}`);
  const items = data.data?.items;
  return (
    <section className="grid gap-4">
      <PageTitle title="Farm Inputs & Materials" description="Seeds, fertilisers, pesticides, herbicides, irrigation materials, and other inputs: stock on hand, use by farm, and reorder alerts. Stock is kept in Inventory."
        action={<PeriodPicker value={period} onChange={setPeriod} />} />
      {(items ?? []).some((item) => item.reorder) ? (
        <div className="rounded-lg border border-[#f3c9c9] bg-[#fdf3f3] px-3 py-2 text-sm text-[#8d2f2f]">
          <AlertTriangle size={14} className="mr-1 inline" /> At or below reorder level: {(items ?? []).filter((item) => item.reorder).map((item) => `${item.name} (${item.onHand} ${item.unit})`).join(', ')}
        </div>
      ) : null}
      <DataTable rows={items} loading={data.isLoading} error={data.error} search={(row) => `${row.sku} ${row.name} ${row.category}`}
        filters={[{ label: 'Category', options: options([...new Set((items ?? []).map((item) => item.category))]), match: (row, value) => row.category === value },
          { label: 'Stock', options: [{ value: 'reorder', label: 'Reorder needed' }], match: (row) => row.reorder }]}
        columns={[
          { header: 'Input', cell: (row) => <div><div className="font-semibold">{row.name}</div><div className="text-xs text-slate-500">{row.sku} · {row.category}</div></div> },
          { header: 'On hand', cell: (row) => <span className={row.reorder ? 'font-semibold text-[#8d2f2f]' : ''}>{row.onHand} {row.unit}</span> },
          { header: 'Reorder at', cell: (row) => `${row.reorderLevel} ${row.unit}` },
          { header: 'Stock value', cell: (row) => amount(row.stockValue) },
          { header: 'Used in period', cell: (row) => `${row.consumed} ${row.unit}` },
          { header: 'By farm', cell: (row) => <span className="text-xs">{row.byFarm.map((use) => `${use.farmName}: ${use.quantity}`).join(' · ') || '—'}</span> },
        ]} />
      <p className="text-xs text-slate-500">Add input items under Inventory → Stock using the categories Seeds, Fertilisers, Pesticides, Herbicides, Irrigation materials, or Other farm inputs. Issues to farms happen when resource requests are fulfilled.</p>
    </section>
  );
}

// ---------------------------------------------------------------- 13. Resource requests

interface RequestRow {
  id: number; referenceNumber: string; farmId: number; farmName: string; category: string; stockItemId: number | null; itemName: string | null; description: string; quantity: number; unit: string;
  estimatedCost: number | null; justification: string; neededBy: string | null; status: string; approvalRequestId: number | null; approvalReference: string | null; pendingStep: string | null;
  requestedBy: string; requestedByUserId: number; available: number | null; fulfilledQuantity: number | null; fulfilledBy: string | null; warehouseName: string | null; remarks: string | null; createdAt: string;
}

export function FarmRequestsPage() {
  const { can, user } = useAuth();
  const meta = useMeta();
  const rows = useFarmQuery<RequestRow[]>('/farm/resource-requests');
  const pending = useFarmQuery<{ resourceQueue: RequestRow[] }>('/farm/pending');
  const mine = new Set((pending.data?.resourceQueue ?? []).map((row) => row.id));
  const [form, setForm] = useState<RequestRow | 'new' | null>(null);
  const [deciding, setDeciding] = useState<{ row: RequestRow; action: 'approve' | 'reject' | 'return' } | null>(null);
  const [fulfilling, setFulfilling] = useState<RequestRow | null>(null);
  const submit = useFarmAction((body: Record<string, unknown>) => (form === 'new' ? send('/farm/resource-requests', 'POST', body) : send(`/farm/resource-requests/${(form as RequestRow).id}`, 'PUT', body)), { onDone: () => setForm(null), extraKeys: [['approval-requests']] });
  const decide = useFarmAction((input: { id: number; action: string; comment: string }) => send(`/farm/resource-requests/${input.id}/decision`, 'POST', { action: input.action, comment: input.comment || undefined }), { onDone: () => setDeciding(null), extraKeys: [['approval-requests']] });
  const fulfil = useFarmAction((body: Record<string, unknown>) => send(`/farm/resource-requests/${fulfilling?.id}/fulfil`, 'POST', body), { onDone: () => setFulfilling(null) });
  const nextIsCeo = (row: RequestRow) => (row.pendingStep ?? '').toLowerCase().includes('operations') && (row.estimatedCost ?? 0) > 0;
  return (
    <section className="grid gap-4">
      <PageTitle title="Resource Requests" description="Requests from farm supervisors. The Operations Manager approves within their financial limit; above it, or when special approval is asked, the request goes on to the CEO."
        action={can('farm.report') ? <Button onClick={() => setForm('new')}>Request resources</Button> : null} />
      <DataTable rows={rows.data} loading={rows.isLoading} error={rows.error} search={(row) => `${row.referenceNumber} ${row.farmName} ${row.description} ${row.requestedBy}`}
        filters={[farmFilter(meta.data), statusFilter(['submitted', 'approved', 'returned', 'rejected', 'fulfilled']), { label: 'Category', options: options(meta.data?.requestCategories), match: (row, value) => row.category === value }]}
        columns={[
          { header: 'Request', cell: (row) => <div><div className="font-semibold">{row.description}</div><div className="text-xs text-slate-500">{row.referenceNumber} · {label(row.category)} · {row.createdAt.slice(0, 10)}</div></div> },
          { header: 'Farm', cell: (row) => <>{row.farmName}<div className="text-xs text-slate-500">{row.requestedBy}</div></> },
          { header: 'Quantity', cell: (row) => <span>{row.quantity} {row.unit}{row.available != null ? <div className={`text-xs ${row.available < row.quantity ? 'text-[#8d2f2f]' : 'text-slate-500'}`}>{row.available} in stock</div> : null}</span> },
          { header: 'Estimate', cell: (row) => amount(row.estimatedCost) },
          { header: 'Justification', cell: (row) => <span className="line-clamp-2 max-w-xs text-xs">{row.justification}</span> },
          { header: 'Status', cell: (row) => <div><StatusBadge value={row.status} />{row.pendingStep ? <div className="mt-0.5 text-xs text-slate-500">with {row.pendingStep}</div> : null}{row.approvalRequestId ? <Link className="block text-xs text-pine" to={`/approvals/${row.approvalRequestId}`}>{row.approvalReference}</Link> : null}</div> },
          { header: '', cell: (row) => (
            <div className="flex flex-wrap gap-2 text-sm font-semibold">
              {mine.has(row.id) ? <>
                <button type="button" className="text-pine" onClick={() => setDeciding({ row, action: 'approve' })}>{nextIsCeo(row) ? 'Approve / recommend' : 'Approve'}</button>
                <button type="button" className="text-pine" onClick={() => setDeciding({ row, action: 'return' })}>Return</button>
                <button type="button" className="text-[#8d2f2f]" onClick={() => setDeciding({ row, action: 'reject' })}>Reject</button>
              </> : null}
              {row.status === 'approved' && (can('farm.approve') || can('inventory.manage')) && row.requestedByUserId !== user?.id ? <button type="button" className="text-pine" onClick={() => setFulfilling(row)}>Fulfil</button> : null}
              {row.status === 'returned' && row.requestedByUserId === user?.id ? <button type="button" className="text-pine" onClick={() => setForm(row)}>Correct</button> : null}
              {row.status === 'fulfilled' ? <span className="text-xs font-normal text-slate-500">{row.fulfilledQuantity} issued by {row.fulfilledBy}{row.warehouseName ? ` from ${row.warehouseName}` : ''}</span> : null}
            </div>
          ) },
        ]} />
      {form ? (
        <FormModal title={form === 'new' ? 'Request resources' : `Correct ${form.referenceNumber}`} submitLabel="Submit request" onClose={() => setForm(null)} onSubmit={(body) => submit.mutate(body)} pending={submit.isPending} error={submit.error}
          initial={form === 'new' ? { unit: 'bag' } : (form as unknown as Record<string, unknown>)}
          fields={[
            { name: 'farmId', label: 'Farm', type: 'select', required: true, options: farmOptions(meta.data) },
            { name: 'category', label: 'Category', type: 'select', required: true, options: options(meta.data?.requestCategories) },
            { name: 'stockItemId', label: 'Stock item (if from store)', type: 'select', options: (meta.data?.inputItems ?? []).map((i) => ({ value: i.id, label: `${i.name} (${i.unit})` })) },
            { name: 'description', label: 'What is needed', required: true }, { name: 'quantity', label: 'Quantity', type: 'number', required: true }, { name: 'unit', label: 'Unit', required: true },
            { name: 'estimatedCost', label: 'Estimated cost', type: 'number', help: 'Decides whether the CEO must also approve.' }, { name: 'neededBy', label: 'Needed by', type: 'date' },
            { name: 'justification', label: 'Justification', type: 'textarea', required: true }, { name: 'specialApproval', label: 'Needs special management approval (adds the CEO)', type: 'checkbox' },
          ]} />
      ) : null}
      {deciding ? (
        <ConfirmDialog title={`${deciding.action === 'approve' ? (nextIsCeo(deciding.row) ? 'Approve or recommend' : 'Approve') : deciding.action === 'return' ? 'Return' : 'Reject'} ${deciding.row.referenceNumber}`}
          message={<>{deciding.row.quantity} {deciding.row.unit} {deciding.row.description} for {deciding.row.farmName}{deciding.row.estimatedCost ? `, estimated ${amount(deciding.row.estimatedCost)}` : ''}. {deciding.action === 'approve' ? 'If the amount is above your approval limit, your approval is recorded as a recommendation and the CEO decides.' : ''}</>}
          confirmLabel={deciding.action === 'approve' ? 'Approve' : deciding.action === 'return' ? 'Return to supervisor' : 'Reject'} danger={deciding.action === 'reject'}
          reasonLabel={deciding.action === 'approve' ? 'Remarks (optional)' : 'Reason'} reasonRequired={deciding.action !== 'approve'}
          onClose={() => setDeciding(null)} onConfirm={(comment) => decide.mutate({ id: deciding.row.id, action: deciding.action, comment })} pending={decide.isPending} error={decide.error} />
      ) : null}
      {fulfilling ? (
        <FormModal title={`Fulfil ${fulfilling.referenceNumber}`} submitLabel="Issue" onClose={() => setFulfilling(null)} onSubmit={(body) => fulfil.mutate(body)} pending={fulfil.isPending} error={fulfil.error}
          initial={{ quantity: fulfilling.quantity }}
          note={fulfilling.stockItemId ? `${fulfilling.itemName}: ${fulfilling.available} available. The issue is recorded against ${fulfilling.farmName} in one stock movement.` : 'This request is not for a stock item. Fulfilling records that it was provided.'}
          fields={[
            ...(fulfilling.stockItemId ? [{ name: 'warehouseId', label: 'Issue from store', type: 'select' as const, required: true, options: (meta.data?.warehouses ?? []).map((w) => ({ value: w.id, label: w.name })) }] : []),
            { name: 'quantity', label: 'Quantity', type: 'number', required: true }, { name: 'remarks', label: 'Remarks', type: 'textarea' },
          ]} />
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- 14. Produce and storage

export interface ProduceRow { itemId: number; sku: string; itemName: string; unit: string; warehouseId: number; warehouseName: string; harvestSources: string | null; grades: string | null; harvested: number; inStorage: number; dispatched: number; otherUse: number; awaitingDispatch: number; availableToDispatch: number }

export function FarmProducePage() {
  const rows = useFarmQuery<ProduceRow[]>('/farm/produce');
  const total = (key: keyof ProduceRow) => (rows.data ?? []).reduce((sum, row) => sum + Number(row[key]), 0);
  return (
    <section className="grid gap-4">
      <PageTitle title="Farm Produce & Storage" description="Harvested produce across stores, from verified harvests and Inventory stock movements. Dispatches leave through Haulage." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={Wheat} label="Harvested into stock" value={kg(total('harvested'))} />
        <StatCard icon={PackageCheck} label="In storage" value={kg(total('inStorage'))} tone="bg-khaki text-navy" />
        <StatCard icon={Truck} label="Dispatched" value={kg(total('dispatched'))} tone="bg-[#e3ecf9] text-[#2f5ea8]" />
        <StatCard icon={ClipboardList} label="Sold or otherwise used" value={kg(total('otherUse'))} tone="bg-navy text-khaki" />
      </div>
      <DataTable rows={rows.data} loading={rows.isLoading} error={rows.error} rowKey={(row) => `${row.itemId}-${row.warehouseId}`} search={(row) => `${row.itemName} ${row.warehouseName} ${row.harvestSources ?? ''}`}
        columns={[
          { header: 'Produce', cell: (row) => <div><div className="font-semibold">{row.itemName}</div><div className="text-xs text-slate-500">{row.sku}{row.grades ? ` · grades ${row.grades}` : ''}</div></div> },
          { header: 'Store', cell: (row) => row.warehouseName },
          { header: 'Harvest source', cell: (row) => row.harvestSources ?? '—' },
          { header: 'Harvested', cell: (row) => `${row.harvested} ${row.unit}` },
          { header: 'Dispatched', cell: (row) => `${row.dispatched} ${row.unit}` },
          { header: 'Other use', cell: (row) => `${row.otherUse} ${row.unit}` },
          { header: 'In storage', cell: (row) => <span className="font-semibold">{row.inStorage} {row.unit}</span> },
          { header: 'Awaiting dispatch', cell: (row) => `${row.awaitingDispatch} ${row.unit}` },
          { header: 'Available', cell: (row) => `${row.availableToDispatch} ${row.unit}` },
        ]} />
    </section>
  );
}

// ---------------------------------------------------------------- 15. Pending reviews and approvals

interface Pending { dailyReports: number; harvestsToVerify: number; resourceRequests: number; dispatchRequests: number; approvedToFulfil: number; newIncidents: number; inspectionFollowUps: number; overdueActivities: number }

export function FarmPendingPage() {
  const data = useFarmQuery<Pending>('/farm/pending');
  const p = data.data;
  const items: Array<[string, number | undefined, string, typeof ClipboardCheck]> = [
    ['Daily reports to review', p?.dailyReports, '/farm/daily', ClipboardCheck],
    ['Harvests to verify', p?.harvestsToVerify, '/farm/harvests', Wheat],
    ['Resource requests awaiting your decision', p?.resourceRequests, '/farm/requests', ClipboardList],
    ['Approved requests to fulfil', p?.approvedToFulfil, '/farm/requests', PackageCheck],
    ['Dispatch requests to authorise', p?.dispatchRequests, '/farm/dispatch', Truck],
    ['New incidents', p?.newIncidents, '/farm/incidents', AlertTriangle],
    ['Inspection follow-ups', p?.inspectionFollowUps, '/farm/inspections', ClipboardCheck],
    ['Overdue activities', p?.overdueActivities, '/farm/schedule?overdue=1', AlertTriangle],
  ];
  return (
    <section className="grid gap-4">
      <PageTitle title="Pending Reviews & Approvals" description="Everything in farm operations waiting on you, in one place." />
      <LoadState loading={data.isLoading} error={data.error}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {items.map(([title, count, to, icon]) => <StatCard key={title} icon={icon} label={title} value={count ?? 0} to={to} tone={count ? 'bg-[#fdf1d6] text-[#8a5a00]' : 'bg-[#e3f3e3] text-[#0a7d0a]'} />)}
        </div>
        {items.every(([, count]) => !count) ? <p className="text-sm text-slate-500">All clear. Nothing is waiting on you.</p> : null}
      </LoadState>
    </section>
  );
}

// ---------------------------------------------------------------- 16. Issues and incidents

interface IncidentRow {
  id: number; referenceNumber: string; farmId: number; farmName: string; category: string; title: string; description: string; priority: string; occurredOn: string; reportedAt: string;
  status: string; reportedBy: string; reportedByUserId: number; assignedToUserId: number | null; assignedTo: string | null; resolutionRemarks: string | null; resolvedBy: string | null; resolvedAt: string | null; attachments: number;
}

export function FarmIncidentsPage() {
  const { can, user } = useAuth();
  const meta = useMeta();
  const rows = useFarmQuery<IncidentRow[]>('/farm/incidents');
  const [reporting, setReporting] = useState(false);
  const [open, setOpen] = useState<IncidentRow | null>(null);
  const report = useFarmAction((body: Record<string, unknown>) => send('/farm/incidents', 'POST', body), { onDone: () => setReporting(false) });
  const update = useFarmAction((body: Record<string, unknown>) => send(`/farm/incidents/${open?.id}`, 'PATCH', body), { onDone: () => setOpen(null) });
  return (
    <section className="grid gap-4">
      <PageTitle title="Farm Issues & Incidents" description="Crop disease, pests, breakdowns, labour and resource shortages, weather, damaged produce, and safety incidents, tracked from report to resolution."
        action={can('farm.report') ? <Button onClick={() => setReporting(true)}>Report incident</Button> : null} />
      <DataTable rows={rows.data} loading={rows.isLoading} error={rows.error} onRowClick={setOpen} search={(row) => `${row.referenceNumber} ${row.title} ${row.farmName} ${row.reportedBy}`}
        filters={[farmFilter(meta.data), statusFilter(['reported', 'investigating', 'in_progress', 'resolved', 'closed']), { label: 'Priority', options: options(['critical', 'high', 'medium', 'low']), match: (row, value) => row.priority === value },
          { label: 'Category', options: options(meta.data?.incidentCategories), match: (row, value) => row.category === value }]}
        columns={[
          { header: 'Incident', cell: (row) => <div><div className="font-semibold">{row.title}</div><div className="text-xs text-slate-500">{row.referenceNumber} · {label(row.category)}</div></div> },
          { header: 'Farm', cell: (row) => row.farmName },
          { header: 'Occurred / reported', cell: (row) => <span className="text-xs">{row.occurredOn} · {row.reportedAt.slice(0, 10)}</span> },
          { header: 'Reported by', cell: (row) => row.reportedBy },
          { header: 'Priority', cell: (row) => <StatusBadge value={row.priority} /> },
          { header: 'Responsible', cell: (row) => row.assignedTo ?? '—' },
          { header: 'Status', cell: (row) => <StatusBadge value={row.status} /> },
        ]} />
      {reporting ? (
        <FormModal title="Report incident" submitLabel="Report" onClose={() => setReporting(false)} onSubmit={(body) => report.mutate(body)} pending={report.isPending} error={report.error}
          initial={{ occurredOn: today(), priority: 'medium' }} note="Add photographs from the incident after you report it."
          fields={[
            { name: 'farmId', label: 'Farm', type: 'select', required: true, options: farmOptions(meta.data) }, { name: 'category', label: 'Category', type: 'select', required: true, options: options(meta.data?.incidentCategories) },
            { name: 'title', label: 'Title', required: true, wide: true }, { name: 'occurredOn', label: 'Occurred on', type: 'date', required: true },
            { name: 'priority', label: 'Priority', type: 'select', required: true, options: options(['low', 'medium', 'high', 'critical']) }, { name: 'description', label: 'Description', type: 'textarea', required: true },
          ]} />
      ) : null}
      {open ? <IncidentDialog incident={open} canManage={can('farm.review')} canAssign={can('farm.assign')} isAssignee={open.assignedToUserId === user?.id} isReporter={open.reportedByUserId === user?.id}
        people={meta.data?.people ?? []} onClose={() => setOpen(null)} onSave={(body) => update.mutate(body)} pending={update.isPending} error={update.error} /> : null}
    </section>
  );
}

function IncidentDialog({ incident, canManage, canAssign, isAssignee, isReporter, people, onClose, onSave, pending, error }: {
  incident: IncidentRow; canManage: boolean; canAssign: boolean; isAssignee: boolean; isReporter: boolean; people: Array<{ id: number; name: string }>;
  onClose: () => void; onSave: (body: Record<string, unknown>) => void; pending: boolean; error: string;
}) {
  const [status, setStatus] = useState(incident.status);
  const [assignee, setAssignee] = useState(incident.assignedToUserId ? String(incident.assignedToUserId) : '');
  const [remarks, setRemarks] = useState(incident.resolutionRemarks ?? '');
  const editable = canManage || isAssignee;
  return (
    <Modal title={`${incident.referenceNumber} · ${incident.title}`} onClose={onClose}>
      <div className="grid gap-3 text-sm">
        <div className="flex flex-wrap gap-2"><StatusBadge value={incident.priority} /><StatusBadge value={incident.status} /><span className="text-slate-600">{incident.farmName} · {label(incident.category)} · occurred {incident.occurredOn} · reported by {incident.reportedBy}</span></div>
        <p className="whitespace-pre-line text-slate-700">{incident.description}</p>
        {incident.resolvedBy ? <p className="rounded bg-canvas px-2 py-1 text-xs">Resolved by {incident.resolvedBy} on {String(incident.resolvedAt).slice(0, 16)}</p> : null}
        <Attachments entity="incidents" id={incident.id} canAdd={isReporter || canManage} />
        {editable ? (
          <div className="grid gap-2 border-t border-line pt-3 sm:grid-cols-2">
            {error ? <div className="sm:col-span-2"><ErrorText>{error}</ErrorText></div> : null}
            <Field label="Status"><select className={controlClass} value={status} onChange={(event) => setStatus(event.target.value)}>
              {['reported', 'investigating', 'in_progress', 'resolved', ...(canManage ? ['closed'] : [])].map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></Field>
            <Field label="Responsible person"><select className={controlClass} value={assignee} disabled={!canAssign} onChange={(event) => setAssignee(event.target.value)}>
              <option value="">Not assigned</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <div className="sm:col-span-2"><Field label="Resolution remarks"><textarea className={`${controlClass} h-20 py-2`} value={remarks} onChange={(event) => setRemarks(event.target.value)} /></Field></div>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
              <Button type="button" disabled={pending} onClick={() => onSave({ status, ...(canAssign ? { assignedToUserId: assignee ? Number(assignee) : null } : {}), resolutionRemarks: remarks || null })}>Save</Button>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- 17. Harvest dispatch coordination

interface DispatchRow {
  id: number; referenceNumber: string; farmId: number | null; farmName: string | null; itemName: string; unit: string; warehouseName: string; quantity: number; collectionLocation: string; destination: string;
  purpose: string; requiredBy: string | null; status: string; requestedBy: string; requestedByUserId: number; authorisedBy: string | null; tripId: number | null; tripReference: string | null; tripStatus: string | null;
  driverName: string | null; vehicle: string | null; movementReference: string | null; dispatchedAt: string | null; deliveredAt: string | null; remarks: string | null; createdAt: string;
}

export function FarmDispatchPage() {
  const { can } = useAuth();
  const meta = useMeta();
  const produce = useFarmQuery<ProduceRow[]>('/farm/produce');
  const rows = useFarmQuery<DispatchRow[]>('/farm/dispatches');
  const [requesting, setRequesting] = useState<ProduceRow | 'new' | null>(null);
  const [scheduling, setScheduling] = useState<DispatchRow | null>(null);
  const [confirm, setConfirm] = useState<{ row: DispatchRow; action: 'depart' | 'deliver' | 'cancel' } | null>(null);
  const request = useFarmAction((body: Record<string, unknown>) => send('/farm/dispatches', 'POST', body), { onDone: () => setRequesting(null) });
  const schedule = useFarmAction((body: Record<string, unknown>) => send(`/farm/dispatches/${scheduling?.id}/schedule`, 'POST', body), { onDone: () => setScheduling(null) });
  const act = useFarmAction((input: { row: DispatchRow; action: string; reason: string }) => send(`/farm/dispatches/${input.row.id}/${input.action}`, 'POST',
    input.action === 'cancel' ? { reason: input.reason } : input.action === 'deliver' ? { remarks: input.reason || null } : undefined), { onDone: () => setConfirm(null), extraKeys: [['inventory']] });
  const initial = requesting && requesting !== 'new' ? { stockItemId: requesting.itemId, warehouseId: requesting.warehouseId, collectionLocation: requesting.warehouseName, purpose: 'processing' } : { purpose: 'processing' };
  return (
    <section className="grid gap-4">
      <PageTitle title="Harvest Dispatch Coordination" description="Produce awaiting dispatch, transport requests, vehicle assignment through Haulage, and delivery tracking. Stock leaves the store when the load departs."
        action={(can('farm.report') || can('farm.manage')) ? <Button onClick={() => setRequesting('new')}>Request transport</Button> : null} />
      <Panel title="Produce awaiting dispatch">
        <DataTable rows={(produce.data ?? []).filter((row) => row.inStorage > 0)} loading={produce.isLoading} error={produce.error} rowKey={(row) => `${row.itemId}-${row.warehouseId}`}
          columns={[
            { header: 'Produce', cell: (row) => row.itemName }, { header: 'Store', cell: (row) => row.warehouseName }, { header: 'Source', cell: (row) => row.harvestSources ?? '—' },
            { header: 'In store', cell: (row) => `${row.inStorage} ${row.unit}` }, { header: 'Already requested', cell: (row) => `${row.awaitingDispatch} ${row.unit}` },
            { header: 'Available', cell: (row) => <span className="font-semibold">{row.availableToDispatch} {row.unit}</span> },
            { header: '', cell: (row) => (row.availableToDispatch > 0 && (can('farm.report') || can('farm.manage')) ? <button type="button" className="text-sm font-semibold text-pine" onClick={() => setRequesting(row)}>Request transport</button> : null) },
          ]} />
      </Panel>
      <Panel title="Dispatches" note="Requested → scheduled (vehicle and trip assigned) → in transit (stock issued) → delivered">
        <DataTable rows={rows.data} loading={rows.isLoading} error={rows.error} search={(row) => `${row.referenceNumber} ${row.itemName} ${row.destination} ${row.tripReference ?? ''}`}
          filters={[statusFilter(['requested', 'scheduled', 'in_transit', 'delivered', 'cancelled'])]}
          columns={[
            { header: 'Dispatch', cell: (row) => <div><div className="font-semibold">{row.quantity} {row.unit} {row.itemName}</div><div className="text-xs text-slate-500">{row.referenceNumber} · {row.farmName ?? 'Store'} · {label(row.purpose)}</div></div> },
            { header: 'Route', cell: (row) => <span className="text-xs">{row.collectionLocation} → {row.destination}{row.requiredBy ? <div>by {row.requiredBy}</div> : null}</span> },
            { header: 'Transport', cell: (row) => <span className="text-xs">{row.tripReference ? <>{row.tripReference} · {row.vehicle ?? 'vehicle not set'}{row.driverName ? ` · ${row.driverName}` : ''}</> : '—'}</span> },
            { header: 'Progress', cell: (row) => <span className="text-xs">{row.dispatchedAt ? `left ${row.dispatchedAt.slice(0, 16)}` : ''}{row.deliveredAt ? <div>delivered {row.deliveredAt.slice(0, 16)}</div> : null}{row.movementReference ? <div>stock {row.movementReference}</div> : null}</span> },
            { header: 'Status', cell: (row) => <StatusBadge value={row.status} /> },
            { header: '', cell: (row) => can('farm.approve') ? (
              <div className="flex flex-wrap gap-2 text-sm font-semibold">
                {row.status === 'requested' ? <button type="button" className="text-pine" onClick={() => setScheduling(row)}>Authorise &amp; assign</button> : null}
                {row.status === 'scheduled' ? <button type="button" className="text-pine" onClick={() => setConfirm({ row, action: 'depart' })}>Load &amp; depart</button> : null}
                {row.status === 'in_transit' ? <button type="button" className="text-pine" onClick={() => setConfirm({ row, action: 'deliver' })}>Delivered</button> : null}
                {['requested', 'scheduled'].includes(row.status) ? <button type="button" className="text-[#8d2f2f]" onClick={() => setConfirm({ row, action: 'cancel' })}>Cancel</button> : null}
              </div>
            ) : null },
          ]} />
      </Panel>
      {requesting ? (
        <FormModal title="Request transport for produce" submitLabel="Request" onClose={() => setRequesting(null)} onSubmit={(body) => request.mutate(body)} pending={request.isPending} error={request.error} initial={initial}
          fields={[
            { name: 'stockItemId', label: 'Produce', type: 'select', required: true, options: (meta.data?.produceItems ?? []).map((i) => ({ value: i.id, label: i.name })) },
            { name: 'warehouseId', label: 'From store', type: 'select', required: true, options: (meta.data?.warehouses ?? []).map((w) => ({ value: w.id, label: w.name })) },
            { name: 'farmId', label: 'Farm (optional)', type: 'select', options: farmOptions(meta.data) }, { name: 'quantity', label: 'Quantity', type: 'number', required: true },
            { name: 'collectionLocation', label: 'Collection location', required: true }, { name: 'destination', label: 'Destination', required: true },
            { name: 'purpose', label: 'Purpose', type: 'select', required: true, options: options(['sale', 'processing', 'transfer', 'other']) }, { name: 'requiredBy', label: 'Required by', type: 'date' },
            { name: 'remarks', label: 'Remarks', type: 'textarea' },
          ]} />
      ) : null}
      {scheduling ? (
        <FormModal title={`Authorise ${scheduling.referenceNumber}`} submitLabel="Authorise and assign" onClose={() => setScheduling(null)} onSubmit={(body) => schedule.mutate(body)} pending={schedule.isPending} error={schedule.error}
          initial={{ tripDate: scheduling.requiredBy ?? today() }} note={`${scheduling.quantity} ${scheduling.unit} of ${scheduling.itemName}: ${scheduling.collectionLocation} → ${scheduling.destination}. Use a planned trip, or give a date and vehicle to create a new haulage trip.`}
          fields={[
            { name: 'tripId', label: 'Existing planned trip', type: 'select', options: (meta.data?.plannedTrips ?? []).map((t) => ({ value: t.id, label: t.label })) },
            { name: 'tripDate', label: 'Trip date (new trip)', type: 'date' },
            { name: 'vehicleId', label: 'Vehicle', type: 'select', options: (meta.data?.vehicles ?? []).filter((v) => v.status !== 'maintenance').map((v) => ({ value: v.id, label: v.name })) },
            { name: 'driverName', label: 'Driver' }, { name: 'distanceKm', label: 'Distance (km)', type: 'number' }, { name: 'remarks', label: 'Remarks', type: 'textarea' },
          ]} />
      ) : null}
      {confirm ? (
        <ConfirmDialog title={{ depart: 'Load and depart', deliver: 'Confirm delivery', cancel: 'Cancel dispatch' }[confirm.action]}
          message={confirm.action === 'depart' ? `${confirm.row.quantity} ${confirm.row.unit} of ${confirm.row.itemName} will be issued from ${confirm.row.warehouseName} now, and the trip goes in transit. This cannot be undone.`
            : confirm.action === 'deliver' ? `Confirm ${confirm.row.referenceNumber} arrived at ${confirm.row.destination}.` : `${confirm.row.referenceNumber} will be cancelled. No stock has left yet.`}
          confirmLabel={{ depart: 'Issue stock and depart', deliver: 'Mark delivered', cancel: 'Cancel dispatch' }[confirm.action]} danger={confirm.action === 'cancel'}
          reasonLabel={confirm.action === 'cancel' ? 'Reason' : confirm.action === 'deliver' ? 'Delivery remarks (optional)' : undefined} reasonRequired={confirm.action === 'cancel'}
          onClose={() => setConfirm(null)} onConfirm={(reason) => act.mutate({ row: confirm.row, action: confirm.action, reason })} pending={act.isPending} error={act.error} />
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- 18. Reports and analytics

interface ReportResult { title: string; tables: Array<{ title: string; columns: string[]; rows: Array<Array<string | number>> }> }

export function FarmReportsPage() {
  const { can } = useAuth();
  const meta = useMeta();
  const [code, setCode] = useState('daily_operations');
  const [period, setPeriod] = useState<PeriodValue>({ period: 'month', from: `${today().slice(0, 8)}01`, to: today() });
  const [filters, setFilters] = useState({ farmId: '', crop: '', season: '', supervisorUserId: '' });
  const query = [periodQuery(period), ...Object.entries(filters).filter(([, value]) => value).map(([key, value]) => `${key}=${encodeURIComponent(value)}`)].join('&');
  const ready = period.period !== 'custom' || (period.from && period.to && period.from <= period.to);
  const report = useFarmQuery<ReportResult>(`/farm/reports/${code}?${query}`, Boolean(ready));
  return (
    <section className="grid gap-4 print:block">
      <div className="print:hidden"><PageTitle title="Farm Reports & Analytics" description="Seventeen operational reports from recorded data. Activity dates and record dates are shown separately; backdated records are included by the date of the work." /></div>
      <Panel title="Report" className="print:hidden">
        <div className="grid gap-3 lg:grid-cols-[1fr_2fr]">
          <Field label="Choose a report"><select className={controlClass} value={code} onChange={(event) => setCode(event.target.value)}>{(meta.data?.reports ?? []).map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}</select></Field>
          <div className="grid gap-2"><span className="text-sm font-semibold text-slate-700">Period</span><PeriodPicker value={period} onChange={setPeriod} /></div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Farm"><select className={controlClass} value={filters.farmId} onChange={(event) => setFilters({ ...filters, farmId: event.target.value })}><option value="">All farms</option>{farmOptions(meta.data).map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}</select></Field>
          <Field label="Crop"><select className={controlClass} value={filters.crop} onChange={(event) => setFilters({ ...filters, crop: event.target.value })}><option value="">All crops</option>{(meta.data?.crops ?? []).map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Season"><select className={controlClass} value={filters.season} onChange={(event) => setFilters({ ...filters, season: event.target.value })}><option value="">All seasons</option>{(meta.data?.seasons ?? []).map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Supervisor"><select className={controlClass} value={filters.supervisorUserId} onChange={(event) => setFilters({ ...filters, supervisorUserId: event.target.value })}><option value="">All supervisors</option>{(meta.data?.people ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {can('farm.export') ? <>
            <a className="inline-flex h-10 items-center rounded-md bg-pine px-3.5 text-sm font-semibold text-cream hover:bg-navy" href={`/api/v1/farm/reports/${code}/export.pdf?${query}`}>Download PDF</a>
            <a className="inline-flex h-10 items-center rounded-md border border-line bg-white px-3.5 text-sm font-semibold hover:bg-cream" href={`/api/v1/farm/reports/${code}/export.xlsx?${query}`}>Download Excel</a>
          </> : null}
          <Button variant="secondary" onClick={() => window.print()}>Print</Button>
        </div>
      </Panel>
      <LoadState loading={report.isLoading} error={report.error}>
        {report.data ? (
          <article className="rounded-xl border border-line bg-white p-4 shadow-card print:border-0 print:p-0 print:shadow-none">
            <div className="mb-3 flex items-center gap-3"><img src="/brand/bajogo-mark.png" alt="" className="h-10 w-10 rounded-full" /><div><div className="text-xs font-semibold uppercase tracking-wide text-olive">BAJOGO ENTERPRISE</div><h2 className="text-lg font-bold text-ink">{report.data.title}</h2></div></div>
            {report.data.tables.map((table) => (
              <div key={table.title} className="mb-5">
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{table.title}</h3>
                <div className="overflow-x-auto"><table className="min-w-full text-left text-xs">
                  <thead className="bg-canvas uppercase tracking-wide text-slate-500"><tr>{table.columns.map((column) => <th key={column} className="whitespace-nowrap px-2 py-1.5">{column}</th>)}</tr></thead>
                  <tbody>{table.rows.map((row, index) => <tr key={index} className="border-t border-line align-top">{row.map((cell, cellIndex) => <td key={cellIndex} className="px-2 py-1.5">{typeof cell === 'number' ? cell.toLocaleString() : cell}</td>)}</tr>)}</tbody>
                </table></div>
              </div>
            ))}
            <p className="text-xs text-slate-500">Generated {new Date().toLocaleString()} from BAJOGO ERP records.</p>
          </article>
        ) : null}
      </LoadState>
    </section>
  );
}

// ---------------------------------------------------------------- Haulage (the existing haulage register, now with vehicles)

interface TripRow { id: number; referenceNumber: string; tripDate: string; vehicleId: number | null; vehicle: string | null; driverName: string | null; origin: string; destination: string; cargo: string | null; quantityKg: number | null; distanceKm: number | null; fuelLitres: number | null; status: string; departedAt: string | null; deliveredAt: string | null; notes: string | null; dispatches: string | null }

export function HaulagePage() {
  const { can } = useAuth();
  const meta = useMeta();
  const rows = useFarmQuery<TripRow[]>('/farm/trips');
  const [editing, setEditing] = useState<TripRow | 'new' | null>(null);
  const save = useFarmAction((body: Record<string, unknown>) => (editing === 'new' ? send('/farm/trips', 'POST', body) : send(`/farm/trips/${(editing as TripRow).id}`, 'PUT', body)), { onDone: () => setEditing(null) });
  return (
    <section className="grid gap-4">
      <PageTitle title="Haulage & Trips" description="Every haulage trip with vehicle, driver, route, load, distance, and fuel. Produce dispatches create and move trips here." action={can('farm.manage') ? <Button onClick={() => setEditing('new')}>Plan trip</Button> : null} />
      <DataTable rows={rows.data} loading={rows.isLoading} error={rows.error} onRowClick={can('farm.manage') ? setEditing : undefined} search={(row) => `${row.referenceNumber} ${row.origin} ${row.destination} ${row.vehicle ?? ''} ${row.driverName ?? ''}`}
        filters={[statusFilter(['planned', 'in_transit', 'delivered', 'cancelled'])]}
        columns={[
          { header: 'Trip', cell: (row) => <div><div className="font-semibold">{row.tripDate}</div><div className="text-xs text-slate-500">{row.referenceNumber}{row.dispatches ? ` · ${row.dispatches}` : ''}</div></div> },
          { header: 'Route', cell: (row) => `${row.origin} → ${row.destination}` }, { header: 'Vehicle', cell: (row) => row.vehicle ?? '—' }, { header: 'Driver', cell: (row) => row.driverName ?? '—' },
          { header: 'Load', cell: (row) => <span className="text-xs">{row.cargo ?? '—'}{row.quantityKg ? ` · ${kg(row.quantityKg)}` : ''}</span> },
          { header: 'Km / fuel', cell: (row) => <span className="text-xs">{row.distanceKm ?? '—'} km · {row.fuelLitres ?? '—'} L</span> },
          { header: 'Status', cell: (row) => <StatusBadge value={row.status} /> },
        ]} />
      {editing ? (
        <FormModal title={editing === 'new' ? 'Plan trip' : `Trip ${editing.referenceNumber}`} onClose={() => setEditing(null)} onSubmit={(body) => save.mutate(body)} pending={save.isPending} error={save.error}
          initial={editing === 'new' ? { tripDate: today() } : (editing as unknown as Record<string, unknown>)}
          note={editing !== 'new' && editing.dispatches ? 'This trip carries a produce dispatch. Move its status from Harvest Dispatch Coordination.' : undefined}
          fields={[
            { name: 'tripDate', label: 'Date', type: 'date', required: true }, { name: 'vehicleId', label: 'Vehicle', type: 'select', options: (meta.data?.vehicles ?? []).map((v) => ({ value: v.id, label: v.name })) },
            { name: 'driverName', label: 'Driver' }, { name: 'origin', label: 'From', required: true }, { name: 'destination', label: 'To', required: true }, { name: 'cargo', label: 'Cargo' },
            { name: 'quantityKg', label: 'Load (kg)', type: 'number' }, { name: 'distanceKm', label: 'Distance (km)', type: 'number' }, { name: 'fuelLitres', label: 'Fuel (litres)', type: 'number' },
            ...(editing === 'new' ? [] : [{ name: 'status', label: 'Status', type: 'select' as const, options: options(['planned', 'in_transit', 'delivered', 'cancelled']) }]),
            { name: 'notes', label: 'Notes', type: 'textarea' },
          ]} />
      ) : null}
    </section>
  );
}
