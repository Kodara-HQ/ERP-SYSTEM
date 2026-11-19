import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  AlertTriangle, CalendarClock, ClipboardList, Factory, LandPlot, Map as MapIcon, Package, Sprout, Target, Truck, UserCheck, Users, Wheat, Wrench,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { Button, ErrorText, Modal } from '../components/ui';
import {
  amount, Attachments, axisProps, chartColors, ConfirmDialog, DataTable, type FieldDef, FormModal, kg, label, Panel, PageTitle,
  PeriodPicker, type PeriodValue, periodQuery, send, seriesColors, StatCard, StatusBadge, useFarmAction, useFarmQuery,
} from '../components/FarmKit';

export interface FarmMeta {
  farms: Array<{ id: number; code: string; name: string; warehouseId: number | null }>;
  crops: string[]; seasons: string[];
  employees: Array<{ id: number; name: string; employeeNumber: string; department: string }>;
  people: Array<{ id: number; name: string }>;
  produceItems: Array<{ id: number; name: string; unit: string; sku: string }>;
  inputItems: Array<{ id: number; name: string; unit: string; category: string }>;
  warehouses: Array<{ id: number; name: string; code: string }>;
  vehicles: Array<{ id: number; name: string; status: string }>;
  plannedTrips: Array<{ id: number; label: string }>;
  activityTypes: string[]; incidentCategories: string[]; requestCategories: string[];
  reports: Array<{ code: string; name: string }>;
}

export const useMeta = () => useFarmQuery<FarmMeta>('/farm/meta');
export const options = (values: string[] | undefined) => (values ?? []).map((value) => ({ value, label: label(value) }));
export const farmOptions = (meta?: FarmMeta) => (meta?.farms ?? []).map((farm) => ({ value: farm.id, label: farm.name }));
export const farmFilter = <T extends { farmId?: number | null }>(meta?: FarmMeta) => ({
  label: 'Farm', options: (meta?.farms ?? []).map((farm) => ({ value: String(farm.id), label: farm.name })), match: (row: T, value: string) => String(row.farmId) === value,
});
export const statusFilter = <T extends { status: string }>(values: string[]) => ({
  label: 'Status', options: values.map((value) => ({ value, label: label(value) })), match: (row: T, value: string) => row.status === value,
});
const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- 1. Farm overview dashboard

interface Dashboard {
  range: { from: string; to: string };
  cards: Record<string, number | null>;
  charts: {
    targetVsActual: Array<{ name: string; target: number; actual: number }>;
    byLocation: Array<{ farm: string; harvested: number; yieldPerHa: number; completion: number; incidents: number }>;
    cropTrend: { crops: string[]; rows: Array<Record<string, string | number>> };
    harvestPerformance: Array<{ period: string; expected: number; harvested: number; losses: number }>;
    activityCompletion: Array<{ type: string; total: number; completed: number; overdue: number }>;
    resourceUtilisation: Array<{ category: string; quantity: number; value: number }>;
    equipmentHours: Array<{ type: string; hours: number }>;
  };
}

function ChartBox({ children, empty }: { children: React.ReactElement; empty: boolean }) {
  if (empty) return <div className="grid h-60 place-items-center rounded-lg bg-canvas text-sm text-slate-500">No records in this period.</div>;
  return <div className="h-60"><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>;
}

export function FarmOverviewPage() {
  const [period, setPeriod] = useState<PeriodValue>({ period: 'month', from: today().slice(0, 8) + '01', to: today() });
  const ready = period.period !== 'custom' || (period.from && period.to && period.from <= period.to);
  const dashboard = useFarmQuery<Dashboard>(`/farm/dashboard?${periodQuery(period)}`, Boolean(ready));
  const c = dashboard.data?.cards ?? {};
  const charts = dashboard.data?.charts;
  const n = (key: string) => (c[key] ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
  return (
    <section className="grid gap-5">
      <PageTitle title="Farm Overview" description="Farms, production, resources, and produce across every farm you oversee. Every figure comes from recorded data." action={<PeriodPicker value={period} onChange={setPeriod} />} />
      {dashboard.error ? <ErrorText>{(dashboard.error as Error).message}</ErrorText> : null}
      {dashboard.isLoading ? <p className="text-sm text-slate-500">Loading farm figures…</p> : null}
      {dashboard.data ? (
        <>
          <p className="text-xs text-slate-500">Period {dashboard.data.range.from} to {dashboard.data.range.to}. Counts without a period reflect today.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
            <StatCard icon={MapIcon} label="Registered farms" value={n('totalFarms')} note={`${n('activeFarms')} active locations`} to="/farm/locations" />
            <StatCard icon={LandPlot} label="Cultivated land" value={`${n('cultivatedAreaHa')} ha`} note={`of ${n('totalLandHa')} ha registered`} to="/farm/locations" tone="bg-khaki text-navy" />
            <StatCard icon={Sprout} label="Active crop projects" value={n('activeCropProjects')} to="/farm/crops" tone="bg-[#e3f3e3] text-[#0a7d0a]" />
            <StatCard icon={UserCheck} label="Farm supervisors" value={n('supervisors')} to="/farm/teams" tone="bg-navy text-khaki" />
            <StatCard icon={Users} label="Assigned workers" value={n('workers')} to="/farm/teams" tone="bg-[#e3ecf9] text-[#2f5ea8]" />
            <StatCard icon={CalendarClock} label="Current activities" value={n('currentActivities')} note={`${n('overdueActivities')} overdue`} to="/farm/schedule" tone="bg-[#fdf1d6] text-[#8a5a00]" />
            <StatCard icon={Wheat} label="Upcoming harvests" value={n('upcomingHarvests')} note="Next 30 days" to="/farm/harvests" tone="bg-khaki text-navy" />
            <StatCard icon={Package} label="Harvested (verified)" value={kg(c.harvestedKg)} note={`${n('unverifiedHarvests')} awaiting verification`} to="/farm/harvests" />
            <StatCard icon={Target} label="Target achievement" value={c.targetAchievement == null ? '—' : `${c.targetAchievement}%`} note={`${kg(c.actualKg)} of ${kg(c.targetKg)}`} to="/farm/targets" tone="bg-[#ece4f7] text-[#6b46a8]" />
            <StatCard icon={ClipboardList} label="Pending resource requests" value={n('pendingResourceRequests')} to="/farm/requests" tone="bg-[#fdf1d6] text-[#8a5a00]" />
            <StatCard icon={AlertTriangle} label="Outstanding incidents" value={n('openIncidents')} note={`${n('urgentIncidents')} high or critical`} to="/farm/incidents" tone="bg-[#fbe3e3] text-[#b02f2f]" />
            <StatCard icon={Wrench} label="Equipment needing maintenance" value={n('equipmentMaintenance')} to="/farm/equipment?maintenance=1" tone="bg-navy text-khaki" />
            <StatCard icon={Truck} label="Produce in store" value={kg(c.produceInStore)} note="Available for dispatch" to="/farm/dispatch" tone="bg-[#e3f3e3] text-[#0a7d0a]" />
            <StatCard icon={Factory} label="Harvest losses" value={kg(c.harvestLossKg)} to="/farm/harvests" tone="bg-cream text-pine ring-1 ring-khaki" />
          </div>
          {charts ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Production targets versus actual" note="Verified harvest inside each target period">
                <ChartBox empty={charts.targetVsActual.length === 0}>
                  <BarChart data={charts.targetVsActual}><CartesianGrid vertical={false} stroke="#ECE9CC" /><XAxis dataKey="name" {...axisProps} interval={0} tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)} /><YAxis {...axisProps} width={56} />
                    <Tooltip /><Legend /><Bar dataKey="target" name="Target (kg)" fill={chartColors.khaki} radius={[4, 4, 0, 0]} /><Bar dataKey="actual" name="Actual (kg)" fill={chartColors.pine} radius={[4, 4, 0, 0]} /></BarChart>
                </ChartBox>
              </Panel>
              <Panel title="Farm performance by location" note="Harvested kg and activity completion in the period">
                <ChartBox empty={charts.byLocation.length === 0}>
                  <BarChart data={charts.byLocation}><CartesianGrid vertical={false} stroke="#ECE9CC" /><XAxis dataKey="farm" {...axisProps} interval={0} /><YAxis yAxisId="kg" {...axisProps} width={56} /><YAxis yAxisId="pct" orientation="right" {...axisProps} width={40} unit="%" />
                    <Tooltip /><Legend /><Bar yAxisId="kg" dataKey="harvested" name="Harvested (kg)" fill={chartColors.pine} radius={[4, 4, 0, 0]} /><Bar yAxisId="pct" dataKey="completion" name="Activities completed %" fill={chartColors.amber} radius={[4, 4, 0, 0]} /></BarChart>
                </ChartBox>
              </Panel>
              <Panel title="Crop production trend" note="Verified harvest by crop">
                <ChartBox empty={charts.cropTrend.crops.length === 0}>
                  <LineChart data={charts.cropTrend.rows}><CartesianGrid vertical={false} stroke="#ECE9CC" /><XAxis dataKey="period" {...axisProps} /><YAxis {...axisProps} width={56} /><Tooltip /><Legend />
                    {charts.cropTrend.crops.map((crop, index) => <Line key={crop} type="monotone" dataKey={crop} stroke={seriesColors[index % seriesColors.length]} strokeWidth={2.5} dot={false} />)}</LineChart>
                </ChartBox>
              </Panel>
              <Panel title="Harvest performance" note="Expected, harvested, and lost (kg)">
                <ChartBox empty={charts.harvestPerformance.every((row) => !row.expected && !row.harvested && !row.losses)}>
                  <BarChart data={charts.harvestPerformance}><CartesianGrid vertical={false} stroke="#ECE9CC" /><XAxis dataKey="period" {...axisProps} /><YAxis {...axisProps} width={56} /><Tooltip /><Legend />
                    <Bar dataKey="expected" name="Expected" fill={chartColors.khaki} /><Bar dataKey="harvested" name="Harvested" fill={chartColors.pine} /><Bar dataKey="losses" name="Losses" fill={chartColors.red} /></BarChart>
                </ChartBox>
              </Panel>
              <Panel title="Farm activity completion" note="Activities due in the period, by type">
                <ChartBox empty={charts.activityCompletion.length === 0}>
                  <BarChart data={charts.activityCompletion.map((row) => ({ ...row, type: label(row.type), open: row.total - row.completed - row.overdue }))} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid horizontal={false} stroke="#ECE9CC" /><XAxis type="number" {...axisProps} allowDecimals={false} /><YAxis type="category" dataKey="type" {...axisProps} width={110} /><Tooltip /><Legend />
                    <Bar dataKey="completed" stackId="a" name="Completed" fill={chartColors.green} /><Bar dataKey="open" stackId="a" name="Open" fill={chartColors.khaki} /><Bar dataKey="overdue" stackId="a" name="Overdue" fill={chartColors.red} /></BarChart>
                </ChartBox>
              </Panel>
              <Panel title="Resource utilisation" note="Inputs issued to farms (by stock value) and machine hours">
                <div className="grid gap-3 sm:grid-cols-2">
                  <ChartBox empty={charts.resourceUtilisation.length === 0}>
                    <PieChart><Pie data={charts.resourceUtilisation} dataKey="quantity" nameKey="category" innerRadius={45} outerRadius={80} paddingAngle={2}>
                      {charts.resourceUtilisation.map((row, index) => <Cell key={row.category} fill={seriesColors[index % seriesColors.length]} />)}</Pie><Tooltip /><Legend /></PieChart>
                  </ChartBox>
                  <ChartBox empty={charts.equipmentHours.length === 0}>
                    <BarChart data={charts.equipmentHours.map((row) => ({ ...row, type: label(row.type) }))}><XAxis dataKey="type" {...axisProps} /><YAxis {...axisProps} width={40} /><Tooltip /><Bar dataKey="hours" name="Hours used" fill={chartColors.olive} radius={[4, 4, 0, 0]} /></BarChart>
                  </ChartBox>
                </div>
              </Panel>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- 2. Farm locations

interface FarmRow {
  id: number; code: string; name: string; location: string; region: string | null; gpsCoordinates: string | null; totalAreaHa: number; cultivatedAreaHa: number;
  ownership: string; status: string; supervisorEmployeeId: number | null; supervisorName: string | null; warehouseId: number | null; warehouseName: string | null;
  notes: string | null; workerCount: number; activeCycles: number; openActivities: number; openIncidents: number; harvestedKg: number;
}

function farmFields(meta?: FarmMeta, editing = false): FieldDef[] {
  return [
    ...(editing ? [] : [{ name: 'code', label: 'Farm code', required: true, help: 'Letters, numbers, and dashes, for example WENCHI-1.' } as FieldDef]),
    { name: 'name', label: 'Farm name', required: true },
    { name: 'location', label: 'Location', required: true },
    { name: 'region', label: 'Region or district' },
    { name: 'gpsCoordinates', label: 'GPS coordinates' },
    { name: 'totalAreaHa', label: 'Total land (ha)', type: 'number', required: true },
    { name: 'cultivatedAreaHa', label: 'Cultivated (ha)', type: 'number', required: true },
    { name: 'ownership', label: 'Ownership', type: 'select', required: true, options: options(['owned', 'leased', 'partner']) },
    { name: 'status', label: 'Status', type: 'select', options: options(['active', 'fallow', 'inactive']) },
    { name: 'supervisorEmployeeId', label: 'Farm supervisor (employee)', type: 'select', options: (meta?.employees ?? []).map((e) => ({ value: e.id, label: `${e.name} · ${e.department}` })) },
    { name: 'warehouseId', label: 'Produce store', type: 'select', options: (meta?.warehouses ?? []).map((w) => ({ value: w.id, label: w.name })) },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ];
}

export function FarmLocationsPage() {
  const { can } = useAuth();
  const meta = useMeta();
  const farms = useFarmQuery<FarmRow[]>('/farm/farms');
  const navigate = useNavigate();
  const [editing, setEditing] = useState<FarmRow | 'new' | null>(null);
  const save = useFarmAction((body: Record<string, unknown>) => (editing === 'new' ? send('/farm/farms', 'POST', body) : send(`/farm/farms/${(editing as FarmRow).id}`, 'PATCH', body)), { onDone: () => setEditing(null) });
  return (
    <section>
      <PageTitle title="Farm Locations" description="Every registered farm: location, land, supervisor, status, and what is happening there." action={can('farm.manage') ? <Button onClick={() => setEditing('new')}>Register farm</Button> : null} />
      <DataTable rows={farms.data} loading={farms.isLoading} error={farms.error} onRowClick={(row) => navigate(`/farm/locations/${row.id}`)}
        search={(row) => `${row.code} ${row.name} ${row.location} ${row.region ?? ''} ${row.supervisorName ?? ''}`}
        filters={[statusFilter(['active', 'fallow', 'inactive'])]}
        columns={[
          { header: 'Farm', cell: (row) => <div><div className="font-semibold text-ink">{row.name}</div><div className="text-xs text-slate-500">{row.code}</div></div> },
          { header: 'Location', cell: (row) => <>{row.location}{row.region ? <div className="text-xs text-slate-500">{row.region}</div> : null}</> },
          { header: 'Land (ha)', cell: (row) => <span className="tabular-nums">{row.cultivatedAreaHa} / {row.totalAreaHa}</span> },
          { header: 'Supervisor', cell: (row) => row.supervisorName ?? <span className="text-[#8d2f2f]">Not assigned</span> },
          { header: 'Workers', cell: (row) => row.workerCount, className: 'tabular-nums' },
          { header: 'Crops', cell: (row) => row.activeCycles, className: 'tabular-nums' },
          { header: 'Open work', cell: (row) => <span className="text-xs">{row.openActivities} activities · {row.openIncidents} incidents</span> },
          { header: 'Harvested', cell: (row) => kg(row.harvestedKg) },
          { header: 'Status', cell: (row) => <StatusBadge value={row.status} /> },
        ]}
      />
      {editing ? (
        <FormModal title={editing === 'new' ? 'Register farm' : `Edit ${editing.name}`} fields={farmFields(meta.data, editing !== 'new')} initial={editing === 'new' ? { ownership: 'owned', status: 'active' } : (editing as unknown as Record<string, unknown>)}
          onClose={() => setEditing(null)} onSubmit={(body) => save.mutate(body)} pending={save.isPending} error={save.error} />
      ) : null}
    </section>
  );
}

interface FarmDetail extends FarmRow {
  team: TeamRow[]; cropCycles: CycleRow[]; activities: ActivityRow[]; incidents: Array<{ id: number; referenceNumber: string; title: string; priority: string; status: string }>;
  equipment: Array<{ id: number; assetCode: string; name: string; status: string; condition: string }>;
}

export function FarmRecordPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const meta = useMeta();
  const farm = useFarmQuery<FarmDetail>(`/farm/farms/${id}`);
  const [editing, setEditing] = useState(false);
  const save = useFarmAction((body: Record<string, unknown>) => send(`/farm/farms/${id}`, 'PATCH', body), { onDone: () => setEditing(false) });
  const f = farm.data;
  return (
    <section className="grid gap-4">
      <Link to="/farm/locations" className="text-sm font-semibold text-pine">← All farms</Link>
      {farm.error ? <ErrorText>{(farm.error as Error).message}</ErrorText> : null}
      {f ? (
        <>
          <PageTitle title={f.name} description={`${f.code} · ${f.location}${f.region ? `, ${f.region}` : ''} · ${f.ownership}`} action={can('farm.manage') ? <Button variant="secondary" onClick={() => setEditing(true)}>Edit farm</Button> : null} />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard icon={LandPlot} label="Cultivated" value={`${f.cultivatedAreaHa} ha`} note={`of ${f.totalAreaHa} ha`} />
            <StatCard icon={UserCheck} label="Supervisor" value={<span className="text-base">{f.supervisorName ?? '—'}</span>} tone="bg-navy text-khaki" />
            <StatCard icon={Users} label="Workers" value={f.workerCount} tone="bg-[#e3ecf9] text-[#2f5ea8]" />
            <StatCard icon={Package} label="Harvested" value={kg(f.harvestedKg)} tone="bg-khaki text-navy" />
            <StatCard icon={AlertTriangle} label="Open incidents" value={f.openIncidents} tone="bg-[#fbe3e3] text-[#b02f2f]" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Team"><ul className="divide-y divide-line text-sm">{f.team.map((m) => <li key={m.id} className="flex justify-between py-1.5"><span>{m.name}</span><span className="text-slate-500">{label(m.teamRole)}</span></li>)}{f.team.length === 0 ? <li className="text-slate-500">No team assigned.</li> : null}</ul></Panel>
            <Panel title="Crops"><ul className="divide-y divide-line text-sm">{f.cropCycles.map((c) => <li key={c.id} className="flex justify-between py-1.5"><span>{c.crop} · {c.season} · {c.areaHa} ha</span><StatusBadge value={c.stage} /></li>)}{f.cropCycles.length === 0 ? <li className="text-slate-500">No crops recorded.</li> : null}</ul></Panel>
            <Panel title="Activities"><ul className="divide-y divide-line text-sm">{f.activities.map((a) => <li key={a.id} className="flex justify-between gap-2 py-1.5"><span>{a.scheduledDate} · {a.title}</span><StatusBadge value={a.overdue ? 'overdue' : a.status} /></li>)}{f.activities.length === 0 ? <li className="text-slate-500">No activities scheduled.</li> : null}</ul></Panel>
            <Panel title="Equipment and incidents">
              <ul className="divide-y divide-line text-sm">
                {f.equipment.map((q) => <li key={`q${q.id}`} className="flex justify-between py-1.5"><span>{q.name} ({q.assetCode})</span><StatusBadge value={q.status} /></li>)}
                {f.incidents.map((i) => <li key={`i${i.id}`} className="flex justify-between py-1.5"><span>{i.referenceNumber} · {i.title}</span><StatusBadge value={i.status} /></li>)}
                {f.equipment.length + f.incidents.length === 0 ? <li className="text-slate-500">Nothing to show.</li> : null}
              </ul>
            </Panel>
          </div>
          {editing ? <FormModal title={`Edit ${f.name}`} fields={farmFields(meta.data, true)} initial={f as unknown as Record<string, unknown>} onClose={() => setEditing(false)} onSubmit={(body) => save.mutate(body)} pending={save.isPending} error={save.error} /> : null}
        </>
      ) : <p className="text-sm text-slate-500">Loading…</p>}
    </section>
  );
}

// ---------------------------------------------------------------- 3. Supervisors and teams

interface TeamRow { id: number; farmId: number; farmName: string; employeeId: number; name: string; employeeNumber: string; phone: string | null; positionTitle: string | null; teamRole: string; responsibilities: string | null; startDate: string }
interface SupervisorRow {
  employeeId: number; name: string; employeeNumber: string; phone: string | null; farms: string | null; farmCount: number; responsibilities: string | null; workers: number;
  activitiesTotal: number; activitiesCompleted: number; outstanding: number; overdue: number; completionRate: number | null; reportsSubmitted: number; latestReport: string | null;
}

export function FarmTeamsPage() {
  const { can } = useAuth();
  const meta = useMeta();
  const supervisors = useFarmQuery<SupervisorRow[]>('/farm/supervisors');
  const team = useFarmQuery<TeamRow[]>('/farm/team');
  const [adding, setAdding] = useState(false);
  const [ending, setEnding] = useState<TeamRow | null>(null);
  const add = useFarmAction((body: Record<string, unknown>) => send(`/farm/farms/${body.farmId}/team`, 'POST', body), { onDone: () => setAdding(false) });
  const end = useFarmAction((row: TeamRow) => send(`/farm/team/${row.id}/end`, 'POST'), { onDone: () => setEnding(null) });
  return (
    <section className="grid gap-5">
      <PageTitle title="Farm Supervisors & Teams" description="Who supervises each farm, who works there, and how each supervisor is performing." action={can('farm.assign') ? <Button onClick={() => setAdding(true)}>Assign to a farm</Button> : null} />
      <Panel title="Supervisors" note="Completion counts the activities assigned to the supervisor or scheduled on their farms.">
        <DataTable rows={supervisors.data} loading={supervisors.isLoading} error={supervisors.error} rowKey={(row) => row.employeeId} search={(row) => `${row.name} ${row.farms ?? ''}`}
          columns={[
            { header: 'Supervisor', cell: (row) => <div><div className="font-semibold">{row.name}</div><div className="text-xs text-slate-500">{row.employeeNumber}{row.phone ? ` · ${row.phone}` : ''}</div></div> },
            { header: 'Farms', cell: (row) => row.farms },
            { header: 'Workers', cell: (row) => row.workers, className: 'tabular-nums' },
            { header: 'Responsibilities', cell: (row) => <span className="text-xs">{row.responsibilities ?? '—'}</span> },
            { header: 'Completion', cell: (row) => (row.completionRate == null ? '—' : `${row.completionRate}% (${row.activitiesCompleted}/${row.activitiesTotal})`) },
            { header: 'Outstanding', cell: (row) => <span>{row.outstanding}{row.overdue ? <span className="ml-1 text-xs font-semibold text-[#8d2f2f]">{row.overdue} overdue</span> : null}</span> },
            { header: 'Reports', cell: (row) => <span className="text-xs">{row.reportsSubmitted} submitted{row.latestReport ? ` · last ${row.latestReport}` : ''}</span> },
          ]} />
      </Panel>
      <Panel title="Team members">
        <DataTable rows={team.data} loading={team.isLoading} error={team.error} search={(row) => `${row.name} ${row.farmName} ${row.positionTitle ?? ''}`}
          filters={[farmFilter(meta.data), { label: 'Role', options: options(['supervisor', 'worker', 'operator']), match: (row, value) => row.teamRole === value }]}
          columns={[
            { header: 'Employee', cell: (row) => <div><div className="font-semibold">{row.name}</div><div className="text-xs text-slate-500">{row.employeeNumber} · {row.positionTitle ?? '—'}</div></div> },
            { header: 'Farm', cell: (row) => row.farmName },
            { header: 'Role', cell: (row) => <StatusBadge value={row.teamRole} /> },
            { header: 'Responsibilities', cell: (row) => row.responsibilities ?? '—' },
            { header: 'Since', cell: (row) => row.startDate },
            { header: '', cell: (row) => (can('farm.assign') ? <button type="button" className="text-sm font-semibold text-[#8d2f2f]" onClick={() => setEnding(row)}>End assignment</button> : null) },
          ]} />
      </Panel>
      {adding ? (
        <FormModal title="Assign an employee to a farm" onClose={() => setAdding(false)} onSubmit={(body) => add.mutate(body)} pending={add.isPending} error={add.error}
          fields={[
            { name: 'farmId', label: 'Farm', type: 'select', required: true, options: farmOptions(meta.data) },
            { name: 'employeeId', label: 'Employee', type: 'select', required: true, options: (meta.data?.employees ?? []).map((e) => ({ value: e.id, label: `${e.name} · ${e.department}` })) },
            { name: 'teamRole', label: 'Role', type: 'select', required: true, options: options(['supervisor', 'worker', 'operator']) },
            { name: 'startDate', label: 'From', type: 'date' },
            { name: 'responsibilities', label: 'Responsibilities', type: 'textarea' },
          ]} initial={{ teamRole: 'worker', startDate: today() }} />
      ) : null}
      {ending ? <ConfirmDialog title="End farm assignment" message={`${ending.name} will no longer be on the ${ending.farmName} team from today. The history is kept.`} confirmLabel="End assignment" danger
        onClose={() => setEnding(null)} onConfirm={() => end.mutate(ending)} pending={end.isPending} error={end.error} /> : null}
    </section>
  );
}

// ---------------------------------------------------------------- 4. Activity schedule (calendar and list)

export interface ActivityRow {
  id: number; referenceNumber: string; farmId: number; farmName: string; cropCycleId: number | null; crop: string | null; activityType: string; title: string;
  scheduledDate: string; dueDate: string; assignedUserId: number | null; assigneeName: string | null; status: string; completedOn: string | null; overdue: boolean; notes: string | null;
}

function activityFields(meta?: FarmMeta, cycles?: CycleRow[]): FieldDef[] {
  return [
    { name: 'farmId', label: 'Farm', type: 'select', required: true, options: farmOptions(meta) },
    { name: 'activityType', label: 'Activity', type: 'select', required: true, options: options(meta?.activityTypes) },
    { name: 'title', label: 'Title', required: true, wide: true },
    { name: 'scheduledDate', label: 'Scheduled', type: 'date', required: true },
    { name: 'dueDate', label: 'Due', type: 'date', required: true },
    { name: 'cropCycleId', label: 'Crop (optional)', type: 'select', options: (cycles ?? []).filter((c) => c.status === 'active').map((c) => ({ value: c.id, label: `${c.farmName} · ${c.crop} ${c.season}` })) },
    { name: 'assignedUserId', label: 'Assigned to', type: 'select', options: (meta?.people ?? []).map((p) => ({ value: p.id, label: p.name })) },
    { name: 'status', label: 'Status', type: 'select', options: options(['planned', 'in_progress', 'completed', 'cancelled']) },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ];
}

export function FarmSchedulePage() {
  const { can } = useAuth();
  const meta = useMeta();
  const [params] = useSearchParams();
  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  const [month, setMonth] = useState(today().slice(0, 7));
  const [editing, setEditing] = useState<ActivityRow | 'new' | null>(null);
  const first = `${month}-01`;
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const activities = useFarmQuery<ActivityRow[]>(view === 'calendar' ? `/farm/activities?from=${first}&to=${last}` : `/farm/activities${params.get('overdue') ? '?overdue=true' : ''}`);
  const cycles = useFarmQuery<CycleRow[]>('/farm/crop-cycles');
  const save = useFarmAction((body: Record<string, unknown>) => (editing === 'new' ? send('/farm/activities', 'POST', body) : send(`/farm/activities/${(editing as ActivityRow).id}`, 'PUT', body)), { onDone: () => setEditing(null) });
  const quick = useFarmAction((input: { row: ActivityRow; status: string }) => send(`/farm/activities/${input.row.id}`, 'PUT', { ...input.row, status: input.status, assignedUserId: input.row.assignedUserId, cropCycleId: input.row.cropCycleId }));
  const days = useMemo(() => {
    const start = new Date(`${first}T00:00:00Z`);
    const offset = (start.getUTCDay() + 6) % 7;
    const cells: Array<string | null> = Array.from({ length: offset }, () => null);
    for (let day = 1; day <= Number(last.slice(8)); day += 1) cells.push(`${month}-${String(day).padStart(2, '0')}`);
    return cells;
  }, [first, last, month]);
  const shift = (step: number) => { const d = new Date(`${first}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + step); setMonth(d.toISOString().slice(0, 7)); };
  const tone = (a: ActivityRow) => (a.overdue ? 'bg-[#fbe3e3] text-[#8d2f2f]' : a.status === 'completed' ? 'bg-[#e3f3e3] text-[#0a7d0a]' : a.status === 'in_progress' ? 'bg-[#e3ecf9] text-[#2f5ea8]' : a.status === 'cancelled' ? 'bg-slate-100 text-slate-500 line-through' : 'bg-cream text-pine');
  return (
    <section className="grid gap-4">
      <PageTitle title="Farm Activity Schedule" description="Planting, fertilisation, irrigation, weeding, pest control, harvesting, and equipment servicing across farms."
        action={<>
          <Button variant={view === 'calendar' ? 'primary' : 'secondary'} onClick={() => setView('calendar')}>Calendar</Button>
          <Button variant={view === 'list' ? 'primary' : 'secondary'} onClick={() => setView('list')}>List</Button>
          {can('farm.assign') ? <Button onClick={() => setEditing('new')}>Schedule activity</Button> : null}
        </>} />
      {quick.error ? <ErrorText>{quick.error}</ErrorText> : null}
      {view === 'calendar' ? (
        <Panel title={new Date(`${first}T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}
          action={<div className="flex gap-2"><Button variant="secondary" onClick={() => shift(-1)}>Previous</Button><Button variant="secondary" onClick={() => setMonth(today().slice(0, 7))}>Today</Button><Button variant="secondary" onClick={() => shift(1)}>Next</Button></div>}>
          <div className="overflow-x-auto">
            <div className="grid min-w-[720px] grid-cols-7 gap-1 text-xs">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="px-1 py-1 font-semibold uppercase text-slate-500">{d}</div>)}
              {days.map((day, index) => (
                <div key={day ?? `blank-${index}`} className={`min-h-[92px] rounded-md border p-1 ${day === today() ? 'border-pine' : 'border-line'} ${day ? 'bg-white' : 'bg-transparent border-transparent'}`}>
                  {day ? <div className="mb-1 font-semibold text-slate-500">{Number(day.slice(8))}</div> : null}
                  {day ? (activities.data ?? []).filter((a) => a.scheduledDate <= day && a.dueDate >= day).slice(0, 4).map((a) => (
                    <button key={a.id} type="button" title={`${a.title} · ${a.farmName}`} onClick={() => setEditing(a)} className={`mb-0.5 block w-full truncate rounded px-1 py-0.5 text-left ${tone(a)}`}>{a.title}</button>
                  )) : null}
                </div>
              ))}
            </div>
          </div>
          {activities.isLoading ? <p className="mt-2 text-sm text-slate-500">Loading…</p> : null}
        </Panel>
      ) : (
        <DataTable rows={activities.data} loading={activities.isLoading} error={activities.error} search={(row) => `${row.referenceNumber} ${row.title} ${row.farmName} ${row.assigneeName ?? ''}`}
          filters={[farmFilter(meta.data), statusFilter(['planned', 'in_progress', 'completed', 'cancelled']), { label: 'Activity', options: options(meta.data?.activityTypes), match: (row, value) => row.activityType === value },
            { label: 'Overdue', options: [{ value: 'yes', label: 'Overdue only' }], match: (row) => row.overdue }]}
          columns={[
            { header: 'Activity', cell: (row) => <div><div className="font-semibold">{row.title}</div><div className="text-xs text-slate-500">{row.referenceNumber} · {label(row.activityType)}{row.crop ? ` · ${row.crop}` : ''}</div></div> },
            { header: 'Farm', cell: (row) => row.farmName },
            { header: 'When', cell: (row) => <span className="text-xs">{row.scheduledDate} → {row.dueDate}</span> },
            { header: 'Assigned to', cell: (row) => row.assigneeName ?? 'Farm supervisor' },
            { header: 'Status', cell: (row) => <StatusBadge value={row.overdue ? 'overdue' : row.status} /> },
            { header: '', cell: (row) => (
              <div className="flex flex-wrap gap-2 text-sm font-semibold">
                {row.status === 'planned' && can('farm.report') ? <button type="button" className="text-pine" onClick={() => quick.mutate({ row, status: 'in_progress' })}>Start</button> : null}
                {['planned', 'in_progress'].includes(row.status) && can('farm.report') ? <button type="button" className="text-pine" onClick={() => quick.mutate({ row, status: 'completed' })}>Complete</button> : null}
                {can('farm.assign') ? <button type="button" className="text-pine" onClick={() => setEditing(row)}>Reschedule</button> : null}
              </div>
            ) },
          ]} />
      )}
      {editing ? (
        <FormModal title={editing === 'new' ? 'Schedule activity' : `Activity ${editing.referenceNumber}`} fields={activityFields(meta.data, cycles.data)} submitLabel={editing === 'new' ? 'Schedule' : 'Save changes'}
          initial={editing === 'new' ? { scheduledDate: today(), dueDate: today(), status: 'planned' } : (editing as unknown as Record<string, unknown>)}
          note={editing !== 'new' && !can('farm.assign') ? 'You can update the status. Rescheduling and reassignment are for the Operations Manager.' : undefined}
          onClose={() => setEditing(null)} onSubmit={(body) => save.mutate(body)} pending={save.isPending} error={save.error} />
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- 5. Daily farm activities

interface DailyRow {
  id: number; referenceNumber: string; farmId: number; farmName: string; activityId: number | null; activityReference: string | null; activityDate: string; activityType: string;
  workPerformed: string; workersCount: number; workerNames: string | null; resourcesUsed: string | null; workCompleted: string | null; areaCoveredHa: number | null;
  challenges: string | null; supervisorRemarks: string | null; status: string; submittedBy: string; submittedByUserId: number; submittedAt: string; createdAt: string;
  reviewedBy: string | null; reviewedAt: string | null; reviewRemarks: string | null; attachments: number;
}

function dailyFields(meta?: FarmMeta, activities?: ActivityRow[]): FieldDef[] {
  return [
    { name: 'farmId', label: 'Farm', type: 'select', required: true, options: farmOptions(meta) },
    { name: 'activityDate', label: 'Date of activity', type: 'date', required: true, help: 'The day the work was done. Earlier dates are allowed.' },
    { name: 'activityType', label: 'Activity performed', type: 'select', required: true, options: options(meta?.activityTypes) },
    { name: 'activityId', label: 'Scheduled activity (optional)', type: 'select', options: (activities ?? []).filter((a) => ['planned', 'in_progress'].includes(a.status)).map((a) => ({ value: a.id, label: `${a.farmName} · ${a.title}` })) },
    { name: 'workPerformed', label: 'Work performed', type: 'textarea', required: true },
    { name: 'workersCount', label: 'Workers involved', type: 'number', required: true, step: '1' },
    { name: 'areaCoveredHa', label: 'Area covered (ha)', type: 'number' },
    { name: 'workerNames', label: 'Worker names', type: 'textarea' },
    { name: 'resourcesUsed', label: 'Resources used', type: 'textarea' },
    { name: 'workCompleted', label: 'Work completed', type: 'textarea' },
    { name: 'challenges', label: 'Challenges encountered', type: 'textarea' },
    { name: 'supervisorRemarks', label: "Supervisor's remarks", type: 'textarea' },
    { name: 'markActivityCompleted', label: 'This finishes the scheduled activity', type: 'checkbox' },
  ];
}

export function FarmDailyPage() {
  const { can, user } = useAuth();
  const meta = useMeta();
  const reports = useFarmQuery<DailyRow[]>('/farm/daily-reports');
  const activities = useFarmQuery<ActivityRow[]>('/farm/activities');
  const [form, setForm] = useState<DailyRow | 'new' | null>(null);
  const [open, setOpen] = useState<DailyRow | null>(null);
  const [reviewing, setReviewing] = useState<{ row: DailyRow; action: 'acknowledge' | 'return' } | null>(null);
  const submit = useFarmAction((body: Record<string, unknown>) => (form === 'new' ? send('/farm/daily-reports', 'POST', body) : send(`/farm/daily-reports/${(form as DailyRow).id}`, 'PUT', body)), { onDone: () => setForm(null) });
  const review = useFarmAction((input: { id: number; action: string; remarks: string }) => send(`/farm/daily-reports/${input.id}/review`, 'POST', { action: input.action, remarks: input.remarks }), { onDone: () => { setReviewing(null); setOpen(null); } });
  return (
    <section className="grid gap-4">
      <PageTitle title="Daily Farm Activities" description="Daily submissions from farm supervisors. The activity date is when the work was done; the submission time is when it was reported."
        action={can('farm.report') ? <Button onClick={() => setForm('new')}>Submit daily report</Button> : null} />
      <DataTable rows={reports.data} loading={reports.isLoading} error={reports.error} onRowClick={setOpen}
        search={(row) => `${row.referenceNumber} ${row.farmName} ${row.workPerformed} ${row.submittedBy}`}
        filters={[farmFilter(meta.data), statusFilter(['submitted', 'acknowledged', 'returned']), { label: 'Activity', options: options(meta.data?.activityTypes), match: (row, value) => row.activityType === value }]}
        columns={[
          { header: 'Activity date', cell: (row) => <div><div className="font-semibold">{row.activityDate}</div><div className="text-xs text-slate-500">submitted {row.submittedAt.slice(0, 16).replace('T', ' ')}</div></div> },
          { header: 'Farm', cell: (row) => row.farmName },
          { header: 'Activity', cell: (row) => <div><div>{label(row.activityType)}</div><div className="line-clamp-2 max-w-xs text-xs text-slate-500">{row.workPerformed}</div></div> },
          { header: 'Workers', cell: (row) => row.workersCount, className: 'tabular-nums' },
          { header: 'Supervisor', cell: (row) => row.submittedBy },
          { header: 'Files', cell: (row) => row.attachments || '—', className: 'tabular-nums' },
          { header: 'Status', cell: (row) => <StatusBadge value={row.status} /> },
        ]} />
      {open ? (
        <Modal title={`${open.referenceNumber} · ${open.farmName}`} onClose={() => setOpen(null)}>
          <div className="grid gap-3 text-sm">
            <div className="flex flex-wrap gap-2 text-slate-600"><StatusBadge value={open.status} /> Activity on {open.activityDate} · submitted {open.submittedAt.slice(0, 16).replace('T', ' ')} by {open.submittedBy}{open.activityReference ? ` · ${open.activityReference}` : ''}</div>
            {([['Activity', label(open.activityType)], ['Work performed', open.workPerformed], ['Workers', `${open.workersCount}${open.workerNames ? ` — ${open.workerNames}` : ''}`], ['Resources used', open.resourcesUsed],
              ['Work completed', open.workCompleted], ['Area covered', open.areaCoveredHa == null ? null : `${open.areaCoveredHa} ha`], ['Challenges', open.challenges], ["Supervisor's remarks", open.supervisorRemarks]] as Array<[string, string | null]>)
              .filter(([, value]) => value).map(([title, value]) => <div key={title}><div className="font-semibold text-ink">{title}</div><p className="whitespace-pre-line text-slate-700">{value}</p></div>)}
            {open.reviewedBy ? <p className="rounded bg-canvas px-2 py-1 text-xs">Reviewed by {open.reviewedBy} on {String(open.reviewedAt).slice(0, 16)}{open.reviewRemarks ? `: ${open.reviewRemarks}` : ''}</p> : null}
            <Attachments entity="daily-reports" id={open.id} canAdd={open.submittedByUserId === user?.id || can('farm.review')} />
            <div className="flex flex-wrap justify-end gap-2">
              {open.status === 'returned' && open.submittedByUserId === user?.id ? <Button variant="secondary" onClick={() => { setForm(open); setOpen(null); }}>Correct and resubmit</Button> : null}
              {open.status === 'submitted' && can('farm.review') && open.submittedByUserId !== user?.id ? (
                <>
                  <Button variant="secondary" onClick={() => setReviewing({ row: open, action: 'return' })}>Return for correction</Button>
                  <Button onClick={() => setReviewing({ row: open, action: 'acknowledge' })}>Acknowledge</Button>
                </>
              ) : null}
            </div>
          </div>
        </Modal>
      ) : null}
      {reviewing ? (
        <ConfirmDialog title={reviewing.action === 'acknowledge' ? 'Acknowledge daily report' : 'Return daily report'} message={`${reviewing.row.referenceNumber} from ${reviewing.row.submittedBy} for ${reviewing.row.activityDate}.`}
          confirmLabel={reviewing.action === 'acknowledge' ? 'Acknowledge' : 'Return for correction'} reasonLabel={reviewing.action === 'return' ? 'What needs correcting' : 'Remarks (optional)'}
          reasonRequired={reviewing.action === 'return'} onClose={() => setReviewing(null)} onConfirm={(remarks) => review.mutate({ id: reviewing.row.id, action: reviewing.action, remarks })} pending={review.isPending} error={review.error} />
      ) : null}
      {form ? (
        <FormModal title={form === 'new' ? 'Submit daily farm report' : `Correct ${form.referenceNumber}`} fields={dailyFields(meta.data, activities.data)} submitLabel="Submit"
          initial={form === 'new' ? { activityDate: today(), workersCount: 0 } : (form as unknown as Record<string, unknown>)}
          note={form !== 'new' && form.reviewRemarks ? <span className="text-[#8a5a00]">Returned: {form.reviewRemarks}</span> : 'Add photographs from the report after you submit it.'}
          onClose={() => setForm(null)} onSubmit={(body) => submit.mutate(body)} pending={submit.isPending} error={submit.error} />
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- 6. Farm inspections

interface InspectionRow { id: number; referenceNumber: string; farmId: number; farmName: string; crop: string | null; cropCycleId: number | null; inspectionDate: string; inspectionType: string; rating: number | null; findings: string; recommendations: string | null; followUpDate: string | null; status: string; inspector: string }

export function FarmInspectionsPage() {
  const { can } = useAuth();
  const meta = useMeta();
  const rows = useFarmQuery<InspectionRow[]>('/farm/inspections');
  const [editing, setEditing] = useState<InspectionRow | 'new' | null>(null);
  const save = useFarmAction((body: Record<string, unknown>) => (editing === 'new' ? send('/farm/inspections', 'POST', body) : send(`/farm/inspections/${(editing as InspectionRow).id}`, 'PUT', body)), { onDone: () => setEditing(null) });
  return (
    <section>
      <PageTitle title="Farm Inspections" description="Routine, crop-health, pest, compliance, harvest-readiness, equipment, and safety inspections with findings and follow-ups."
        action={can('farm.review') ? <Button onClick={() => setEditing('new')}>Record inspection</Button> : null} />
      <DataTable rows={rows.data} loading={rows.isLoading} error={rows.error} onRowClick={can('farm.review') ? setEditing : undefined} search={(row) => `${row.referenceNumber} ${row.farmName} ${row.findings}`}
        filters={[farmFilter(meta.data), statusFilter(['open', 'follow_up', 'closed'])]}
        columns={[
          { header: 'Date', cell: (row) => <div><div className="font-semibold">{row.inspectionDate}</div><div className="text-xs text-slate-500">{row.referenceNumber}</div></div> },
          { header: 'Farm', cell: (row) => <>{row.farmName}{row.crop ? <div className="text-xs text-slate-500">{row.crop}</div> : null}</> },
          { header: 'Type', cell: (row) => label(row.inspectionType) },
          { header: 'Rating', cell: (row) => (row.rating ? `${row.rating}/5` : '—') },
          { header: 'Findings', cell: (row) => <span className="line-clamp-2 max-w-sm text-xs">{row.findings}</span> },
          { header: 'Follow-up', cell: (row) => row.followUpDate ?? '—' },
          { header: 'Inspector', cell: (row) => row.inspector },
          { header: 'Status', cell: (row) => <StatusBadge value={row.status} /> },
        ]} />
      {editing ? (
        <FormModal title={editing === 'new' ? 'Record inspection' : `Inspection ${editing.referenceNumber}`} onClose={() => setEditing(null)} onSubmit={(body) => save.mutate(body)} pending={save.isPending} error={save.error}
          initial={editing === 'new' ? { inspectionDate: today(), inspectionType: 'routine', status: 'open' } : (editing as unknown as Record<string, unknown>)}
          fields={[
            { name: 'farmId', label: 'Farm', type: 'select', required: true, options: farmOptions(meta.data) },
            { name: 'inspectionDate', label: 'Date', type: 'date', required: true },
            { name: 'inspectionType', label: 'Type', type: 'select', required: true, options: options(['routine', 'crop_health', 'pest', 'compliance', 'harvest_readiness', 'equipment', 'safety']) },
            { name: 'rating', label: 'Rating (1–5)', type: 'select', options: [1, 2, 3, 4, 5].map((v) => ({ value: v, label: String(v) })) },
            { name: 'findings', label: 'Findings', type: 'textarea', required: true },
            { name: 'recommendations', label: 'Recommendations', type: 'textarea' },
            { name: 'followUpDate', label: 'Follow-up date', type: 'date' },
            { name: 'status', label: 'Status', type: 'select', options: options(['open', 'follow_up', 'closed']) },
          ]} />
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- 7. Crop production monitoring

export interface CycleRow {
  id: number; referenceNumber: string; farmId: number; farmName: string; crop: string; variety: string | null; season: string; areaHa: number; plantingDate: string | null;
  expectedHarvestDate: string | null; stage: string; expectedYieldKg: number | null; status: string; notes: string | null; harvestedKg: number; yieldPerHa: number | null;
}

const stages = ['planned', 'land_preparation', 'planting', 'vegetative', 'flowering', 'fruiting', 'harvesting', 'completed'];

export function FarmCropsPage() {
  const { can } = useAuth();
  const meta = useMeta();
  const rows = useFarmQuery<CycleRow[]>('/farm/crop-cycles');
  const [editing, setEditing] = useState<CycleRow | 'new' | null>(null);
  const save = useFarmAction((body: Record<string, unknown>) => (editing === 'new' ? send('/farm/crop-cycles', 'POST', body) : send(`/farm/crop-cycles/${(editing as CycleRow).id}`, 'PUT', body)), { onDone: () => setEditing(null) });
  return (
    <section>
      <PageTitle title="Crop Production Monitoring" description="Crops under cultivation: planting dates, area, production stage, location, and expected harvest." action={can('farm.manage') ? <Button onClick={() => setEditing('new')}>Add crop production</Button> : null} />
      <DataTable rows={rows.data} loading={rows.isLoading} error={rows.error} onRowClick={can('farm.manage') ? setEditing : undefined} search={(row) => `${row.crop} ${row.variety ?? ''} ${row.farmName} ${row.season}`}
        filters={[farmFilter(meta.data), statusFilter(['active', 'completed', 'abandoned']), { label: 'Stage', options: options(stages), match: (row, value) => row.stage === value },
          { label: 'Season', options: options(meta.data?.seasons), match: (row, value) => row.season === value }]}
        columns={[
          { header: 'Crop', cell: (row) => <div><div className="font-semibold">{row.crop}{row.variety ? ` · ${row.variety}` : ''}</div><div className="text-xs text-slate-500">{row.referenceNumber} · {row.season}</div></div> },
          { header: 'Farm', cell: (row) => row.farmName },
          { header: 'Area', cell: (row) => `${row.areaHa} ha (${(row.areaHa * 2.471).toFixed(1)} ac)` },
          { header: 'Planted', cell: (row) => row.plantingDate ?? '—' },
          { header: 'Expected harvest', cell: (row) => row.expectedHarvestDate ?? '—' },
          { header: 'Stage', cell: (row) => <StatusBadge value={row.stage} /> },
          { header: 'Expected / harvested', cell: (row) => <span className="text-xs">{kg(row.expectedYieldKg)} / {kg(row.harvestedKg)}</span> },
          { header: 'Status', cell: (row) => <StatusBadge value={row.status} /> },
        ]} />
      {editing ? (
        <FormModal title={editing === 'new' ? 'Add crop production' : `Crop ${editing.referenceNumber}`} onClose={() => setEditing(null)} onSubmit={(body) => save.mutate(body)} pending={save.isPending} error={save.error}
          initial={editing === 'new' ? { crop: 'Cashew', stage: 'planned', status: 'active' } : (editing as unknown as Record<string, unknown>)}
          fields={[
            { name: 'farmId', label: 'Farm', type: 'select', required: true, options: farmOptions(meta.data) },
            { name: 'crop', label: 'Crop', required: true }, { name: 'variety', label: 'Variety' },
            { name: 'season', label: 'Season', required: true, help: 'For example 2026/27.' }, { name: 'areaHa', label: 'Area (ha)', type: 'number', required: true },
            { name: 'plantingDate', label: 'Planting date', type: 'date' }, { name: 'expectedHarvestDate', label: 'Expected harvest', type: 'date' },
            { name: 'stage', label: 'Production stage', type: 'select', options: options(stages) }, { name: 'expectedYieldKg', label: 'Expected yield (kg)', type: 'number' },
            { name: 'status', label: 'Status', type: 'select', options: options(['active', 'completed', 'abandoned']) }, { name: 'notes', label: 'Notes', type: 'textarea' },
          ]} />
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- 8. Production targets

interface TargetRow { id: number; farmId: number; farmName: string; crop: string; season: string; periodStart: string; periodEnd: string; targetKg: number; actualKg: number; achievement: number; expectedByNow: number; underperforming: boolean; notes: string | null }

export function FarmTargetsPage() {
  const { can } = useAuth();
  const meta = useMeta();
  const rows = useFarmQuery<TargetRow[]>('/farm/targets');
  const [editing, setEditing] = useState<TargetRow | 'new' | null>(null);
  const save = useFarmAction((body: Record<string, unknown>) => (editing === 'new' ? send('/farm/targets', 'POST', body) : send(`/farm/targets/${(editing as TargetRow).id}`, 'PUT', body)), { onDone: () => setEditing(null) });
  const seasons = useMemo(() => {
    const map = new Map<string, { season: string; target: number; actual: number }>();
    for (const row of rows.data ?? []) {
      const entry = map.get(row.season) ?? { season: row.season, target: 0, actual: 0 };
      entry.target += row.targetKg; entry.actual += row.actualKg; map.set(row.season, entry);
    }
    return [...map.values()].sort((a, b) => a.season.localeCompare(b.season));
  }, [rows.data]);
  return (
    <section className="grid gap-4">
      <PageTitle title="Production Targets" description="Targets by farm, crop, and season against verified harvests. Farms behind the pace of the period are flagged." action={can('farm.manage') ? <Button onClick={() => setEditing('new')}>Set target</Button> : null} />
      <DataTable rows={rows.data} loading={rows.isLoading} error={rows.error} onRowClick={can('farm.manage') ? setEditing : undefined} search={(row) => `${row.farmName} ${row.crop} ${row.season}`}
        filters={[farmFilter(meta.data), { label: 'Season', options: options(meta.data?.seasons), match: (row, value) => row.season === value },
          { label: 'Performance', options: [{ value: 'under', label: 'Underperforming' }], match: (row) => row.underperforming }]}
        columns={[
          { header: 'Farm', cell: (row) => <div><div className="font-semibold">{row.farmName}</div><div className="text-xs text-slate-500">{row.crop} · {row.season}</div></div> },
          { header: 'Period', cell: (row) => <span className="text-xs">{row.periodStart} → {row.periodEnd}</span> },
          { header: 'Progress', cell: (row) => (
            <div className="w-56">
              <div className="relative h-2 rounded-full bg-canvas"><div className={`h-2 rounded-full ${row.underperforming ? 'bg-[#d03b3b]' : 'bg-pine'}`} style={{ width: `${Math.min(100, row.achievement)}%` }} />
                <div className="absolute -top-1 h-4 w-0.5 bg-navy" style={{ left: `${Math.min(100, row.expectedByNow)}%` }} title="Where the farm should be by now" /></div>
              <div className="mt-1 text-xs tabular-nums text-slate-600">{kg(row.actualKg)} of {kg(row.targetKg)} · {row.achievement}%</div>
            </div>
          ) },
          { header: 'Status', cell: (row) => <StatusBadge value={row.underperforming ? 'overdue' : row.achievement >= 100 ? 'completed' : 'in_progress'} /> },
        ]} />
      <Panel title="Comparison across seasons" note="All farms combined">
        <div className="h-60"><ResponsiveContainer><BarChart data={seasons}><CartesianGrid vertical={false} stroke="#ECE9CC" /><XAxis dataKey="season" {...axisProps} /><YAxis {...axisProps} width={56} /><Tooltip /><Legend />
          <Bar dataKey="target" name="Target (kg)" fill={chartColors.khaki} /><Bar dataKey="actual" name="Actual (kg)" fill={chartColors.pine} /></BarChart></ResponsiveContainer></div>
      </Panel>
      {editing ? (
        <FormModal title={editing === 'new' ? 'Set production target' : 'Edit target'} onClose={() => setEditing(null)} onSubmit={(body) => save.mutate(body)} pending={save.isPending} error={save.error}
          initial={editing === 'new' ? { crop: 'Cashew' } : (editing as unknown as Record<string, unknown>)}
          fields={[
            { name: 'farmId', label: 'Farm', type: 'select', required: true, options: farmOptions(meta.data) }, { name: 'crop', label: 'Crop', required: true },
            { name: 'season', label: 'Season', required: true }, { name: 'targetKg', label: 'Target (kg)', type: 'number', required: true },
            { name: 'periodStart', label: 'From', type: 'date', required: true }, { name: 'periodEnd', label: 'To', type: 'date', required: true }, { name: 'notes', label: 'Notes', type: 'textarea' },
          ]} />
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- 9. Harvest monitoring

interface HarvestRow {
  id: number; referenceNumber: string; farmId: number; farmName: string; crop: string; season: string; harvestDate: string; expectedKg: number | null; quantityKg: number; lossKg: number;
  grade: string | null; moisturePercent: number | null; status: string; itemName: string | null; warehouseName: string | null; movementReference: string | null; recordedBy: string; verifiedBy: string | null; createdAt: string; rejectionReason: string | null; stockItemId: number | null; warehouseId: number | null;
}

export function FarmHarvestsPage() {
  const { can } = useAuth();
  const meta = useMeta();
  const rows = useFarmQuery<HarvestRow[]>('/farm/harvests');
  const cycles = useFarmQuery<CycleRow[]>('/farm/crop-cycles?status=active');
  const [recording, setRecording] = useState(false);
  const [verifying, setVerifying] = useState<HarvestRow | null>(null);
  const [rejecting, setRejecting] = useState<HarvestRow | null>(null);
  const record = useFarmAction((body: Record<string, unknown>) => send('/farm/harvests', 'POST', body), { onDone: () => setRecording(false) });
  const verify = useFarmAction((body: Record<string, unknown>) => send(`/farm/harvests/${verifying?.id}/verify`, 'POST', body), { onDone: () => setVerifying(null), extraKeys: [['inventory']] });
  const reject = useFarmAction((reason: string) => send(`/farm/harvests/${rejecting?.id}/reject`, 'POST', { reason }), { onDone: () => setRejecting(null) });
  const schedule = (cycles.data ?? []).filter((c) => c.expectedHarvestDate).sort((a, b) => String(a.expectedHarvestDate).localeCompare(String(b.expectedHarvestDate)));
  return (
    <section className="grid gap-4">
      <PageTitle title="Harvest Monitoring" description="Harvest schedule, expected and actual quantities, grading, losses, and verification into produce stock."
        action={can('farm.report') ? <Button onClick={() => setRecording(true)}>Record harvest</Button> : null} />
      <Panel title="Harvest schedule" note="Active crops by expected harvest date, with progress">
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {schedule.map((c) => {
            const progress = c.expectedYieldKg ? Math.min(100, Math.round((c.harvestedKg / c.expectedYieldKg) * 100)) : null;
            return (
              <li key={c.id} className="rounded-lg border border-line p-3 text-sm">
                <div className="flex justify-between gap-2"><span className="font-semibold">{c.farmName} · {c.crop}</span><span className={String(c.expectedHarvestDate) < today() && c.stage !== 'completed' ? 'text-[#8d2f2f]' : 'text-slate-500'}>{c.expectedHarvestDate}</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-canvas"><div className="h-1.5 rounded-full bg-pine" style={{ width: `${progress ?? 0}%` }} /></div>
                <div className="mt-1 text-xs text-slate-500">{kg(c.harvestedKg)} of {kg(c.expectedYieldKg)} · {label(c.stage)}</div>
              </li>
            );
          })}
          {schedule.length === 0 ? <li className="text-sm text-slate-500">No upcoming harvests on record.</li> : null}
        </ul>
      </Panel>
      <DataTable rows={rows.data} loading={rows.isLoading} error={rows.error} search={(row) => `${row.referenceNumber} ${row.farmName} ${row.crop} ${row.grade ?? ''}`}
        filters={[farmFilter(meta.data), statusFilter(['recorded', 'verified', 'rejected']), { label: 'Season', options: options(meta.data?.seasons), match: (row, value) => row.season === value }]}
        columns={[
          { header: 'Harvest date', cell: (row) => <div><div className="font-semibold">{row.harvestDate}</div><div className="text-xs text-slate-500">{row.referenceNumber} · recorded {row.createdAt.slice(0, 10)}</div></div> },
          { header: 'Farm', cell: (row) => <>{row.farmName}<div className="text-xs text-slate-500">{row.crop} · {row.season}</div></> },
          { header: 'Expected', cell: (row) => kg(row.expectedKg) },
          { header: 'Harvested', cell: (row) => <span className="font-semibold">{kg(row.quantityKg)}</span> },
          { header: 'Losses', cell: (row) => kg(row.lossKg) },
          { header: 'Quality', cell: (row) => <span className="text-xs">{row.grade ? `Grade ${row.grade}` : '—'}{row.moisturePercent != null ? ` · ${row.moisturePercent}% moisture` : ''}</span> },
          { header: 'Stock', cell: (row) => <span className="text-xs">{row.movementReference ? `${row.itemName} · ${row.warehouseName} (${row.movementReference})` : row.rejectionReason ?? '—'}</span> },
          { header: 'Status', cell: (row) => <StatusBadge value={row.status} /> },
          { header: '', cell: (row) => (row.status === 'recorded' && can('farm.review') ? (
            <div className="flex gap-2 text-sm font-semibold"><button type="button" className="text-pine" onClick={() => setVerifying(row)}>Verify</button><button type="button" className="text-[#8d2f2f]" onClick={() => setRejecting(row)}>Reject</button></div>
          ) : null) },
        ]} />
      {recording ? (
        <FormModal title="Record harvest" onClose={() => setRecording(false)} onSubmit={(body) => record.mutate(body)} pending={record.isPending} error={record.error} initial={{ harvestDate: today() }}
          note="The harvest goes into stock when the Operations Manager verifies it."
          fields={[
            { name: 'farmId', label: 'Farm', type: 'select', required: true, options: farmOptions(meta.data) },
            { name: 'cropCycleId', label: 'Crop', type: 'select', options: (cycles.data ?? []).map((c) => ({ value: c.id, label: `${c.farmName} · ${c.crop} ${c.season}` })) },
            { name: 'harvestDate', label: 'Harvest date', type: 'date', required: true }, { name: 'quantityKg', label: 'Quantity (kg)', type: 'number', required: true },
            { name: 'lossKg', label: 'Losses (kg)', type: 'number' }, { name: 'expectedKg', label: 'Expected (kg)', type: 'number' },
            { name: 'grade', label: 'Grade' }, { name: 'moisturePercent', label: 'Moisture %', type: 'number' },
            { name: 'crop', label: 'Crop (if no crop record)' }, { name: 'season', label: 'Season (if no crop record)' },
            { name: 'stockItemId', label: 'Produce stock item', type: 'select', options: (meta.data?.produceItems ?? []).map((i) => ({ value: i.id, label: i.name })) },
            { name: 'warehouseId', label: 'Store', type: 'select', options: (meta.data?.warehouses ?? []).map((w) => ({ value: w.id, label: w.name })) },
            { name: 'qualityNotes', label: 'Quality notes', type: 'textarea' },
          ]} />
      ) : null}
      {verifying ? (
        <FormModal title={`Verify ${verifying.referenceNumber}`} submitLabel="Verify and receive into stock" onClose={() => setVerifying(null)} onSubmit={(body) => verify.mutate(body)} pending={verify.isPending} error={verify.error}
          initial={{ stockItemId: verifying.stockItemId ?? '', warehouseId: verifying.warehouseId ?? '' }}
          note={`${kg(verifying.quantityKg)} of ${verifying.crop} from ${verifying.farmName} will be received into the store as one stock receipt. This cannot be repeated.`}
          fields={[
            { name: 'stockItemId', label: 'Produce stock item', type: 'select', required: true, options: (meta.data?.produceItems ?? []).map((i) => ({ value: i.id, label: `${i.name} (${i.unit})` })), help: 'Stock items in the "Farm produce" category.' },
            { name: 'warehouseId', label: 'Store', type: 'select', required: true, options: (meta.data?.warehouses ?? []).map((w) => ({ value: w.id, label: w.name })) },
            { name: 'unitCost', label: 'Unit cost (optional)', type: 'number' },
          ]} />
      ) : null}
      {rejecting ? <ConfirmDialog title={`Reject ${rejecting.referenceNumber}`} message="The harvest will not enter stock. The supervisor is told why." confirmLabel="Reject harvest" danger reasonLabel="Reason" reasonRequired
        onClose={() => setRejecting(null)} onConfirm={(reason) => reject.mutate(reason)} pending={reject.isPending} error={reject.error} /> : null}
    </section>
  );
}

// ---------------------------------------------------------------- 10. Yield performance

interface YieldRow { farmId: number; farmName: string; crop: string; season: string; areaHa: number; expectedKg: number; harvestedKg: number; lossKg: number; yieldPerHa: number | null; yieldPerAcre: number | null; expectedPerHa: number | null }

export function FarmYieldPage() {
  const meta = useMeta();
  const rows = useFarmQuery<YieldRow[]>('/farm/yield');
  const [unit, setUnit] = useState<'ha' | 'acre'>('ha');
  return (
    <section className="grid gap-4">
      <PageTitle title="Yield Performance" description="Verified harvest per hectare or acre, by crop, farm, and season." action={<>
        <Button variant={unit === 'ha' ? 'primary' : 'secondary'} onClick={() => setUnit('ha')}>Per hectare</Button><Button variant={unit === 'acre' ? 'primary' : 'secondary'} onClick={() => setUnit('acre')}>Per acre</Button></>} />
      <Panel title={`Yield (kg per ${unit === 'ha' ? 'hectare' : 'acre'})`}>
        <div className="h-64"><ResponsiveContainer><BarChart data={(rows.data ?? []).map((row) => ({ name: `${row.farmName} · ${row.crop} ${row.season}`, actual: unit === 'ha' ? row.yieldPerHa : row.yieldPerAcre, expected: unit === 'ha' ? row.expectedPerHa : row.expectedPerHa == null ? null : Math.round((row.expectedPerHa / 2.471) * 10) / 10 }))}>
          <CartesianGrid vertical={false} stroke="#ECE9CC" /><XAxis dataKey="name" {...axisProps} interval={0} tickFormatter={(v: string) => (v.length > 16 ? `${v.slice(0, 15)}…` : v)} /><YAxis {...axisProps} width={56} /><Tooltip /><Legend />
          <Bar dataKey="expected" name="Expected" fill={chartColors.khaki} /><Bar dataKey="actual" name="Actual" fill={chartColors.pine} /></BarChart></ResponsiveContainer></div>
      </Panel>
      <DataTable rows={rows.data} loading={rows.isLoading} error={rows.error} rowKey={(row) => `${row.farmId}-${row.crop}-${row.season}`} search={(row) => `${row.farmName} ${row.crop} ${row.season}`}
        filters={[farmFilter(meta.data), { label: 'Season', options: options(meta.data?.seasons), match: (row, value) => row.season === value }, { label: 'Crop', options: options(meta.data?.crops), match: (row, value) => row.crop === value }]}
        columns={[
          { header: 'Farm', cell: (row) => row.farmName }, { header: 'Crop', cell: (row) => row.crop }, { header: 'Season', cell: (row) => row.season },
          { header: 'Area', cell: (row) => `${row.areaHa} ha` }, { header: 'Harvested', cell: (row) => kg(row.harvestedKg) }, { header: 'Losses', cell: (row) => kg(row.lossKg) },
          { header: `Yield / ${unit}`, cell: (row) => <span className="font-semibold">{(unit === 'ha' ? row.yieldPerHa : row.yieldPerAcre) ?? '—'}</span> },
          { header: 'Expected / ha', cell: (row) => row.expectedPerHa ?? '—' },
        ]} />
    </section>
  );
}

export { amount };
