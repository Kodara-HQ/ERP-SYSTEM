import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Button, controlClass, ErrorText, Field, PageHeader } from '../components/ui';

function message(error: unknown) {
  return error instanceof ApiError ? error.message : 'The request failed.';
}

interface DocumentRow {
  id: number;
  referenceNumber: string;
  documentType: string;
  title: string;
  counterparty: string;
  status: string;
  expiryOn: string | null;
  department: string | null;
}

interface Risk { id: number; referenceNumber: string; title: string; likelihood: string; impact: string; status: string }

export function LegalPage() {
  const { can } = useAuth();
  const client = useQueryClient();
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [summary, setSummary] = useState('');
  const [documentType, setDocumentType] = useState('contract');
  const [comment, setComment] = useState('');
  const documents = useQuery({ queryKey: ['legal'], queryFn: () => api<{ data: DocumentRow[] }>('/v1/legal') });
  const risks = useQuery({ queryKey: ['legal-risks'], enabled: can('legal.manage'), queryFn: () => api<{ data: Risk[] }>('/v1/legal/risks') });
  const expiring = useQuery({ queryKey: ['legal-expiring'], enabled: can('legal.manage') || can('legal.view_confidential'), queryFn: () => api<{ data: Array<{ id: number; title: string; expiryOn: string }> }>('/v1/legal/expiring') });
  const save = useMutation({
    mutationFn: () => api('/v1/legal', { method: 'POST', body: JSON.stringify({ documentType, title, counterparty, summary }) }),
    onSuccess: async () => { setError(''); setTitle(''); setSummary(''); await client.invalidateQueries({ queryKey: ['legal'] }); },
    onError: (reason) => setError(message(reason)),
  });
  const act = useMutation({
    mutationFn: (task: { path: string; body?: unknown }) => api(task.path, { method: 'POST', body: task.body ? JSON.stringify(task.body) : undefined }),
    onSuccess: async () => { setError(''); await client.invalidateQueries({ queryKey: ['legal'] }); },
    onError: (reason) => setError(message(reason)),
  });

  return (
    <section>
      <PageHeader title="Legal records" description="A requesting department sends a contract, MOU, or agreement to Legal Affairs. Clearance is recorded before the CEO's final approval, and the document can be marked executed only after that approval." />
      {error ? <div className="mb-4"><ErrorText>{error}</ErrorText></div> : null}
      {can('legal.request') || can('legal.manage') ? (
        <form className="mb-4 grid gap-3 rounded-lg border border-line bg-white p-4" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type">
              <select className={controlClass} value={documentType} onChange={(event) => setDocumentType(event.target.value)}>
                <option value="contract">Contract</option>
                <option value="mou">MOU</option>
                <option value="agreement">Agreement</option>
              </select>
            </Field>
            <Field label="Counterparty"><input className={controlClass} value={counterparty} onChange={(event) => setCounterparty(event.target.value)} /></Field>
            <Field label="Title"><input className={controlClass} value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
            <Field label="Summary"><input className={controlClass} value={summary} onChange={(event) => setSummary(event.target.value)} /></Field>
          </div>
          <Button type="submit">Create draft</Button>
        </form>
      ) : null}
      <div className="grid gap-2">
        {(documents.data?.data ?? []).map((row) => (
          <article key={row.id} className="rounded-lg border border-line bg-white px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{row.referenceNumber}</span>
              <Badge value={row.status} />
              <span>{row.documentType} · {row.title} · {row.counterparty}{row.expiryOn ? ` · expires ${row.expiryOn}` : ''}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {row.status === 'draft' ? <Button type="button" onClick={() => act.mutate({ path: `/v1/legal/${row.id}/submit` })}>Submit for legal review</Button> : null}
              {can('legal.manage') && row.status === 'in_review' ? (
                <>
                  <Button type="button" onClick={() => act.mutate({ path: `/v1/legal/${row.id}/review`, body: { action: 'approve', recommendation: 'recommend', comment } })}>Clear</Button>
                  <Button type="button" variant="secondary" onClick={() => act.mutate({ path: `/v1/legal/${row.id}/review`, body: { action: 'return', recommendation: 'amend', comment } })}>Request amendment</Button>
                  <Button type="button" variant="secondary" onClick={() => act.mutate({ path: `/v1/legal/${row.id}/review`, body: { action: 'return', recommendation: 'concern', comment } })}>Raise concern</Button>
                </>
              ) : null}
              {can('finance.approve_expenditure') && row.status === 'awaiting_ceo' ? <Button type="button" onClick={() => act.mutate({ path: `/v1/legal/${row.id}/review`, body: { action: 'approve', recommendation: 'recommend', comment: comment || 'CEO final approval.' } })}>CEO approval</Button> : null}
              {can('legal.manage') && row.status === 'approved' ? <Button type="button" onClick={() => act.mutate({ path: `/v1/legal/${row.id}/execute` })}>Record execution</Button> : null}
            </div>
          </article>
        ))}
      </div>
      {can('legal.manage') ? <Field label="Review comment"><input className={controlClass} value={comment} onChange={(event) => setComment(event.target.value)} /></Field> : null}
      {expiring.data?.data.length ? (
        <div className="mt-4">
          <h2 className="mb-2 font-semibold">Expiring within 30 days</h2>
          {expiring.data.data.map((row) => <p key={row.id} className="text-sm">{row.title} · {row.expiryOn}</p>)}
        </div>
      ) : null}
      {can('legal.manage') ? (
        <div className="mt-4">
          <h2 className="mb-2 font-semibold">Risk register</h2>
          {(risks.data?.data ?? []).map((risk) => <p key={risk.id} className="text-sm">{risk.referenceNumber} · {risk.title} · {risk.likelihood}/{risk.impact} · {risk.status}</p>)}
          {(risks.data?.data.length ?? 0) === 0 ? <p className="text-sm text-slate-500">No legal risks recorded.</p> : null}
        </div>
      ) : null}
    </section>
  );
}
