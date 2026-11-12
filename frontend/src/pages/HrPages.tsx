import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Button, controlClass, ErrorText, Field, PageHeader } from '../components/ui';
import { ReportDownloads } from '../components/ReportDownloads';

function message(error: unknown): string {
  return error instanceof ApiError ? error.message : 'The request failed.';
}

interface LeaveType { id: number; code: string; name: string; daysPerYear: number; paid: boolean }
interface LeaveRow {
  id: number;
  employeeName: string | null;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  status: string;
  approvalRequestId: number | null;
  referenceNumber: string | null;
}
interface Balance { code: string; name: string; entitled: number; used: number; pending: number; available: number }
interface AttendanceRow { id: number; employeeName: string; workDate: string; status: string; checkIn: string | null; checkOut: string | null }
interface Vacancy {
  id: number;
  title: string;
  departmentName: string | null;
  openings: number;
  status: string;
  approvalRequestId: number | null;
  referenceNumber: string | null;
}
interface Applicant { id: number; firstName: string; lastName: string; status: string; employeeId: number | null }
interface Named { id: number; name?: string; title?: string; code: string }
interface EmployeeOption { id: number; employeeNumber: string; firstName: string; lastName: string }

function useOrgOptions(enabled: boolean) {
  const departments = useQuery({ queryKey: ['department-options'], queryFn: () => api<{ data: Named[] }>('/v1/organisation/departments?pageSize=200'), enabled });
  const positions = useQuery({ queryKey: ['position-options'], queryFn: () => api<{ data: Named[] }>('/v1/organisation/positions?pageSize=200'), enabled });
  const branches = useQuery({ queryKey: ['branch-options'], queryFn: () => api<{ data: Named[] }>('/v1/organisation/branches?pageSize=200'), enabled });
  return { departments: departments.data?.data ?? [], positions: positions.data?.data ?? [], branches: branches.data?.data ?? [] };
}

function useEmployees(enabled: boolean) {
  return useQuery({
    queryKey: ['employee-options'],
    queryFn: () => api<{ data: EmployeeOption[] }>('/v1/employees?pageSize=200&status=current'),
    enabled,
  });
}

export function LeavePage() {
  const { can } = useAuth();
  const client = useQueryClient();
  const [error, setError] = useState('');
  const form = useForm<{ leaveTypeCode: string; startDate: string; endDate: string; reason: string; employeeId: string }>();
  const types = useQuery({ queryKey: ['leave-types'], queryFn: () => api<{ data: LeaveType[] }>('/v1/hr/leave-types') });
  const balances = useQuery({ queryKey: ['leave-balances'], queryFn: () => api<{ data: Balance[] }>('/v1/hr/leave/balances') });
  const leave = useQuery({ queryKey: ['leave'], queryFn: () => api<{ data: LeaveRow[] }>('/v1/hr/leave') });
  const employees = useEmployees(can('hr.manage'));
  const submit = useMutation({
    mutationFn: (values: { leaveTypeCode: string; startDate: string; endDate: string; reason: string; employeeId: string }) => api('/v1/hr/leave', {
      method: 'POST',
      body: JSON.stringify({
        leaveTypeCode: values.leaveTypeCode,
        startDate: values.startDate,
        endDate: values.endDate,
        reason: values.reason,
        employeeId: values.employeeId ? Number(values.employeeId) : undefined,
      }),
    }),
    onSuccess: async () => {
      setError('');
      form.reset();
      await client.invalidateQueries({ queryKey: ['leave'] });
      await client.invalidateQueries({ queryKey: ['leave-balances'] });
    },
    onError: (reason) => setError(message(reason)),
  });

  return (
    <section>
      <PageHeader title="Leave" description="Leave is submitted through the central approval route. HR reviews it, and the CEO gives final approval. Paid leave uses the balance for the year of the start date." />
      {error ? <div className="mb-4"><ErrorText>{error}</ErrorText></div> : null}
      {leave.isError ? <div className="mb-4"><ErrorText>{message(leave.error)}</ErrorText></div> : null}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(balances.data?.data ?? []).map((balance) => (
          <article key={balance.code} className="rounded-lg border border-line bg-white px-4 py-3">
            <div className="text-sm text-slate-500">{balance.name}</div>
            <div className="mt-1 text-2xl font-semibold">{balance.available}</div>
            <div className="text-xs text-slate-500">available · {balance.used} used · {balance.pending} pending of {balance.entitled}</div>
          </article>
        ))}
      </div>
      {can('leave.apply') || can('hr.manage') ? (
        <form className="mb-5 grid gap-3 rounded-lg border border-line bg-white p-4 md:grid-cols-2" onSubmit={form.handleSubmit((values) => submit.mutate(values))}>
          {can('hr.manage') ? (
            <Field label="Employee">
              <select className={controlClass} {...form.register('employeeId')}>
                <option value="">My own record</option>
                {(employees.data?.data ?? []).map((employee) => <option key={employee.id} value={employee.id}>{employee.employeeNumber} · {employee.firstName} {employee.lastName}</option>)}
              </select>
            </Field>
          ) : null}
          <Field label="Leave type">
            <select className={controlClass} {...form.register('leaveTypeCode', { required: true })}>
              <option value="">Select</option>
              {(types.data?.data ?? []).map((type) => <option key={type.code} value={type.code}>{type.name}</option>)}
            </select>
          </Field>
          <Field label="Reason"><input className={controlClass} {...form.register('reason', { required: true, minLength: 8 })} /></Field>
          <Field label="Start"><input className={controlClass} type="date" {...form.register('startDate', { required: true })} /></Field>
          <Field label="End"><input className={controlClass} type="date" {...form.register('endDate', { required: true })} /></Field>
          <div><Button type="submit" disabled={submit.isPending}>Submit leave</Button></div>
        </form>
      ) : null}
      <div className="overflow-hidden rounded-lg border border-line bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-canvas text-xs uppercase tracking-wide text-slate-500">
            <tr>{['Employee', 'Type', 'Dates', 'Days', 'Approval', 'Status'].map((header) => <th key={header} className="px-4 py-3">{header}</th>)}</tr>
          </thead>
          <tbody>
            {(leave.data?.data ?? []).map((row) => (
              <tr key={row.id} className="border-t border-line">
                <td className="px-4 py-3">{row.employeeName}</td>
                <td className="px-4 py-3">{row.leaveType}</td>
                <td className="px-4 py-3">{row.startDate} – {row.endDate}</td>
                <td className="px-4 py-3">{row.days}</td>
                <td className="px-4 py-3">{row.approvalRequestId ? <Link className="font-semibold text-pine" to={`/approvals/${row.approvalRequestId}`}>{row.referenceNumber ?? 'Open'}</Link> : '—'}</td>
                <td className="px-4 py-3"><Badge value={row.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {leave.data && leave.data.data.length === 0 ? <div className="px-4 py-8 text-sm text-slate-500">No leave requests yet.</div> : null}
      </div>
    </section>
  );
}

export function AttendancePage() {
  const { can } = useAuth();
  const client = useQueryClient();
  const [error, setError] = useState('');
  const rows = useQuery({ queryKey: ['attendance'], queryFn: () => api<{ data: AttendanceRow[] }>('/v1/hr/attendance') });
  const form = useForm<{ workDate: string; status: 'present' | 'absent' | 'leave' | 'off'; notes: string }>({ defaultValues: { status: 'present' } });
  const checkIn = useMutation({
    mutationFn: () => api('/v1/hr/attendance/check-in', { method: 'POST' }),
    onSuccess: async () => {
      setError('');
      await client.invalidateQueries({ queryKey: ['attendance'] });
    },
    onError: (reason) => setError(message(reason)),
  });
  const record = useMutation({
    mutationFn: (values: { workDate: string; status: string; notes: string }) => api('/v1/hr/attendance', {
      method: 'POST',
      body: JSON.stringify({ ...values, notes: values.notes || null }),
    }),
    onSuccess: async () => {
      setError('');
      form.reset({ status: 'present', workDate: '', notes: '' });
      await client.invalidateQueries({ queryKey: ['attendance'] });
    },
    onError: (reason) => setError(message(reason)),
  });

  return (
    <section>
      <PageHeader title="Attendance" description="Record your own day, or maintain the register when your role includes HR management." action={can('attendance.self') ? <Button onClick={() => checkIn.mutate()} disabled={checkIn.isPending}>Check in or out</Button> : undefined} />
      {error ? <div className="mb-4"><ErrorText>{error}</ErrorText></div> : null}
      {can('hr.manage') ? (
        <form className="mb-5 grid gap-3 rounded-lg border border-line bg-white p-4 md:grid-cols-4" onSubmit={form.handleSubmit((values) => record.mutate(values))}>
          <Field label="Date"><input className={controlClass} type="date" {...form.register('workDate', { required: true })} /></Field>
          <Field label="Status">
            <select className={controlClass} {...form.register('status')}>
              {['present', 'absent', 'leave', 'off'].map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </Field>
          <Field label="Notes"><input className={controlClass} {...form.register('notes')} /></Field>
          <div className="flex items-end"><Button type="submit">Save attendance</Button></div>
        </form>
      ) : null}
      <div className="overflow-hidden rounded-lg border border-line bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-canvas text-xs uppercase tracking-wide text-slate-500">
            <tr>{['Employee', 'Date', 'Status', 'In', 'Out'].map((header) => <th key={header} className="px-4 py-3">{header}</th>)}</tr>
          </thead>
          <tbody>
            {(rows.data?.data ?? []).map((row) => (
              <tr key={row.id} className="border-t border-line">
                <td className="px-4 py-3">{row.employeeName}</td>
                <td className="px-4 py-3">{row.workDate}</td>
                <td className="px-4 py-3"><Badge value={row.status} /></td>
                <td className="px-4 py-3">{row.checkIn ?? '—'}</td>
                <td className="px-4 py-3">{row.checkOut ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.data && rows.data.data.length === 0 ? <div className="px-4 py-8 text-sm text-slate-500">No attendance recorded.</div> : null}
      </div>
    </section>
  );
}

export function RecruitmentPage() {
  const { can } = useAuth();
  const client = useQueryClient();
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const org = useOrgOptions(can('hr.manage'));
  const vacancies = useQuery({ queryKey: ['vacancies'], queryFn: () => api<{ data: Vacancy[] }>('/v1/hr/vacancies') });
  const applicants = useQuery({
    queryKey: ['applicants', selected],
    queryFn: () => api<{ data: Applicant[] }>(`/v1/hr/vacancies/${selected}/applicants`),
    enabled: selected != null && can('hr.manage'),
  });
  const vacancyForm = useForm<{ title: string; departmentId: string; positionId: string; branchId: string; openings: string; description: string }>({ defaultValues: { openings: '1' } });
  const applicantForm = useForm<{ firstName: string; lastName: string; email: string }>();
  const create = useMutation({
    mutationFn: (values: { title: string; departmentId: string; positionId: string; branchId: string; openings: string; description: string }) => api('/v1/hr/vacancies', {
      method: 'POST',
      body: JSON.stringify({
        title: values.title,
        departmentId: Number(values.departmentId),
        positionId: Number(values.positionId),
        branchId: Number(values.branchId),
        openings: Number(values.openings),
        description: values.description || null,
        submit: true,
      }),
    }),
    onSuccess: async () => {
      setError('');
      vacancyForm.reset({ openings: '1' });
      await client.invalidateQueries({ queryKey: ['vacancies'] });
    },
    onError: (reason) => setError(message(reason)),
  });
  const add = useMutation({
    mutationFn: (values: { firstName: string; lastName: string; email: string }) => api(`/v1/hr/vacancies/${selected}/applicants`, {
      method: 'POST',
      body: JSON.stringify({ ...values, email: values.email || null }),
    }),
    onSuccess: async () => {
      setError('');
      applicantForm.reset();
      await client.invalidateQueries({ queryKey: ['applicants', selected] });
    },
    onError: (reason) => setError(message(reason)),
  });
  const hire = useMutation({
    mutationFn: (applicantId: number) => api(`/v1/hr/applicants/${applicantId}/hire`, {
      method: 'POST',
      body: JSON.stringify({ startDate: new Date().toISOString().slice(0, 10) }),
    }),
    onSuccess: async () => {
      setError('');
      await client.invalidateQueries({ queryKey: ['applicants', selected] });
      await client.invalidateQueries({ queryKey: ['employee-options'] });
    },
    onError: (reason) => setError(message(reason)),
  });
  const current = (vacancies.data?.data ?? []).find((item) => item.id === selected);

  return (
    <section>
      <PageHeader title="Recruitment" description="A vacancy stays closed until the recruitment route is approved. Hiring then creates the employee record." />
      {error ? <div className="mb-4"><ErrorText>{error}</ErrorText></div> : null}
      {can('hr.manage') ? (
        <form className="mb-5 grid gap-3 rounded-lg border border-line bg-white p-4 md:grid-cols-2" onSubmit={vacancyForm.handleSubmit((values) => create.mutate(values))}>
          <Field label="Title"><input className={controlClass} {...vacancyForm.register('title', { required: true })} /></Field>
          <Field label="Openings"><input className={controlClass} type="number" min={1} {...vacancyForm.register('openings', { required: true })} /></Field>
          <Field label="Department">
            <select className={controlClass} {...vacancyForm.register('departmentId', { required: true })}>
              <option value="">Select</option>
              {org.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
          <Field label="Position">
            <select className={controlClass} {...vacancyForm.register('positionId', { required: true })}>
              <option value="">Select</option>
              {org.positions.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
          </Field>
          <Field label="Branch">
            <select className={controlClass} {...vacancyForm.register('branchId', { required: true })}>
              <option value="">Select</option>
              {org.branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
          <Field label="Description"><input className={controlClass} {...vacancyForm.register('description')} /></Field>
          <div><Button type="submit" disabled={create.isPending}>Submit vacancy</Button></div>
        </form>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="overflow-hidden rounded-lg border border-line bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-canvas text-xs uppercase tracking-wide text-slate-500">
              <tr>{['Vacancy', 'Department', 'Status'].map((header) => <th key={header} className="px-4 py-3">{header}</th>)}</tr>
            </thead>
            <tbody>
              {(vacancies.data?.data ?? []).map((row) => (
                <tr key={row.id} className="cursor-pointer border-t border-line hover:bg-canvas" onClick={() => setSelected(row.id)}>
                  <td className="px-4 py-3 font-semibold">{row.title}<div className="text-xs font-normal text-slate-500">{row.referenceNumber ?? `${row.openings} opening${row.openings === 1 ? '' : 's'}`}</div></td>
                  <td className="px-4 py-3">{row.departmentName}</td>
                  <td className="px-4 py-3"><Badge value={row.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {vacancies.data && vacancies.data.data.length === 0 ? <div className="px-4 py-8 text-sm text-slate-500">No vacancies yet.</div> : null}
        </div>
        <aside className="rounded-lg border border-line bg-white p-4">
          {current == null ? <p className="text-sm text-slate-500">Select a vacancy.</p> : null}
          {current ? (
            <>
              <h2 className="text-lg font-semibold">{current.title}</h2>
              <p className="mb-3 text-sm text-slate-500">{current.status}{current.approvalRequestId ? ' · ' : ''}</p>
              {can('hr.manage') && current.status === 'open' ? (
                <form className="mb-4 grid gap-2" onSubmit={applicantForm.handleSubmit((values) => add.mutate(values))}>
                  <Field label="First name"><input className={controlClass} {...applicantForm.register('firstName', { required: true })} /></Field>
                  <Field label="Last name"><input className={controlClass} {...applicantForm.register('lastName', { required: true })} /></Field>
                  <Field label="Email"><input className={controlClass} {...applicantForm.register('email')} /></Field>
                  <Button type="submit">Add applicant</Button>
                </form>
              ) : null}
              <ul className="space-y-2 text-sm">
                {(applicants.data?.data ?? []).map((person) => (
                  <li key={person.id} className="flex items-center justify-between gap-2 border-t border-line pt-2">
                    <span>{person.firstName} {person.lastName} · {person.status}</span>
                    {can('hr.manage') && current.status === 'open' && person.status !== 'hired' ? <button className="font-semibold text-pine" type="button" onClick={() => hire.mutate(person.id)}>Hire</button> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

interface Lifecycle {
  contracts: { id: number; contractType: string; startDate: string; endDate: string | null; status: string }[];
  promotions: { id: number; effectiveDate: string; reason: string }[];
  training: { id: number; courseName: string; status: string }[];
  onboarding: { id: number; title: string; completedAt: string | null }[];
  exit: { exitDate: string; reason: string; clearanceStatus: string } | null;
  disciplinary: { id: number; incidentDate: string; category: string; status: string }[];
  appraisals: { id: number; periodEnd: string; rating: number; summary: string }[];
}

export function LifecyclePage() {
  const { can } = useAuth();
  const client = useQueryClient();
  const [employeeId, setEmployeeId] = useState('');
  const [error, setError] = useState('');
  const employees = useEmployees(can('employees.view'));
  const org = useOrgOptions(can('hr.manage'));
  const lifecycle = useQuery({
    queryKey: ['lifecycle', employeeId],
    queryFn: () => api<{ data: Lifecycle }>(`/v1/hr/employees/${employeeId}/lifecycle`),
    enabled: employeeId !== '',
  });
  const id = Number(employeeId);
  const invalidate = async () => {
    await client.invalidateQueries({ queryKey: ['lifecycle', employeeId] });
  };
  const promotion = useForm<{ departmentId: string; positionId: string; branchId: string; effectiveDate: string; reason: string }>();
  const exitForm = useForm<{ exitDate: string; reason: string }>();
  const promote = useMutation({
    mutationFn: (values: { departmentId: string; positionId: string; branchId: string; effectiveDate: string; reason: string }) => api('/v1/hr/promotions', {
      method: 'POST',
      body: JSON.stringify({ employeeId: id, departmentId: Number(values.departmentId), positionId: Number(values.positionId), branchId: Number(values.branchId), effectiveDate: values.effectiveDate, reason: values.reason }),
    }),
    onSuccess: async () => { setError(''); promotion.reset(); await invalidate(); },
    onError: (reason) => setError(message(reason)),
  });
  const exit = useMutation({
    mutationFn: (values: { exitDate: string; reason: string }) => api('/v1/hr/exits', { method: 'POST', body: JSON.stringify({ employeeId: id, ...values }) }),
    onSuccess: async () => { setError(''); exitForm.reset(); await invalidate(); },
    onError: (reason) => setError(message(reason)),
  });
  const record = lifecycle.data?.data;

  return (
    <section>
      <PageHeader title="Employee lifecycle" description="Promotions keep the previous assignment. An exit closes the open assignment, reporting line, and employment record." />
      {error ? <div className="mb-4"><ErrorText>{error}</ErrorText></div> : null}
      <Field label="Employee">
        <select className={`${controlClass} max-w-md`} value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
          <option value="">Select</option>
          {(employees.data?.data ?? []).map((employee) => <option key={employee.id} value={employee.id}>{employee.employeeNumber} · {employee.firstName} {employee.lastName}</option>)}
        </select>
      </Field>
      {record ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <article className="rounded-lg border border-line bg-white p-4 text-sm">
            <h2 className="mb-2 font-semibold">Promotions</h2>
            {record.promotions.length === 0 ? <p className="text-slate-500">None recorded.</p> : record.promotions.map((item) => <p key={item.id}>{item.effectiveDate} · {item.reason}</p>)}
            <h2 className="mb-2 mt-4 font-semibold">Training</h2>
            {record.training.length === 0 ? <p className="text-slate-500">None recorded.</p> : record.training.map((item) => <p key={item.id}>{item.courseName} · {item.status}</p>)}
            <h2 className="mb-2 mt-4 font-semibold">Onboarding</h2>
            {record.onboarding.length === 0 ? <p className="text-slate-500">None recorded.</p> : record.onboarding.map((item) => <p key={item.id}>{item.title}{item.completedAt ? ' · complete' : ''}</p>)}
            <h2 className="mb-2 mt-4 font-semibold">Contracts</h2>
            {record.contracts.length === 0 ? <p className="text-slate-500">None recorded.</p> : record.contracts.map((item) => <p key={item.id}>{item.contractType} from {item.startDate}</p>)}
            {record.exit ? <p className="mt-4">Exit {record.exit.exitDate} · clearance {record.exit.clearanceStatus}</p> : null}
          </article>
          {can('hr.view_confidential') ? (
            <article className="rounded-lg border border-line bg-white p-4 text-sm">
              <h2 className="mb-2 font-semibold">Appraisals</h2>
              {record.appraisals.length === 0 ? <p className="text-slate-500">None recorded.</p> : record.appraisals.map((item) => <p key={item.id}>{item.periodEnd} · rating {item.rating}</p>)}
              <h2 className="mb-2 mt-4 font-semibold">Disciplinary records</h2>
              {record.disciplinary.length === 0 ? <p className="text-slate-500">None recorded.</p> : record.disciplinary.map((item) => <p key={item.id}>{item.incidentDate} · {item.category}</p>)}
            </article>
          ) : null}
          {can('hr.manage') ? (
            <form className="rounded-lg border border-line bg-white p-4" onSubmit={promotion.handleSubmit((values) => promote.mutate(values))}>
              <h2 className="mb-3 font-semibold">Promotion or transfer</h2>
              <div className="grid gap-3">
                <Field label="Department"><select className={controlClass} {...promotion.register('departmentId', { required: true })}><option value="">Select</option>{org.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
                <Field label="Position"><select className={controlClass} {...promotion.register('positionId', { required: true })}><option value="">Select</option>{org.positions.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>
                <Field label="Branch"><select className={controlClass} {...promotion.register('branchId', { required: true })}><option value="">Select</option>{org.branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
                <Field label="Effective date"><input className={controlClass} type="date" {...promotion.register('effectiveDate', { required: true })} /></Field>
                <Field label="Reason"><input className={controlClass} {...promotion.register('reason', { required: true, minLength: 8 })} /></Field>
                <Button type="submit">Record promotion</Button>
              </div>
            </form>
          ) : null}
          {can('hr.manage') ? (
            <form className="rounded-lg border border-line bg-white p-4" onSubmit={exitForm.handleSubmit((values) => exit.mutate(values))}>
              <h2 className="mb-3 font-semibold">Exit</h2>
              <div className="grid gap-3">
                <Field label="Exit date"><input className={controlClass} type="date" {...exitForm.register('exitDate', { required: true })} /></Field>
                <Field label="Reason"><input className={controlClass} {...exitForm.register('reason', { required: true, minLength: 8 })} /></Field>
                <Button type="submit" variant="danger">Record exit</Button>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

interface Report {
  from: string;
  to: string;
  headcount: { department: string; headcount: number }[];
  leave: { leaveType: string; requests: number; days: number }[];
  attendance: { status: string; days: number }[];
  openVacancies: number;
}

export function HrReportsPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const query = new URLSearchParams();
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const report = useQuery({ queryKey: ['hr-report', from, to], queryFn: () => api<{ data: Report }>(`/v1/hr/reports${suffix}`) });
  const data = report.data?.data;

  return (
    <section>
      <PageHeader title="HR reports" description="Counts come from employees, leave, attendance, and vacancies." action={<ReportDownloads base={`/api/v1/hr/reports${suffix}`} />} />
      <div className="mb-4 flex flex-wrap gap-3">
        <Field label="From"><input className={controlClass} type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></Field>
        <Field label="To"><input className={controlClass} type="date" value={to} onChange={(event) => setTo(event.target.value)} /></Field>
      </div>
      {data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <article className="rounded-lg border border-line bg-white p-4 text-sm">
            <h2 className="mb-2 font-semibold">Headcount</h2>
            {data.headcount.map((row) => <p key={row.department}>{row.department}: {row.headcount}</p>)}
            <p className="mt-3">Open vacancies: {data.openVacancies}</p>
          </article>
          <article className="rounded-lg border border-line bg-white p-4 text-sm">
            <h2 className="mb-2 font-semibold">Approved leave, {data.from} to {data.to}</h2>
            {data.leave.map((row) => <p key={row.leaveType}>{row.leaveType}: {row.days} days across {row.requests} requests</p>)}
            <h2 className="mb-2 mt-4 font-semibold">Attendance</h2>
            {data.attendance.length === 0 ? <p className="text-slate-500">No attendance in this range.</p> : data.attendance.map((row) => <p key={row.status}>{row.status}: {row.days}</p>)}
          </article>
        </div>
      ) : null}
    </section>
  );
}
