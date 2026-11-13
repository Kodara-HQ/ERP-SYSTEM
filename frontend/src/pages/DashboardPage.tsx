import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { canOpenPath } from '../lib/navigation';
import { PageHeader } from '../components/ui';

type Card = [label: string, value: number, to: string];

interface Summary {
  data: {
    employees?: { active: number; probation: number; exited: number };
    headcountByDepartment?: { department: string; headcount: number }[];
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
  };
}

export function DashboardPage() {
  const summary = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Summary>('/v1/dashboard/summary') });
  const data = summary.data?.data;
  const { user } = useAuth();
  const canOpen = (path: string) => canOpenPath(path, user?.permissions ?? [], user?.workspaces ?? []);
  const cards: Card[] = [
    data?.employees ? ['Active employees', data.employees.active, '/employees'] : null,
    data?.employees ? ['On probation', data.employees.probation, '/employees'] : null,
    data?.departments != null ? ['Departments', data.departments, '/organisation/departments'] : null,
    data?.branches != null ? ['Branches', data.branches, '/organisation/branches'] : null,
    data?.positions != null ? ['Positions', data.positions, '/organisation/positions'] : null,
    data?.users ? ['Active accounts', data.users.active, '/admin/users'] : null,
    data?.users ? ['Locked accounts', data.users.locked, '/admin/users'] : null,
    data?.pendingChangeRequests != null ? ['Changes awaiting implementation', data.pendingChangeRequests, '/organisation/changes'] : null,
    data?.approvals ? ['My open requests', data.approvals.mine, '/approvals'] : null,
    data?.approvals ? ['Approvals waiting for me', data.approvals.inbox, '/approvals'] : null,
    data?.hr ? ['On leave today', data.hr.onLeaveToday, '/hr'] : null,
    data?.hr ? ['Open vacancies', data.hr.openVacancies, '/hr/recruitment'] : null,
    data?.hr ? ['Leave awaiting approval', data.hr.pendingLeave, '/hr'] : null,
    data?.myLeave != null ? ['My open leave', data.myLeave, '/hr'] : null,
    data?.procurement ? ['Requisitions awaiting approval', data.procurement.pendingRequisitions, '/procurement'] : null,
    data?.procurement ? ['Open purchase orders', data.procurement.openOrders, '/procurement/orders'] : null,
    data?.inventory ? ['Items at reorder', data.inventory.belowReorder, '/inventory'] : null,
    data?.finance ? ['Payments awaiting approval', data.finance.pendingPayments, '/finance/payments'] : null,
    data?.finance ? ['Open payables', data.finance.openPayables, '/finance/reports'] : null,
    data?.finance ? ['Open receivables', data.finance.openReceivables, '/finance/reports'] : null,
    data?.payroll ? ['Payroll with accounts', data.payroll.withAccounts, '/payroll'] : null,
    data?.payroll ? ['Payroll awaiting CEO', data.payroll.withCeo, '/payroll'] : null,
    data?.payroll ? ['Payroll awaiting payment', data.payroll.awaitingPayment, '/payroll'] : null,
    data?.payroll ? ['Failed salary payments', data.payroll.failedPayments, '/payroll'] : null,
    data?.legal ? ['Legal reviews pending', data.legal.pendingReviews, '/legal'] : null,
    data?.legal ? ['Documents expiring', data.legal.expiring, '/legal'] : null,
    data?.operations ? ['Open operational tasks', data.operations.openTasks, '/operations'] : null,
    data?.operations ? ['Open operational issues', data.operations.openIssues, '/operations'] : null,
    data?.operations ? ['Issues escalated to CEO', data.operations.escalatedIssues, '/operations'] : null,
    data?.executive ? ['Department checks open', data.executive.openReviews, '/executive'] : null,
    data?.executive ? ['Corrective actions open', data.executive.openActions, '/executive'] : null,
    data?.executive ? ['Reports awaiting CEO', data.executive.pendingReports, '/executive'] : null,
  ].filter((card): card is Card => card !== null);

  return (
    <section>
      <PageHeader title="Dashboard" description="Figures come from the company database and only include areas your account is allowed to see." />
      {summary.isLoading ? <p className="text-sm text-slate-500">Loading company figures…</p> : null}
      {summary.isError ? <p className="text-sm text-[#8d2f2f]">The dashboard could not be loaded.</p> : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {cards.map(([label, value, to]) => {
          const body = (
            <>
              <div className="flex items-start justify-between gap-2">
                <div className="text-xs text-slate-500 sm:text-sm">{label}</div>
                {canOpen(to) ? <ArrowUpRight size={16} className="shrink-0 text-slate-300 transition-colors group-hover:text-pine" /> : null}
              </div>
              <div className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{value}</div>
            </>
          );
          const base = 'rounded-lg border border-line bg-white px-3 py-3 shadow-card sm:px-4 sm:py-4';
          return canOpen(to) ? (
            <Link
              key={label}
              to={to}
              className={`group ${base} transition hover:-translate-y-0.5 hover:border-pine/40 hover:shadow-[0_8px_24px_rgba(62,60,40,0.12)] focus:outline-none focus-visible:ring-2 focus-visible:ring-pine`}
            >
              {body}
            </Link>
          ) : (
            <article key={label} className={base}>{body}</article>
          );
        })}
      </div>
      {data?.headcountByDepartment && data.headcountByDepartment.length > 0 ? (
        <article className="mt-5 rounded-lg border border-line bg-white p-4 shadow-card">
          <h2 className="mb-4 text-base font-semibold">Primary assignments by department</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.headcountByDepartment}>
                <CartesianGrid stroke="#D9D7B6" vertical={false} />
                <XAxis dataKey="department" tick={{ fontSize: 12 }} interval={0} angle={-20} height={70} textAnchor="end" />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} label={{ value: 'Employees', angle: -90, position: 'insideLeft' }} />
                <Tooltip />
                <Bar dataKey="headcount" name="Employees" fill="#545233" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
      ) : null}
    </section>
  );
}
