import { useMemo, useState, type ReactNode } from 'react';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Button, controlClass, ErrorText, Field, Modal, PageHeader } from '../components/ui';

interface UserRoleSummary { code: string; name: string; scopeType: string; scopeName: string | null }
interface UserRow {
  id: number;
  username: string;
  email: string;
  status: string;
  employeeId: number | null;
  employeeName: string | null;
  employeeNumber: string | null;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  roles: UserRoleSummary[];
}
interface RoleAssignment { id: number; roleId: number; code: string; name: string; scopeType: string; scopeId: number | null }
interface RoleOption {
  id: number;
  code: string;
  name: string;
  description: string | null;
  status: string;
  canApproveExpenditure: boolean;
  permissions: { sensitivity: string }[];
}
interface EmployeeOption {
  id: number;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  workEmail: string | null;
  departmentId: number | null;
  departmentName: string | null;
  positionTitle: string | null;
}
interface DepartmentOption { id: number; name: string }

type Scope = 'global' | 'department' | 'own';
interface CreateValues {
  employeeId: string;
  username: string;
  email: string;
  password: string;
  roleId: string;
  scopeType: Scope;
  scopeId: string;
  reason: string;
}
interface AssignValues { roleId: string; scopeType: Scope; scopeId: string; reason: string }

const scopeLabels: Record<string, string> = {
  global: 'Whole company',
  department: 'One department',
  branch: 'One branch',
  own: 'Own records only',
};

const passwordRules = [
  { label: 'At least 12 characters', test: (value: string) => value.length >= 12 },
  { label: 'An upper-case letter', test: (value: string) => /[A-Z]/.test(value) },
  { label: 'A lower-case letter', test: (value: string) => /[a-z]/.test(value) },
  { label: 'A digit', test: (value: string) => /[0-9]/.test(value) },
];

function isProtectedRole(role: RoleOption | undefined): boolean {
  if (!role) return false;
  return role.canApproveExpenditure || role.permissions.some((permission) => permission.sensitivity === 'confidential' || permission.sensitivity === 'expenditure');
}

function generatePassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;
  const pick = (set: string) => set[crypto.getRandomValues(new Uint32Array(1))[0] % set.length];
  const chars = [pick(upper), pick(lower), pick(digits), ...Array.from({ length: 13 }, () => pick(all))];
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swap = crypto.getRandomValues(new Uint32Array(1))[0] % (index + 1);
    [chars[index], chars[swap]] = [chars[swap], chars[index]];
  }
  return chars.join('');
}

function suggestUsername(employee: EmployeeOption): string {
  return `${employee.firstName}.${employee.lastName}`.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 60);
}

function describeScope(scopeType: string, scopeName: string | null): string {
  return scopeName ? `${scopeLabels[scopeType] ?? scopeType}: ${scopeName}` : scopeLabels[scopeType] ?? scopeType;
}

function errorMessage(reason: unknown, fallback: string): string {
  if (reason instanceof ApiError) {
    return reason.details?.length ? reason.details.map((detail) => detail.message).join(' ') : reason.message;
  }
  return fallback;
}

function Section({ step, title, hint, children }: { step: number; title: string; hint: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-3 rounded-md border border-line p-4">
      <legend className="px-1 text-sm font-semibold text-ink">{step}. {title}</legend>
      <p className="-mt-1 text-xs text-slate-500">{hint}</p>
      {children}
    </fieldset>
  );
}

function ScopeFields({
  scopeType,
  register,
  departments,
}: {
  scopeType: Scope;
  register: (name: 'scopeType' | 'scopeId', options?: { required?: boolean }) => UseFormRegisterReturn;
  departments: DepartmentOption[];
}) {
  return (
    <>
      <Field label="Where the role applies">
        <select className={controlClass} {...register('scopeType', { required: true })}>
          <option value="global">{scopeLabels.global}</option>
          <option value="department">{scopeLabels.department}</option>
          <option value="own">{scopeLabels.own}</option>
        </select>
      </Field>
      {scopeType === 'department' ? (
        <Field label="Department">
          <select className={controlClass} {...register('scopeId', { required: true })}>
            <option value="">Select a department</option>
            {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
          </select>
        </Field>
      ) : null}
    </>
  );
}

function roleBody(values: { roleId: string; scopeType: Scope; scopeId: string; reason: string }) {
  return {
    roleId: Number(values.roleId),
    scopeType: values.scopeType,
    scopeId: values.scopeType === 'department' && values.scopeId ? Number(values.scopeId) : undefined,
    reason: values.reason?.trim() || undefined,
  };
}

export function UsersPage() {
  const { can } = useAuth();
  const canManage = can('users.manage');
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [panelError, setPanelError] = useState('');

  const users = useQuery({ queryKey: ['users'], queryFn: () => api<{ data: UserRow[] }>('/v1/users?pageSize=200') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<{ data: RoleOption[] }>('/v1/roles') });
  const employees = useQuery({
    queryKey: ['employee-options-for-accounts'],
    enabled: canManage,
    retry: false,
    queryFn: () => api<{ data: EmployeeOption[] }>('/v1/employees?pageSize=200&status=current'),
  });
  const departments = useQuery({
    queryKey: ['department-options-for-accounts'],
    enabled: canManage,
    retry: false,
    queryFn: () => api<{ data: DepartmentOption[] }>('/v1/organisation/departments?pageSize=200'),
  });

  const activeRoles = useMemo(() => (roles.data?.data ?? []).filter((role) => role.status === 'active'), [roles.data]);
  const linkedEmployeeIds = useMemo(() => new Set((users.data?.data ?? []).map((user) => user.employeeId).filter(Boolean)), [users.data]);
  const unlinkedEmployees = useMemo(
    () => (employees.data?.data ?? []).filter((employee) => !linkedEmployeeIds.has(employee.id)),
    [employees.data, linkedEmployeeIds],
  );
  const selectedUser = users.data?.data.find((user) => user.id === selected) ?? null;

  const refreshUsers = () => client.invalidateQueries({ queryKey: ['users'] });

  return (
    <section>
      <PageHeader
        title="User accounts"
        description="An account is how a person signs in. Link it to their employee record, then give it a role: the role decides what they can see and do. New accounts get a temporary password that must be changed at first sign-in."
        action={canManage ? <Button onClick={() => setOpen(true)}>Create account</Button> : null}
      />
      <div className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
        <div className="overflow-x-auto rounded-lg border border-line bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-canvas text-xs uppercase tracking-wide text-slate-500">
              <tr>{['Account', 'Employee', 'Roles', 'Status'].map((header) => <th key={header} className="px-4 py-3">{header}</th>)}</tr>
            </thead>
            <tbody>
              {users.data?.data.map((user) => (
                <tr
                  key={user.id}
                  className={`cursor-pointer border-t border-line hover:bg-canvas ${user.id === selected ? 'bg-canvas' : ''}`}
                  onClick={() => { setPanelError(''); setSelected(user.id); }}
                >
                  <td className="px-4 py-3">
                    <div className="font-semibold">{user.username}</div>
                    <div className="text-xs text-slate-500">{user.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    {user.employeeName ? (
                      <>
                        <div>{user.employeeName}</div>
                        <div className="text-xs text-slate-500">{user.employeeNumber}</div>
                      </>
                    ) : <span className="text-slate-400">Not linked</span>}
                  </td>
                  <td className="px-4 py-3">
                    {user.roles.length ? (
                      <div className="flex flex-wrap gap-1">
                        {user.roles.map((role, index) => (
                          <span key={`${role.code}-${index}`} title={describeScope(role.scopeType, role.scopeName)} className="rounded-full bg-cream px-2 py-0.5 text-xs font-semibold text-pine">{role.name}</span>
                        ))}
                      </div>
                    ) : <span className="text-xs font-semibold text-[#8d2f2f]">No role: cannot do anything yet</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col items-start gap-1">
                      <Badge value={user.status} />
                      {user.mustChangePassword ? <span className="text-xs text-slate-500">Awaiting first sign-in</span> : null}
                    </div>
                  </td>
                </tr>
              ))}
              {users.data?.data.length === 0 ? <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">No accounts yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <aside className="rounded-lg border border-line bg-white p-4">
          {selectedUser ? (
            <AccountPanel
              key={selectedUser.id}
              user={selectedUser}
              canManage={canManage}
              roles={activeRoles}
              departments={departments.data?.data ?? []}
              unlinkedEmployees={unlinkedEmployees}
              error={panelError}
              setError={setPanelError}
              onChanged={refreshUsers}
            />
          ) : (
            <>
              <h2 className="font-semibold">Account details</h2>
              <p className="mt-2 text-sm text-slate-500">Select an account to see its roles, link an employee, or change its access.</p>
            </>
          )}
        </aside>
      </div>
      {open ? (
        <CreateAccountModal
          roles={activeRoles}
          departments={departments.data?.data ?? []}
          employees={unlinkedEmployees}
          employeesUnavailable={employees.isError}
          onClose={() => setOpen(false)}
          onCreated={async (id) => { await refreshUsers(); setSelected(id); }}
        />
      ) : null}
    </section>
  );
}

function AccountPanel({
  user,
  canManage,
  roles,
  departments,
  unlinkedEmployees,
  error,
  setError,
  onChanged,
}: {
  user: UserRow;
  canManage: boolean;
  roles: RoleOption[];
  departments: DepartmentOption[];
  unlinkedEmployees: EmployeeOption[];
  error: string;
  setError: (message: string) => void;
  onChanged: () => Promise<unknown>;
}) {
  const client = useQueryClient();
  const [linkTo, setLinkTo] = useState('');
  const assignments = useQuery({
    queryKey: ['user-roles', user.id],
    queryFn: () => api<{ data: RoleAssignment[] }>(`/v1/users/${user.id}/roles`),
  });
  const form = useForm<AssignValues>({ defaultValues: { roleId: '', scopeType: 'global', scopeId: '', reason: '' } });
  const roleId = form.watch('roleId');
  const scopeType = form.watch('scopeType');
  const chosenRole = roles.find((role) => String(role.id) === roleId);
  const protectedRole = isProtectedRole(chosenRole);
  const departmentName = (id: number | null) => departments.find((department) => department.id === id)?.name ?? null;

  const afterChange = async () => {
    setError('');
    await client.invalidateQueries({ queryKey: ['user-roles', user.id] });
    await onChanged();
  };
  const assign = useMutation({
    mutationFn: (values: AssignValues) => api(`/v1/users/${user.id}/roles`, { method: 'POST', body: JSON.stringify(roleBody(values)) }),
    onSuccess: async () => { form.reset(); await afterChange(); },
    onError: (reason) => setError(errorMessage(reason, 'Role was not assigned.')),
  });
  const remove = useMutation({
    mutationFn: (assignmentId: number) => api(`/v1/users/${user.id}/roles/${assignmentId}`, { method: 'DELETE' }),
    onSuccess: afterChange,
    onError: (reason) => setError(errorMessage(reason, 'Role was not removed.')),
  });
  const update = useMutation({
    mutationFn: (body: { status?: 'active' | 'disabled'; employeeId?: number | null }) => api(`/v1/users/${user.id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: async () => { setLinkTo(''); await afterChange(); },
    onError: (reason) => setError(errorMessage(reason, 'Account was not updated.')),
  });

  return (
    <div className="grid gap-4">
      <div>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">{user.username}</h2>
            <p className="text-sm text-slate-500">{user.email}</p>
          </div>
          <Badge value={user.status} />
        </div>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-slate-500">Employee</dt>
          <dd>{user.employeeName ? `${user.employeeName} (${user.employeeNumber})` : 'Not linked'}</dd>
          <dt className="text-slate-500">Last sign-in</dt>
          <dd>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Never'}</dd>
        </dl>
      </div>

      {error ? <ErrorText>{error}</ErrorText> : null}

      {canManage && !user.employeeId ? (
        <div className="grid gap-2 rounded-md border border-line p-3">
          <p className="text-sm font-semibold">Link to an employee</p>
          <p className="text-xs text-slate-500">Linking ties this login to a person in HR, so department-based access and approvals work.</p>
          <div className="flex gap-2">
            <select className={controlClass} value={linkTo} onChange={(event) => setLinkTo(event.target.value)}>
              <option value="">Select an employee</option>
              {unlinkedEmployees.map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName} · {employee.employeeNumber}</option>
              ))}
            </select>
            <Button variant="secondary" disabled={!linkTo || update.isPending} onClick={() => update.mutate({ employeeId: Number(linkTo) })}>Link</Button>
          </div>
        </div>
      ) : null}

      <div>
        <h3 className="text-sm font-semibold">Roles</h3>
        {assignments.data?.data.length === 0 ? <p className="mt-1 text-sm text-[#8d2f2f]">No role yet. This person can sign in but cannot see or do anything.</p> : null}
        <ul className="mt-2 grid gap-2 text-sm">
          {assignments.data?.data.map((assignment) => (
            <li key={assignment.id} className="flex items-center justify-between gap-2 rounded-md bg-canvas px-3 py-2">
              <div>
                <div className="font-semibold">{assignment.name}</div>
                <div className="text-xs text-slate-500">{describeScope(assignment.scopeType, assignment.scopeType === 'department' ? departmentName(assignment.scopeId) : null)}</div>
              </div>
              {canManage ? (
                <Button variant="ghost" className="h-8" disabled={remove.isPending} onClick={() => { if (window.confirm(`Remove ${assignment.name} from ${user.username}?`)) remove.mutate(assignment.id); }}>Remove</Button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      {canManage ? (
        <form className="grid gap-3 rounded-md border border-line p-3" onSubmit={form.handleSubmit((values) => assign.mutate(values))}>
          <p className="text-sm font-semibold">Add a role</p>
          <Field label="Role">
            <select className={controlClass} {...form.register('roleId', { required: true })}>
              <option value="">Select a role</option>
              {roles.map((role) => <option key={role.id} value={role.id}>{role.name}{isProtectedRole(role) ? ' (protected)' : ''}</option>)}
            </select>
          </Field>
          {chosenRole?.description ? <p className="-mt-1 text-xs text-slate-500">{chosenRole.description}</p> : null}
          <ScopeFields scopeType={scopeType} register={form.register} departments={departments} />
          {protectedRole ? (
            <Field label="Reason (recorded in the audit log)">
              <input className={controlClass} placeholder="e.g. Appointed HR Manager, approved by CEO" {...form.register('reason', { required: true, minLength: 8 })} />
            </Field>
          ) : null}
          <Button type="submit" disabled={assign.isPending}>Add role</Button>
        </form>
      ) : null}

      {canManage ? (
        <Button
          variant={user.status === 'active' ? 'danger' : 'secondary'}
          disabled={update.isPending}
          onClick={() => {
            const next = user.status === 'active' ? 'disabled' : 'active';
            if (next === 'active' || window.confirm(`Disable ${user.username}? They will be signed out and unable to sign in.`)) update.mutate({ status: next });
          }}
        >
          {user.status === 'active' ? 'Disable account' : 'Enable account'}
        </Button>
      ) : null}
    </div>
  );
}

function CreateAccountModal({
  roles,
  departments,
  employees,
  employeesUnavailable,
  onClose,
  onCreated,
}: {
  roles: RoleOption[];
  departments: DepartmentOption[];
  employees: EmployeeOption[];
  employeesUnavailable: boolean;
  onClose: () => void;
  onCreated: (id: number) => Promise<void>;
}) {
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [created, setCreated] = useState<{ username: string; password: string; roles: UserRoleSummary[] } | null>(null);
  const form = useForm<CreateValues>({
    defaultValues: { employeeId: '', username: '', email: '', password: '', roleId: '', scopeType: 'global', scopeId: '', reason: '' },
  });
  const { register, watch, setValue, formState } = form;
  const password = watch('password') ?? '';
  const roleId = watch('roleId');
  const scopeType = watch('scopeType');
  const chosenRole = roles.find((role) => String(role.id) === roleId);
  const protectedRole = isProtectedRole(chosenRole);

  const pickEmployee = (value: string) => {
    setValue('employeeId', value);
    const employee = employees.find((item) => String(item.id) === value);
    if (!employee) return;
    if (!form.getValues('username')) setValue('username', suggestUsername(employee));
    if (!form.getValues('email') && employee.workEmail) setValue('email', employee.workEmail);
    if (!form.getValues('roleId') && employee.positionTitle) {
      const match = roles.find((role) => role.name.toLowerCase() === employee.positionTitle!.toLowerCase());
      if (match) setValue('roleId', String(match.id));
    }
    if (employee.departmentId) setValue('scopeId', String(employee.departmentId));
  };

  const create = useMutation({
    mutationFn: (values: CreateValues) => api<{ data: UserRow }>('/v1/users', {
      method: 'POST',
      body: JSON.stringify({
        username: values.username,
        email: values.email,
        password: values.password,
        employeeId: values.employeeId ? Number(values.employeeId) : null,
        role: values.roleId ? roleBody(values) : undefined,
      }),
    }),
    onSuccess: async (result, values) => {
      setCreated({ username: result.data.username, password: values.password, roles: result.data.roles ?? [] });
      await onCreated(result.data.id);
    },
    onError: (reason) => setError(errorMessage(reason, 'Account was not created.')),
  });

  if (created) {
    return (
      <Modal title="Account created" onClose={onClose}>
        <div className="grid gap-4 text-sm">
          <p>Give these sign-in details to the person in person or through a separate, private channel. They must choose their own password at first sign-in.</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-md bg-canvas p-4">
            <dt className="text-slate-500">Username</dt>
            <dd className="font-mono font-semibold">{created.username}</dd>
            <dt className="text-slate-500">Temporary password</dt>
            <dd className="flex items-center gap-2 font-mono font-semibold">
              {showPassword ? created.password : '•'.repeat(created.password.length)}
              <button type="button" className="text-xs font-sans text-pine underline" onClick={() => setShowPassword((value) => !value)}>{showPassword ? 'Hide' : 'Show'}</button>
              <button type="button" className="text-xs font-sans text-pine underline" onClick={() => void navigator.clipboard?.writeText(created.password)}>Copy</button>
            </dd>
            <dt className="text-slate-500">Role</dt>
            <dd>{created.roles.length ? created.roles.map((role) => role.name).join(', ') : 'None yet: add one from the account panel'}</dd>
          </dl>
          <Button onClick={onClose}>Done</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Create account" onClose={onClose}>
      <form className="grid gap-4" onSubmit={form.handleSubmit((values) => { setError(''); create.mutate(values); })}>
        <Section step={1} title="Who is this for?" hint="Pick the person's employee record. If they are not in HR yet, add them under Employees first, or leave this empty and link later.">
          <Field label="Employee">
            <select className={controlClass} value={watch('employeeId')} onChange={(event) => pickEmployee(event.target.value)}>
              <option value="">Not linked yet</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.firstName} {employee.lastName} · {employee.employeeNumber}{employee.positionTitle ? ` · ${employee.positionTitle}` : ''}
                </option>
              ))}
            </select>
          </Field>
          {employeesUnavailable ? <p className="text-xs text-slate-500">Employee records could not be loaded for your account.</p> : null}
        </Section>

        <Section step={2} title="Sign-in details" hint="Usernames are saved in lower case.">
          <Field label="Username" error={formState.errors.username ? 'Use 3 to 60 characters.' : undefined}>
            <input className={controlClass} autoComplete="off" placeholder="e.g. ama.mensah" {...register('username', { required: true, minLength: 3, maxLength: 60 })} />
          </Field>
          <Field label="Work email" error={formState.errors.email ? 'Enter a valid email address.' : undefined}>
            <input className={controlClass} type="email" autoComplete="off" {...register('email', { required: true })} />
          </Field>
          <Field label="Temporary password">
            <div className="flex gap-2">
              <input
                className={controlClass}
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                {...register('password', { required: true, validate: (value) => passwordRules.every((rule) => rule.test(value)) })}
              />
              <Button type="button" variant="secondary" onClick={() => setShowPassword((value) => !value)}>{showPassword ? 'Hide' : 'Show'}</Button>
              <Button type="button" variant="secondary" onClick={() => { setValue('password', generatePassword(), { shouldValidate: true }); setShowPassword(true); }}>Generate</Button>
            </div>
          </Field>
          <ul className="grid grid-cols-2 gap-1 text-xs">
            {passwordRules.map((rule) => {
              const ok = rule.test(password);
              return <li key={rule.label} className={ok ? 'text-pine' : 'text-slate-500'}>{ok ? '✓' : '○'} {rule.label}</li>;
            })}
          </ul>
        </Section>

        <Section step={3} title="What can they do?" hint="The role sets their permissions. Without a role the person can sign in but sees nothing.">
          <Field label="Role">
            <select className={controlClass} {...register('roleId')}>
              <option value="">No role yet</option>
              {roles.map((role) => <option key={role.id} value={role.id}>{role.name}{isProtectedRole(role) ? ' (protected)' : ''}</option>)}
            </select>
          </Field>
          {chosenRole?.description ? <p className="-mt-1 text-xs text-slate-500">{chosenRole.description}</p> : null}
          {chosenRole ? <ScopeFields scopeType={scopeType} register={register} departments={departments} /> : null}
          {protectedRole ? (
            <>
              <p className="rounded-md bg-cream px-3 py-2 text-xs text-pine">
                This role can see confidential records or approve spending. The assignment is recorded in the audit log and reported to whoever manages protected permissions.
              </p>
              <Field label="Reason" error={formState.errors.reason ? 'Give a reason of at least 8 characters.' : undefined}>
                <input className={controlClass} placeholder="e.g. Appointed HR Manager, approved by CEO" {...register('reason', { required: true, minLength: 8 })} />
              </Field>
            </>
          ) : null}
        </Section>

        {error ? <ErrorText>{error}</ErrorText> : null}
        <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create account'}</Button>
      </form>
    </Modal>
  );
}
