import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { controlClass, PageHeader } from '../components/ui';

interface AuditRow {
  id: number;
  username: string | null;
  action: string;
  module: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
}

export function AuditPage() {
  const [search, setSearch] = useState('');
  const audit = useQuery({
    queryKey: ['audit', search],
    queryFn: () => api<{ data: AuditRow[] }>(`/v1/audit?pageSize=50&search=${encodeURIComponent(search)}`),
  });
  return (
    <section>
      <PageHeader title="Audit log" description="Important actions are appended here. The application does not provide a way to edit or delete them, and the database rejects those changes." />
      <input className={`${controlClass} mb-3 max-w-xs`} placeholder="Search action or user" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search audit log" />
      <div className="overflow-hidden rounded-lg border border-line bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-canvas text-xs uppercase tracking-wide text-slate-500"><tr>{['When', 'User', 'Action', 'Record'].map((header) => <th key={header} className="px-4 py-3">{header}</th>)}</tr></thead>
          <tbody>
            {audit.data?.data.map((row) => (
              <tr key={row.id} className="border-t border-line">
                <td className="px-4 py-3 whitespace-nowrap">{String(row.createdAt).replace('T', ' ').slice(0, 19)}</td>
                <td className="px-4 py-3">{row.username || 'System'}</td>
                <td className="px-4 py-3 font-semibold">{row.action}</td>
                <td className="px-4 py-3">{row.entityType} {row.entityId || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
