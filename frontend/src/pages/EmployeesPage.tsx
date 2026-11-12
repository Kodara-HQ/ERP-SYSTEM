import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Button, controlClass, Empty, ErrorText, Field, Modal, PageHeader } from '../components/ui';

interface EmployeeRow {
  id: number;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  workEmail: string | null;
  employmentStatus: string;
  confidentialityLevel: string;
  departmentName: string | null;
  positionTitle: string | null;
  branchName: string | null;
}

interface Option { id: number; name?: string; title?: string; code: string }

export function EmployeesPage() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const client = useQueryClient();
  const employees = useQuery({
    queryKey: ['employees', search],
    queryFn: () => api<{ data: EmployeeRow[] }>(`/v1/employees?pageSize=50&search=${encodeURIComponent(search)}`),
  });
  const branches = useQuery({ queryKey: ['branch-options'], enabled: open, queryFn: () => api<{ data: Option[] }>('/v1/organisation/branches?pageSize=200') });
  const departments = useQuery({ queryKey: ['department-options'], enabled: open, queryFn: () => api<{ data: Option[] }>('/v1/organisation/departments?pageSize=200') });
  const positions = useQuery({ queryKey: ['position-options'], enabled: open, queryFn: () => api<{ data: Array<Option & { title: string; departmentId: number | null }> }>('/v1/organisation/positions?pageSize=200') });
  const form = useForm<Record<string, string>>();
  const create = useMutation({
    mutationFn: (values: Record<string, string>) => api('/v1/employees', {
      method: 'POST',
      body: JSON.stringify({
        firstName: values.firstName,
        lastName: values.lastName,
        workEmail: values.workEmail || null,
        phone: values.phone || null,
        employmentType: values.employmentType,
        employmentStatus: values.employmentStatus || 'active',
        confidentialityLevel: values.confidentialityLevel || 'standard',
        departmentId: Number(values.departmentId),
        positionId: Number(values.positionId),
        branchId: Number(values.branchId),
        assignmentStartDate: values.assignmentStartDate,
        hireDate: values.assignmentStartDate,
      }),
    }),
    onSuccess: async () => {
      setOpen(false);
      form.reset();
      await client.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (reason) => setError(reason instanceof ApiError ? reason.message : 'The employee could not be registered.'),
  });

  return (
    <section>
      <PageHeader
        title="Employees"
        description="Each person is an employee record. Their login, role, and current assignment are separate and keep their history."
        action={can('employees.create') ? <Button onClick={() => { setError(''); setOpen(true); }}>Register employee</Button> : null}
      />
      <input className={`${controlClass} mb-3 max-w-xs`} placeholder="Search name or number" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search employees" />
      <div className="overflow-hidden rounded-lg border border-line bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-canvas text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {['Number', 'Name', 'Department', 'Position', 'Branch', 'Status'].map((header) => <th key={header} className="px-4 py-3 font-semibold">{header}</th>)}
            </tr>
          </thead>
          <tbody>
            {employees.data?.data.map((employee) => (
              <tr key={employee.id} className="border-t border-line">
                <td className="px-4 py-3"><Link className="font-semibold text-pine" to={`/employees/${employee.id}`}>{employee.employeeNumber}</Link></td>
                <td className="px-4 py-3">{employee.firstName} {employee.lastName}</td>
                <td className="px-4 py-3">{employee.departmentName || '—'}</td>
                <td className="px-4 py-3">{employee.positionTitle || '—'}</td>
                <td className="px-4 py-3">{employee.branchName || '—'}</td>
                <td className="px-4 py-3"><Badge value={employee.employmentStatus} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {employees.data?.data.length === 0 ? <Empty>No employees match this search.</Empty> : null}
      </div>
      {open ? (
        <Modal title="Register employee" onClose={() => setOpen(false)}>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={form.handleSubmit((values) => create.mutate(values))}>
            {error ? <div className="sm:col-span-2"><ErrorText>{error}</ErrorText></div> : null}
            <Field label="First name"><input className={controlClass} {...form.register('firstName', { required: true })} /></Field>
            <Field label="Last name"><input className={controlClass} {...form.register('lastName', { required: true })} /></Field>
            <Field label="Work email"><input className={controlClass} {...form.register('workEmail')} /></Field>
            <Field label="Phone"><input className={controlClass} {...form.register('phone')} /></Field>
            <Field label="Branch"><select className={controlClass} {...form.register('branchId', { required: true })}><option value="">Select</option>{branches.data?.data.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
            <Field label="Department"><select className={controlClass} {...form.register('departmentId', { required: true })}><option value="">Select</option>{departments.data?.data.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
            <Field label="Position"><select className={controlClass} {...form.register('positionId', { required: true })}><option value="">Select</option>{positions.data?.data.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>
            <Field label="Start date"><input className={controlClass} type="date" {...form.register('assignmentStartDate', { required: true })} /></Field>
            <Field label="Employment type"><select className={controlClass} {...form.register('employmentType', { required: true })}><option value="permanent">Permanent</option><option value="fixed_term">Fixed term</option><option value="temporary">Temporary</option><option value="casual">Casual</option></select></Field>
            {can('employees.view_confidential') ? <Field label="Confidentiality"><select className={controlClass} {...form.register('confidentialityLevel')}><option value="standard">Standard</option><option value="confidential">Confidential</option><option value="restricted">Restricted</option></select></Field> : null}
            <div className="sm:col-span-2 flex justify-end"><Button type="submit" disabled={create.isPending}>Save employee</Button></div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}

interface Assignment {
  id: number;
  departmentName: string;
  positionTitle: string;
  branchName: string;
  assignmentType: string;
  isPrimary: boolean;
  startDate: string;
  endDate: string | null;
  reason: string | null;
}

interface EmployeeDetail extends EmployeeRow {
  phone: string | null;
  nationalId?: string;
  personalEmail?: string;
  dateOfBirth?: string;
  assignments: Assignment[];
  reportingLines: { id: number; managerName: string; relationshipType: string; isPrimary: boolean; startDate: string; endDate: string | null }[];
}

export function EmployeeDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [error, setError] = useState('');
  const employee = useQuery({ queryKey: ['employee', id], queryFn: () => api<{ data: EmployeeDetail }>(`/v1/employees/${id}`) });
  const departments = useQuery({ queryKey: ['department-options'], queryFn: () => api<{ data: Option[] }>('/v1/organisation/departments?pageSize=200') });
  const positions = useQuery({ queryKey: ['position-options'], queryFn: () => api<{ data: Array<Option & { title: string }> }>('/v1/organisation/positions?pageSize=200') });
  const branches = useQuery({ queryKey: ['branch-options'], queryFn: () => api<{ data: Option[] }>('/v1/organisation/branches?pageSize=200') });
  const form = useForm<Record<string, string>>();
  const transfer = useMutation({
    mutationFn: (values: Record<string, string>) => api(`/v1/employees/${id}/transfers`, {
      method: 'POST',
      body: JSON.stringify({
        departmentId: Number(values.departmentId),
        positionId: Number(values.positionId),
        branchId: Number(values.branchId),
        startDate: values.startDate,
        reason: values.reason,
      }),
    }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['employee', id] }),
    onError: (reason) => setError(reason instanceof ApiError ? reason.message : 'Transfer failed.'),
  });
  const record = employee.data?.data;

  return (
    <section>
      <button className="mb-3 text-sm font-semibold text-pine" onClick={() => navigate('/employees')} type="button">Back to employees</button>
      {employee.isLoading ? <p className="text-sm text-slate-500">Loading employee…</p> : null}
      {employee.isError ? <ErrorText>{employee.error instanceof ApiError ? employee.error.message : 'Employee could not be loaded.'}</ErrorText> : null}
      {record ? (
        <>
          <PageHeader title={`${record.firstName} ${record.lastName}`} description={`${record.employeeNumber} · ${record.positionTitle || 'No current position'} · ${record.departmentName || 'No department'}`} />
          <div className="mb-5 grid gap-3 sm:grid-cols-3">
            <Info label="Status" value={<Badge value={record.employmentStatus} />} />
            <Info label="Confidentiality" value={<Badge value={record.confidentialityLevel} />} />
            <Info label="Branch" value={record.branchName || '—'} />
            {record.nationalId ? <Info label="National ID" value={record.nationalId} /> : null}
            {record.personalEmail ? <Info label="Personal email" value={record.personalEmail} /> : null}
          </div>
          <h2 className="mb-2 text-lg font-semibold">Assignment history</h2>
          <div className="overflow-hidden rounded-lg border border-line bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-canvas text-xs uppercase tracking-wide text-slate-500">
                <tr>{['Department', 'Position', 'Branch', 'Type', 'From', 'To'].map((header) => <th key={header} className="px-4 py-3">{header}</th>)}</tr>
              </thead>
              <tbody>
                {record.assignments.map((assignment) => (
                  <tr key={assignment.id} className="border-t border-line">
                    <td className="px-4 py-3">{assignment.departmentName}</td>
                    <td className="px-4 py-3">{assignment.positionTitle}</td>
                    <td className="px-4 py-3">{assignment.branchName}</td>
                    <td className="px-4 py-3">{assignment.assignmentType}{assignment.isPrimary ? ' · primary' : ''}</td>
                    <td className="px-4 py-3">{String(assignment.startDate).slice(0, 10)}</td>
                    <td className="px-4 py-3">{assignment.endDate ? String(assignment.endDate).slice(0, 10) : 'Current'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {record.assignments.length === 0 ? <Empty>No assignments recorded.</Empty> : null}
          </div>
          <h2 className="mb-2 mt-6 text-lg font-semibold">Reporting lines</h2>
          <ul className="rounded-lg border border-line bg-white">
            {record.reportingLines.length === 0 ? <li className="px-4 py-3 text-sm text-slate-500">No reporting lines.</li> : null}
            {record.reportingLines.map((line) => (
              <li key={line.id} className="border-t border-line px-4 py-3 text-sm first:border-t-0">
                {line.relationshipType} to {line.managerName} · {String(line.startDate).slice(0, 10)} – {line.endDate ? String(line.endDate).slice(0, 10) : 'current'}
              </li>
            ))}
          </ul>
          {can('employees.edit') ? (
            <form className="mt-6 grid max-w-3xl gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-2" onSubmit={form.handleSubmit((values) => transfer.mutate(values))}>
              <h2 className="sm:col-span-2 text-lg font-semibold">Transfer</h2>
              <p className="sm:col-span-2 text-sm text-slate-600">The current primary assignment is closed and kept. It is not overwritten.</p>
              {error ? <div className="sm:col-span-2"><ErrorText>{error}</ErrorText></div> : null}
              <Field label="Department"><select className={controlClass} {...form.register('departmentId', { required: true })}><option value="">Select</option>{departments.data?.data.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
              <Field label="Position"><select className={controlClass} {...form.register('positionId', { required: true })}><option value="">Select</option>{positions.data?.data.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>
              <Field label="Branch"><select className={controlClass} {...form.register('branchId', { required: true })}><option value="">Select</option>{branches.data?.data.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
              <Field label="Start date"><input className={controlClass} type="date" {...form.register('startDate', { required: true })} /></Field>
              <Field label="Reason"><input className={controlClass} {...form.register('reason', { required: true, minLength: 8 })} /></Field>
              <div className="sm:col-span-2"><Button type="submit" disabled={transfer.isPending}>Record transfer</Button></div>
            </form>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return <div className="rounded-lg border border-line bg-white px-4 py-3"><div className="text-xs uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-sm font-semibold">{value}</div></div>;
}
