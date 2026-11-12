import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Button, controlClass, ErrorText, Field, Modal, PageHeader } from '../components/ui';

interface UserRow {
  id: number;
  username: string;
  email: string;
  status: string;
  employeeName: string | null;
  mustChangePassword: boolean;
}

interface RoleAssignment { id: number; roleId: number; code: string; name: string; scopeType: string }
interface RoleOption { id: number; code: string; name: string }

export function UsersPage() {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState('');
  const client = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<{ data: UserRow[] }>('/v1/users?pageSize=100') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<{ data: RoleOption[] }>('/v1/roles') });
  const assignments = useQuery({
    queryKey: ['user-roles', selected],
    enabled: selected != null,
    queryFn: () => api<{ data: RoleAssignment[] }>(`/v1/users/${selected}/roles`),
  });
  const form = useForm<Record<string, string>>();
  const roleForm = useForm<Record<string, string>>();
  const create = useMutation({
    mutationFn: (values: Record<string, string>) => api('/v1/users', { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: async () => {
      setOpen(false);
      form.reset();
      await client.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (reason) => setError(reason instanceof ApiError ? reason.message : 'Account was not created.'),
  });
  const assign = useMutation({
    mutationFn: (values: Record<string, string>) => api(`/v1/users/${selected}/roles`, {
      method: 'POST',
      body: JSON.stringify({ roleId: Number(values.roleId), scopeType: values.scopeType, reason: values.reason || undefined }),
    }),
    onSuccess: async () => {
      roleForm.reset();
      await client.invalidateQueries({ queryKey: ['user-roles', selected] });
    },
    onError: (reason) => setError(reason instanceof ApiError ? reason.message : 'Role was not assigned.'),
  });

  return (
    <section>
      <PageHeader title="User accounts" description="A user account is the login. It is not the same thing as the employee or the job position. New accounts must change the temporary password." action={can('users.manage') ? <Button onClick={() => { setError(''); setOpen(true); }}>Create account</Button> : null} />
      {error ? <div className="mb-4"><ErrorText>{error}</ErrorText></div> : null}
      <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
        <div className="overflow-hidden rounded-lg border border-line bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-canvas text-xs uppercase tracking-wide text-slate-500"><tr>{['Username', 'Employee', 'Status'].map((header) => <th key={header} className="px-4 py-3">{header}</th>)}</tr></thead>
            <tbody>
              {users.data?.data.map((user) => (
                <tr key={user.id} className="cursor-pointer border-t border-line hover:bg-canvas" onClick={() => setSelected(user.id)}>
                  <td className="px-4 py-3 font-semibold">{user.username}</td>
                  <td className="px-4 py-3">{user.employeeName || 'Not linked'}</td>
                  <td className="px-4 py-3"><Badge value={user.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <aside className="rounded-lg border border-line bg-white p-4">
          <h2 className="font-semibold">Role assignments</h2>
          {selected == null ? <p className="mt-2 text-sm text-slate-500">Select an account.</p> : null}
          <ul className="mt-3 space-y-2 text-sm">
            {assignments.data?.data.map((role) => <li key={role.id}>{role.name} · {role.scopeType}</li>)}
          </ul>
          {selected != null && can('users.manage') ? (
            <form className="mt-4 grid gap-3" onSubmit={roleForm.handleSubmit((values) => assign.mutate(values))}>
              <Field label="Role"><select className={controlClass} {...roleForm.register('roleId', { required: true })}><option value="">Select</option>{roles.data?.data.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></Field>
              <Field label="Scope"><select className={controlClass} {...roleForm.register('scopeType', { required: true })}><option value="global">Global</option><option value="own">Own records</option></select></Field>
              <Field label="Reason for a protected role"><input className={controlClass} {...roleForm.register('reason')} /></Field>
              <Button type="submit">Assign role</Button>
            </form>
          ) : null}
        </aside>
      </div>
      {open ? (
        <Modal title="Create account" onClose={() => setOpen(false)}>
          <form className="grid gap-3" onSubmit={form.handleSubmit((values) => create.mutate(values))}>
            <Field label="Username"><input className={controlClass} {...form.register('username', { required: true, minLength: 3 })} /></Field>
            <Field label="Email"><input className={controlClass} {...form.register('email', { required: true })} /></Field>
            <Field label="Temporary password"><input className={controlClass} type="password" {...form.register('password', { required: true, minLength: 12 })} /></Field>
            <p className="text-xs text-slate-500">Use at least 12 characters with upper case, lower case, and a digit. The user must change it at first sign-in.</p>
            <Button type="submit" disabled={create.isPending}>Create account</Button>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}
