import { useState } from 'react';
import { Bell, LogOut, Menu, Search, X } from 'lucide-react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { SiteFooter } from './SiteFooter';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { canOpenPath, visibleNavigation } from '../lib/navigation';

interface SearchResponse {
  data: Record<string, { id: number; label: string }[]>;
}

interface NotificationResponse {
  data: { id: number; title: string; body: string; isRead: boolean; createdAt: string }[];
  meta: { unread: number };
}

export function Shell() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const workspaces = user?.workspaces ?? [];
  const items = visibleNavigation(user?.permissions ?? [], workspaces);
  const allowed = canOpenPath(location.pathname, user?.permissions ?? [], workspaces);
  const groups = [...new Set(items.map((item) => item.group))];
  const search = useQuery({
    queryKey: ['search', query],
    enabled: query.trim().length >= 2,
    queryFn: () => api<SearchResponse>(`/v1/search?q=${encodeURIComponent(query.trim())}`),
  });
  const notes = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<NotificationResponse>('/v1/notifications'),
  });

  async function markRead(id: number) {
    await api(`/v1/notifications/${id}/read`, { method: 'POST' });
    await notes.refetch();
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <aside className={`fixed inset-y-0 left-0 z-30 w-72 bg-navy text-cream transition-transform lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-16 items-center gap-3 border-b border-white/10 px-5">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-cream text-sm font-bold text-navy">BE</div>
          <div>
            <div className="text-sm font-semibold tracking-wide text-cream">BAJOGO ERP</div>
            <div className="text-xs text-khaki">Enterprise</div>
          </div>
        </div>
        <nav className="h-[calc(100%-4rem)] overflow-y-auto px-3 py-4">
          {groups.map((group) => (
            <div key={group} className="mb-4">
              <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-khaki">{group}</div>
              {items.filter((item) => item.group === group).map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/' || item.end === true}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) => `mb-1 flex items-center gap-3 rounded-md px-3 py-2 text-sm ${isActive ? 'bg-cream/15 text-cream' : 'text-khaki hover:bg-cream/10'}`}
                >
                  <item.icon size={16} />
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      {open ? <button className="fixed inset-0 z-20 bg-black/40 lg:hidden" aria-label="Close menu" onClick={() => setOpen(false)} /> : null}
      <div className="flex min-h-screen flex-col lg:pl-72">
        <header className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b border-line bg-white px-4">
          <button className="grid h-10 w-10 place-items-center rounded-md border border-line lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
          <div className="relative w-full max-w-xl">
            <Search className="pointer-events-none absolute left-3 top-2.5 text-slate-400" size={16} />
            <input
              className="h-10 w-full rounded-md border border-line bg-canvas pl-9 pr-3 text-sm"
              placeholder="Search employees, departments, suppliers, stock, accounts"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Global search"
            />
            {query.trim().length >= 2 && search.data ? (
              <div className="absolute mt-1 w-full rounded-md border border-line bg-white p-2 shadow-card">
                {Object.entries(search.data.data).flatMap(([type, rows]) => rows.map((row) => (
                  <button
                    key={`${type}-${row.id}`}
                    className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-canvas"
                    onClick={() => {
                      setQuery('');
                      if (type === 'employees') navigate(`/employees/${row.id}`);
                      if (type === 'departments') navigate('/organisation/departments');
                      if (type === 'positions') navigate('/organisation/positions');
                      if (type === 'approvals') navigate(`/approvals/${row.id}`);
                      if (type === 'vacancies') navigate('/hr/recruitment');
                      if (type === 'suppliers') navigate('/procurement/suppliers');
                      if (type === 'items') navigate('/inventory');
                      if (type === 'accounts') navigate('/finance');
                    }}
                    type="button"
                  >
                    <span className="mr-2 text-[11px] uppercase tracking-wide text-slate-400">{type.slice(0, -1)}</span>
                    {row.label}
                  </button>
                )))}
                {Object.values(search.data.data).every((rows) => rows.length === 0) ? <div className="px-2 py-2 text-sm text-slate-500">No matching records.</div> : null}
              </div>
            ) : null}
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="relative">
              <button className="relative grid h-10 w-10 place-items-center rounded-md border border-line" onClick={() => setNotesOpen((value) => !value)} aria-label="Notifications">
                <Bell size={16} />
                {(notes.data?.meta.unread ?? 0) > 0 ? <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-brass" /> : null}
              </button>
              {notesOpen ? (
                <div className="absolute right-0 mt-2 w-80 rounded-md border border-line bg-white p-2 shadow-card">
                  {(notes.data?.data ?? []).length === 0 ? <div className="px-2 py-3 text-sm text-slate-500">No notifications.</div> : null}
                  {notes.data?.data.map((note) => (
                    <button key={note.id} className="block w-full rounded px-2 py-2 text-left hover:bg-canvas" onClick={() => markRead(note.id)} type="button">
                      <div className="text-sm font-semibold">{note.title}</div>
                      <div className="text-xs text-slate-600">{note.body}</div>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-3 border-l border-line pl-4">
              <Link className="hidden text-right sm:block" to="/settings">
                <div className="text-sm font-semibold">{user?.employeeName || user?.username}</div>
                <div className="text-xs text-slate-500">{user?.roles.join(', ')}</div>
              </Link>
              <button className="grid h-10 w-10 place-items-center rounded-md border border-line" onClick={() => signOut().then(() => navigate('/login'))} aria-label="Sign out">
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6">
          {allowed ? <Outlet /> : <Navigate to="/" replace />}
        </main>
        <SiteFooter />
      </div>
    </div>
  );
}
