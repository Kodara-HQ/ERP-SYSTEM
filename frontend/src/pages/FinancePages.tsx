import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ReportDownloads } from '../components/ReportDownloads';
import { Badge, Button, controlClass, ErrorText, Field, PageHeader } from '../components/ui';

function message(error: unknown): string {
  return error instanceof ApiError ? error.message : 'The request failed.';
}

interface Account { id: number; code: string; name: string; accountType: string; status: string }
interface Cash { id: number; code: string; name: string; kind: string; status: string }
interface Journal { id: number; referenceNumber: string; journalDate: string; description: string; debit: number; sourceType: string | null }
interface Payment { id: number; referenceNumber: string; payee: string; purpose: string; amount: number; status: string; approvalRequestId: number | null }
interface Budget { id: number; referenceNumber: string; budgetYear: number; amount: number; purpose: string; status: string; approvalRequestId: number | null }
interface FinanceReport {
  profitAndLoss: { income: number; expense: number; net: number };
  balanceSheet: { assets: number; liabilities: number; equity: number; currentEarnings: number };
  payables: Array<{ name: string; invoiceNumber: string; outstanding: number }>;
  receivables: Array<{ name: string; referenceNumber: string; outstanding: number }>;
  budgets: Array<{ department: string; account: string; amount: number; actual: number }>;
  departmentalExpenditure: Array<{ department: string; amount: number }>;
}

function useList<T>(key: string, path: string) {
  return useQuery({ queryKey: [key], queryFn: () => api<{ data: T }>(path) });
}

export function LedgerPage() {
  const { can } = useAuth();
  const client = useQueryClient();
  const accounts = useList<Account[]>('ledger-accounts', '/v1/finance/accounts');
  const journals = useList<Journal[]>('journals', '/v1/finance/journals');
  const [date, setDate] = useState('');
  const [description, setDescription] = useState('');
  const [debitAccount, setDebitAccount] = useState('');
  const [creditAccount, setCreditAccount] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const active = (accounts.data?.data ?? []).filter((row) => row.status === 'active');
  const post = useMutation({
    mutationFn: () => api('/v1/finance/journals', {
      method: 'POST',
      body: JSON.stringify({
        journalDate: date,
        description,
        lines: [
          { accountId: Number(debitAccount), debit: Number(amount), credit: 0 },
          { accountId: Number(creditAccount), debit: 0, credit: Number(amount) },
        ],
      }),
    }),
    onSuccess: async () => {
      setDescription('');
      setAmount('');
      setError('');
      await client.invalidateQueries({ queryKey: ['journals'] });
    },
    onError: (reason) => setError(message(reason)),
  });
  return (
    <section>
      <PageHeader title="Ledger" description="Every journal must balance. A posted amount stays in the books. A correction is a reversing journal, not an edit." />
      {can('finance.manage') ? (
        <form className="mb-6 grid gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); post.mutate(); }}>
          <Field label="Date"><input className={controlClass} type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
          <Field label="Amount"><input className={controlClass} value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
          <Field label="Debit account">
            <select className={controlClass} value={debitAccount} onChange={(event) => setDebitAccount(event.target.value)}>
              <option value="">Choose</option>
              {active.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}
            </select>
          </Field>
          <Field label="Credit account">
            <select className={controlClass} value={creditAccount} onChange={(event) => setCreditAccount(event.target.value)}>
              <option value="">Choose</option>
              {active.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}
            </select>
          </Field>
          <Field label="Description"><input className={controlClass} value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
          <div className="flex items-end"><Button type="submit" disabled={post.isPending}>Post journal</Button></div>
          {error ? <div className="sm:col-span-2"><ErrorText>{error}</ErrorText></div> : null}
        </form>
      ) : null}
      <h2 className="mb-2 font-semibold">Chart of accounts</h2>
      <div className="mb-6 grid gap-2">
        {(accounts.data?.data ?? []).map((row) => (
          <article key={row.id} className="flex items-center justify-between rounded-lg border border-line bg-white px-4 py-3 text-sm">
            <span>{row.code} · {row.name}</span>
            <Badge value={row.accountType} />
          </article>
        ))}
      </div>
      <h2 className="mb-2 font-semibold">Journals</h2>
      <div className="grid gap-2">
        {(journals.data?.data ?? []).map((row) => (
          <article key={row.id} className="rounded-lg border border-line bg-white px-4 py-3 text-sm">
            {row.referenceNumber} · {row.journalDate} · {row.description} · {row.debit.toFixed(2)}
          </article>
        ))}
        {journals.data?.data.length === 0 ? <p className="text-sm text-slate-500">No journals yet.</p> : null}
      </div>
    </section>
  );
}

export function PaymentsPage() {
  const { can } = useAuth();
  const client = useQueryClient();
  const payments = useList<Payment[]>('payments', '/v1/finance/payments');
  const accounts = useList<Account[]>('ledger-accounts', '/v1/finance/accounts');
  const cash = useList<Cash[]>('cash-accounts', '/v1/finance/cash');
  const [payee, setPayee] = useState('');
  const [purpose, setPurpose] = useState('');
  const [amount, setAmount] = useState('');
  const [expenseAccountId, setExpenseAccountId] = useState('');
  const [cashAccountId, setCashAccountId] = useState('');
  const [error, setError] = useState('');
  const expenses = (accounts.data?.data ?? []).filter((row) => row.accountType === 'expense' && row.status === 'active');
  const books = (cash.data?.data ?? []).filter((row) => row.status === 'active');
  const submit = useMutation({
    mutationFn: () => api('/v1/finance/payments', {
      method: 'POST',
      body: JSON.stringify({ payee, purpose, amount: Number(amount), expenseAccountId: Number(expenseAccountId), cashAccountId: Number(cashAccountId) }),
    }),
    onSuccess: async () => {
      setPurpose('');
      setError('');
      await client.invalidateQueries({ queryKey: ['payments'] });
    },
    onError: (reason) => setError(message(reason)),
  });
  const pay = useMutation({
    mutationFn: (id: number) => api(`/v1/finance/payments/${id}/pay`, { method: 'POST' }),
    onSuccess: async () => {
      setError('');
      await client.invalidateQueries({ queryKey: ['payments'] });
      await client.invalidateQueries({ queryKey: ['journals'] });
    },
    onError: (reason) => setError(message(reason)),
  });
  return (
    <section>
      <PageHeader title="Payments" description="A payment follows the payment route: the department manager, accounts verification, then the CEO. Accounts posts the journal only after that approval." />
      {error ? <div className="mb-4"><ErrorText>{error}</ErrorText></div> : null}
      {can('finance.request') || can('finance.manage') ? (
        <form className="mb-6 grid gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); submit.mutate(); }}>
          <Field label="Payee"><input className={controlClass} value={payee} onChange={(event) => setPayee(event.target.value)} /></Field>
          <Field label="Amount"><input className={controlClass} value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
          <Field label="Expense account">
            <select className={controlClass} value={expenseAccountId} onChange={(event) => setExpenseAccountId(event.target.value)}>
              <option value="">Choose</option>
              {expenses.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}
            </select>
          </Field>
          <Field label="Pay from">
            <select className={controlClass} value={cashAccountId} onChange={(event) => setCashAccountId(event.target.value)}>
              <option value="">Choose</option>
              {books.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}
            </select>
          </Field>
          <Field label="Purpose"><input className={controlClass} value={purpose} onChange={(event) => setPurpose(event.target.value)} /></Field>
          <div className="flex items-end"><Button type="submit" disabled={submit.isPending}>Submit payment</Button></div>
        </form>
      ) : null}
      <div className="grid gap-3">
        {(payments.data?.data ?? []).map((row) => (
          <article key={row.id} className="rounded-lg border border-line bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{row.referenceNumber}</span>
              <Badge value={row.status} />
              <span className="text-sm text-slate-500">{row.payee} · {row.amount.toFixed(2)}</span>
              {row.approvalRequestId ? <Link className="text-sm text-pine" to={`/approvals/${row.approvalRequestId}`}>Approval</Link> : null}
              {can('finance.manage') && row.status === 'approved' ? <button className="text-sm text-pine" type="button" onClick={() => pay.mutate(row.id)}>Post payment</button> : null}
            </div>
            <p className="mt-2 text-sm">{row.purpose}</p>
          </article>
        ))}
        {payments.data?.data.length === 0 ? <p className="text-sm text-slate-500">No payment requests yet.</p> : null}
      </div>
    </section>
  );
}

export function BudgetsPage() {
  const client = useQueryClient();
  const budgets = useList<Budget[]>('budgets', '/v1/finance/budgets');
  const accounts = useList<Account[]>('ledger-accounts', '/v1/finance/accounts');
  const departments = useQuery({ queryKey: ['departments'], queryFn: () => api<{ data: Array<{ id: number; name: string }> }>('/v1/organisation/departments?pageSize=200') });
  const [departmentId, setDepartmentId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [amount, setAmount] = useState('');
  const [purpose, setPurpose] = useState('');
  const [error, setError] = useState('');
  const submit = useMutation({
    mutationFn: () => api('/v1/finance/budgets', {
      method: 'POST',
      body: JSON.stringify({ departmentId: Number(departmentId), ledgerAccountId: Number(accountId), budgetYear: Number(year), amount: Number(amount), purpose }),
    }),
    onSuccess: async () => {
      setPurpose('');
      setError('');
      await client.invalidateQueries({ queryKey: ['budgets'] });
    },
    onError: (reason) => setError(message(reason)),
  });
  return (
    <section>
      <PageHeader title="Budgets" description="A department budget is verified by accounts and approved by the CEO. The report compares the approved amount with the expense posted to that account." />
      <form className="mb-6 grid gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); submit.mutate(); }}>
        <Field label="Department">
          <select className={controlClass} value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
            <option value="">Choose</option>
            {(departments.data?.data ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </Field>
        <Field label="Expense account">
          <select className={controlClass} value={accountId} onChange={(event) => setAccountId(event.target.value)}>
            <option value="">Choose</option>
            {(accounts.data?.data ?? []).filter((row) => row.accountType === 'expense').map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}
          </select>
        </Field>
        <Field label="Year"><input className={controlClass} value={year} onChange={(event) => setYear(event.target.value)} /></Field>
        <Field label="Amount"><input className={controlClass} value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
        <Field label="Purpose"><input className={controlClass} value={purpose} onChange={(event) => setPurpose(event.target.value)} /></Field>
        <div className="flex items-end"><Button type="submit" disabled={submit.isPending}>Submit budget</Button></div>
        {error ? <div className="sm:col-span-2"><ErrorText>{error}</ErrorText></div> : null}
      </form>
      <div className="grid gap-2">
        {(budgets.data?.data ?? []).map((row) => (
          <article key={row.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-white px-4 py-3 text-sm">
            <span className="font-semibold">{row.referenceNumber}</span>
            <Badge value={row.status} />
            <span>{row.budgetYear} · {row.amount.toFixed(2)} · {row.purpose}</span>
            {row.approvalRequestId ? <Link className="text-pine" to={`/approvals/${row.approvalRequestId}`}>Approval</Link> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

export function FinanceReportsPage() {
  const [mode, setMode] = useState('dates');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [quarter, setQuarter] = useState('1');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const params = new URLSearchParams();
  if (mode === 'quarter') {
    params.set('year', year);
    params.set('quarter', quarter);
  } else if (mode === 'year') params.set('year', year);
  else if (mode === 'financial') params.set('financialYear', year);
  else {
    if (from) params.set('from', from);
    if (to) params.set('to', to);
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const report = useQuery({ queryKey: ['finance-report', suffix], queryFn: () => api<{ data: FinanceReport }>(`/v1/finance/reports${suffix}`) });
  const data = report.data?.data;
  return (
    <section>
      <PageHeader title="Financial reports" description="Profit and loss is the period. The balance sheet is the position at the end of that period, with current earnings kept separate from equity so the books still balance. The financial year runs January to December." action={<ReportDownloads base={`/api/v1/finance/reports${suffix}`} />} />
      <div className="mb-4 flex flex-wrap gap-3">
        <Field label="Period">
          <select className={controlClass} value={mode} onChange={(event) => setMode(event.target.value)}>
            <option value="dates">Custom dates</option>
            <option value="quarter">Quarter</option>
            <option value="year">Calendar year</option>
            <option value="financial">Financial year</option>
          </select>
        </Field>
        {mode === 'dates' ? (
          <>
            <Field label="From"><input className={controlClass} type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></Field>
            <Field label="To"><input className={controlClass} type="date" value={to} onChange={(event) => setTo(event.target.value)} /></Field>
          </>
        ) : (
          <Field label="Year"><input className={controlClass} value={year} onChange={(event) => setYear(event.target.value)} /></Field>
        )}
        {mode === 'quarter' ? (
          <Field label="Quarter">
            <select className={controlClass} value={quarter} onChange={(event) => setQuarter(event.target.value)}>
              <option value="1">Q1</option>
              <option value="2">Q2</option>
              <option value="3">Q3</option>
              <option value="4">Q4</option>
            </select>
          </Field>
        ) : null}
      </div>
      {report.isError ? <ErrorText>{message(report.error)}</ErrorText> : null}
      {data ? (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <article className="rounded-lg border border-line bg-white px-4 py-4"><div className="text-sm text-slate-500">Income</div><div className="mt-1 text-2xl font-semibold">{data.profitAndLoss.income.toFixed(2)}</div></article>
            <article className="rounded-lg border border-line bg-white px-4 py-4"><div className="text-sm text-slate-500">Expense</div><div className="mt-1 text-2xl font-semibold">{data.profitAndLoss.expense.toFixed(2)}</div></article>
            <article className="rounded-lg border border-line bg-white px-4 py-4"><div className="text-sm text-slate-500">Net</div><div className="mt-1 text-2xl font-semibold">{data.profitAndLoss.net.toFixed(2)}</div></article>
          </div>
          <h2 className="mb-2 font-semibold">Departmental expenditure</h2>
          <div className="mb-4 grid gap-2">
            {data.departmentalExpenditure.map((row) => <article key={row.department} className="rounded-lg border border-line bg-white px-4 py-3 text-sm">{row.department} · {row.amount.toFixed(2)}</article>)}
            {data.departmentalExpenditure.length === 0 ? <p className="text-sm text-slate-500">No departmental expense in this period.</p> : null}
          </div>
          <h2 className="mb-2 font-semibold">Payables</h2>
          <div className="mb-4 grid gap-2">
            {data.payables.map((row) => <article key={row.invoiceNumber} className="rounded-lg border border-line bg-white px-4 py-3 text-sm">{row.name} · {row.invoiceNumber} · {row.outstanding.toFixed(2)}</article>)}
            {data.payables.length === 0 ? <p className="text-sm text-slate-500">No open supplier balances.</p> : null}
          </div>
          <h2 className="mb-2 font-semibold">Receivables</h2>
          <div className="grid gap-2">
            {data.receivables.map((row) => <article key={row.referenceNumber} className="rounded-lg border border-line bg-white px-4 py-3 text-sm">{row.name} · {row.referenceNumber} · {row.outstanding.toFixed(2)}</article>)}
            {data.receivables.length === 0 ? <p className="text-sm text-slate-500">No open customer balances.</p> : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
