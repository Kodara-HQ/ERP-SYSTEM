import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { Button, controlClass, ErrorText, Field, PageHeader } from '../components/ui';
import { ReportDownloads } from '../components/ReportDownloads';

interface ReportOption { code: string; name: string; description: string }
interface ReportTable { title: string; columns: string[]; rows: Array<Array<string | number>> }
interface Report { code: string; name: string; from: string; to: string; period: string; title: string; generatedAt: string; tables: ReportTable[] }

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function ordinal(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return `${day}th`;
  return `${day}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th'}`;
}

/** 2026-11-10 → "10th November 2026" */
export function longDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return '';
  return `${ordinal(day)} ${months[month - 1]} ${year}`;
}

const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function presets(): Array<{ label: string; from: string; to: string }> {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  const quarterStart = Math.floor(m / 3) * 3;
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 29);
  return [
    { label: 'This month', from: iso(new Date(y, m, 1)), to: iso(today) },
    { label: 'Last month', from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) },
    { label: 'Last 30 days', from: iso(thirtyDaysAgo), to: iso(today) },
    { label: 'This quarter', from: iso(new Date(y, quarterStart, 1)), to: iso(today) },
    { label: 'This year', from: iso(new Date(y, 0, 1)), to: iso(today) },
    { label: 'Last year', from: iso(new Date(y - 1, 0, 1)), to: iso(new Date(y - 1, 11, 31)) },
  ];
}

function formatCell(value: string | number): string {
  return typeof value === 'number' ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : value;
}

export function ReportsPage() {
  const ranges = useMemo(presets, []);
  const [type, setType] = useState('');
  const [from, setFrom] = useState(ranges[0].from);
  const [to, setTo] = useState(ranges[0].to);

  const options = useQuery({ queryKey: ['report-types'], queryFn: () => api<{ data: ReportOption[] }>('/v1/reports') });
  useEffect(() => {
    if (!type && options.data?.data.length) setType(options.data.data[0].code);
  }, [options.data, type]);

  const validRange = Boolean(from && to && from <= to);
  const suffix = `?from=${from}&to=${to}`;
  const report = useQuery({
    queryKey: ['report', type, from, to],
    enabled: Boolean(type) && validRange,
    queryFn: () => api<{ data: Report }>(`/v1/reports/${type}${suffix}`),
  });
  const chosen = options.data?.data.find((option) => option.code === type);
  const periodText = validRange ? `${longDate(from)} - ${longDate(to)}` : '';

  return (
    <section>
      <PageHeader
        title="Reports"
        description="Choose the report you need and the period it should cover. Figures come straight from the company records, and every report can be downloaded or printed."
      />

      <div className="mb-4 grid gap-4 rounded-lg border border-line bg-white p-4 print:hidden">
        <div className="grid gap-4 md:grid-cols-[1.2fr_1fr_1fr]">
          <Field label="Report">
            <select className={controlClass} value={type} onChange={(event) => setType(event.target.value)}>
              {options.data?.data.map((option) => <option key={option.code} value={option.code}>{option.name}</option>)}
            </select>
          </Field>
          <Field label="From">
            <input className={controlClass} type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} />
          </Field>
          <Field label="To">
            <input className={controlClass} type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} />
          </Field>
        </div>
        {chosen ? <p className="-mt-2 text-xs text-slate-500">{chosen.description}</p> : null}
        <div className="flex flex-wrap gap-2">
          {ranges.map((range) => (
            <button
              key={range.label}
              type="button"
              onClick={() => { setFrom(range.from); setTo(range.to); }}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${from === range.from && to === range.to ? 'border-pine bg-pine text-cream' : 'border-line bg-white text-pine hover:bg-cream'}`}
            >
              {range.label}
            </button>
          ))}
        </div>
        {!validRange ? <ErrorText>Choose a start date that is on or before the end date.</ErrorText> : null}
      </div>

      {options.isError ? <ErrorText>{options.error instanceof ApiError ? options.error.message : 'Reports could not be loaded.'}</ErrorText> : null}

      {type && validRange ? (
        <article className="rounded-lg border border-line bg-white">
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h2 className="text-xl font-semibold text-ink">{chosen?.name ?? 'Report'}</h2>
              <p className="mt-1 text-base font-semibold text-pine">{periodText}</p>
              {report.data ? <p className="mt-1 text-xs text-slate-500">Prepared {new Date(report.data.data.generatedAt).toLocaleString()}</p> : null}
            </div>
            <div className="flex flex-wrap gap-2 print:hidden">
              <ReportDownloads base={`/api/v1/reports/${type}.csv${suffix}`} />
              <Button variant="secondary" className="h-9" onClick={() => window.print()}>Print</Button>
            </div>
          </header>
          <div className="grid gap-6 px-5 py-4">
            {report.isLoading ? <p className="text-sm text-slate-500">Preparing the report…</p> : null}
            {report.isError ? <ErrorText>{report.error instanceof ApiError ? report.error.message : 'The report could not be prepared.'}</ErrorText> : null}
            {report.data?.data.tables.map((table) => (
              <section key={table.title}>
                <h3 className="mb-2 font-semibold">{table.title}</h3>
                {table.rows.length === 0 ? (
                  <p className="rounded-md bg-canvas px-3 py-3 text-sm text-slate-500">Nothing recorded in this period.</p>
                ) : (
                  <div className="overflow-x-auto rounded-md border border-line">
                    <table className="min-w-full text-left text-sm">
                      <thead className="bg-canvas text-xs uppercase tracking-wide text-slate-500">
                        <tr>{table.columns.map((column) => <th key={column} className="px-3 py-2">{column}</th>)}</tr>
                      </thead>
                      <tbody>
                        {table.rows.map((row, index) => (
                          <tr key={index} className="border-t border-line">
                            {row.map((cell, cellIndex) => (
                              <td key={cellIndex} className={`px-3 py-2 ${typeof cell === 'number' ? 'text-right tabular-nums' : ''}`}>{formatCell(cell)}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            ))}
          </div>
        </article>
      ) : null}
    </section>
  );
}
