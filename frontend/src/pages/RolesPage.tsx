import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, controlClass, ErrorText, Field, PageHeader } from '../components/ui';

interface Permission { code: string; module: string; description: string; sensitivity: string }
interface Role {
  id: number;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isTechnicalAdmin: boolean;
  canApproveExpenditure: boolean;
  hasFinalBusinessAuthority: boolean;
  status: string;
  permissions: Permission[];
}

export function RolesPage() {
  const { can } = useAuth();
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [error, setError] = useState('');
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<{ data: Role[] }>('/v1/roles') });
  const permissions = useQuery({ queryKey: ['permissions'], queryFn: () => api<{ data: Permission[] }>('/v1/roles/permissions') });
  const selected = roles.data?.data.find((role) => role.id === selectedId) ?? null;
  const form = useForm<{ code: string; name: string; description: string }>();

  const permissionKey = selected?.permissions.map((permission) => permission.code).join('|') ?? '';
  useEffect(() => {
    setChecked(permissionKey ? permissionKey.split('|') : []);
  }, [selected?.id, permissionKey]);

  const create = useMutation({
    mutationFn: (values: { code: string; name: string; description: string }) => api('/v1/roles', { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['roles'] }),
    onError: (reason) => setError(reason instanceof ApiError ? reason.message : 'Role was not created.'),
  });
  const save = useMutation({
    mutationFn: () => api(`/v1/roles/${selectedId}/permissions`, { method: 'PUT', body: JSON.stringify({ permissions: checked }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['roles'] }),
    onError: (reason) => setError(reason instanceof ApiError ? reason.message : 'Permissions were not saved.'),
  });

  function toggleAllowed(permission: Permission): boolean {
    if (permission.sensitivity === 'standard') return can('roles.manage');
    if (permission.sensitivity === 'technical') return can('roles.manage') && Boolean(selected?.isTechnicalAdmin);
    return can('permissions.manage_protected');
  }

  const grouped = new Map<string, Permission[]>();
  for (const permission of permissions.data?.data ?? []) {
    grouped.set(permission.module, [...(grouped.get(permission.module) ?? []), permission]);
  }

  return (
    <section>
      <PageHeader title="Roles and permissions" description="Technical administration cannot grant expenditure approval or confidential business access. Those grants stay with a role that already holds protected-permission authority." />
      {error ? <div className="mb-4"><ErrorText>{error}</ErrorText></div> : null}
      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <div className="rounded-lg border border-line bg-white">
          {roles.data?.data.map((role) => (
            <button key={role.id} className={`block w-full border-b border-line px-4 py-3 text-left text-sm ${role.id === selectedId ? 'bg-canvas' : ''}`} onClick={() => setSelectedId(role.id)} type="button">
              <div className="font-semibold">{role.name}</div>
              <div className="text-xs text-slate-500">{role.code}{role.canApproveExpenditure ? ' · expenditure' : ''}{role.hasFinalBusinessAuthority ? ' · final approval' : ''}{role.isTechnicalAdmin ? ' · technical' : ''}</div>
            </button>
          ))}
          {can('roles.manage') ? (
            <form className="grid gap-2 p-4" onSubmit={form.handleSubmit((values) => create.mutate(values))}>
              <Field label="New role code"><input className={controlClass} {...form.register('code', { required: true })} /></Field>
              <Field label="Name"><input className={controlClass} {...form.register('name', { required: true })} /></Field>
              <Button type="submit">Create role</Button>
            </form>
          ) : null}
        </div>
        <div className="rounded-lg border border-line bg-white p-4">
          {selected == null ? <p className="text-sm text-slate-500">Select a role to review its permissions.</p> : null}
          {selected ? (
            <>
              <h2 className="text-lg font-semibold">{selected.name}</h2>
              <p className="mb-4 text-sm text-slate-600">{selected.description}</p>
              {[...grouped.entries()].map(([module, items]) => (
                <fieldset key={module} className="mb-4">
                  <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{module}</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {items.map((permission) => {
                      const allowed = toggleAllowed(permission);
                      return (
                        <label key={permission.code} className="flex gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={checked.includes(permission.code)}
                            disabled={!allowed}
                            onChange={(event) => setChecked((current) => event.target.checked ? [...current, permission.code] : current.filter((code) => code !== permission.code))}
                          />
                          <span>
                            <span className="font-semibold">{permission.code}</span>
                            <span className="block text-xs text-slate-500">{permission.description}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
              <Button onClick={() => save.mutate()} disabled={save.isPending}>Save permissions</Button>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
