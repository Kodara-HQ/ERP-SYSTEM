import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Button, controlClass, ErrorText, Field, PageHeader } from '../components/ui';

interface WorkflowOption {
  id: number;
  code: string;
  name: string;
  transactionKind: string;
}

interface RequestSummary {
  id: number;
  referenceNumber: string;
  workflowName: string;
  title: string;
  amount: number | null;
  currencyCode: string;
  status: string;
  requester: string;
  canDecide: boolean;
}

interface RequestDetail extends RequestSummary {
  details: string | null;
  departmentName: string | null;
  branchName: string | null;
  revision: number;
  steps: {
    id: number;
    stepOrder: number;
    parallelGroup: number | null;
    name: string;
    decisionKind: string;
    status: string;
    decidedBy: string | null;
    comment: string | null;
    decidedAt: string | null;
    isFinalBusinessStep: boolean;
  }[];
  actions: { id: number; action: string; comment: string | null; actor: string; createdAt: string }[];
}

function message(error: unknown): string {
  return error instanceof ApiError ? error.message : 'The request failed.';
}

export function ApprovalsPage() {
  const { can } = useAuth();
  const client = useQueryClient();
  const [queue, setQueue] = useState<'mine' | 'inbox'>('inbox');
  const [error, setError] = useState('');
  const form = useForm<{ workflowCode: string; title: string; details: string; amount: string }>();
  const workflows = useQuery({
    queryKey: ['approval-workflows'],
    queryFn: () => api<{ data: WorkflowOption[] }>('/v1/approvals/workflows'),
    enabled: can('approvals.submit') || can('approvals.view'),
  });
  const requests = useQuery({
    queryKey: ['approval-requests', queue],
    queryFn: () => api<{ data: RequestSummary[] }>(`/v1/approvals/requests?queue=${queue}&pageSize=50`),
  });
  const create = useMutation({
    mutationFn: (values: { workflowCode: string; title: string; details: string; amount: string }) => api('/v1/approvals/requests', {
      method: 'POST',
      body: JSON.stringify({
        workflowCode: values.workflowCode,
        title: values.title,
        details: values.details || null,
        amount: values.amount === '' ? null : Number(values.amount),
        submit: true,
      }),
    }),
    onSuccess: async () => {
      setError('');
      form.reset();
      await client.invalidateQueries({ queryKey: ['approval-requests'] });
      await client.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (reason) => setError(message(reason)),
  });

  return (
    <section>
      <PageHeader title="Approval requests" description="Accounts can verify a financial request. The CEO gives the final approval of company expenditure, and that approval is recorded with the time and the comment." />
      {error ? <div className="mb-4"><ErrorText>{error}</ErrorText></div> : null}
      {can('approvals.submit') ? (
        <form className="mb-5 grid gap-3 rounded-lg border border-line bg-white p-4 md:grid-cols-2" onSubmit={form.handleSubmit((values) => create.mutate(values))}>
          <Field label="Workflow">
            <select className={controlClass} {...form.register('workflowCode', { required: true })}>
              <option value="">Select</option>
              {workflows.data?.data.map((workflow) => <option key={workflow.id} value={workflow.code}>{workflow.name}</option>)}
            </select>
          </Field>
          <Field label="Amount"><input className={controlClass} type="number" min="0" step="0.01" {...form.register('amount')} /></Field>
          <Field label="Title"><input className={controlClass} {...form.register('title', { required: true, minLength: 3 })} /></Field>
          <Field label="Details"><input className={controlClass} {...form.register('details')} /></Field>
          <div className="md:col-span-2"><Button type="submit" disabled={create.isPending}>Submit request</Button></div>
        </form>
      ) : null}
      <div className="mb-3 flex gap-2">
        <Button variant={queue === 'inbox' ? 'primary' : 'secondary'} onClick={() => setQueue('inbox')} type="button">Waiting for me</Button>
        <Button variant={queue === 'mine' ? 'primary' : 'secondary'} onClick={() => setQueue('mine')} type="button">My requests</Button>
      </div>
      <div className="overflow-hidden rounded-lg border border-line bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-canvas text-xs uppercase tracking-wide text-slate-500">
            <tr>{['Reference', 'Request', 'Requester', 'Amount', 'Status'].map((header) => <th key={header} className="px-4 py-3">{header}</th>)}</tr>
          </thead>
          <tbody>
            {requests.data?.data.map((item) => (
              <tr key={item.id} className="border-t border-line">
                <td className="px-4 py-3 font-semibold"><Link className="text-pine" to={`/approvals/${item.id}`}>{item.referenceNumber}</Link></td>
                <td className="px-4 py-3">{item.title}<div className="text-xs text-slate-500">{item.workflowName}</div></td>
                <td className="px-4 py-3">{item.requester}</td>
                <td className="px-4 py-3">{item.amount == null ? '—' : `${item.currencyCode} ${item.amount.toLocaleString()}`}</td>
                <td className="px-4 py-3"><Badge value={item.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {requests.data && requests.data.data.length === 0 ? <div className="px-4 py-8 text-sm text-slate-500">No requests in this queue.</div> : null}
      </div>
      {can('approvals.delegate') ? <DelegationsPanel workflows={workflows.data?.data ?? []} /> : null}
    </section>
  );
}

interface Delegation {
  id: number;
  delegator: string;
  delegate: string;
  workflowCode: string | null;
  startsOn: string;
  endsOn: string;
  reason: string;
  status: string;
}

interface UserOption {
  id: number;
  username: string;
  employeeName: string | null;
  status: string;
}

function dateOnly(value: string): string {
  return String(value).slice(0, 10);
}

function DelegationsPanel({ workflows }: { workflows: WorkflowOption[] }) {
  const { can, user } = useAuth();
  const client = useQueryClient();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const today = new Date().toISOString().slice(0, 10);
  const form = useForm<{ delegateUserId: string; workflowId: string; startsOn: string; endsOn: string; reason: string }>({
    defaultValues: { startsOn: today, endsOn: today, workflowId: '', delegateUserId: '', reason: '' },
  });
  const delegations = useQuery({
    queryKey: ['approval-delegations'],
    queryFn: () => api<{ data: Delegation[] }>('/v1/approvals/delegations'),
  });
  const users = useQuery({
    queryKey: ['users', 'active-for-delegation'],
    queryFn: () => api<{ data: UserOption[] }>('/v1/users?status=active&pageSize=200'),
    enabled: can('users.view'),
  });
  const refresh = () => client.invalidateQueries({ queryKey: ['approval-delegations'] });
  const create = useMutation({
    mutationFn: (values: { delegateUserId: string; workflowId: string; startsOn: string; endsOn: string; reason: string }) => api('/v1/approvals/delegations', {
      method: 'POST',
      body: JSON.stringify({
        delegateUserId: Number(values.delegateUserId),
        workflowId: values.workflowId === '' ? null : Number(values.workflowId),
        startsOn: values.startsOn,
        endsOn: values.endsOn,
        reason: values.reason.trim(),
      }),
    }),
    onSuccess: async () => {
      setError('');
      setNotice('Delegation saved. The person you chose has been notified.');
      form.reset({ startsOn: today, endsOn: today, workflowId: '', delegateUserId: '', reason: '' });
      await refresh();
    },
    onError: (reason) => { setNotice(''); setError(message(reason)); },
  });
  const revoke = useMutation({
    mutationFn: (id: number) => api(`/v1/approvals/delegations/${id}/revoke`, { method: 'POST' }),
    onSuccess: async () => { setError(''); setNotice('Delegation revoked.'); await refresh(); },
    onError: (reason) => { setNotice(''); setError(message(reason)); },
  });
  const candidates = (users.data?.data ?? []).filter((row) => row.status === 'active' && row.id !== user?.id);
  const rows = delegations.data?.data ?? [];

  return (
    <div className="mt-8">
      <h2 className="mb-1 text-lg font-semibold">Delegate my approvals</h2>
      <p className="mb-3 text-sm text-slate-500">
        While you are away, the person you choose can decide the approval steps that are waiting for you, including final approval, for the dates you set. Every decision they make is recorded as made on your behalf. You can revoke a delegation at any time.
      </p>
      {error ? <div className="mb-3"><ErrorText>{error}</ErrorText></div> : null}
      {notice ? <div className="mb-3 text-sm text-pine">{notice}</div> : null}
      {can('users.view') ? (
        <form className="mb-4 grid gap-3 rounded-lg border border-line bg-white p-4 md:grid-cols-2" onSubmit={form.handleSubmit((values) => create.mutate(values))}>
          <Field label="Act on my behalf">
            <select className={controlClass} {...form.register('delegateUserId', { required: true })}>
              <option value="">Select a person</option>
              {candidates.map((row) => <option key={row.id} value={row.id}>{row.employeeName ? `${row.employeeName} (${row.username})` : row.username}</option>)}
            </select>
          </Field>
          <Field label="Approval route">
            <select className={controlClass} {...form.register('workflowId')}>
              <option value="">All routes</option>
              {workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}
            </select>
          </Field>
          <Field label="From"><input className={controlClass} type="date" {...form.register('startsOn', { required: true })} /></Field>
          <Field label="Until (inclusive)"><input className={controlClass} type="date" {...form.register('endsOn', { required: true })} /></Field>
          <div className="md:col-span-2">
            <Field label="Reason" error={form.formState.errors.reason ? 'Give a reason of at least 8 characters.' : undefined}>
              <input className={controlClass} placeholder="e.g. Annual leave, travelling abroad" {...form.register('reason', { required: true, minLength: 8, validate: (value) => value.trim().length >= 8 })} />
            </Field>
          </div>
          <div className="md:col-span-2"><Button type="submit" disabled={create.isPending}>Save delegation</Button></div>
        </form>
      ) : (
        <p className="mb-4 text-sm text-slate-500">Ask a system administrator to set up a delegation for you.</p>
      )}
      <div className="overflow-hidden rounded-lg border border-line bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-canvas text-xs uppercase tracking-wide text-slate-500">
            <tr>{['From', 'To', 'Route', 'Dates', 'Reason', 'Status', ''].map((header) => <th key={header} className="px-4 py-3">{header}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-line">
                <td className="px-4 py-3">{row.delegator}</td>
                <td className="px-4 py-3">{row.delegate}</td>
                <td className="px-4 py-3">{row.workflowCode ?? 'All routes'}</td>
                <td className="px-4 py-3">{dateOnly(row.startsOn)} – {dateOnly(row.endsOn)}</td>
                <td className="px-4 py-3">{row.reason}</td>
                <td className="px-4 py-3"><Badge value={row.status} /></td>
                <td className="px-4 py-3">
                  {row.status === 'active' && (row.delegator === user?.username || can('approvals.configure')) ? (
                    <Button variant="secondary" type="button" disabled={revoke.isPending} onClick={() => revoke.mutate(row.id)}>Revoke</Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {delegations.data && rows.length === 0 ? <div className="px-4 py-8 text-sm text-slate-500">No delegations.</div> : null}
      </div>
    </div>
  );
}

export function ApprovalDetailPage() {
  const { id } = useParams();
  const { can, user } = useAuth();
  const client = useQueryClient();
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const request = useQuery({
    queryKey: ['approval-request', id],
    queryFn: () => api<{ data: RequestDetail }>(`/v1/approvals/requests/${id}`),
  });
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['approval-request', id] });
    await client.invalidateQueries({ queryKey: ['approval-requests'] });
    await client.invalidateQueries({ queryKey: ['notifications'] });
    await client.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const act = useMutation({
    mutationFn: (action: { path: string; body?: unknown }) => api(`/v1/approvals/requests/${id}/${action.path}`, {
      method: 'POST',
      body: action.body ? JSON.stringify(action.body) : undefined,
    }),
    onSuccess: async () => {
      setError('');
      setComment('');
      await refresh();
    },
    onError: (reason) => setError(message(reason)),
  });
  const item = request.data?.data;
  const mine = item?.requester === user?.username;

  return (
    <section>
      <PageHeader title={item ? `${item.referenceNumber} · ${item.title}` : 'Approval request'} description="The route below is the one captured when the request was submitted. Later changes to the workflow do not rewrite this history." />
      {error ? <div className="mb-4"><ErrorText>{error}</ErrorText></div> : null}
      {request.isLoading ? <p className="text-sm text-slate-500">Loading request…</p> : null}
      {item ? (
        <div className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
          <article className="rounded-lg border border-line bg-white p-4">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <Badge value={item.status} />
              <span className="text-sm text-slate-500">{item.workflowName}</span>
              {item.amount != null ? <span className="text-sm font-semibold">{item.currencyCode} {item.amount.toLocaleString()}</span> : null}
            </div>
            {item.details ? <p className="mb-4 text-sm text-slate-700">{item.details}</p> : null}
            <ol className="space-y-3">
              {item.steps.map((step) => (
                <li key={step.id} className="rounded-md border border-line px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold">{step.stepOrder}. {step.name}</div>
                      <div className="text-xs text-slate-500">{step.decisionKind}{step.parallelGroup ? ` · parallel group ${step.parallelGroup}` : ''}{step.isFinalBusinessStep ? ' · final business approval' : ''}</div>
                    </div>
                    <Badge value={step.status} />
                  </div>
                  {step.decidedBy ? <p className="mt-2 text-sm text-slate-600">{step.decidedBy}{step.comment ? ` — ${step.comment}` : ''}</p> : null}
                </li>
              ))}
            </ol>
          </article>
          <aside className="space-y-4">
            {item.canDecide && can('approvals.decide') ? (
              <form className="rounded-lg border border-line bg-white p-4" onSubmit={(event) => event.preventDefault()}>
                <Field label="Comment">
                  <textarea className={`${controlClass} h-24 py-2`} value={comment} onChange={(event) => setComment(event.target.value)} />
                </Field>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" disabled={act.isPending} onClick={() => act.mutate({ path: 'decision', body: { action: 'approve', comment } })}>
                    {item.steps.some((step) => step.status === 'pending' && step.isFinalBusinessStep) ? 'Give final approval' : item.steps.some((step) => step.status === 'pending' && step.decisionKind === 'verify') ? 'Verify' : 'Approve'}
                  </Button>
                  <Button type="button" variant="secondary" disabled={act.isPending} onClick={() => act.mutate({ path: 'decision', body: { action: 'return', comment } })}>Return</Button>
                  <Button type="button" variant="danger" disabled={act.isPending} onClick={() => act.mutate({ path: 'decision', body: { action: 'reject', comment } })}>Reject</Button>
                </div>
              </form>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {mine && item.status === 'returned_for_correction' ? <Button type="button" onClick={() => act.mutate({ path: 'resubmit' })}>Resubmit</Button> : null}
              {mine && ['draft', 'pending_review', 'under_approval', 'returned_for_correction'].includes(item.status) ? <Button variant="secondary" type="button" onClick={() => act.mutate({ path: 'cancel', body: { comment } })}>Cancel</Button> : null}
              {['pending_review', 'under_approval'].includes(item.status) ? <Button variant="secondary" type="button" onClick={() => act.mutate({ path: 'remind' })}>Send reminder</Button> : null}
              {can('approvals.process') && item.status === 'approved' ? <Button type="button" onClick={() => act.mutate({ path: 'process' })}>Start processing</Button> : null}
              {can('approvals.process') && item.status === 'processing' ? <Button type="button" onClick={() => act.mutate({ path: 'complete' })}>Mark completed</Button> : null}
            </div>
            <article className="rounded-lg border border-line bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">History</h2>
              <ul className="space-y-3">
                {item.actions.map((action) => (
                  <li key={action.id} className="text-sm">
                    <div className="font-semibold capitalize">{action.action} · {action.actor}</div>
                    <div className="text-xs text-slate-500">{action.createdAt?.replace('T', ' ').slice(0, 19)}</div>
                    {action.comment ? <div className="text-slate-700">{action.comment}</div> : null}
                  </li>
                ))}
              </ul>
            </article>
          </aside>
        </div>
      ) : null}
    </section>
  );
}
