import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Button, controlClass, Empty, ErrorText, Field, Modal, PageHeader } from './ui';

export interface FieldDef {
  name: string;
  label: string;
  kind?: 'text' | 'textarea' | 'select' | 'checkbox';
  options?: { value: string; label: string }[];
  required?: boolean;
}

interface PageResponse<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}

export function RecordPage<T extends { id: number; status: string }>({
  title,
  description,
  endpoint,
  managePermission,
  columns,
  fields,
  empty,
}: {
  title: string;
  description: string;
  endpoint: string;
  managePermission: string;
  columns: { header: string; cell: (row: T) => ReactNode }[];
  fields: FieldDef[];
  empty: string;
}) {
  const { can } = useAuth();
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('active');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [error, setError] = useState('');
  const form = useForm<Record<string, string | boolean>>();
  const queryKey = [endpoint, page, search, status];
  const records = useQuery({
    queryKey,
    queryFn: () => api<PageResponse<T>>(`${endpoint}?page=${page}&pageSize=20&search=${encodeURIComponent(search)}&status=${status}`),
  });

  const save = useMutation({
    mutationFn: async (values: Record<string, string | boolean>) => {
      const payload: Record<string, unknown> = {};
      for (const field of fields) {
        const value = values[field.name];
        if (field.kind === 'checkbox') {
          payload[field.name] = Boolean(value);
          continue;
        }
        if (value === '' || value === undefined) continue;
        payload[field.name] = field.name.endsWith('Id') ? Number(value) : value;
      }
      if (editing) {
        return api(`${endpoint}/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      }
      return api(endpoint, { method: 'POST', body: JSON.stringify(payload) });
    },
    onSuccess: async () => {
      setOpen(false);
      setEditing(null);
      form.reset();
      await client.invalidateQueries({ queryKey: [endpoint] });
    },
    onError: (reason) => setError(reason instanceof ApiError ? reason.message : 'Save failed.'),
  });

  const deactivate = useMutation({
    mutationFn: (id: number) => api(`${endpoint}/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'inactive' }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: [endpoint] }),
    onError: (reason) => setError(reason instanceof ApiError ? reason.message : 'The record could not be deactivated.'),
  });

  const pages = useMemo(() => Math.max(1, Math.ceil((records.data?.meta.total ?? 0) / 20)), [records.data]);
  const manageable = can(managePermission);

  function startEdit(row: T) {
    const values: Record<string, string | boolean> = {};
    for (const field of fields) {
      const current = (row as Record<string, unknown>)[field.name];
      values[field.name] = typeof current === 'boolean' ? current : current == null ? '' : String(current);
    }
    form.reset(values);
    setEditing(row);
    setError('');
    setOpen(true);
  }

  return (
    <section>
      <PageHeader
        title={title}
        description={description}
        action={manageable ? <Button onClick={() => { form.reset({}); setEditing(null); setError(''); setOpen(true); }}>Add</Button> : null}
      />
      {error ? <div className="mb-4"><ErrorText>{error}</ErrorText></div> : null}
      <div className="mb-3 flex flex-wrap gap-2">
        <input className={`${controlClass} max-w-xs`} placeholder="Search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} aria-label={`Search ${title}`} />
        <select className={`${controlClass} max-w-[10rem]`} value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} aria-label="Status">
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
      </div>
      <div className="overflow-hidden rounded-lg border border-line bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-canvas text-xs uppercase tracking-wide text-slate-500">
              <tr>{columns.map((column) => <th key={column.header} className="px-4 py-3 font-semibold">{column.header}</th>)}{manageable ? <th className="px-4 py-3" /> : null}</tr>
            </thead>
            <tbody>
              {records.data?.data.map((row) => (
                <tr key={row.id} className="border-t border-line">
                  {columns.map((column) => <td key={column.header} className="px-4 py-3">{column.cell(row)}</td>)}
                  {manageable ? (
                    <td className="px-4 py-3 text-right">
                      <button className="mr-3 text-sm font-semibold text-pine" onClick={() => startEdit(row)} type="button">Edit</button>
                      {row.status === 'active' ? <button className="text-sm font-semibold text-[#8d2f2f]" onClick={() => { if (window.confirm('Deactivate this record? Historical links are kept.')) deactivate.mutate(row.id); }} type="button">Deactivate</button> : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {records.isLoading ? <div className="px-4 py-8 text-sm text-slate-500">Loading records…</div> : null}
        {records.data && records.data.data.length === 0 ? <Empty>{empty}</Empty> : null}
      </div>
      <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
        <span>{records.data?.meta.total ?? 0} records</span>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button>
          <span className="grid h-10 place-items-center px-2">{page} / {pages}</span>
          <Button variant="secondary" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>Next</Button>
        </div>
      </div>
      {open ? (
        <Modal title={editing ? `Edit ${title}` : `Add ${title}`} onClose={() => setOpen(false)}>
          <form className="grid gap-4" onSubmit={form.handleSubmit((values) => save.mutate(values))}>
            {fields.map((field) => (
              <Field key={field.name} label={field.label}>
                {field.kind === 'textarea' ? (
                  <textarea className={`${controlClass} h-24 py-2`} {...form.register(field.name, { required: field.required })} />
                ) : field.kind === 'select' ? (
                  <select className={controlClass} {...form.register(field.name, { required: field.required })}>
                    <option value="">Select</option>
                    {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                ) : field.kind === 'checkbox' ? (
                  <input type="checkbox" className="h-4 w-4" {...form.register(field.name)} />
                ) : (
                  <input className={controlClass} {...form.register(field.name, { required: field.required })} />
                )}
              </Field>
            ))}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" type="button" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}

export function StatusCell({ value }: { value: string }) {
  return <Badge value={value} />;
}
