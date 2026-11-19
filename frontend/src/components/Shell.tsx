import { useEffect, useState } from 'react';
import { Bell, ChevronDown, ChevronRight, LogOut, Menu, Search, X } from 'lucide-react';

/** Sidebar groups that expand and collapse. Each opens on its own when you are on one of its pages. */
const collapsibleGroups = new Set(['Approvals', 'Procurement', 'Inventory', 'Finance', 'Operations', 'Farm Operations']);
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { SiteFooter } from './SiteFooter';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { canOpenPath, visibleNavigation } from '../lib/navigation';

interface SearchResponse {
  data: Record<string, { id: number; label: string }[]>;
}

export interface Notification {
  id: number;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationResponse {
  data: Notification[];
  meta: { unread: number };
}

export function notificationTarget(note: Notification): string | null {
  switch (note.entityType) {
    case 'approval_request':
      return note.entityId ? `/approvals/${note.entityId}` : '/approvals';
    case 'approval_delegation':
      return '/approvals';
    case 'organisational_change_request':
      return '/organisation/changes';
    case 'user':
      return '/admin/users';
    default:
      return null;
  }
}

export function timeAgo(value: string): string {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(value).toLocaleDateString();
}

function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
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
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(window.localStorage.getItem('bajogo.nav.collapsed') ?? '{}') as Record<string, boolean>; } catch { return {}; }
  });
  // The group holding the current page; the longest matching link wins (so /farm/daily belongs to Farm Operations).
  const activeGroup = items
    .filter((item) => location.pathname === item.to || (item.to !== '/' && location.pathname.startsWith(`${item.to}/`)))
    .sort((left, right) => right.to.length - left.to.length)[0]?.group;
  // Groups start closed, except the one you are working in. Opening or closing one is remembered.
  const groupOpen = (group: string) => (collapsed[group] === undefined ? group === activeGroup : !collapsed[group]);
  function remember(next: Record<string, boolean>) {
    setCollapsed(next);
    try { window.localStorage.setItem('bajogo.nav.collapsed', JSON.stringify(next)); } catch { /* storage may be unavailable */ }
  }
  function toggleGroup(group: string) {
    remember({ ...collapsed, [group]: groupOpen(group) });
  }
  // Moving to a page always shows its group, even if it was closed earlier.
  useEffect(() => {
    if (activeGroup && collapsed[activeGroup]) remember({ ...collapsed, [activeGroup]: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroup, location.pathname]);
  const search = useQuery({
    queryKey: ['search', query],
    enabled: query.trim().length >= 2,
    queryFn: () => api<SearchResponse>(`/v1/search?q=${encodeURIComponent(query.trim())}`),
  });
  const notes = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<NotificationResponse>('/v1/notifications'),
  });
  const unread = notes.data?.meta.unread ?? 0;

  async function openNotification(note: Notification) {
    setNotesOpen(false);
    const target = notificationTarget(note);
    if (target) navigate(target);
    if (!note.isRead) {
      await api(`/v1/notifications/${note.id}/read`, { method: 'POST' });
      await notes.refetch();
    }
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <aside className={`fixed inset-y-0 left-0 z-30 flex w-72 flex-col bg-navy text-cream shadow-[4px_0_24px_rgba(28,27,18,0.18)] transition-transform lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <Link to="/" onClick={() => setOpen(false)} className="flex h-20 shrink-0 items-center gap-3 border-b border-white/10 px-5">
          <img src="/brand/bajogo-mark.png" alt="" className="h-12 w-12 rounded-full object-cover ring-2 ring-khaki/40" />
          <div className="leading-tight">
            <div className="text-xl font-bold tracking-wide text-cream">BAJOGO</div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-khaki">Enterprise ERP</div>
          </div>
        </Link>
        <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          {groups.map((group) => (
            <div key={group} className="mb-3">
              {collapsibleGroups.has(group) ? (
                <button type="button" onClick={() => toggleGroup(group)} aria-expanded={groupOpen(group)}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-khaki/80 hover:bg-white/10 hover:text-cream">
                  <span>{group}</span>
                  <ChevronDown size={14} className={`transition-transform ${groupOpen(group) ? '' : '-rotate-90'}`} />
                </button>
              ) : group !== 'Overview' ? <div className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-khaki/70">{group}</div> : null}
              {(!collapsibleGroups.has(group) || groupOpen(group)) && items.filter((item) => item.group === group).map((item) => (
                <NavLink
                  key={item.to + item.label}
                  to={item.to}
                  end={item.to === '/' || item.end === true}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) => `group mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${isActive ? 'bg-cream font-semibold text-navy shadow-sm' : 'text-khaki hover:bg-white/10 hover:text-cream'}`}
                >
                  <item.icon size={17} className="shrink-0" />
                  <span className="flex-1 truncate">{item.label}</span>
                  <ChevronRight size={14} className="opacity-0 transition-opacity group-hover:opacity-60" />
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <button
          className="flex shrink-0 items-center gap-3 border-t border-white/10 px-8 py-4 text-sm text-khaki hover:bg-white/10 hover:text-cream"
          onClick={() => signOut().then(() => navigate('/login'))}
          type="button"
        >
          <LogOut size={17} /> Sign out
        </button>
      </aside>
      {open ? <button className="fixed inset-0 z-20 bg-black/40 lg:hidden" aria-label="Close menu" onClick={() => setOpen(false)} /> : null}
      <div className="flex min-h-screen flex-col lg:pl-72">
        <header className="sticky top-0 z-10 flex h-20 items-center gap-3 border-b border-line bg-white/95 px-4 backdrop-blur sm:px-6">
          <button className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-line lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
          <div className="relative w-full max-w-xl">
            <Search className="pointer-events-none absolute left-3.5 top-3 text-slate-400" size={16} />
            <input
              className="h-10 w-full rounded-full border border-line bg-canvas pl-10 pr-4 text-sm"
              placeholder="Search employees, departments, suppliers, stock, accounts"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Global search"
            />
            {query.trim().length >= 2 && search.data ? (
              <div className="absolute mt-1 w-full rounded-lg border border-line bg-white p-2 shadow-card">
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
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <div className="relative">
              <button className="relative grid h-10 w-10 place-items-center rounded-full text-pine hover:bg-canvas" onClick={() => setNotesOpen((value) => !value)} aria-label={`Notifications, ${unread} unread`}>
                <Bell size={20} />
                {unread > 0 ? (
                  <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-[#d03b3b] px-1 text-[10px] font-bold text-white ring-2 ring-white">
                    {Math.min(unread, 99)}
                  </span>
                ) : null}
              </button>
              {notesOpen ? (
                <>
                  <button className="fixed inset-0 z-10 cursor-default" aria-label="Close notifications" onClick={() => setNotesOpen(false)} type="button" />
                  <div className="fixed inset-x-3 top-[5.5rem] z-20 flex max-h-[70vh] flex-col rounded-lg border border-line bg-white shadow-card sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-96">
                    <div className="flex items-center justify-between border-b border-line px-4 py-3">
                      <span className="text-sm font-semibold">Notifications</span>
                      <span className="text-xs text-slate-500">{unread} unread</span>
                    </div>
                    <div className="overflow-y-auto p-2">
                      {(notes.data?.data ?? []).length === 0 ? <div className="px-2 py-3 text-sm text-slate-500">No notifications.</div> : null}
                      {notes.data?.data.map((note) => (
                        <button
                          key={note.id}
                          className={`flex w-full gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-canvas focus:bg-canvas focus:outline-none ${note.isRead ? '' : 'bg-cream/40'}`}
                          onClick={() => openNotification(note)}
                          type="button"
                        >
                          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${note.isRead ? 'bg-transparent' : 'bg-brass'}`} />
                          <span className="min-w-0 flex-1">
                            <span className={`block text-sm ${note.isRead ? 'font-medium text-slate-600' : 'font-semibold text-ink'}`}>{note.title}</span>
                            <span className="block break-words text-xs text-slate-600">{note.body}</span>
                            <span className="mt-1 block text-[11px] text-slate-400">{timeAgo(note.createdAt)}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
            <Link className="flex items-center gap-3 rounded-full py-1 pl-1 pr-2 hover:bg-canvas sm:ml-1 sm:border-l sm:border-line sm:pl-4" to="/settings" title="Your profile">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-pine text-sm font-bold text-cream ring-2 ring-khaki">
                {initials(user?.employeeName || user?.username || '')}
              </span>
              <span className="hidden text-left sm:block">
                <span className="block text-sm font-semibold leading-tight">{user?.employeeName || user?.username}</span>
                <span className="block max-w-[14rem] truncate text-xs text-slate-500">{user?.roles.join(', ')}</span>
              </span>
            </Link>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {allowed ? <Outlet /> : <Navigate to="/" replace />}
        </main>
        <SiteFooter />
      </div>
    </div>
  );
}
