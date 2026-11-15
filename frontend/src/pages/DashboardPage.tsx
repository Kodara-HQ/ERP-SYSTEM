import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { canOpenPath } from '../lib/navigation';

interface TrendMonth { month: string; label: string; approved: number; rejected: number; waiting: number; approvedAmount: number }

interface Summary {
  data: {
    employees?: { active: number; probation: number; exited: number };
    headcountByDepartment?: { department: string; headcount: number }[];
    headcount?: number;
    departments?: number;
    branches?: number;
    positions?: number;
    users?: { active: number; locked: number; disabled: number };
    pendingChangeRequests?: number;
    approvals?: { mine: number; inbox: number };
    hr?: { onLeaveToday: number; openVacancies: number; pendingLeave: number };
    myLeave?: number;
    procurement?: { pendingRequisitions: number; openOrders: number };
    inventory?: { belowReorder: number };
    finance?: { pendingPayments: number; openPayables: number; openReceivables: number };
    payroll?: { withAccounts: number; withCeo: number; awaitingPayment: number; failedPayments: number };
    legal?: { pendingReviews: number; expiring: number };
    operations?: { openTasks: number; openIssues: number; escalatedIssues: number };
    executive?: { openReviews: number; openActions: number; pendingReports: number };
    approvalTrend?: TrendMonth[];
    currencyCode?: string;
  };
}

type Item = { label: string; value: number; to: string; tone?: 'urgent' };

const ink = { primary: '#2C2B1C', secondary: '#6A6854', grid: '#ECE9CC' };
const brand = '#545233';
/** Status steps from the validated reference palette, always shown with a legend and labels. */
const status = { approved: '#0ca30c', waiting: '#fab219', rejected: '#d03b3b' };

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function ordinal(day: number) {
  if (day % 100 >= 11 && day % 100 <= 13) return `${day}th`;
  return `${day}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th'}`;
}
function today() {
  const now = new Date();
  return `${days[now.getDay()]}, ${ordinal(now.getDate())} ${months[now.getMonth()]} ${now.getFullYear()}`;
}
function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}
const compact = (value: number) => value.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const full = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

function Panel({ title, note, action, children }: { title: string; note?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <article className="rounded-lg border border-line bg-white p-4 shadow-card sm:p-5">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {note ? <p className="mt-0.5 text-xs text-slate-500">{note}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </article>
  );
}

function ChartTooltip({ active, payload, label, money }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string; money?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line bg-white px-3 py-2 text-xs shadow-card">
      <div className="mb-1 font-semibold text-ink">{label}</div>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 text-slate-600">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: entry.color }} />
          <span>{entry.name}</span>
          <span className="ml-auto pl-3 font-semibold tabular-nums text-ink">{money ? `${money} ${full(entry.value)}` : full(entry.value)}</span>
        </div>
      ))}
    </div>
  );
}

const axis = { tick: { fontSize: 12, fill: ink.secondary }, axisLine: false, tickLine: false } as const;

export function DashboardPage() {
  const summary = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Summary>('/v1/dashboard/summary') });
  const data = summary.data?.data;
  const { user } = useAuth();
  const canOpen = (path: string) => canOpenPath(path, user?.permissions ?? [], user?.workspaces ?? []);
  const money = data?.currencyCode ?? '';
  const trend = data?.approvalTrend ?? [];
  const thisMonth = trend[trend.length - 1];
  const lastMonth = trend[trend.length - 2];

  // Work waiting on someone. Only non-zero items are shown, most urgent first.
  const attention: Item[] = ([
    data?.approvals ? { label: 'Approvals waiting for you', value: data.approvals.inbox, to: '/approvals', tone: 'urgent' } : null,
    data?.executive ? { label: 'Reports awaiting your sign-off', value: data.executive.pendingReports, to: '/executive', tone: 'urgent' } : null,
    data?.payroll ? { label: 'Payroll awaiting CEO approval', value: data.payroll.withCeo, to: '/payroll', tone: 'urgent' } : null,
    data?.operations ? { label: 'Issues escalated to you', value: data.operations.escalatedIssues, to: '/operations', tone: 'urgent' } : null,
    data?.payroll ? { label: 'Failed salary payments', value: data.payroll.failedPayments, to: '/payroll', tone: 'urgent' } : null,
    data?.legal ? { label: 'Documents expiring soon', value: data.legal.expiring, to: '/legal', tone: 'urgent' } : null,
    data?.users ? { label: 'Locked accounts', value: data.users.locked, to: '/admin/users' } : null,
    data?.pendingChangeRequests != null ? { label: 'Changes awaiting implementation', value: data.pendingChangeRequests, to: '/organisation/changes' } : null,
    data?.hr ? { label: 'Leave awaiting approval', value: data.hr.pendingLeave, to: '/hr' } : null,
    data?.procurement ? { label: 'Requisitions awaiting approval', value: data.procurement.pendingRequisitions, to: '/procurement' } : null,
    data?.finance ? { label: 'Payments awaiting approval', value: data.finance.pendingPayments, to: '/finance/payments' } : null,
    data?.payroll ? { label: 'Payroll with accounts', value: data.payroll.withAccounts, to: '/payroll' } : null,
    data?.payroll ? { label: 'Payroll awaiting payment', value: data.payroll.awaitingPayment, to: '/payroll' } : null,
    data?.legal ? { label: 'Legal reviews pending', value: data.legal.pendingReviews, to: '/legal' } : null,
    data?.inventory ? { label: 'Stock items at reorder level', value: data.inventory.belowReorder, to: '/inventory' } : null,
    data?.executive ? { label: 'Corrective actions open', value: data.executive.openActions, to: '/executive' } : null,
    data?.operations ? { label: 'Open operational issues', value: data.operations.openIssues, to: '/operations' } : null,
  ] as Array<Item | null>).filter((item): item is Item => item !== null && item.value > 0);

  // Reference figures, grouped, shown compactly.
  const glance: Array<{ group: string; items: Item[] }> = [
    { group: 'Organisation', items: [
      data?.departments != null ? { label: 'Departments', value: data.departments, to: '/organisation/departments' } : null,
      data?.positions != null ? { label: 'Positions', value: data.positions, to: '/organisation/positions' } : null,
      data?.branches != null ? { label: 'Branches', value: data.branches, to: '/organisation/branches' } : null,
    ] },
    { group: 'People', items: [
      data?.employees ? { label: 'On probation', value: data.employees.probation, to: '/employees' } : null,
      data?.hr ? { label: 'On leave today', value: data.hr.onLeaveToday, to: '/hr' } : null,
      data?.hr ? { label: 'Open vacancies', value: data.hr.openVacancies, to: '/hr/recruitment' } : null,
      data?.myLeave != null ? { label: 'My open leave', value: data.myLeave, to: '/hr' } : null,
    ] },
    { group: 'Money', items: [
      data?.finance ? { label: 'Open payables', value: data.finance.openPayables, to: '/finance/reports' } : null,
      data?.finance ? { label: 'Open receivables', value: data.finance.openReceivables, to: '/finance/reports' } : null,
      data?.procurement ? { label: 'Open purchase orders', value: data.procurement.openOrders, to: '/procurement/orders' } : null,
    ] },
    { group: 'Operations', items: [
      data?.operations ? { label: 'Open tasks', value: data.operations.openTasks, to: '/operations' } : null,
      data?.executive ? { label: 'Department checks open', value: data.executive.openReviews, to: '/executive' } : null,
      data?.approvals ? { label: 'My open requests', value: data.approvals.mine, to: '/approvals' } : null,
    ] },
  ].map((section) => ({ group: section.group, items: (section.items as Array<Item | null>).filter((item): item is Item => item !== null) }))
    .filter((section) => section.items.length > 0);

  // Four headline figures, chosen from what this person can see.
  const urgentCount = attention.filter((item) => item.tone === 'urgent').reduce((sum, item) => sum + item.value, 0);
  const kpis: Array<{ label: string; value: string; note: string; to: string }> = [];
  if (data?.employees) kpis.push({ label: 'Active employees', value: full(data.employees.active), note: `${data.employees.probation} on probation`, to: '/employees' });
  else if (data?.headcount != null) kpis.push({ label: 'Active employees', value: full(data.headcount), note: data.hr ? `${data.hr.onLeaveToday} on leave today` : 'Across all departments', to: '/hr/reports' });
  if (data?.approvals) kpis.push({ label: 'Waiting for you', value: full(urgentCount || data.approvals.inbox), note: urgentCount ? 'Items need your decision' : 'Nothing needs your decision', to: '/approvals' });
  if (thisMonth) {
    const change = lastMonth && lastMonth.approvedAmount > 0 ? Math.round(((thisMonth.approvedAmount - lastMonth.approvedAmount) / lastMonth.approvedAmount) * 100) : null;
    kpis.push({
      label: 'Approved spending this month',
      value: `${money} ${compact(thisMonth.approvedAmount)}`.trim(),
      note: change == null ? `${thisMonth.approved} request${thisMonth.approved === 1 ? '' : 's'} approved` : `${change >= 0 ? '+' : ''}${change}% on last month`,
      to: '/reports',
    });
  }
  if (data?.operations || data?.executive) {
    const open = (data.operations?.openIssues ?? 0) + (data.executive?.openActions ?? 0);
    kpis.push({ label: 'Open issues and actions', value: full(open), note: `${data.operations?.escalatedIssues ?? 0} escalated to you`, to: data.operations ? '/operations' : '/executive' });
  } else if (data?.hr) {
    kpis.push({ label: 'On leave today', value: full(data.hr.onLeaveToday), note: `${data.hr.pendingLeave} leave requests waiting`, to: '/hr' });
  }

  const headcount = [...(data?.headcountByDepartment ?? [])].filter((row) => row.headcount > 0).sort((a, b) => b.headcount - a.headcount);
  const linkClass = 'transition hover:border-pine/40 hover:shadow-[0_8px_24px_rgba(62,60,40,0.10)] focus:outline-none focus-visible:ring-2 focus-visible:ring-pine';

  return (
    <section className="grid gap-5">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm text-slate-500">{today()}</p>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{greeting()}{user?.username ? `, ${user.username}` : ''}</h1>
        </div>
        {canOpen('/reports') ? (
          <Link to="/reports" className="inline-flex h-9 items-center gap-1 rounded-md border border-line bg-white px-3 text-sm font-semibold text-pine hover:bg-cream">
            Full reports <ArrowUpRight size={15} />
          </Link>
        ) : null}
      </header>

      {summary.isLoading ? <p className="text-sm text-slate-500">Loading company figures…</p> : null}
      {summary.isError ? <p className="text-sm text-[#8d2f2f]">The dashboard could not be loaded.</p> : null}

      {kpis.length ? (
        <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${["xl:grid-cols-1", "xl:grid-cols-2", "xl:grid-cols-3", "xl:grid-cols-4"][Math.min(kpis.length, 4) - 1]}`}>
          {kpis.slice(0, 4).map((kpi) => {
            const body = (
              <>
                <div className="text-sm text-slate-500">{kpi.label}</div>
                <div className="mt-2 text-3xl font-semibold tracking-tight text-ink tabular-nums">{kpi.value}</div>
                <div className="mt-1 text-xs text-slate-500">{kpi.note}</div>
              </>
            );
            const base = 'rounded-lg border border-line bg-white px-4 py-4 shadow-card';
            return canOpen(kpi.to)
              ? <Link key={kpi.label} to={kpi.to} className={`${base} ${linkClass}`}>{body}</Link>
              : <article key={kpi.label} className={base}>{body}</article>;
          })}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 gap-5">
          {trend.length ? (
            <Panel title="Approval requests by month" note="Requests submitted each month, by where they stand now">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trend} barCategoryGap="28%">
                    <CartesianGrid stroke={ink.grid} vertical={false} />
                    <XAxis dataKey="label" {...axis} />
                    <YAxis allowDecimals={false} width={32} {...axis} />
                    <Tooltip cursor={{ fill: '#F3F0D2' }} content={<ChartTooltip />} />
                    <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12, color: ink.secondary }} />
                    <Bar dataKey="approved" name="Approved" stackId="s" fill={status.approved} stroke="#fff" strokeWidth={2} />
                    <Bar dataKey="waiting" name="Still waiting" stackId="s" fill={status.waiting} stroke="#fff" strokeWidth={2} />
                    <Bar dataKey="rejected" name="Rejected" stackId="s" fill={status.rejected} stroke="#fff" strokeWidth={2} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          ) : null}

          {trend.length ? (
            <Panel title="Approved spending by month" note={`Total amount approved each month${money ? `, in ${money}` : ''}`}>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trend} barCategoryGap="36%">
                    <CartesianGrid stroke={ink.grid} vertical={false} />
                    <XAxis dataKey="label" {...axis} />
                    <YAxis width={48} tickFormatter={compact} {...axis} />
                    <Tooltip cursor={{ fill: '#F3F0D2' }} content={<ChartTooltip money={money} />} />
                    <Bar dataKey="approvedAmount" name="Approved" fill={brand} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          ) : null}

          {headcount.length ? (
            <Panel title="Staff by department" note="Employees by their main department">
              <div style={{ height: Math.max(160, headcount.length * 34 + 30) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={headcount} layout="vertical" barCategoryGap="30%" margin={{ left: 8, right: 24 }}>
                    <CartesianGrid stroke={ink.grid} horizontal={false} />
                    <XAxis type="number" allowDecimals={false} {...axis} />
                    <YAxis type="category" dataKey="department" width={150} {...axis} />
                    <Tooltip cursor={{ fill: '#F3F0D2' }} content={<ChartTooltip />} />
                    <Bar dataKey="headcount" name="Employees" fill={brand} radius={[0, 4, 4, 0]} label={{ position: 'right', fontSize: 12, fill: ink.primary }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          ) : null}
        </div>

        <div className="grid content-start gap-5">
          <Panel title="Needs attention" note="Work waiting on you or your teams">
            {attention.length === 0 ? (
              <div className="flex items-center gap-2 rounded-md bg-canvas px-3 py-3 text-sm text-pine">
                <CheckCircle2 size={16} /> All clear. Nothing is waiting.
              </div>
            ) : (
              <ul className="-mx-2 grid">
                {attention.map((item) => {
                  const row = (
                    <>
                      <span className={`h-2 w-2 shrink-0 rounded-full ${item.tone === 'urgent' ? 'bg-[#d03b3b]' : 'bg-[#fab219]'}`} aria-hidden="true" />
                      <span className="text-sm text-ink">{item.label}</span>
                      <span className="ml-auto rounded-full bg-cream px-2 py-0.5 text-xs font-semibold tabular-nums text-pine">{item.value}</span>
                    </>
                  );
                  return (
                    <li key={item.label}>
                      {canOpen(item.to)
                        ? <Link to={item.to} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-canvas">{row}</Link>
                        : <div className="flex items-center gap-3 px-2 py-2">{row}</div>}
                    </li>
                  );
                })}
              </ul>
            )}
            {attention.some((item) => item.tone === 'urgent') ? (
              <p className="mt-3 flex items-center gap-3 text-xs text-slate-500">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#d03b3b]" /> Needs your decision</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#fab219]" /> In progress with a team</span>
              </p>
            ) : null}
          </Panel>

          {glance.length ? (
            <Panel title="At a glance">
              <div className="grid gap-4">
                {glance.map((section) => (
                  <div key={section.group}>
                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{section.group}</h3>
                    <div className="grid">
                      {section.items.map((item) => {
                        const row = (
                          <>
                            <span className="text-sm text-slate-600">{item.label}</span>
                            <span className="ml-auto text-sm font-semibold tabular-nums text-ink">{item.value}</span>
                          </>
                        );
                        return canOpen(item.to)
                          ? <Link key={item.label} to={item.to} className="-mx-2 flex items-center rounded-md px-2 py-1.5 hover:bg-canvas">{row}</Link>
                          : <div key={item.label} className="flex items-center py-1.5">{row}</div>;
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}
        </div>
      </div>
    </section>
  );
}
