import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  Bell,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  FileText,
  GitBranch,
  ListChecks,
  Network,
  Package,
  Receipt,
  Scale,
  Send,
  Shield,
  ShoppingCart,
  Truck,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { canOpenPath } from '../lib/navigation';
import { notificationTarget, timeAgo, type NotificationResponse } from '../components/Shell';

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

interface InboxRequest {
  id: number;
  referenceNumber: string;
  workflowName: string;
  title: string;
  amount: number | null;
  currencyCode: string;
  status: string;
  requester: string;
}

type Data = NonNullable<Summary['data']>;
type Persona = 'ceo' | 'finance' | 'hr' | 'operations' | 'legal' | 'supply' | 'admin' | 'staff';
type Item = { label: string; value: number; to: string; tone?: 'urgent' };
type Kpi = {
  key: string;
  label: string;
  value: string;
  note: string;
  icon: LucideIcon;
  to: string;
  trend?: { up: boolean; good: boolean; text: string };
};

const ink = { primary: '#2C2B1C', secondary: '#6A6854', grid: '#ECE9CC' };
const palette = { pine: '#545233', navy: '#3E3C28', olive: '#878571', khaki: '#D9D7B6', cream: '#FDFAD5' };
/** Status steps already used across the app, always shown with a legend and labels. */
const status = { approved: '#0ca30c', waiting: '#fab219', rejected: '#d03b3b' };
/** Icon tiles rotate through the brand palette so neighbouring cards read apart. */
const tileTones = ['bg-pine text-cream', 'bg-khaki text-navy', 'bg-navy text-khaki', 'bg-cream text-pine ring-1 ring-khaki'];

const personas: Record<Persona, { title: string; tagline: string; banner: string; bannerNote: string }> = {
  ceo: { title: 'CEO Dashboard', tagline: 'Strategic overview and final authority', banner: 'Leading BAJOGO forward', bannerNote: 'Every decision waiting on you, and how the company is moving, in one place.' },
  finance: { title: 'Finance Dashboard', tagline: 'Financial control, business growth', banner: 'Stay on track', bannerNote: 'Keep payments, payables and receivables moving on time.' },
  hr: { title: 'HR Dashboard', tagline: 'Our people, our strength', banner: 'A motivated workforce drives our success', bannerNote: 'Happy employees, greater productivity.' },
  operations: { title: 'Operations Dashboard', tagline: 'Efficient operations, higher output', banner: 'Healthy farms, bountiful harvests', bannerNote: 'Our operations today secure our tomorrow.' },
  legal: { title: 'Legal Dashboard', tagline: 'Compliance and risk management', banner: 'Legal compliance builds trust', bannerNote: 'Our commitment to doing things the right way.' },
  supply: { title: 'Supply Dashboard', tagline: 'Purchasing and stock under control', banner: 'The right stock at the right time', bannerNote: 'Requisitions, orders and stock levels at a glance.' },
  admin: { title: 'Administration Dashboard', tagline: 'Accounts, access and structure', banner: 'Secure access for every team', bannerNote: 'Keep accounts, roles and the organisation in order.' },
  staff: { title: 'My Dashboard', tagline: 'Your work in one place', banner: 'Welcome to BAJOGO ERP', bannerNote: 'Growing today. Feeding tomorrow.' },
};

/** Cards each persona sees first; anything else they can see fills the remaining slots. */
const kpiOrder: Record<Persona, string[]> = {
  ceo: ['employees', 'inbox', 'spending', 'reports', 'issues', 'actions', 'payroll', 'departments'],
  finance: ['payments', 'payables', 'receivables', 'payroll', 'inbox', 'spending'],
  hr: ['employees', 'onLeave', 'vacancies', 'pendingLeave', 'departments', 'inbox'],
  operations: ['tasks', 'issues', 'escalated', 'stock', 'inbox'],
  legal: ['legalReviews', 'expiring', 'inbox', 'myRequests'],
  supply: ['requisitions', 'orders', 'stock', 'inbox'],
  admin: ['users', 'locked', 'changes', 'departments', 'employees'],
  staff: ['inbox', 'myRequests', 'myLeave'],
};

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

function personaFor(data: Data | undefined): Persona {
  if (!data) return 'staff';
  if (data.executive) return 'ceo';
  if (data.finance) return 'finance';
  if (data.hr) return 'hr';
  if (data.operations) return 'operations';
  if (data.legal) return 'legal';
  if (data.procurement || data.inventory) return 'supply';
  if (data.users || data.departments != null) return 'admin';
  return 'staff';
}

function Panel({ title, note, action, children, className = '' }: { title: string; note?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <article className={`flex min-w-0 flex-col rounded-xl border border-line bg-white p-4 shadow-card sm:p-5 ${className}`}>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink">{title}</h2>
          {note ? <p className="mt-0.5 text-xs text-slate-500">{note}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </article>
  );
}

function ViewAll({ to, show }: { to: string; show: boolean }) {
  if (!show) return null;
  return (
    <Link to={to} className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-pine hover:bg-canvas">
      View all <ArrowRight size={12} />
    </Link>
  );
}

function ChartTooltip({ active, payload, label, money }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string; money?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line bg-white px-3 py-2 text-xs shadow-card">
      <div className="mb-1 font-semibold text-ink">{label}</div>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 text-slate-600">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: entry.color }} />
          <span>{entry.name}</span>
          <span className="ml-auto pl-3 font-semibold tabular-nums text-ink">{money ? `${money} ${full(entry.value)}` : full(entry.value)}</span>
        </div>
      ))}
    </div>
  );
}

const axis = { tick: { fontSize: 12, fill: ink.secondary }, axisLine: false, tickLine: false } as const;
const spans: Record<number, string[]> = { 1: ['xl:col-span-12'], 2: ['xl:col-span-7', 'xl:col-span-5'], 3: ['xl:col-span-5', 'xl:col-span-4', 'xl:col-span-3'] };
const columns: Record<number, string> = { 1: 'grid gap-5', 2: 'grid gap-5 lg:grid-cols-2', 3: 'grid gap-5 lg:grid-cols-2 xl:grid-cols-3' };

export function DashboardPage() {
  const summary = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Summary>('/v1/dashboard/summary') });
  const data = summary.data?.data;
  const { user } = useAuth();
  const canOpen = (path: string) => canOpenPath(path, user?.permissions ?? [], user?.workspaces ?? []);
  const [trendView, setTrendView] = useState<'requests' | 'spending'>('requests');
  const persona = personaFor(data);
  const copy = personas[persona];
  const money = data?.currencyCode ?? '';
  const trend = (data?.approvalTrend ?? []).map((month) => ({ ...month, submitted: month.approved + month.rejected + month.waiting }));
  const thisMonth = trend[trend.length - 1];
  const lastMonth = trend[trend.length - 2];

  const inbox = useQuery({
    queryKey: ['approval-requests', 'inbox'],
    enabled: Boolean(data?.approvals),
    queryFn: () => api<{ data: InboxRequest[] }>('/v1/approvals/requests?queue=inbox&pageSize=50'),
  });
  const notes = useQuery({ queryKey: ['notifications'], queryFn: () => api<NotificationResponse>('/v1/notifications') });

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

  // Every headline figure this person can see; the persona decides which come first.
  const candidates: Array<Kpi | null> = data ? [
    data.employees
      ? { key: 'employees', label: 'Total employees', value: full(data.employees.active), note: `${data.employees.probation} on probation`, icon: Users, to: '/employees' }
      : data.headcount != null ? { key: 'employees', label: 'Total employees', value: full(data.headcount), note: 'Across all departments', icon: Users, to: '/hr/reports' } : null,
    data.approvals ? { key: 'inbox', label: 'Waiting for you', value: full(data.approvals.inbox), note: data.approvals.inbox ? 'Need your decision' : 'Nothing needs you', icon: ListChecks, to: '/approvals' } : null,
    data.approvals ? { key: 'myRequests', label: 'My open requests', value: full(data.approvals.mine), note: 'Moving through approval', icon: Send, to: '/approvals' } : null,
    thisMonth ? (() => {
      const change = lastMonth && lastMonth.approvedAmount > 0 ? Math.round(((thisMonth.approvedAmount - lastMonth.approvedAmount) / lastMonth.approvedAmount) * 100) : null;
      return {
        key: 'spending', label: 'Approved this month', value: `${money} ${compact(thisMonth.approvedAmount)}`.trim(),
        note: change == null ? `${thisMonth.approved} request${thisMonth.approved === 1 ? '' : 's'} approved` : 'on last month',
        icon: Banknote, to: '/reports',
        trend: change == null ? undefined : { up: change >= 0, good: true, text: `${Math.abs(change)}%` },
      };
    })() : null,
    data.executive ? { key: 'reports', label: 'Awaiting sign-off', value: full(data.executive.pendingReports), note: 'Payroll and legal reports', icon: FileCheck2, to: '/executive' } : null,
    data.executive ? { key: 'actions', label: 'Corrective actions', value: full(data.executive.openActions), note: `${data.executive.openReviews} department checks open`, icon: ClipboardCheck, to: '/executive' } : null,
    data.operations ? { key: 'issues', label: 'Open issues', value: full(data.operations.openIssues), note: `${data.operations.escalatedIssues} escalated`, icon: AlertTriangle, to: '/operations' } : null,
    data.operations ? { key: 'tasks', label: 'Open tasks', value: full(data.operations.openTasks), note: 'Daily operations', icon: ClipboardCheck, to: '/operations' } : null,
    data.operations ? { key: 'escalated', label: 'Escalated issues', value: full(data.operations.escalatedIssues), note: 'Raised to management', icon: AlertTriangle, to: '/operations' } : null,
    data.payroll ? { key: 'payroll', label: 'Payroll in progress', value: full(data.payroll.withAccounts + data.payroll.withCeo + data.payroll.awaitingPayment), note: `${data.payroll.awaitingPayment} awaiting payment`, icon: Wallet, to: '/payroll' } : null,
    data.departments != null ? { key: 'departments', label: 'Departments', value: full(data.departments), note: [data.branches != null ? `${data.branches} branches` : '', data.positions != null ? `${data.positions} positions` : ''].filter(Boolean).join(' · ') || 'Active', icon: Network, to: '/organisation/departments' } : null,
    data.hr ? { key: 'onLeave', label: 'On leave today', value: full(data.hr.onLeaveToday), note: 'Approved leave', icon: CalendarDays, to: '/hr' } : null,
    data.hr ? { key: 'vacancies', label: 'Open vacancies', value: full(data.hr.openVacancies), note: 'Recruitment', icon: UserPlus, to: '/hr/recruitment' } : null,
    data.hr ? { key: 'pendingLeave', label: 'Leave requests', value: full(data.hr.pendingLeave), note: 'Awaiting approval', icon: CalendarClock, to: '/hr' } : null,
    data.myLeave != null ? { key: 'myLeave', label: 'My open leave', value: full(data.myLeave), note: 'Submitted or returned', icon: CalendarDays, to: '/hr' } : null,
    data.finance ? { key: 'payments', label: 'Payments to approve', value: full(data.finance.pendingPayments), note: 'Payment requests', icon: Receipt, to: '/finance/payments' } : null,
    data.finance ? { key: 'payables', label: 'Open payables', value: full(data.finance.openPayables), note: 'Supplier invoices', icon: FileText, to: '/finance/reports' } : null,
    data.finance ? { key: 'receivables', label: 'Open receivables', value: full(data.finance.openReceivables), note: 'Customer invoices', icon: Wallet, to: '/finance/reports' } : null,
    data.procurement ? { key: 'requisitions', label: 'Requisitions', value: full(data.procurement.pendingRequisitions), note: 'Awaiting approval', icon: ShoppingCart, to: '/procurement' } : null,
    data.procurement ? { key: 'orders', label: 'Open purchase orders', value: full(data.procurement.openOrders), note: 'Issued or partly received', icon: Truck, to: '/procurement/orders' } : null,
    data.inventory ? { key: 'stock', label: 'Low stock items', value: full(data.inventory.belowReorder), note: 'At or below reorder level', icon: Package, to: '/inventory' } : null,
    data.legal ? { key: 'legalReviews', label: 'Legal reviews', value: full(data.legal.pendingReviews), note: 'In review or with the CEO', icon: Scale, to: '/legal' } : null,
    data.legal ? { key: 'expiring', label: 'Expiring in 30 days', value: full(data.legal.expiring), note: 'Contracts and licences', icon: CalendarClock, to: '/legal' } : null,
    data.users ? { key: 'users', label: 'Active accounts', value: full(data.users.active), note: `${data.users.disabled} disabled`, icon: Shield, to: '/admin/users' } : null,
    data.users ? { key: 'locked', label: 'Locked accounts', value: full(data.users.locked), note: 'Need unlocking', icon: Shield, to: '/admin/users' } : null,
    data.pendingChangeRequests != null ? { key: 'changes', label: 'Change requests', value: full(data.pendingChangeRequests), note: 'Awaiting implementation', icon: GitBranch, to: '/organisation/changes' } : null,
  ] : [];
  const available = candidates.filter((kpi): kpi is Kpi => kpi !== null);
  const order = kpiOrder[persona];
  const kpis = [
    ...order.map((key) => available.find((kpi) => kpi.key === key)).filter((kpi): kpi is Kpi => Boolean(kpi)),
    ...available.filter((kpi) => !order.includes(kpi.key)),
  ].slice(0, 8);
  // Fill whole rows of four on wide screens so no row ends half empty.
  const shown = kpis.length > 4 ? kpis.slice(0, kpis.length >= 8 ? 8 : 4) : kpis;

  const headcount = [...(data?.headcountByDepartment ?? [])].filter((row) => row.headcount > 0).sort((a, b) => b.headcount - a.headcount);
  const totalHeadcount = headcount.reduce((sum, row) => sum + row.headcount, 0);
  const decided = trend.reduce((sum, month) => sum + month.approved + month.rejected, 0);
  const approvedTotal = trend.reduce((sum, month) => sum + month.approved, 0);
  const ring = decided > 0
    ? { title: 'Approval rate', note: 'Decided requests, last 6 months', value: Math.round((approvedTotal / decided) * 100), caption: 'Approved', legend: [{ label: 'Approved', value: approvedTotal, color: palette.pine }, { label: 'Rejected', value: decided - approvedTotal, color: palette.khaki }] }
    : data?.employees && data.employees.active > 0
      ? { title: 'Workforce', note: 'Confirmed staff against probation', value: Math.round(((data.employees.active - data.employees.probation) / data.employees.active) * 100), caption: 'Confirmed', legend: [{ label: 'Confirmed', value: data.employees.active - data.employees.probation, color: palette.pine }, { label: 'On probation', value: data.employees.probation, color: palette.khaki }] }
      : null;

  const charts: Array<{ key: string; node: (span: string) => ReactNode }> = [];
  if (trend.length) {
    charts.push({ key: 'trend', node: (span) => (
      <Panel
        key="trend"
        className={span}
        title={trendView === 'requests' ? 'Approval requests' : 'Approved spending'}
        note={trendView === 'requests' ? 'Submitted against approved, by month' : `Amount approved each month${money ? `, in ${money}` : ''}`}
        action={
          <div className="flex rounded-full border border-line p-0.5 text-xs font-semibold" role="group" aria-label="Chart view">
            {(['requests', 'spending'] as const).map((view) => (
              <button key={view} type="button" onClick={() => setTrendView(view)} aria-pressed={trendView === view} className={`rounded-full px-2.5 py-1 capitalize ${trendView === view ? 'bg-pine text-cream' : 'text-slate-500 hover:text-pine'}`}>{view}</button>
            ))}
          </div>
        }
      >
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={ink.grid} vertical={false} />
              <XAxis dataKey="label" {...axis} />
              {trendView === 'requests' ? (
                <>
                  <YAxis allowDecimals={false} width={32} {...axis} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend verticalAlign="top" align="center" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: ink.secondary, paddingBottom: 8 }} />
                  <Line type="monotone" dataKey="submitted" name="Submitted" stroke={palette.pine} strokeWidth={2.5} dot={{ r: 3.5, fill: '#fff', strokeWidth: 2 }} />
                  <Line type="monotone" dataKey="approved" name="Approved" stroke={status.approved} strokeWidth={2.5} dot={{ r: 3.5, fill: '#fff', strokeWidth: 2 }} />
                </>
              ) : (
                <>
                  <YAxis width={48} tickFormatter={compact} {...axis} />
                  <Tooltip content={<ChartTooltip money={money} />} />
                  <Legend verticalAlign="top" align="center" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: ink.secondary, paddingBottom: 8 }} />
                  <Line type="monotone" dataKey="approvedAmount" name="Approved amount" stroke={palette.pine} strokeWidth={2.5} dot={{ r: 3.5, fill: '#fff', strokeWidth: 2 }} />
                </>
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel>
    ) });
  }
  if (headcount.length) {
    const top = headcount.slice(0, 6);
    const max = top[0].headcount;
    charts.push({ key: 'departments', node: (span) => (
      <Panel key="departments" className={span} title="Staff by department" note={`${full(totalHeadcount)} employees across ${headcount.length} departments`} action={<ViewAll to="/hr/reports" show={canOpen('/hr/reports')} />}>
        <ul className="grid gap-3">
          {top.map((row) => (
            <li key={row.department} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-3 text-sm">
              <span className="truncate text-slate-600" title={row.department}>{row.department}</span>
              <span className="h-2.5 overflow-hidden rounded-full bg-canvas">
                <span className="block h-full rounded-full bg-pine" style={{ width: `${Math.max(4, (row.headcount / max) * 100)}%` }} />
              </span>
              <span className="w-14 text-right font-semibold tabular-nums text-ink">{row.headcount} <span className="text-xs font-normal text-slate-500">{Math.round((row.headcount / totalHeadcount) * 100)}%</span></span>
            </li>
          ))}
        </ul>
        {headcount.length > top.length ? <p className="mt-3 text-xs text-slate-500">+{headcount.length - top.length} more departments</p> : null}
      </Panel>
    ) });
  }
  if (ring) {
    charts.push({ key: 'ring', node: (span) => (
      <Panel key="ring" className={span} title={ring.title} note={ring.note}>
        <div className="relative mx-auto h-44 w-44">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={ring.legend} dataKey="value" nameKey="label" innerRadius="72%" outerRadius="100%" startAngle={90} endAngle={-270} stroke="none" isAnimationActive={false}>
                {ring.legend.map((slice) => <Cell key={slice.label} fill={slice.color} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div>
              <div className="text-3xl font-bold tabular-nums text-ink">{ring.value}%</div>
              <div className="text-xs text-slate-500">{ring.caption}</div>
            </div>
          </div>
        </div>
        <ul className="mt-4 grid gap-1.5 text-sm">
          {ring.legend.map((slice) => (
            <li key={slice.label} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: slice.color }} />
              <span className="text-slate-600">{slice.label}</span>
              <span className="ml-auto font-semibold tabular-nums">{full(slice.value)}</span>
            </li>
          ))}
        </ul>
      </Panel>
    ) });
  }

  const pending = (inbox.data?.data ?? []).slice(0, 4);
  const activity = (notes.data?.data ?? []).slice(0, 5);
  const lists: ReactNode[] = [];
  if (data?.approvals) {
    lists.push(
      <Panel key="pending" title="Pending approvals" note={`${data.approvals.inbox} waiting for your decision`} action={<ViewAll to="/approvals" show={canOpen('/approvals')} />}>
        {pending.length === 0 ? (
          <AllClear text={inbox.isLoading ? 'Loading…' : 'Nothing is waiting for you.'} />
        ) : (
          <ul className="-mx-2 grid">
            {pending.map((request, index) => (
              <li key={request.id}>
                <Link to={`/approvals/${request.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-canvas">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${tileTones[index % tileTones.length]}`}><ListChecks size={16} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{request.title}</span>
                    <span className="block truncate text-xs text-slate-500">{request.workflowName} · {request.requester}</span>
                  </span>
                  {request.amount != null ? <span className="shrink-0 text-xs font-semibold tabular-nums text-pine">{request.currencyCode} {compact(request.amount)}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>,
    );
  }
  lists.push(
    <Panel key="activity" title="Recent activity" note="Your latest notifications">
      {activity.length === 0 ? <AllClear text={notes.isLoading ? 'Loading…' : 'No recent activity.'} /> : (
        <ul className="-mx-2 grid">
          {activity.map((note) => {
            const target = notificationTarget(note);
            const row = (
              <>
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${note.isRead ? 'bg-canvas text-olive' : 'bg-pine text-cream'}`}><Bell size={15} /></span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm ${note.isRead ? 'text-slate-600' : 'font-semibold text-ink'}`}>{note.title}</span>
                  <span className="block text-xs text-slate-400">{timeAgo(note.createdAt)}</span>
                </span>
              </>
            );
            return (
              <li key={note.id}>
                {target && canOpen(target)
                  ? <Link to={target} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-canvas">{row}</Link>
                  : <div className="flex items-center gap-3 px-2 py-2">{row}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>,
  );
  lists.push(
    <Panel key="attention" title="Needs attention" note="Work waiting on you or your teams">
      {attention.length === 0 ? <AllClear text="All clear. Nothing is waiting." /> : (
        <ul className="-mx-2 grid">
          {attention.slice(0, 7).map((item) => {
            const row = (
              <>
                <span className={`h-2 w-2 shrink-0 rounded-full ${item.tone === 'urgent' ? 'bg-[#d03b3b]' : 'bg-[#fab219]'}`} aria-hidden="true" />
                <span className="text-sm text-ink">{item.label}</span>
                <span className="ml-auto rounded-full bg-cream px-2 py-0.5 text-xs font-semibold tabular-nums text-pine ring-1 ring-khaki">{item.value}</span>
              </>
            );
            return (
              <li key={item.label}>
                {canOpen(item.to)
                  ? <Link to={item.to} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-canvas">{row}</Link>
                  : <div className="flex items-center gap-3 px-2 py-2">{row}</div>}
              </li>
            );
          })}
        </ul>
      )}
      {attention.length ? (
        <p className="mt-auto flex flex-wrap items-center gap-3 pt-3 text-xs text-slate-500">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#d03b3b]" /> Needs your decision</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#fab219]" /> In progress with a team</span>
        </p>
      ) : null}
    </Panel>,
  );

  const linkClass = 'transition hover:-translate-y-0.5 hover:border-pine/40 hover:shadow-[0_10px_28px_rgba(62,60,40,0.12)] focus:outline-none focus-visible:ring-2 focus-visible:ring-pine';

  return (
    <section className="mx-auto grid max-w-[1600px] gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{copy.title}</h1>
          <p className="mt-0.5 text-sm font-medium text-pine">{copy.tagline}</p>
        </div>
        <p className="text-sm text-slate-500">{greeting()}{user?.employeeName || user?.username ? `, ${(user?.employeeName || user?.username || '').split(' ')[0]}` : ''} · {today()}</p>
      </header>

      {summary.isLoading ? <p className="text-sm text-slate-500">Loading company figures…</p> : null}
      {summary.isError ? <p className="text-sm text-[#8d2f2f]">The dashboard could not be loaded.</p> : null}

      {shown.length ? (
        <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${['xl:grid-cols-1', 'xl:grid-cols-2', 'xl:grid-cols-3', 'xl:grid-cols-4'][Math.min(shown.length, 4) - 1]}`}>
          {shown.map((kpi, index) => {
            const body = (
              <>
                <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${tileTones[index % tileTones.length]}`}>
                  <kpi.icon size={22} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-slate-500">{kpi.label}</span>
                  <span className="mt-0.5 block text-2xl font-bold tracking-tight text-ink tabular-nums">{kpi.value}</span>
                  <span className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                    {kpi.trend ? (
                      <span className={`inline-flex items-center font-semibold ${kpi.trend.up === kpi.trend.good ? 'text-[#0a7d0a]' : 'text-[#b02f2f]'}`}>
                        {kpi.trend.up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{kpi.trend.text}
                      </span>
                    ) : null}
                    <span className="truncate">{kpi.note}</span>
                  </span>
                </span>
              </>
            );
            const base = 'flex items-center gap-4 rounded-xl border border-line bg-white p-4 shadow-card';
            return canOpen(kpi.to)
              ? <Link key={kpi.key} to={kpi.to} className={`${base} ${linkClass}`}>{body}</Link>
              : <article key={kpi.key} className={base}>{body}</article>;
          })}
        </div>
      ) : null}

      {charts.length ? (
        <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-12">
          {charts.map((chart, index) => chart.node(`${spans[charts.length][index]} ${charts.length === 3 && index === 0 ? 'lg:col-span-2 xl:col-span-5' : ''} ${charts.length === 1 ? 'lg:col-span-2' : ''}`))}
        </div>
      ) : null}

      <div className={columns[lists.length]}>{lists}</div>

      <div className="relative overflow-hidden rounded-xl bg-gradient-to-r from-navy via-pine to-pine px-5 py-5 text-cream shadow-card sm:px-7">
        <img src="/brand/bajogo-logo-panel.jpg" alt="" className="pointer-events-none absolute inset-y-0 right-0 hidden h-full w-[42%] object-cover opacity-50 [mask-image:linear-gradient(to_right,transparent,black_45%)] md:block" />
        <div className="relative flex flex-wrap items-center gap-4">
          <img src="/brand/bajogo-mark.png" alt="" className="h-12 w-12 rounded-full object-cover ring-2 ring-khaki/60" />
          <div className="min-w-0 flex-1">
            <div className="text-lg font-bold">{copy.banner}</div>
            <div className="text-sm text-khaki">{copy.bannerNote}</div>
          </div>
          {canOpen('/reports') ? (
            <Link to="/reports" className="relative inline-flex items-center gap-1.5 rounded-full bg-cream px-4 py-2 text-sm font-semibold text-navy hover:bg-khaki">
              Full reports <ArrowRight size={15} />
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function AllClear({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-canvas px-3 py-3 text-sm text-pine">
      <CheckCircle2 size={16} /> {text}
    </div>
  );
}
