import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, Loader2, type LucideIcon } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { Badge, Button, controlClass, ErrorText, Field, Modal } from './ui';

export const chartColors = { pine: '#545233', navy: '#3E3C28', olive: '#878571', khaki: '#D9D7B6', green: '#0ca30c', amber: '#fab219', red: '#d03b3b', clay: '#d97a5b' };
export const seriesColors = [chartColors.pine, chartColors.amber, chartColors.clay, chartColors.olive, chartColors.navy, chartColors.green];
export const axisProps = { tick: { fontSize: 12, fill: '#6A6854' }, axisLine: false, tickLine: false } as const;

export function errorMessage(reason: unknown): string {
  return reason instanceof ApiError ? reason.message : 'The request could not be completed.';
}

export const label = (value: string | null | undefined) => (value ? value.replaceAll('_', ' ') : '—');
export const kg = (value: number | null | undefined) => (value == null ? '—' : `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg`);
export const amount = (value: number | null | undefined) => (value == null ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: 2 }));

/** A GET request for a farm page, keyed so every screen refreshes after a change. */
export function useFarmQuery<T>(path: string, enabled = true) {
  return useQuery({ queryKey: ['farm', path], queryFn: () => api<{ data: T }>(`/v1${path}`).then((response) => response.data), enabled });
}

/** A change that refreshes every farm screen when it succeeds. */
export function useFarmAction<I = unknown>(run: (input: I) => Promise<unknown>, options?: { onDone?: () => void; extraKeys?: QueryKey[] }) {
  const client = useQueryClient();
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: run,
    onSuccess: async () => {
      setError('');
      options?.onDone?.();
      await client.invalidateQueries({ queryKey: ['farm'] });
      for (const key of options?.extraKeys ?? []) await client.invalidateQueries({ queryKey: key });
      await client.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (reason) => setError(errorMessage(reason)),
  });
  return { ...mutation, error, setError };
}

export const send = (path: string, method: 'POST' | 'PUT' | 'PATCH', body?: unknown) =>
  api(`/v1${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });

export function StatusBadge({ value }: { value: string }) {
  const tone: Record<string, string> = {
    overdue: 'bg-[#fbe3e3] text-[#8d2f2f]', critical: 'bg-[#8d2f2f] text-white', high: 'bg-[#fbe3e3] text-[#8d2f2f]',
    returned: 'bg-[#fdf1d6] text-[#8a5a00]', recorded: 'bg-[#fdf1d6] text-[#8a5a00]', requested: 'bg-[#fdf1d6] text-[#8a5a00]', reported: 'bg-[#fdf1d6] text-[#8a5a00]',
    in_transit: 'bg-[#e3ecf9] text-[#2f5ea8]', in_progress: 'bg-[#e3ecf9] text-[#2f5ea8]', scheduled: 'bg-[#e3ecf9] text-[#2f5ea8]',
    delivered: 'bg-[#e3f3e3] text-[#0a7d0a]', verified: 'bg-[#e3f3e3] text-[#0a7d0a]', acknowledged: 'bg-[#e3f3e3] text-[#0a7d0a]', completed: 'bg-[#e3f3e3] text-[#0a7d0a]',
    fulfilled: 'bg-[#e3f3e3] text-[#0a7d0a]', resolved: 'bg-[#e3f3e3] text-[#0a7d0a]', good: 'bg-[#e3f3e3] text-[#0a7d0a]', maintenance: 'bg-[#fdf1d6] text-[#8a5a00]',
    poor: 'bg-[#fbe3e3] text-[#8d2f2f]', out_of_service: 'bg-[#fbe3e3] text-[#8d2f2f]',
  };
  return tone[value] ? <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${tone[value]}`}>{label(value)}</span> : <Badge value={value} />;
}

export function PageTitle({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-olive">Farm operations</div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
        <p className="mt-0.5 max-w-3xl text-sm text-slate-600">{description}</p>
      </div>
      {action ? <div className="flex flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}

export function StatCard({ label: title, value, note, icon: Icon, to, tone = 'bg-pine text-cream' }: { label: string; value: ReactNode; note?: string; icon: LucideIcon; to?: string; tone?: string }) {
  const body = (
    <>
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${tone}`}><Icon size={20} /></span>
      <span className="min-w-0">
        <span className="block truncate text-sm text-slate-500">{title}</span>
        <span className="block text-2xl font-bold tabular-nums tracking-tight text-ink">{value}</span>
        {note ? <span className="block truncate text-xs text-slate-500">{note}</span> : null}
      </span>
    </>
  );
  const base = 'flex items-center gap-3 rounded-xl border border-line bg-white p-4 shadow-card';
  return to ? <Link to={to} className={`${base} transition hover:-translate-y-0.5 hover:border-pine`}>{body}</Link> : <div className={base}>{body}</div>;
}

export function Panel({ title, note, children, action, className = '' }: { title: string; note?: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-white p-4 shadow-card ${className}`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-ink">{title}</h2>
          {note ? <p className="text-xs text-slate-500">{note}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function LoadState({ loading, error, empty, children }: { loading?: boolean; error?: unknown; empty?: boolean; children: ReactNode }) {
  if (loading) return <div className="flex items-center gap-2 px-4 py-10 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Loading…</div>;
  if (error) return <div className="flex items-center gap-2 px-4 py-6 text-sm text-[#8d2f2f]"><AlertTriangle size={16} /> {errorMessage(error)}</div>;
  if (empty) return <div className="flex flex-col items-center gap-1 px-4 py-10 text-center text-sm text-slate-500"><Inbox size={20} /> Nothing recorded yet.</div>;
  return <>{children}</>;
}

export interface Column<T> { header: string; cell: (row: T) => ReactNode; className?: string }
export interface TableFilter<T> { label: string; options: Array<{ value: string; label: string }>; match: (row: T, value: string) => boolean }

/** A searchable, filterable, paginated table with loading, empty, and error states. */
export function DataTable<T extends object>({ rows, columns, search, filters = [], loading, error, pageSize = 15, rowKey, onRowClick }: {
  rows: T[] | undefined; columns: Column<T>[]; search?: (row: T) => string; filters?: TableFilter<T>[]; loading?: boolean; error?: unknown;
  pageSize?: number; rowKey?: (row: T, index: number) => string | number; onRowClick?: (row: T) => void;
}) {
  const [term, setTerm] = useState('');
  const [chosen, setChosen] = useState<Record<number, string>>({});
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => (rows ?? []).filter((row) => {
    if (term && search && !search(row).toLowerCase().includes(term.toLowerCase())) return false;
    return filters.every((filter, index) => !chosen[index] || filter.match(row, chosen[index]!));
  }), [rows, term, chosen, filters, search]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => { if (page > pages) setPage(1); }, [page, pages]);
  const shown = filtered.slice((page - 1) * pageSize, page * pageSize);
  return (
    <div className="grid gap-2">
      {search || filters.length ? (
        <div className="flex flex-wrap gap-2">
          {search ? <input className={`${controlClass} max-w-xs`} placeholder="Search" value={term} onChange={(event) => { setTerm(event.target.value); setPage(1); }} aria-label="Search" /> : null}
          {filters.map((filter, index) => (
            <select key={filter.label} className={`${controlClass} w-auto min-w-[9rem]`} value={chosen[index] ?? ''} aria-label={filter.label}
              onChange={(event) => { setChosen({ ...chosen, [index]: event.target.value }); setPage(1); }}>
              <option value="">{filter.label}: all</option>
              {filter.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          ))}
        </div>
      ) : null}
      <div className="overflow-hidden rounded-xl border border-line bg-white shadow-card">
        <LoadState loading={loading} error={error} empty={!loading && !error && filtered.length === 0}>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-canvas text-xs uppercase tracking-wide text-slate-500">
                <tr>{columns.map((column) => <th key={column.header} className={`whitespace-nowrap px-3 py-2.5 font-semibold ${column.className ?? ''}`}>{column.header}</th>)}</tr>
              </thead>
              <tbody>
                {shown.map((row, index) => (
                  <tr key={rowKey ? rowKey(row, index) : (row as { id?: number | string }).id ?? index} className={`border-t border-line align-top ${onRowClick ? 'cursor-pointer hover:bg-canvas/60' : ''}`} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                    {columns.map((column) => <td key={column.header} className={`px-3 py-2.5 ${column.className ?? ''}`}>{column.cell(row)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </LoadState>
      </div>
      {filtered.length > pageSize ? (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>{filtered.length} records</span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft size={16} /></Button>
            <span className="tabular-nums">{page} / {pages}</span>
            <Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight size={16} /></Button>
          </div>
        </div>
      ) : <div className="text-xs text-slate-500">{filtered.length} records</div>}
    </div>
  );
}

export interface FieldDef {
  name: string; label: string; type?: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox';
  options?: Array<{ value: string | number; label: string }>; required?: boolean; help?: string; step?: string; wide?: boolean;
}

type Values = Record<string, string | boolean>;

function toValues(fields: FieldDef[], initial?: Record<string, unknown>): Values {
  const values: Values = {};
  for (const field of fields) {
    const value = initial?.[field.name];
    values[field.name] = field.type === 'checkbox' ? Boolean(value) : value == null ? '' : String(value);
  }
  return values;
}

/** Converts form strings to the API's types: numbers, ids, nulls for blanks. */
export function payload(fields: FieldDef[], values: Values): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const field of fields) {
    const value = values[field.name];
    if (field.type === 'checkbox') { body[field.name] = Boolean(value); continue; }
    if (value === '' || value === undefined) { body[field.name] = null; continue; }
    body[field.name] = field.type === 'number' || (field.type === 'select' && /Id$/.test(field.name)) ? Number(value) : value;
  }
  return body;
}

/** A form dialog built from field definitions. Blank optional fields are sent as null. */
export function FormModal({ title, fields, initial, submitLabel = 'Save', onClose, onSubmit, pending, error, note }: {
  title: string; fields: FieldDef[]; initial?: Record<string, unknown>; submitLabel?: string; onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void; pending?: boolean; error?: string; note?: ReactNode;
}) {
  const [values, setValues] = useState<Values>(() => toValues(fields, initial));
  return (
    <Modal title={title} onClose={onClose}>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => {
        event.preventDefault();
        const body = payload(fields, values);
        for (const field of fields) if (!field.required && body[field.name] === null && initial?.[field.name] === undefined && field.type !== 'checkbox') delete body[field.name];
        onSubmit(body);
      }}>
        {note ? <div className="text-sm text-slate-600 sm:col-span-2">{note}</div> : null}
        {error ? <div className="sm:col-span-2"><ErrorText>{error}</ErrorText></div> : null}
        {fields.map((field) => (
          <div key={field.name} className={field.wide || field.type === 'textarea' ? 'sm:col-span-2' : ''}>
            {field.type === 'checkbox' ? (
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input type="checkbox" className="h-4 w-4" checked={Boolean(values[field.name])} onChange={(event) => setValues({ ...values, [field.name]: event.target.checked })} />
                {field.label}
              </label>
            ) : (
              <Field label={`${field.label}${field.required ? ' *' : ''}`}>
                {field.type === 'textarea' ? (
                  <textarea className={`${controlClass} h-20 py-2`} required={field.required} value={String(values[field.name])} onChange={(event) => setValues({ ...values, [field.name]: event.target.value })} />
                ) : field.type === 'select' ? (
                  <select className={controlClass} required={field.required} value={String(values[field.name])} onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}>
                    <option value="">Select</option>
                    {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                ) : (
                  <input className={controlClass} type={field.type ?? 'text'} step={field.step ?? (field.type === 'number' ? 'any' : undefined)} min={field.type === 'number' ? 0 : undefined}
                    required={field.required} value={String(values[field.name])} onChange={(event) => setValues({ ...values, [field.name]: event.target.value })} />
                )}
              </Field>
            )}
            {field.help ? <p className="mt-1 text-xs text-slate-500">{field.help}</p> : null}
          </div>
        ))}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={pending}>{pending ? 'Saving…' : submitLabel}</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Confirmation for sensitive actions, optionally asking for a reason. */
export function ConfirmDialog({ title, message, confirmLabel, danger, reasonLabel, reasonRequired, onConfirm, onClose, pending, error }: {
  title: string; message: ReactNode; confirmLabel: string; danger?: boolean; reasonLabel?: string; reasonRequired?: boolean;
  onConfirm: (reason: string) => void; onClose: () => void; pending?: boolean; error?: string;
}) {
  const [reason, setReason] = useState('');
  return (
    <Modal title={title} onClose={onClose}>
      <div className="grid gap-3 text-sm">
        <div className="text-slate-700">{message}</div>
        {error ? <ErrorText>{error}</ErrorText> : null}
        {reasonLabel ? (
          <Field label={`${reasonLabel}${reasonRequired ? ' *' : ''}`}>
            <textarea className={`${controlClass} h-20 py-2`} value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="button" variant={danger ? 'danger' : 'primary'} disabled={pending || (reasonRequired && reason.trim().length < 8)} onClick={() => onConfirm(reason.trim())}>
            {pending ? 'Working…' : confirmLabel}
          </Button>
        </div>
        {reasonRequired ? <p className="text-xs text-slate-500">A reason of at least 8 characters is recorded in the audit log.</p> : null}
      </div>
    </Modal>
  );
}

export type Period = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom';
export interface PeriodValue { period: Period; from: string; to: string }

export function periodQuery(value: PeriodValue): string {
  return value.period === 'custom' ? `period=custom&from=${value.from}&to=${value.to}` : `period=${value.period}`;
}

export function PeriodPicker({ value, onChange }: { value: PeriodValue; onChange: (value: PeriodValue) => void }) {
  const options: Array<[Period, string]> = [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['quarter', 'This quarter'], ['year', 'This year'], ['custom', 'Custom']];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap rounded-lg border border-line bg-white p-0.5">
        {options.map(([key, text]) => (
          <button key={key} type="button" onClick={() => onChange({ ...value, period: key })}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold ${value.period === key ? 'bg-pine text-cream' : 'text-slate-600 hover:bg-canvas'}`}>{text}</button>
        ))}
      </div>
      {value.period === 'custom' ? (
        <div className="flex items-center gap-1">
          <input type="date" className={`${controlClass} w-40`} value={value.from} onChange={(event) => onChange({ ...value, from: event.target.value })} aria-label="From" />
          <span className="text-slate-500">to</span>
          <input type="date" className={`${controlClass} w-40`} value={value.to} onChange={(event) => onChange({ ...value, to: event.target.value })} aria-label="To" />
        </div>
      ) : null}
    </div>
  );
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Photographs and documents attached to a daily report or incident. Attachments cannot be removed. */
export function Attachments({ entity, id, canAdd }: { entity: 'daily-reports' | 'incidents'; id: number; canAdd: boolean }) {
  const files = useFarmQuery<Array<{ id: number; fileName: string; contentType: string; sizeBytes: number; uploadedBy: string }>>(`/farm/${entity}/${id}/documents`);
  const upload = useFarmAction(async (file: File) => {
    if (file.size > 5 * 1024 * 1024) throw new ApiError(413, 'A file can be at most 5 MB.');
    return send(`/farm/${entity}/${id}/documents`, 'POST', { fileName: file.name, contentType: file.type || 'application/octet-stream', contentBase64: await readBase64(file) });
  });
  return (
    <div className="grid gap-2">
      <div className="text-sm font-semibold text-ink">Photographs and attachments</div>
      {upload.error ? <ErrorText>{upload.error}</ErrorText> : null}
      <ul className="grid gap-2 sm:grid-cols-2">
        {files.data?.map((file) => (
          <li key={file.id} className="rounded-md border border-line p-2 text-sm">
            {file.contentType.startsWith('image/') ? (
              <a href={`/api/v1/farm/${entity}/${id}/documents/${file.id}`} target="_blank" rel="noreferrer">
                <img src={`/api/v1/farm/${entity}/${id}/documents/${file.id}`} alt={file.fileName} className="mb-1 h-28 w-full rounded object-cover" />
              </a>
            ) : null}
            <a className="font-semibold text-pine" href={`/api/v1/farm/${entity}/${id}/documents/${file.id}`}>{file.fileName}</a>
            <div className="text-xs text-slate-500">{Math.ceil(file.sizeBytes / 1024)} KB · {file.uploadedBy}</div>
          </li>
        ))}
        {files.data && files.data.length === 0 ? <li className="text-sm text-slate-500">No attachments.</li> : null}
      </ul>
      {canAdd ? (
        <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-semibold hover:bg-cream">
          {upload.isPending ? 'Uploading…' : 'Add photo or file'}
          <input type="file" className="hidden" accept="image/png,image/jpeg,.pdf,.docx,.xlsx" disabled={upload.isPending}
            onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.target.value = ''; }} />
        </label>
      ) : null}
    </div>
  );
}
