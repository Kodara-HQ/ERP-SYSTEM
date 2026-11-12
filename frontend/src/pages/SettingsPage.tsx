import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { ErrorText, PageHeader } from '../components/ui';

interface Profile {
  username: string;
  email: string | null;
  employeeNumber: string | null;
  employeeName: string | null;
  departmentName: string | null;
  positionTitle: string | null;
  branchName: string | null;
  roles: string[];
  lastLoginAt: string | null;
}

function message(error: unknown): string {
  return error instanceof ApiError ? error.message : 'The profile could not be loaded.';
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-lg border border-line bg-white px-4 py-4">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </article>
  );
}

export function SettingsPage() {
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api<{ data: Profile }>('/v1/auth/me') });
  const data = profile.data?.data;
  return (
    <section>
      <PageHeader title="Profile" description="Your own sign-in record. Employee files for other people stay with Human Resources and the system administrator." />
      {profile.isError ? <ErrorText>{message(profile.error)}</ErrorText> : null}
      {data ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Row label="Name" value={data.employeeName || data.username} />
          <Row label="Username" value={data.username} />
          <Row label="Email" value={data.email || '—'} />
          <Row label="Roles" value={data.roles.join(', ') || '—'} />
          <Row label="Employee number" value={data.employeeNumber || 'No employee record is linked'} />
          <Row label="Department" value={data.departmentName || '—'} />
          <Row label="Position" value={data.positionTitle || '—'} />
          <Row label="Branch" value={data.branchName || '—'} />
          <Row label="Last sign-in" value={data.lastLoginAt ? String(data.lastLoginAt).replace('T', ' ').slice(0, 19) : '—'} />
        </div>
      ) : null}
    </section>
  );
}
