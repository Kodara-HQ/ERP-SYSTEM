import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Button, controlClass, ErrorText, Field, PageHeader } from '../components/ui';

function message(error: unknown) {
  return error instanceof ApiError ? error.message : 'The request failed.';
}

const areas = ['daily', 'procurement', 'loading', 'farm', 'haulage', 'inventory', 'other'];

interface Overview {
  openTasks: number;
  openIssues: number;
  escalatedIssues: number;
  pendingRequisitions: number;
  openOrders: number;
  belowReorder: number;
  recentAreas: Array<{ area: string; total: number }>;
}

export function OperationsPage() {
  const { can } = useAuth();
  const client = useQueryClient();
  const [error, setError] = useState('');
  const [summary, setSummary] = useState('');
  const [area, setArea] = useState('daily');
  const [title, setTitle] = useState('');
  const overview = useQuery({ queryKey: ['operations'], queryFn: () => api<{ data: Overview }>('/v1/operations/overview') });
  const activities = useQuery({ queryKey: ['operations-activities'], queryFn: () => api<{ data: Array<{ id: number; referenceNumber: string; activityDate: string; area: string; summary: string }> }>('/v1/operations/activities') });
  const tasks = useQuery({ queryKey: ['operations-tasks'], queryFn: () => api<{ data: Array<{ id: number; referenceNumber: string; title: string; status: string; area: string }> }>('/v1/operations/tasks') });
  const issues = useQuery({ queryKey: ['operations-issues'], queryFn: () => api<{ data: Array<{ id: number; referenceNumber: string; title: string; status: string; severity: string; escalated: boolean }> }>('/v1/operations/issues') });
  const actions = useQuery({ queryKey: ['my-actions'], queryFn: () => api<{ data: Array<{ id: number; referenceNumber: string; title: string; status: string }> }>('/v1/executive/actions') });
  const save = useMutation({
    mutationFn: (task: { path: string; body: unknown }) => api(task.path, { method: 'POST', body: JSON.stringify(task.body) }),
    onSuccess: async () => {
      setError('');
      await client.invalidateQueries({ queryKey: ['operations'] });
      await client.invalidateQueries({ queryKey: ['operations-activities'] });
      await client.invalidateQueries({ queryKey: ['operations-tasks'] });
      await client.invalidateQueries({ queryKey: ['operations-issues'] });
      await client.invalidateQueries({ queryKey: ['my-actions'] });
    },
    onError: (reason) => setError(message(reason)),
  });
  const data = overview.data?.data;

  return (
    <section>
      <PageHeader title="Daily operations" description="The operations manager records the day's work across procurement, loading, farm, haulage, and stores, and escalates issues that need the CEO." />
      {error ? <div className="mb-4"><ErrorText>{error}</ErrorText></div> : null}
      {data ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          {[['Open tasks', data.openTasks], ['Open issues', data.openIssues], ['Escalated to CEO', data.escalatedIssues], ['Requisitions awaiting approval', data.pendingRequisitions], ['Open purchase orders', data.openOrders], ['Items at reorder', data.belowReorder]].map(([label, value]) => (
            <article key={String(label)} className="rounded-lg border border-line bg-white px-4 py-4"><div className="text-sm text-slate-500">{label}</div><div className="mt-1 text-2xl font-semibold">{value}</div></article>
          ))}
        </div>
      ) : null}
      <h2 className="mb-2 font-semibold">Last 7 days</h2>
      <div className="mb-4 grid gap-2">
        {(data?.recentAreas ?? []).map((row) => <p key={row.area} className="text-sm">{row.area}: {row.total}</p>)}
        {(data?.recentAreas.length ?? 0) === 0 ? <p className="text-sm text-slate-500">No operational activity recorded in the last 7 days.</p> : null}
      </div>
      {can('operations.manage') ? (
        <form className="mb-4 grid gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-3" onSubmit={(event) => { event.preventDefault(); save.mutate({ path: '/v1/operations/activities', body: { activityDate: new Date().toISOString().slice(0, 10), area, summary } }); }}>
          <Field label="Area"><select className={controlClass} value={area} onChange={(event) => setArea(event.target.value)}>{areas.map((item) => <option key={item}>{item}</option>)}</select></Field>
          <Field label="What happened"><input className={controlClass} value={summary} onChange={(event) => setSummary(event.target.value)} /></Field>
          <div className="flex items-end gap-2">
            <Button type="submit">Record activity</Button>
            <Button type="button" variant="secondary" onClick={() => save.mutate({ path: '/v1/operations/issues', body: { title: title || summary, description: summary, area, severity: 'medium' } })}>Log issue</Button>
          </div>
          <Field label="Task title"><input className={controlClass} value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
          <div className="flex items-end"><Button type="button" variant="secondary" onClick={() => save.mutate({ path: '/v1/operations/tasks', body: { title, area } })}>Assign task</Button></div>
        </form>
      ) : null}
      <h2 className="mb-2 font-semibold">Register</h2>
      {(activities.data?.data ?? []).map((row) => <p key={row.id} className="text-sm">{row.referenceNumber} · {row.activityDate} · {row.area} · {row.summary}</p>)}
      <h2 className="mb-2 mt-4 font-semibold">Tasks</h2>
      {(tasks.data?.data ?? []).map((row) => <p key={row.id} className="text-sm">{row.referenceNumber} · {row.title} · <Badge value={row.status} /></p>)}
      <h2 className="mb-2 mt-4 font-semibold">Corrective actions assigned to you</h2>
      {(actions.data?.data ?? []).map((row) => (
        <div key={row.id} className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <span>{row.referenceNumber} · {row.title}</span>
          <Badge value={row.status} />
          {row.status === 'open' || row.status === 'outstanding' ? <Button type="button" onClick={() => save.mutate({ path: `/v1/executive/actions/${row.id}/response`, body: { response: summary || 'The corrective action has been carried out.' } })}>Send response</Button> : null}
        </div>
      ))}
      {(actions.data?.data.length ?? 0) === 0 ? <p className="text-sm text-slate-500">No corrective action is assigned to you.</p> : null}
      <h2 className="mb-2 mt-4 font-semibold">Issues</h2>
      {(issues.data?.data ?? []).map((row) => (
        <div key={row.id} className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <span>{row.referenceNumber} · {row.title} · {row.severity}</span>
          <Badge value={row.status} />
          {row.escalated ? <Badge value="escalated" /> : null}
          {can('operations.manage') && !row.escalated ? <Button type="button" variant="secondary" onClick={() => api(`/v1/operations/issues/${row.id}`, { method: 'PATCH', body: JSON.stringify({ escalated: true }) }).then(() => client.invalidateQueries({ queryKey: ['operations-issues'] }))}>Escalate to CEO</Button> : null}
        </div>
      ))}
    </section>
  );
}
