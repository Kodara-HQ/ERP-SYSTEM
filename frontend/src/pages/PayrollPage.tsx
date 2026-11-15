import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ReportDownloads } from '../components/ReportDownloads';
import { Badge, Button, controlClass, ErrorText, Field, PageHeader } from '../components/ui';

function message(error: unknown) {
  return error instanceof ApiError ? error.message : 'The request failed.';
}

interface Run {
  id: number;
  referenceNumber: string;
  periodYear: number;
  periodMonth: number;
  status: string;
  employeeCount: number;
  totalNet: number;
  approvalRequestId: number | null;
}

interface SalarySms {
  status: 'queued' | 'sent' | 'failed' | 'skipped';
  recipient: string | null;
  error: string | null;
}

const smsLabels: Record<SalarySms['status'], { text: string; className: string }> = {
  queued: { text: 'SMS sending', className: 'text-slate-500' },
  sent: { text: 'SMS sent', className: 'text-pine' },
  failed: { text: 'SMS failed', className: 'text-[#8d2f2f]' },
  skipped: { text: 'No SMS', className: 'text-slate-500' },
};

interface Detail extends Run {
  lines: Array<{ id: number; employeeName: string; employeeNumber: string; department: string | null; basicSalary: number; allowances: number; deductions: number; netPay: number; sms: SalarySms | null }>;
  departments: Array<{ department: string; net: number }>;
  events: Array<{ id: number; action: string; toStatus: string; comment: string | null; actor: string }>;
  payments: Array<{ id: number; referenceNumber: string; lineId: number; status: string; amount: number; failureReason: string | null }>;
}

interface Salary {
  employeeId: number;
  employeeName: string;
  employeeNumber: string;
  department: string | null;
  basicSalary: number | null;
}

export function PayrollPage() {
  const { can } = useAuth();
  const client = useQueryClient();
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [employeeId, setEmployeeId] = useState('');
  const [basic, setBasic] = useState('');
  const [allowances, setAllowances] = useState('0');
  const [deductions, setDeductions] = useState('0');
  const [comment, setComment] = useState('');
  const [cashAccountId, setCashAccountId] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const runs = useQuery({ queryKey: ['payroll'], queryFn: () => api<{ data: Run[] }>('/v1/payroll') });
  const detail = useQuery({ queryKey: ['payroll', selected], enabled: selected != null, queryFn: () => api<{ data: Detail }>(`/v1/payroll/${selected}`) });
  const salaries = useQuery({ queryKey: ['payroll-salaries'], enabled: can('payroll.manage'), queryFn: () => api<{ data: Salary[] }>('/v1/payroll/compensation') });
  const cash = useQuery({ queryKey: ['cash'], enabled: can('payroll.pay'), queryFn: () => api<{ data: Array<{ id: number; code: string; name: string }> }>('/v1/finance/cash') });
  const refresh = () => client.invalidateQueries({ queryKey: ['payroll'] });
  const act = useMutation({
    mutationFn: async (task: () => Promise<unknown>) => task(),
    onSuccess: async () => { setError(''); await refresh(); },
    onError: (reason) => setError(message(reason)),
  });
  const row = detail.data?.data;

  return (
    <section>
      <PageHeader title="Payroll" description="HR prepares salaries, accounts verifies them, the CEO approves, and accounts pays. Paid amounts are posted to the ledger and are not edited afterwards." action={<ReportDownloads base="/api/v1/payroll/reports" />} />
      {error ? <div className="mb-4"><ErrorText>{error}</ErrorText></div> : null}
      {can('payroll.manage') ? (
        <form className="mb-4 grid gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-4" onSubmit={(event) => {
          event.preventDefault();
          act.mutate(() => api('/v1/payroll/compensation', { method: 'POST', body: JSON.stringify({ employeeId: Number(employeeId), effectiveFrom: new Date().toISOString().slice(0, 10), basicSalary: Number(basic), allowances: Number(allowances), deductions: Number(deductions) }) }));
        }}>
          <Field label="Employee">
            <select className={controlClass} value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
              <option value="">Choose</option>
              {(salaries.data?.data ?? []).map((person) => <option key={person.employeeId} value={person.employeeId}>{person.employeeNumber} · {person.employeeName}</option>)}
            </select>
          </Field>
          <Field label="Basic"><input className={controlClass} value={basic} onChange={(event) => setBasic(event.target.value)} /></Field>
          <Field label="Allowances"><input className={controlClass} value={allowances} onChange={(event) => setAllowances(event.target.value)} /></Field>
          <Field label="Deductions"><input className={controlClass} value={deductions} onChange={(event) => setDeductions(event.target.value)} /></Field>
          <div className="sm:col-span-4"><Button type="submit">Save salary</Button></div>
        </form>
      ) : null}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        {can('payroll.manage') ? (
          <>
            <Field label="Year"><input className={controlClass} value={year} onChange={(event) => setYear(event.target.value)} /></Field>
            <Field label="Month"><input className={controlClass} value={month} onChange={(event) => setMonth(event.target.value)} /></Field>
            <Button type="button" onClick={() => act.mutate(async () => { const created = await api<{ data: Run }>('/v1/payroll', { method: 'POST', body: JSON.stringify({ year: Number(year), month: Number(month) }) }); setSelected(created.data.id); })}>Prepare payroll</Button>
          </>
        ) : null}
      </div>
      <div className="grid gap-2">
        {(runs.data?.data ?? []).map((item) => (
          <button key={item.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-white px-4 py-3 text-left text-sm" type="button" onClick={() => setSelected(item.id)}>
            <span className="font-semibold">{item.referenceNumber}</span>
            <Badge value={item.status} />
            <span>{item.periodYear}-{String(item.periodMonth).padStart(2, '0')} · {item.employeeCount} employees · {item.totalNet.toFixed(2)}</span>
          </button>
        ))}
      </div>
      {row ? (
        <div className="mt-5 grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{row.referenceNumber}</h2>
            <Badge value={row.status} />
          </div>
          {row.departments.map((department) => <p key={department.department} className="text-sm">{department.department}: {department.net.toFixed(2)}</p>)}
          {row.lines.map((line) => (
            <article key={line.id} className="rounded-lg border border-line bg-white px-4 py-3 text-sm">
              {line.employeeNumber} · {line.employeeName} · {line.department ?? 'No department'} · basic {line.basicSalary.toFixed(2)} · allowances {line.allowances.toFixed(2)} · deductions {line.deductions.toFixed(2)} · net {line.netPay.toFixed(2)}
              {row.payments.filter((payment) => payment.lineId === line.id).map((payment) => <div key={payment.id}>{payment.referenceNumber} · {payment.status}{payment.failureReason ? ` · ${payment.failureReason}` : ''}</div>)}
              {line.sms ? (
                <div className={`mt-1 text-xs ${smsLabels[line.sms.status].className}`}>
                  {smsLabels[line.sms.status].text}
                  {line.sms.recipient ? ` to +${line.sms.recipient}` : ''}
                  {line.sms.error ? ` · ${line.sms.error}` : ''}
                </div>
              ) : null}
            </article>
          ))}
          <div className="flex flex-wrap gap-2">
            {can('payroll.submit') && row.status === 'draft' ? <Button type="button" onClick={() => act.mutate(() => api(`/v1/payroll/${row.id}/submit`, { method: 'POST' }))}>Submit to accounts</Button> : null}
            {can('payroll.submit') && row.status === 'returned_to_hr' ? <Button type="button" onClick={() => act.mutate(() => api(`/v1/payroll/${row.id}/resubmit`, { method: 'POST' }))}>Resubmit to accounts</Button> : null}
            {can('payroll.verify') && row.status === 'submitted_to_accounts' ? <Button type="button" onClick={() => act.mutate(() => api(`/v1/payroll/${row.id}/review`, { method: 'POST' }))}>Start accounts review</Button> : null}
            {can('payroll.verify') && row.status === 'under_accounts_review' ? <Button type="button" onClick={() => act.mutate(() => api(`/v1/payroll/${row.id}/forward`, { method: 'POST' }))}>Forward to CEO</Button> : null}
            {can('payroll.verify') && ['submitted_to_accounts', 'under_accounts_review'].includes(row.status) ? <Button type="button" variant="secondary" onClick={() => act.mutate(() => api(`/v1/payroll/${row.id}/return`, { method: 'POST', body: JSON.stringify({ comment }) }))}>Return to HR</Button> : null}
            {can('finance.approve_expenditure') && row.status === 'submitted_for_ceo' ? (
              <>
                <Button type="button" onClick={() => act.mutate(() => api(`/v1/payroll/${row.id}/decision`, { method: 'POST', body: JSON.stringify({ action: 'approve', comment }) }))}>Give final approval</Button>
                <Button type="button" variant="secondary" onClick={() => act.mutate(() => api(`/v1/payroll/${row.id}/decision`, { method: 'POST', body: JSON.stringify({ action: 'reject', comment }) }))}>Reject</Button>
                <Button type="button" variant="secondary" onClick={() => act.mutate(() => api(`/v1/payroll/${row.id}/decision`, { method: 'POST', body: JSON.stringify({ action: 'return', comment }) }))}>Return</Button>
              </>
            ) : null}
            {can('payroll.pay') && row.status === 'approved' ? <Button type="button" onClick={() => act.mutate(() => api(`/v1/payroll/${row.id}/release`, { method: 'POST' }))}>Release for payment</Button> : null}
            {can('payroll.pay') && row.status === 'paid' ? <Button type="button" onClick={() => act.mutate(() => api(`/v1/payroll/${row.id}/complete`, { method: 'POST' }))}>Mark completed</Button> : null}
            {can('payroll.pay') && row.lines.some((line) => line.sms?.status === 'failed') ? (
              <Button type="button" variant="secondary" onClick={() => act.mutate(() => api(`/v1/payroll/${row.id}/sms/resend`, { method: 'POST' }))}>Resend failed SMS</Button>
            ) : null}
          </div>
          {can('payroll.verify') || can('finance.approve_expenditure') ? (
            <Field label="Comment"><input className={controlClass} value={comment} onChange={(event) => setComment(event.target.value)} /></Field>
          ) : null}
          {can('payroll.pay') && ['ready_for_payment', 'partially_paid', 'payment_failed'].includes(row.status) ? (
            <form className="grid gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-3" onSubmit={(event) => {
              event.preventDefault();
              const unpaid = row.lines.filter((line) => !row.payments.some((payment) => payment.lineId === line.id && payment.status === 'paid')).map((line) => line.id);
              act.mutate(() => api(`/v1/payroll/${row.id}/payments`, { method: 'POST', body: JSON.stringify({ lineIds: unpaid, cashAccountId: Number(cashAccountId), paymentDate }) }));
            }}>
              <Field label="Cash account">
                <select className={controlClass} value={cashAccountId} onChange={(event) => setCashAccountId(event.target.value)}>
                  <option value="">Choose</option>
                  {(cash.data?.data ?? []).map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
                </select>
              </Field>
              <Field label="Payment date"><input className={controlClass} type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></Field>
              <div className="flex items-end"><Button type="submit">Pay remaining salaries</Button></div>
            </form>
          ) : null}
          <div className="text-sm text-slate-600">
            {row.events.map((event) => <p key={event.id}>{event.actor} · {event.action} · {event.toStatus}{event.comment ? ` · ${event.comment}` : ''}</p>)}
          </div>
        </div>
      ) : null}
    </section>
  );
}
