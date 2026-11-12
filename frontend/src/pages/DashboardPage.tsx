import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../lib/api';
import { PageHeader } from '../components/ui';

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
  const cards = [
    data?.employees ? ['Active employees', data.employees.active] : null,
    data?.employees ? ['On probation', data.employees.probation] : null,
    data?.departments != null ? ['Departments', data.departments] : null,
    data?.branches != null ? ['Branches', data.branches] : null,
    data?.positions != null ? ['Positions', data.positions] : null,
    data?.users ? ['Active accounts', data.users.active] : null,
    data?.users ? ['Locked accounts', data.users.locked] : null,
    data?.pendingChangeRequests != null ? ['Changes awaiting implementation', data.pendingChangeRequests] : null,
    data?.approvals ? ['My open requests', data.approvals.mine] : null,
    data?.approvals ? ['Approvals waiting for me', data.approvals.inbox] : null,
    data?.hr ? ['On leave today', data.hr.onLeaveToday] : null,
    data?.hr ? ['Open vacancies', data.hr.openVacancies] : null,
    data?.hr ? ['Leave awaiting approval', data.hr.pendingLeave] : null,
    data?.myLeave != null ? ['My open leave', data.myLeave] : null,
    data?.procurement ? ['Requisitions awaiting approval', data.procurement.pendingRequisitions] : null,
    data?.procurement ? ['Open purchase orders', data.procurement.openOrders] : null,
    data?.inventory ? ['Items at reorder', data.inventory.belowReorder] : null,
    data?.finance ? ['Payments awaiting approval', data.finance.pendingPayments] : null,
    data?.finance ? ['Open payables', data.finance.openPayables] : null,
    data?.finance ? ['Open receivables', data.finance.openReceivables] : null,
    data?.payroll ? ['Payroll with accounts', data.payroll.withAccounts] : null,
    data?.payroll ? ['Payroll awaiting CEO', data.payroll.withCeo] : null,
    data?.payroll ? ['Payroll awaiting payment', data.payroll.awaitingPayment] : null,
    data?.payroll ? ['Failed salary payments', data.payroll.failedPayments] : null,
    data?.legal ? ['Legal reviews pending', data.legal.pendingReviews] : null,
    data?.legal ? ['Documents expiring', data.legal.expiring] : null,
    data?.operations ? ['Open operational tasks', data.operations.openTasks] : null,
    data?.operations ? ['Open operational issues', data.operations.openIssues] : null,
    data?.operations ? ['Issues escalated to CEO', data.operations.escalatedIssues] : null,
    data?.executive ? ['Department checks open', data.executive.openReviews] : null,
    data?.executive ? ['Corrective actions open', data.executive.openActions] : null,
    data?.executive ? ['Reports awaiting CEO', data.executive.pendingReports] : null,
  ].filter((card): card is [string, number] => card !== null);

  return (
    <section>
      <PageHeader title="Dashboard" description="Figures come from the company database and only include areas your account is allowed to see." />
      {summary.isLoading ? <p className="text-sm text-slate-500">Loading company figures…</p> : null}
      {summary.isError ? <p className="text-sm text-[#8d2f2f]">The dashboard could not be loaded.</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([label, value]) => (
          <article key={label} className="rounded-lg border border-line bg-white px-4 py-4 shadow-card">
            <div className="text-sm text-slate-500">{label}</div>
            <div className="mt-2 text-3xl font-semibold tracking-tight">{value}</div>
          </article>
        ))}
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
