import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { Badge, Button, controlClass, ErrorText, Field, PageHeader } from '../components/ui';

function message(error: unknown) {
  return error instanceof ApiError ? error.message : 'The request failed.';
}

interface Review { id: number; referenceNumber: string; department: string; reviewDate: string; status: string; summary: string }
interface Action { id: number; referenceNumber: string; department: string; title: string; dueOn: string; status: string; assignee: string; response: string | null }
interface Meeting { id: number; referenceNumber: string; heldOn: string; title: string; notes: string; actions: Array<{ id: number; description: string; department: string; status: string }> }
interface Department { id: number; name: string }
interface User { id: number; username: string }

export function ExecutivePage() {
  const client = useQueryClient();
  const [error, setError] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [summary, setSummary] = useState('');
  const [finding, setFinding] = useState('');
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [response, setResponse] = useState('');
  const reviews = useQuery({ queryKey: ['reviews'], queryFn: () => api<{ data: Review[] }>('/v1/executive/reviews') });
  const actions = useQuery({ queryKey: ['actions'], queryFn: () => api<{ data: Action[] }>('/v1/executive/actions') });
  const meetings = useQuery({ queryKey: ['meetings'], queryFn: () => api<{ data: Meeting[] }>('/v1/executive/meetings') });
  const departments = useQuery({ queryKey: ['departments'], queryFn: () => api<{ data: Department[] }>('/v1/organisation/departments') });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<{ data: User[] }>('/v1/users') });
  const save = useMutation({
    mutationFn: (task: { path: string; body: unknown }) => api(task.path, { method: 'POST', body: JSON.stringify(task.body) }),
    onSuccess: async () => {
      setError('');
      await client.invalidateQueries({ queryKey: ['reviews'] });
      await client.invalidateQueries({ queryKey: ['actions'] });
      await client.invalidateQueries({ queryKey: ['meetings'] });
    },
    onError: (reason) => setError(message(reason)),
  });

  return (
    <section>
      <PageHeader title="Department checks" description="Choose a department, record what you found, and assign a corrective action. The manager responds, and you mark the action resolved or still outstanding." />
      {error ? <div className="mb-4"><ErrorText>{error}</ErrorText></div> : null}
      <form className="mb-4 grid gap-3 rounded-lg border border-line bg-white p-4" onSubmit={(event) => {
        event.preventDefault();
        save.mutate({ path: '/v1/executive/reviews', body: { departmentId: Number(departmentId), reviewDate: new Date().toISOString().slice(0, 10), summary, findings: finding ? [{ description: finding, severity: 'medium' }] : [] } });
      }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Department">
            <select className={controlClass} value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
              <option value="">Choose</option>
              {(departments.data?.data ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </Field>
          <Field label="Finding"><input className={controlClass} value={finding} onChange={(event) => setFinding(event.target.value)} /></Field>
          <Field label="Review summary"><input className={controlClass} value={summary} onChange={(event) => setSummary(event.target.value)} /></Field>
        </div>
        <Button type="submit">Record departmental check</Button>
      </form>
      <div className="mb-4 grid gap-2">
        {(reviews.data?.data ?? []).map((row) => <article key={row.id} className="rounded-lg border border-line bg-white px-4 py-3 text-sm">{row.referenceNumber} · {row.department} · {row.reviewDate} · {row.summary}</article>)}
      </div>
      <form className="mb-4 grid gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-2" onSubmit={(event) => {
        event.preventDefault();
        const reviewId = reviews.data?.data[0]?.id;
        if (!reviewId) return setError('Record a departmental check first.');
        save.mutate({ path: '/v1/executive/actions', body: { reviewId, title, dueOn: new Date().toISOString().slice(0, 10), assignedToUserId: Number(assignee) } });
      }}>
        <Field label="Corrective action"><input className={controlClass} value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
        <Field label="Assign to">
          <select className={controlClass} value={assignee} onChange={(event) => setAssignee(event.target.value)}>
            <option value="">Choose</option>
            {(users.data?.data ?? []).map((row) => <option key={row.id} value={row.id}>{row.username}</option>)}
          </select>
        </Field>
        <Button type="submit">Assign action</Button>
      </form>
      {(actions.data?.data ?? []).map((row) => (
        <article key={row.id} className="mb-2 rounded-lg border border-line bg-white px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{row.referenceNumber}</span><Badge value={row.status} /><span>{row.department} · {row.title} · due {row.dueOn} · {row.assignee}</span></div>
          {row.response ? <p className="mt-1">Response: {row.response}</p> : null}
          {row.status === 'responded' ? (
            <div className="mt-2 flex gap-2">
              <Button type="button" onClick={() => save.mutate({ path: `/v1/executive/actions/${row.id}/resolve`, body: { status: 'resolved', reviewNote: response || 'The response closes this action.' } })}>Resolve</Button>
              <Button type="button" variant="secondary" onClick={() => save.mutate({ path: `/v1/executive/actions/${row.id}/resolve`, body: { status: 'outstanding', reviewNote: response || 'The response does not close this action.' } })}>Keep outstanding</Button>
            </div>
          ) : null}
        </article>
      ))}
      <Field label="Follow-up note"><input className={controlClass} value={response} onChange={(event) => setResponse(event.target.value)} /></Field>
      <h2 className="mb-2 mt-4 font-semibold">Management meetings</h2>
      {(meetings.data?.data ?? []).map((row) => <p key={row.id} className="text-sm">{row.referenceNumber} · {row.heldOn} · {row.title} · {row.actions.length} action points</p>)}
      {(meetings.data?.data.length ?? 0) === 0 ? <p className="text-sm text-slate-500">No management meetings recorded.</p> : null}
    </section>
  );
}
