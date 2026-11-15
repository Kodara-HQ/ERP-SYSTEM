import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Button, controlClass, Empty, ErrorText, Field, Modal, PageHeader } from '../components/ui';

function errorText(reason: unknown): string {
  return reason instanceof ApiError ? reason.message : 'The request failed.';
}

function Card({ title, note, children, action }: { title: string; note?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <article className="rounded-lg border border-line bg-white p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
          {note ? <p className="mt-0.5 text-xs text-slate-500">{note}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </article>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-ink">{value}</div>
    </div>
  );
}

function Table({ headers, children, empty }: { headers: string[]; children: ReactNode; empty?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-white">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-canvas text-xs uppercase tracking-wide text-slate-500">
          <tr>{headers.map((header) => <th key={header} className="px-3 py-2.5 font-semibold">{header}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {empty ? <div className="px-4 py-8 text-center text-sm text-slate-500">Nothing recorded yet.</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------- company dashboard

interface Announcement { id: number; title: string; body: string; status: string; expiresOn: string | null; publishedBy: string; createdAt: string }
interface CompanyOverview {
  companyName: string;
  headcount: number;
  departmentCount: number;
  departments: Array<{ name: string; people: number }>;
  openVacancies: number;
  announcements: Announcement[];
  myReports: Record<string, number>;
  unreadNotifications: number;
}

export function CompanyOverviewPage() {
  const { can } = useAuth();
  const client = useQueryClient();
  const [error, setError] = useState('');
  const [draft, setDraft] = useState({ title: '', body: '', expiresOn: '' });
  const overview = useQuery({ queryKey: ['company-dashboard'], queryFn: () => api<{ data: CompanyOverview }>('/v1/management/company-dashboard') });
  const publish = useMutation({
    mutationFn: () => api('/v1/management/announcements', { method: 'POST', body: JSON.stringify({ title: draft.title, body: draft.body, expiresOn: draft.expiresOn || null }) }),
    onSuccess: async () => { setDraft({ title: '', body: '', expiresOn: '' }); setError(''); await client.invalidateQueries({ queryKey: ['company-dashboard'] }); },
    onError: (reason) => setError(errorText(reason)),
  });
  const withdraw = useMutation({
    mutationFn: (id: number) => api(`/v1/management/announcements/${id}/withdraw`, { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['company-dashboard'] }),
  });
  const data = overview.data?.data;
  return (
    <section className="space-y-5">
      <PageHeader title="Company dashboard" description="General company information for every employee. Departmental transactions and personal records stay in their departments." />
      {error ? <ErrorText>{error}</ErrorText> : null}
      {data ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Employees" value={data.headcount} />
            <Stat label="Departments and units" value={data.departmentCount} />
            <Stat label="Open vacancies" value={data.openVacancies} />
            <Stat label="Your unread notifications" value={data.unreadNotifications} />
          </div>
          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <Card title="Announcements" note="Published by management.">
              <ul className="space-y-3">
                {data.announcements.map((item) => (
                  <li key={item.id} className="rounded-md border border-line p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-ink">{item.title}</div>
                      {can('announcements.manage') ? <button type="button" className="text-xs font-semibold text-[#8d2f2f]" onClick={() => withdraw.mutate(item.id)}>Withdraw</button> : null}
                    </div>
                    <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{item.body}</p>
                    <div className="mt-1 text-xs text-slate-500">{item.publishedBy} · {String(item.createdAt).slice(0, 10)}{item.expiresOn ? ` · until ${item.expiresOn}` : ''}</div>
                  </li>
                ))}
                {data.announcements.length === 0 ? <li className="text-sm text-slate-500">No announcements.</li> : null}
              </ul>
              {can('announcements.manage') ? (
                <form className="mt-4 grid gap-2 border-t border-line pt-4" onSubmit={(event) => { event.preventDefault(); publish.mutate(); }}>
                  <input className={controlClass} placeholder="Title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} required minLength={3} />
                  <textarea className={`${controlClass} h-20 py-2`} placeholder="Message" value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} required minLength={3} />
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-xs text-slate-600">Show until <input type="date" className={`${controlClass} ml-1 inline-block w-40`} value={draft.expiresOn} onChange={(event) => setDraft({ ...draft, expiresOn: event.target.value })} /></label>
                    <Button type="submit" disabled={publish.isPending}>Publish</Button>
                  </div>
                </form>
              ) : null}
            </Card>
            <div className="space-y-4">
              <Card title="Departments">
                <ul className="divide-y divide-line text-sm">
                  {data.departments.map((row) => <li key={row.name} className="flex justify-between py-2"><span>{row.name}</span><span className="tabular-nums text-slate-500">{row.people}</span></li>)}
                </ul>
              </Card>
              <Card title="Your reports" action={can('reports.submit') ? <Link className="text-sm font-semibold text-pine" to="/management">Open</Link> : null}>
                <div className="flex flex-wrap gap-2 text-sm">
                  {Object.entries(data.myReports).map(([status, count]) => <span key={status} className="inline-flex items-center gap-1"><Badge value={status} /> {count}</span>)}
                  {Object.keys(data.myReports).length === 0 ? <span className="text-slate-500">No reports filed yet.</span> : null}
                </div>
              </Card>
            </div>
          </div>
        </>
      ) : <p className="text-sm text-slate-500">Loading…</p>}
    </section>
  );
}

// ---------------------------------------------------------------- management: reports, targets, assessments, performance

interface Report {
  id: number; referenceNumber: string; departmentName: string; periodType: string; periodStart: string; periodEnd: string; title: string;
  summary: string; achievements: string | null; challenges: string | null; nextSteps: string | null; audience: string; status: string;
  author: string; authorUserId: number; reviewer: string | null; reviewComment: string | null;
}
interface Target { id: number; departmentId: number; departmentName: string; title: string; metric: string; unit: string; targetValue: number; actualValue: number; progress: number; periodStart: string; periodEnd: string; status: string }
interface Assessment { id: number; employeeName: string; employeeNumber: string; departmentName: string; assessor: string; periodStart: string; periodEnd: string; rating: number; strengths: string | null; improvements: string | null; comments: string | null; status: string }
interface Performance { departmentId: number; departmentName: string; isHead: boolean; reportsThisMonth: Record<string, number>; pendingReviews: number; activeTargets: number; achievedTargets: number; missedTargets: number; targetProgress: number | null; openCorrectiveActions: number }

const periodTypes = ['daily', 'weekly', 'monthly', 'quarterly', 'annual'];

export function ManagementPage() {
  const { can } = useAuth();
  const tabs = [
    { key: 'reports', label: 'Reports', show: can('reports.submit') || can('reports.review') },
    { key: 'targets', label: 'Targets', show: can('reports.submit') || can('targets.manage') },
    { key: 'assessments', label: 'Performance assessments', show: true },
    { key: 'performance', label: 'Department performance', show: can('reports.review') || can('executive.review') },
  ].filter((tab) => tab.show);
  const [tab, setTab] = useState(tabs[0]?.key ?? 'reports');
  return (
    <section>
      <PageHeader title="Reporting and performance" description="Daily, weekly, monthly, quarterly, and annual reports go to your manager; heads of department report to the CEO. Managers see their own units only." />
      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((item) => <Button key={item.key} type="button" variant={tab === item.key ? 'primary' : 'secondary'} onClick={() => setTab(item.key)}>{item.label}</Button>)}
      </div>
      {tab === 'reports' ? <ReportsTab /> : null}
      {tab === 'targets' ? <TargetsTab /> : null}
      {tab === 'assessments' ? <AssessmentsTab /> : null}
      {tab === 'performance' ? <PerformanceTab /> : null}
    </section>
  );
}

function ReportsTab() {
  const { can, user } = useAuth();
  const client = useQueryClient();
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<Report | 'new' | null>(null);
  const [viewing, setViewing] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const reports = useQuery({
    queryKey: ['management-reports', filter],
    queryFn: () => api<{ data: Report[] }>(`/v1/management/reports${filter ? `?periodType=${filter}` : ''}`),
  });
  const refresh = () => client.invalidateQueries({ queryKey: ['management-reports'] });
  const review = useMutation({
    mutationFn: (input: { id: number; action: 'reviewed' | 'returned'; comment: string }) => api(`/v1/management/reports/${input.id}/review`, { method: 'POST', body: JSON.stringify({ action: input.action, comment: input.comment }) }),
    onSuccess: async () => { setViewing(null); setError(''); await refresh(); },
    onError: (reason) => setError(errorText(reason)),
  });
  const submit = useMutation({
    mutationFn: (id: number) => api(`/v1/management/reports/${id}/submit`, { method: 'POST' }),
    onSuccess: refresh,
    onError: (reason) => setError(errorText(reason)),
  });
  const rows = reports.data?.data ?? [];
  return (
    <div className="space-y-3">
      {error ? <ErrorText>{error}</ErrorText> : null}
      <div className="flex flex-wrap items-center gap-2">
        <select className={`${controlClass} w-44`} value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Period">
          <option value="">All periods</option>
          {periodTypes.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        {can('reports.submit') ? <Button type="button" onClick={() => setOpen('new')}>Write a report</Button> : null}
        <a className="text-sm font-semibold text-pine" href={`/api/v1/management/reports.xlsx${filter ? `?periodType=${filter}` : ''}`}>Excel</a>
        <a className="text-sm font-semibold text-pine" href={`/api/v1/management/reports.pdf${filter ? `?periodType=${filter}` : ''}`}>PDF</a>
      </div>
      <Table headers={['Reference', 'Department', 'Period', 'Title', 'To', 'Status', 'Author', '']} empty={rows.length === 0}>
        {rows.map((row) => (
          <tr key={row.id} className="border-t border-line">
            <td className="px-3 py-2 font-semibold">{row.referenceNumber}</td>
            <td className="px-3 py-2">{row.departmentName}</td>
            <td className="px-3 py-2 capitalize">{row.periodType}<div className="text-xs text-slate-500">{row.periodStart} – {row.periodEnd}</div></td>
            <td className="px-3 py-2">{row.title}</td>
            <td className="px-3 py-2">{row.audience === 'ceo' ? 'CEO' : 'Manager'}</td>
            <td className="px-3 py-2"><Badge value={row.status} /></td>
            <td className="px-3 py-2">{row.author}</td>
            <td className="px-3 py-2 text-right">
              <button type="button" className="mr-3 text-sm font-semibold text-pine" onClick={() => setViewing(row)}>Open</button>
              {row.authorUserId === user?.id && ['draft', 'returned'].includes(row.status) ? (
                <>
                  <button type="button" className="mr-3 text-sm font-semibold text-pine" onClick={() => setOpen(row)}>Edit</button>
                  <button type="button" className="text-sm font-semibold text-pine" onClick={() => submit.mutate(row.id)}>Submit</button>
                </>
              ) : null}
            </td>
          </tr>
        ))}
      </Table>
      {open ? <ReportForm report={open === 'new' ? null : open} onClose={() => setOpen(null)} onSaved={async () => { setOpen(null); await refresh(); }} /> : null}
      {viewing ? (
        <ReportView report={viewing} canReview={can('reports.review') && viewing.status === 'submitted' && viewing.authorUserId !== user?.id}
          onClose={() => setViewing(null)} onReview={(action, comment) => review.mutate({ id: viewing.id, action, comment })} pending={review.isPending} />
      ) : null}
    </div>
  );
}

function ReportForm({ report, onClose, onSaved }: { report: Report | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const [values, setValues] = useState({
    periodType: report?.periodType ?? 'daily', periodStart: report?.periodStart ?? todayIso, periodEnd: report?.periodEnd ?? todayIso,
    title: report?.title ?? '', summary: report?.summary ?? '', achievements: report?.achievements ?? '', challenges: report?.challenges ?? '', nextSteps: report?.nextSteps ?? '',
  });
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: (submit: boolean) => api(report ? `/v1/management/reports/${report.id}` : '/v1/management/reports', {
      method: report ? 'PUT' : 'POST',
      body: JSON.stringify({ ...values, achievements: values.achievements || null, challenges: values.challenges || null, nextSteps: values.nextSteps || null, submit }),
    }),
    onSuccess: onSaved,
    onError: (reason) => setError(errorText(reason)),
  });
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) => setValues({ ...values, [key]: event.target.value });
  return (
    <Modal title={report ? `Edit ${report.referenceNumber}` : 'Write a report'} onClose={onClose}>
      <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); save.mutate(true); }}>
        {error ? <ErrorText>{error}</ErrorText> : null}
        <div className="grid grid-cols-3 gap-2">
          <Field label="Period"><select className={controlClass} value={values.periodType} onChange={set('periodType')}>{periodTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></Field>
          <Field label="From"><input type="date" className={controlClass} value={values.periodStart} onChange={set('periodStart')} required /></Field>
          <Field label="To"><input type="date" className={controlClass} value={values.periodEnd} onChange={set('periodEnd')} required /></Field>
        </div>
        <Field label="Title"><input className={controlClass} value={values.title} onChange={set('title')} required minLength={3} /></Field>
        <Field label="Summary"><textarea className={`${controlClass} h-24 py-2`} value={values.summary} onChange={set('summary')} required minLength={10} /></Field>
        <Field label="Achievements"><textarea className={`${controlClass} h-16 py-2`} value={values.achievements} onChange={set('achievements')} /></Field>
        <Field label="Challenges"><textarea className={`${controlClass} h-16 py-2`} value={values.challenges} onChange={set('challenges')} /></Field>
        <Field label="Next steps"><textarea className={`${controlClass} h-16 py-2`} value={values.nextSteps} onChange={set('nextSteps')} /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={save.isPending} onClick={() => save.mutate(false)}>Save draft</Button>
          <Button type="submit" disabled={save.isPending}>Submit</Button>
        </div>
      </form>
    </Modal>
  );
}

function ReportView({ report, canReview, onClose, onReview, pending }: { report: Report; canReview: boolean; onClose: () => void; onReview: (action: 'reviewed' | 'returned', comment: string) => void; pending: boolean }) {
  const [comment, setComment] = useState('');
  const sections: Array<[string, string | null]> = [['Summary', report.summary], ['Achievements', report.achievements], ['Challenges', report.challenges], ['Next steps', report.nextSteps]];
  return (
    <Modal title={`${report.referenceNumber} · ${report.title}`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-2 text-slate-600"><Badge value={report.status} /> <span className="capitalize">{report.periodType}</span> · {report.periodStart} – {report.periodEnd} · {report.departmentName} · {report.author}</div>
        {sections.filter(([, text]) => text).map(([label, text]) => <div key={label}><div className="font-semibold">{label}</div><p className="whitespace-pre-line text-slate-700">{text}</p></div>)}
        {report.reviewer ? <p className="rounded bg-canvas px-2 py-1 text-xs">Reviewed by {report.reviewer}{report.reviewComment ? `: ${report.reviewComment}` : ''}</p> : null}
        {canReview ? (
          <div className="border-t border-line pt-3">
            <textarea className={`${controlClass} h-16 py-2`} placeholder="Comment (required to return)" value={comment} onChange={(event) => setComment(event.target.value)} />
            <div className="mt-2 flex gap-2">
              <Button type="button" disabled={pending} onClick={() => onReview('reviewed', comment)}>Mark reviewed</Button>
              <Button type="button" variant="secondary" disabled={pending} onClick={() => onReview('returned', comment)}>Return</Button>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function TargetsTab() {
  const { can } = useAuth();
  const client = useQueryClient();
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const targets = useQuery({ queryKey: ['management-targets'], queryFn: () => api<{ data: Target[] }>('/v1/management/targets') });
  const departments = useQuery({
    queryKey: ['departments-list'], enabled: can('targets.manage'),
    queryFn: () => api<{ data: Array<{ id: number; name: string }> }>('/v1/organisation/departments?pageSize=100&status=active'),
  });
  const update = useMutation({
    mutationFn: (input: { id: number; body: Record<string, unknown> }) => api(`/v1/management/targets/${input.id}`, { method: 'PATCH', body: JSON.stringify(input.body) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['management-targets'] }),
    onError: (reason) => setError(errorText(reason)),
  });
  const [values, setValues] = useState({ departmentId: '', title: '', metric: '', unit: '', targetValue: '', periodStart: '', periodEnd: '' });
  const create = useMutation({
    mutationFn: () => api('/v1/management/targets', { method: 'POST', body: JSON.stringify({ ...values, departmentId: Number(values.departmentId), targetValue: Number(values.targetValue) }) }),
    onSuccess: async () => { setAdding(false); setError(''); await client.invalidateQueries({ queryKey: ['management-targets'] }); },
    onError: (reason) => setError(errorText(reason)),
  });
  const rows = targets.data?.data ?? [];
  return (
    <div className="space-y-3">
      {error ? <ErrorText>{error}</ErrorText> : null}
      {can('targets.manage') ? <Button type="button" onClick={() => setAdding(true)}>Set a target</Button> : null}
      <Table headers={['Department', 'Target', 'Progress', 'Period', 'Status', '']} empty={rows.length === 0}>
        {rows.map((row) => (
          <tr key={row.id} className="border-t border-line">
            <td className="px-3 py-2">{row.departmentName}</td>
            <td className="px-3 py-2 font-semibold">{row.title}<div className="text-xs font-normal text-slate-500">{row.metric}</div></td>
            <td className="px-3 py-2 w-56">
              <div className="h-2 rounded-full bg-canvas"><div className="h-2 rounded-full bg-pine" style={{ width: `${Math.min(100, row.progress)}%` }} /></div>
              <div className="mt-1 text-xs tabular-nums text-slate-600">{row.actualValue.toLocaleString()} / {row.targetValue.toLocaleString()} {row.unit} · {row.progress}%</div>
            </td>
            <td className="px-3 py-2 text-xs">{row.periodStart} – {row.periodEnd}</td>
            <td className="px-3 py-2"><Badge value={row.status} /></td>
            <td className="px-3 py-2 text-right">
              {can('targets.manage') && row.status === 'active' ? (
                <>
                  <button type="button" className="mr-3 text-sm font-semibold text-pine" onClick={() => {
                    const value = window.prompt(`Actual ${row.unit} achieved so far`, String(row.actualValue));
                    if (value !== null && value.trim() !== '' && Number.isFinite(Number(value))) update.mutate({ id: row.id, body: { actualValue: Number(value) } });
                  }}>Update</button>
                  <button type="button" className="mr-3 text-sm font-semibold text-pine" onClick={() => update.mutate({ id: row.id, body: { status: 'achieved' } })}>Achieved</button>
                  <button type="button" className="text-sm font-semibold text-[#8d2f2f]" onClick={() => update.mutate({ id: row.id, body: { status: 'missed' } })}>Missed</button>
                </>
              ) : null}
            </td>
          </tr>
        ))}
      </Table>
      {adding ? (
        <Modal title="Set a departmental target" onClose={() => setAdding(false)}>
          <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
            <Field label="Department">
              <select className={controlClass} value={values.departmentId} onChange={(event) => setValues({ ...values, departmentId: event.target.value })} required>
                <option value="">Select</option>
                {departments.data?.data.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </Field>
            <Field label="Target"><input className={controlClass} value={values.title} onChange={(event) => setValues({ ...values, title: event.target.value })} required minLength={3} /></Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Measure"><input className={controlClass} value={values.metric} onChange={(event) => setValues({ ...values, metric: event.target.value })} required /></Field>
              <Field label="Unit"><input className={controlClass} value={values.unit} onChange={(event) => setValues({ ...values, unit: event.target.value })} required /></Field>
              <Field label="Target value"><input type="number" min="0" step="0.01" className={controlClass} value={values.targetValue} onChange={(event) => setValues({ ...values, targetValue: event.target.value })} required /></Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="From"><input type="date" className={controlClass} value={values.periodStart} onChange={(event) => setValues({ ...values, periodStart: event.target.value })} required /></Field>
              <Field label="To"><input type="date" className={controlClass} value={values.periodEnd} onChange={(event) => setValues({ ...values, periodEnd: event.target.value })} required /></Field>
            </div>
            <div className="flex justify-end"><Button type="submit" disabled={create.isPending}>Save target</Button></div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}

function AssessmentsTab() {
  const { can } = useAuth();
  const client = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const assessments = useQuery({ queryKey: ['assessments'], queryFn: () => api<{ data: Assessment[] }>('/v1/management/assessments') });
  const people = useQuery({
    queryKey: ['assessable'], enabled: can('assessments.manage'),
    queryFn: () => api<{ data: Array<{ id: number; name: string; employeeNumber: string; departmentName: string }> }>('/v1/management/assessments/employees'),
  });
  const [values, setValues] = useState({ employeeId: '', periodStart: '', periodEnd: '', rating: '3', strengths: '', improvements: '', comments: '' });
  const create = useMutation({
    mutationFn: () => api('/v1/management/assessments', {
      method: 'POST',
      body: JSON.stringify({ ...values, employeeId: Number(values.employeeId), rating: Number(values.rating), strengths: values.strengths || null, improvements: values.improvements || null, comments: values.comments || null }),
    }),
    onSuccess: async () => { setAdding(false); setError(''); await client.invalidateQueries({ queryKey: ['assessments'] }); },
    onError: (reason) => setError(errorText(reason)),
  });
  const rows = assessments.data?.data ?? [];
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Assessments are seen by the employee, their manager, HR, and the CEO. Other departments cannot read them.</p>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {can('assessments.manage') && (people.data?.data.length ?? 0) > 0 ? <Button type="button" onClick={() => setAdding(true)}>Assess an employee</Button> : null}
      <Table headers={['Employee', 'Department', 'Period', 'Rating', 'Assessor', 'Notes']} empty={rows.length === 0}>
        {rows.map((row) => (
          <tr key={row.id} className="border-t border-line">
            <td className="px-3 py-2 font-semibold">{row.employeeName}<div className="text-xs font-normal text-slate-500">{row.employeeNumber}</div></td>
            <td className="px-3 py-2">{row.departmentName}</td>
            <td className="px-3 py-2 text-xs">{row.periodStart} – {row.periodEnd}</td>
            <td className="px-3 py-2 font-semibold">{row.rating} / 5</td>
            <td className="px-3 py-2">{row.assessor}</td>
            <td className="px-3 py-2 text-xs text-slate-600">{[row.strengths, row.improvements, row.comments].filter(Boolean).join(' · ')}</td>
          </tr>
        ))}
      </Table>
      {adding ? (
        <Modal title="Assess an employee" onClose={() => setAdding(false)}>
          <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
            <Field label="Employee">
              <select className={controlClass} value={values.employeeId} onChange={(event) => setValues({ ...values, employeeId: event.target.value })} required>
                <option value="">Select</option>
                {people.data?.data.map((row) => <option key={row.id} value={row.id}>{row.name} · {row.departmentName}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="From"><input type="date" className={controlClass} value={values.periodStart} onChange={(event) => setValues({ ...values, periodStart: event.target.value })} required /></Field>
              <Field label="To"><input type="date" className={controlClass} value={values.periodEnd} onChange={(event) => setValues({ ...values, periodEnd: event.target.value })} required /></Field>
              <Field label="Rating (1–5)"><select className={controlClass} value={values.rating} onChange={(event) => setValues({ ...values, rating: event.target.value })}>{[1, 2, 3, 4, 5].map((value) => <option key={value}>{value}</option>)}</select></Field>
            </div>
            <Field label="Strengths"><textarea className={`${controlClass} h-16 py-2`} value={values.strengths} onChange={(event) => setValues({ ...values, strengths: event.target.value })} /></Field>
            <Field label="To improve"><textarea className={`${controlClass} h-16 py-2`} value={values.improvements} onChange={(event) => setValues({ ...values, improvements: event.target.value })} /></Field>
            <Field label="Comments"><textarea className={`${controlClass} h-16 py-2`} value={values.comments} onChange={(event) => setValues({ ...values, comments: event.target.value })} /></Field>
            <div className="flex justify-end"><Button type="submit" disabled={create.isPending}>Save assessment</Button></div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}

function PerformanceTab() {
  const performance = useQuery({ queryKey: ['department-performance'], queryFn: () => api<{ data: Performance[] }>('/v1/management/performance') });
  const rows = performance.data?.data ?? [];
  return (
    <Table headers={['Department', 'Reports this month', 'Awaiting review', 'Targets', 'Progress', 'Corrective actions']} empty={rows.length === 0}>
      {rows.map((row) => (
        <tr key={row.departmentId} className="border-t border-line">
          <td className={`px-3 py-2 ${row.isHead ? 'font-semibold' : 'pl-6'}`}>{row.departmentName}</td>
          <td className="px-3 py-2 text-xs">{Object.entries(row.reportsThisMonth).map(([type, count]) => `${type} ${count}`).join(' · ') || '—'}</td>
          <td className="px-3 py-2 tabular-nums">{row.pendingReviews}</td>
          <td className="px-3 py-2 text-xs">{row.activeTargets} active · {row.achievedTargets} achieved · {row.missedTargets} missed</td>
          <td className="px-3 py-2 tabular-nums">{row.targetProgress == null ? '—' : `${row.targetProgress}%`}</td>
          <td className="px-3 py-2 tabular-nums">{row.openCorrectiveActions}</td>
        </tr>
      ))}
    </Table>
  );
}

// ---------------------------------------------------------------- department registers

interface RegisterField { key: string; label: string; type: 'text' | 'textarea' | 'number' | 'date' | 'select'; options?: string[]; required?: boolean }
interface RegisterInfo { code: string; name: string; description: string; group: string; statuses: string[]; fields: RegisterField[]; access: 'manage' | 'view' | 'self' }
interface RegisterEntry { id: number; referenceNumber: string; status: string; createdBy: string; createdAt: string; values: Record<string, unknown> }

export function RegistersIndexPage() {
  const registers = useQuery({ queryKey: ['registers'], queryFn: () => api<{ data: RegisterInfo[] }>('/v1/registers') });
  const summary = useQuery({ queryKey: ['registers-summary'], queryFn: () => api<{ data: Record<string, { total: number; open: number }> }>('/v1/registers/summary') });
  const alerts = useQuery({ queryKey: ['registers-alerts'], queryFn: () => api<{ data: Array<{ register: string; registerName: string; id: number; referenceNumber: string; title: string; dueOn: string }> }>('/v1/registers/alerts') });
  const groups = new Map<string, RegisterInfo[]>();
  for (const register of registers.data?.data ?? []) groups.set(register.group, [...(groups.get(register.group) ?? []), register]);
  return (
    <section className="space-y-5">
      <PageHeader title="Department registers" description="Farm, harvest, processing, quality, fleet, legal, IT, and marketing records. You see only the registers of your own department." />
      {(alerts.data?.data.length ?? 0) > 0 ? (
        <Card title="Due soon" note="Renewals, hearings, services, and follow-ups inside their alert window.">
          <ul className="space-y-1 text-sm">
            {alerts.data!.data.map((alert) => (
              <li key={`${alert.register}-${alert.id}`}><Link className="font-semibold text-pine" to={`/registers/${alert.register}`}>{alert.referenceNumber}</Link> · {alert.title} · <span className="text-[#8d2f2f]">{alert.dueOn}</span> <span className="text-xs text-slate-500">({alert.registerName})</span></li>
            ))}
          </ul>
        </Card>
      ) : null}
      {[...groups.entries()].map(([group, items]) => (
        <div key={group}>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{group}</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((register) => (
              <Link key={register.code} to={`/registers/${register.code}`} className="rounded-lg border border-line bg-white p-4 hover:border-pine">
                <div className="font-semibold text-ink">{register.name}</div>
                <p className="mt-1 text-xs text-slate-600">{register.description}</p>
                <div className="mt-2 text-xs text-slate-500">
                  {summary.data?.data[register.code] ? `${summary.data.data[register.code]!.open} open of ${summary.data.data[register.code]!.total}` : register.access === 'self' ? 'Your requests' : ''}
                </div>
              </Link>
            ))}
          </div>
        </div>
      ))}
      {registers.data && registers.data.data.length === 0 ? <Empty>No department registers are open to your account.</Empty> : null}
    </section>
  );
}

export function RegisterPage() {
  const { code = '' } = useParams();
  const client = useQueryClient();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<RegisterEntry | 'new' | null>(null);
  const [error, setError] = useState('');
  const list = useQuery({
    queryKey: ['register', code, status, search],
    queryFn: () => api<{ register: RegisterInfo; data: RegisterEntry[] }>(`/v1/registers/${code}?${new URLSearchParams({ ...(status ? { status } : {}), ...(search ? { search } : {}) })}`),
    retry: false,
  });
  const register = list.data?.register;
  const listed = register?.fields.filter((field) => field.type !== 'textarea').slice(0, 5) ?? [];
  return (
    <section className="space-y-3">
      <PageHeader title={register?.name ?? 'Register'} description={register?.access === 'self' ? 'Requests you raised. The owning department updates them.' : 'Records are kept with every change in the audit log.'}
        action={register && register.access !== 'view' ? <Button type="button" onClick={() => setEditing('new')}>Add</Button> : null} />
      {list.isError ? <ErrorText>{errorText(list.error)}</ErrorText> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      {register ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input className={`${controlClass} max-w-xs`} placeholder="Search" value={search} onChange={(event) => setSearch(event.target.value)} />
            <select className={`${controlClass} w-44`} value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Status">
              <option value="">All statuses</option>
              {register.statuses.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
            </select>
            {register.access !== 'self' ? <><a className="text-sm font-semibold text-pine" href={`/api/v1/registers/${code}/export.xlsx`}>Excel</a><a className="text-sm font-semibold text-pine" href={`/api/v1/registers/${code}/export.pdf`}>PDF</a></> : null}
          </div>
          <Table headers={['Reference', ...listed.map((field) => field.label), 'Status', '']} empty={(list.data?.data.length ?? 0) === 0}>
            {list.data?.data.map((row) => (
              <tr key={row.id} className="border-t border-line">
                <td className="px-3 py-2 font-semibold">{row.referenceNumber}</td>
                {listed.map((field) => <td key={field.key} className="px-3 py-2">{row.values[field.key] == null ? '—' : String(row.values[field.key]).replaceAll('_', ' ')}</td>)}
                <td className="px-3 py-2"><Badge value={row.status} /></td>
                <td className="px-3 py-2 text-right">{register.access === 'manage' ? <button type="button" className="text-sm font-semibold text-pine" onClick={() => setEditing(row)}>Edit</button> : null}</td>
              </tr>
            ))}
          </Table>
        </>
      ) : null}
      {editing && register ? (
        <EntryForm register={register} entry={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); setError(''); await client.invalidateQueries({ queryKey: ['register', code] }); }} />
      ) : null}
    </section>
  );
}

function EntryForm({ register, entry, onClose, onSaved }: { register: RegisterInfo; entry: RegisterEntry | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(register.fields.map((field) => [field.key, entry?.values[field.key] == null ? '' : String(entry.values[field.key])])));
  const [status, setStatus] = useState(entry?.status ?? register.statuses[0] ?? '');
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {};
      for (const field of register.fields) {
        const value = values[field.key] ?? '';
        if (!entry && value === '') continue;
        payload[field.key] = value === '' ? null : field.type === 'number' ? Number(value) : value;
      }
      return api(entry ? `/v1/registers/${register.code}/${entry.id}` : `/v1/registers/${register.code}`, {
        method: entry ? 'PATCH' : 'POST',
        body: JSON.stringify({ status: register.access === 'self' ? undefined : status, values: payload }),
      });
    },
    onSuccess: onSaved,
    onError: (reason) => setError(errorText(reason)),
  });
  return (
    <Modal title={entry ? `Edit ${entry.referenceNumber}` : `Add to ${register.name}`} onClose={onClose}>
      <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
        {error ? <ErrorText>{error}</ErrorText> : null}
        {register.fields.map((field) => (
          <Field key={field.key} label={`${field.label}${field.required ? ' *' : ''}`}>
            {field.type === 'textarea' ? (
              <textarea className={`${controlClass} h-20 py-2`} value={values[field.key]} required={field.required} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} />
            ) : field.type === 'select' ? (
              <select className={controlClass} value={values[field.key]} required={field.required} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}>
                <option value="">Select</option>
                {field.options?.map((option) => <option key={option} value={option}>{option.replaceAll('_', ' ')}</option>)}
              </select>
            ) : (
              <input className={controlClass} type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'} step={field.type === 'number' ? 'any' : undefined}
                value={values[field.key]} required={field.required} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} />
            )}
          </Field>
        ))}
        {register.access !== 'self' ? (
          <Field label="Status">
            <select className={controlClass} value={status} onChange={(event) => setStatus(event.target.value)}>
              {register.statuses.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
            </select>
          </Field>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Register figures and due alerts on a department dashboard, for the registers this person may read. */
export function DepartmentRegistersPanel() {
  const registers = useQuery({ queryKey: ['registers'], queryFn: () => api<{ data: RegisterInfo[] }>('/v1/registers') });
  const summary = useQuery({ queryKey: ['registers-summary'], queryFn: () => api<{ data: Record<string, { total: number; open: number; quantity: number; amount: number }> }>('/v1/registers/summary') });
  const alerts = useQuery({ queryKey: ['registers-alerts'], queryFn: () => api<{ data: Array<{ register: string; id: number; referenceNumber: string; title: string; dueOn: string }> }>('/v1/registers/alerts') });
  const readable = (registers.data?.data ?? []).filter((register) => register.access !== 'self');
  if (readable.length === 0) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
      <Card title="Department registers" action={<Link className="text-sm font-semibold text-pine" to="/registers">Open all</Link>}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {readable.map((register) => (
            <Link key={register.code} to={`/registers/${register.code}`} className="rounded-md border border-line px-3 py-2 hover:border-pine">
              <div className="truncate text-xs text-slate-500">{register.name}</div>
              <div className="text-lg font-bold tabular-nums text-ink">{summary.data?.data[register.code]?.open ?? 0}<span className="text-xs font-normal text-slate-500"> open</span></div>
            </Link>
          ))}
        </div>
      </Card>
      <Card title="Due soon">
        <ul className="space-y-1 text-sm">
          {alerts.data?.data.slice(0, 8).map((alert) => <li key={`${alert.register}-${alert.id}`}><Link className="font-semibold text-pine" to={`/registers/${alert.register}`}>{alert.referenceNumber}</Link> · {alert.title} · <span className="text-[#8d2f2f]">{alert.dueOn}</span></li>)}
          {(alerts.data?.data.length ?? 0) === 0 ? <li className="text-slate-500">Nothing falls due in the alert window.</li> : null}
        </ul>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- governance administration

interface Rule { code: string; name: string; description: string; locked: boolean; enabled: boolean }
interface Limit { id: number; roleCode: string; roleName: string | null; workflowCode: string | null; departmentName: string | null; maxAmount: number | null; notes: string | null; status: string }
interface Settings { executiveThreshold: number | null; escalationHours: number; escalationRoleCode: string }
interface ChartPosition { id: number; code: string; title: string; departmentName: string | null; reportsToPositionId: number | null; isManagerial: boolean; holderCount: number; holders: string[] }

export function GovernancePage() {
  const { can } = useAuth();
  const client = useQueryClient();
  const configure = can('governance.configure');
  const [error, setError] = useState('');
  const settings = useQuery({ queryKey: ['gov-settings'], queryFn: () => api<{ data: Settings }>('/v1/governance/settings') });
  const rules = useQuery({ queryKey: ['gov-rules'], queryFn: () => api<{ data: Rule[] }>('/v1/governance/segregation-rules') });
  const limits = useQuery({ queryKey: ['gov-limits'], queryFn: () => api<{ data: Limit[] }>('/v1/governance/authority-limits') });
  const roles = useQuery({ queryKey: ['roles-options'], enabled: configure, queryFn: () => api<{ data: Array<{ code: string; name: string; isTechnicalAdmin?: boolean }> }>('/v1/roles?pageSize=100') });
  const invalidate = () => Promise.all(['gov-settings', 'gov-rules', 'gov-limits'].map((key) => client.invalidateQueries({ queryKey: [key] })));
  const onError = (reason: unknown) => setError(errorText(reason));
  const [form, setForm] = useState<{ threshold: string; hours: string; role: string } | null>(null);
  const saveSettings = useMutation({
    mutationFn: () => api('/v1/governance/settings', { method: 'PUT', body: JSON.stringify({ executiveThreshold: form!.threshold === '' ? null : Number(form!.threshold), escalationHours: Number(form!.hours), escalationRoleCode: form!.role }) }),
    onSuccess: async () => { setForm(null); setError(''); await invalidate(); },
    onError,
  });
  const toggle = useMutation({
    mutationFn: (rule: Rule) => {
      const reason = window.prompt(`Reason for switching "${rule.name}" ${rule.enabled ? 'off' : 'on'} (recorded in the audit log)`);
      if (!reason) return Promise.reject(new ApiError(422, 'A reason is required.'));
      return api(`/v1/governance/segregation-rules/${rule.code}`, { method: 'PUT', body: JSON.stringify({ enabled: !rule.enabled, reason }) });
    },
    onSuccess: async () => { setError(''); await invalidate(); },
    onError,
  });
  const [limitForm, setLimitForm] = useState({ roleCode: '', maxAmount: '', notes: '' });
  const addLimit = useMutation({
    mutationFn: () => api('/v1/governance/authority-limits', { method: 'POST', body: JSON.stringify({ roleCode: limitForm.roleCode, maxAmount: limitForm.maxAmount === '' ? null : Number(limitForm.maxAmount), notes: limitForm.notes || null }) }),
    onSuccess: async () => { setLimitForm({ roleCode: '', maxAmount: '', notes: '' }); setError(''); await invalidate(); },
    onError,
  });
  const editLimit = useMutation({
    mutationFn: (input: { id: number; body: Record<string, unknown> }) => api(`/v1/governance/authority-limits/${input.id}`, { method: 'PATCH', body: JSON.stringify(input.body) }),
    onSuccess: async () => { setError(''); await invalidate(); },
    onError,
  });
  const current = settings.data?.data;
  return (
    <section className="space-y-5">
      <PageHeader title="Approval governance" description={configure ? 'Company financial limits and separation-of-duty controls. Every change is audited and the CEO is notified.' : 'The approval authority and controls in force. Only an authorised system administrator can change them.'} />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Executive threshold" note="Expenditure at or above this amount always needs the CEO.">
          {form ? (
            <form className="grid gap-2" onSubmit={(event) => { event.preventDefault(); saveSettings.mutate(); }}>
              <Field label="Threshold (blank turns it off)"><input type="number" min="0" step="0.01" className={controlClass} value={form.threshold} onChange={(event) => setForm({ ...form, threshold: event.target.value })} /></Field>
              <Field label="Escalate after (hours, 0 = never)"><input type="number" min="0" className={controlClass} value={form.hours} onChange={(event) => setForm({ ...form, hours: event.target.value })} required /></Field>
              <Field label="Escalate to role"><input className={controlClass} value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value.toUpperCase() })} required /></Field>
              <div className="flex gap-2"><Button type="submit" disabled={saveSettings.isPending}>Save</Button><Button type="button" variant="secondary" onClick={() => setForm(null)}>Cancel</Button></div>
            </form>
          ) : current ? (
            <div className="space-y-1 text-sm">
              <div className="text-2xl font-bold tabular-nums">{current.executiveThreshold == null ? 'Off' : current.executiveThreshold.toLocaleString()}</div>
              <div className="text-slate-600">Pending steps escalate after {current.escalationHours || 'no'} hours to {current.escalationRoleCode}.</div>
              {configure ? <Button type="button" variant="secondary" className="mt-2" onClick={() => setForm({ threshold: current.executiveThreshold == null ? '' : String(current.executiveThreshold), hours: String(current.escalationHours), role: current.escalationRoleCode })}>Change</Button> : null}
            </div>
          ) : null}
        </Card>
        <div className="lg:col-span-2">
          <Card title="Approval limits by role" note="A manager approves spending up to their limit. Above it, the request escalates to the CEO. Roles without a limit hold no spending authority.">
            <Table headers={['Role', 'Applies to', 'Limit', 'Status', '']} empty={(limits.data?.data.length ?? 0) === 0}>
              {limits.data?.data.map((row) => (
                <tr key={row.id} className="border-t border-line">
                  <td className="px-3 py-2 font-semibold">{row.roleName ?? row.roleCode}</td>
                  <td className="px-3 py-2 text-xs">{[row.workflowCode, row.departmentName].filter(Boolean).join(' · ') || 'All routes'}</td>
                  <td className="px-3 py-2 tabular-nums">{row.maxAmount == null ? 'Unlimited' : row.maxAmount.toLocaleString()}</td>
                  <td className="px-3 py-2"><Badge value={row.status} /></td>
                  <td className="px-3 py-2 text-right">{configure ? (
                    <>
                      <button type="button" className="mr-3 text-sm font-semibold text-pine" onClick={() => {
                        const value = window.prompt('New limit (blank for unlimited)', row.maxAmount == null ? '' : String(row.maxAmount));
                        if (value !== null) editLimit.mutate({ id: row.id, body: { maxAmount: value.trim() === '' ? null : Number(value) } });
                      }}>Change</button>
                      <button type="button" className="text-sm font-semibold text-pine" onClick={() => editLimit.mutate({ id: row.id, body: { status: row.status === 'active' ? 'inactive' : 'active' } })}>{row.status === 'active' ? 'Deactivate' : 'Activate'}</button>
                    </>
                  ) : null}</td>
                </tr>
              ))}
            </Table>
            {configure ? (
              <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); addLimit.mutate(); }}>
                <Field label="Role">
                  <select className={`${controlClass} w-56`} value={limitForm.roleCode} onChange={(event) => setLimitForm({ ...limitForm, roleCode: event.target.value })} required>
                    <option value="">Select</option>
                    {roles.data?.data.filter((role) => !role.isTechnicalAdmin).map((role) => <option key={role.code} value={role.code}>{role.name}</option>)}
                  </select>
                </Field>
                <Field label="Limit"><input type="number" min="0" step="0.01" className={`${controlClass} w-32`} value={limitForm.maxAmount} onChange={(event) => setLimitForm({ ...limitForm, maxAmount: event.target.value })} required /></Field>
                <Field label="Note"><input className={`${controlClass} w-56`} value={limitForm.notes} onChange={(event) => setLimitForm({ ...limitForm, notes: event.target.value })} /></Field>
                <Button type="submit" disabled={addLimit.isPending}>Add limit</Button>
              </form>
            ) : null}
          </Card>
        </div>
      </div>
      <Card title="Separation of duties" note="Controls the system enforces on every decision and payment. Locked controls cannot be switched off.">
        <ul className="divide-y divide-line">
          {rules.data?.data.map((rule) => (
            <li key={rule.code} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-ink">{rule.name}{rule.locked ? <span className="ml-2 text-xs font-normal text-slate-500">mandatory</span> : null}</div>
                <p className="text-sm text-slate-600">{rule.description}</p>
              </div>
              <div className="flex items-center gap-3">
                <Badge value={rule.enabled ? 'active' : 'inactive'} />
                {configure && !rule.locked ? <Button type="button" variant="secondary" onClick={() => toggle.mutate(rule)}>{rule.enabled ? 'Switch off' : 'Switch on'}</Button> : null}
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <OrganisationChart />
    </section>
  );
}

export function OrganisationChart() {
  const chart = useQuery({ queryKey: ['org-chart'], queryFn: () => api<{ data: ChartPosition[] }>('/v1/governance/organisation-chart') });
  const positions = chart.data?.data ?? [];
  const children = (id: number | null) => positions.filter((position) => position.reportsToPositionId === id);
  const roots = positions.filter((position) => position.reportsToPositionId == null || !positions.some((other) => other.id === position.reportsToPositionId));
  const render = (position: ChartPosition, depth: number): ReactNode => (
    <li key={position.id}>
      <div className={`flex flex-wrap items-center gap-2 py-1 ${depth === 0 ? 'font-bold' : depth === 1 ? 'font-semibold' : ''}`} style={{ paddingLeft: depth * 18 }}>
        <span className="text-ink">{position.title}</span>
        {position.departmentName ? <span className="text-xs text-slate-500">{position.departmentName}</span> : null}
        <span className={`rounded-full px-2 py-0.5 text-xs ${position.holderCount ? 'bg-khaki text-navy' : 'bg-cream text-olive'}`}>{position.holderCount ? (position.holders.length ? position.holders.join(', ') : `${position.holderCount} filled`) : 'vacant'}</span>
      </div>
      {children(position.id).length ? <ul>{children(position.id).map((child) => render(child, depth + 1))}</ul> : null}
    </li>
  );
  return (
    <Card title="Management structure" note="Every department head reports to the CEO. Only a system administrator can change positions and reporting lines.">
      <ul className="text-sm">{roots.map((position) => render(position, 0))}</ul>
    </Card>
  );
}
