import {
  Building2,
  ClipboardList,
  GitBranch,
  LayoutDashboard,
  ListChecks,
  SlidersHorizontal,
  MapPin,
  Network,
  ScrollText,
  Shield,
  Users,
  Briefcase,
  CalendarDays,
  CalendarCheck,
  UserPlus,
  BarChart3,
  Waypoints,
  ShoppingCart,
  Truck,
  Package,
  Warehouse,
  Landmark,
  Receipt,
  UserRound,
  Banknote,
  Scale,
  ClipboardCheck,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  permission: string;
  group: string;
  /** Set when the screen belongs to a department workspace. Personal tasks leave this empty. */
  workspace?: string;
  end?: boolean;
}

export const navigation: NavItem[] = [
  { group: 'Overview', label: 'Dashboard', to: '/', icon: LayoutDashboard, permission: 'dashboard.view' },
  { group: 'Company', label: 'Company profile', to: '/company', icon: Building2, permission: 'company.view', workspace: 'organisation' },
  { group: 'Organisation', label: 'Branches', to: '/organisation/branches', icon: MapPin, permission: 'branches.view', workspace: 'organisation' },
  { group: 'Organisation', label: 'Locations', to: '/organisation/locations', icon: MapPin, permission: 'locations.view', workspace: 'organisation' },
  { group: 'Organisation', label: 'Departments', to: '/organisation/departments', icon: Network, permission: 'departments.view', workspace: 'organisation' },
  { group: 'Organisation', label: 'Positions', to: '/organisation/positions', icon: Briefcase, permission: 'positions.view', workspace: 'organisation' },
  { group: 'My work', label: 'Change requests', to: '/organisation/changes', icon: GitBranch, permission: 'organisation.request_change' },
  { group: 'Organisation', label: 'Change implementation', to: '/organisation/changes', icon: GitBranch, permission: 'organisation.implement_change', workspace: 'organisation' },
  { group: 'Approvals', label: 'Approval requests', to: '/approvals', icon: ListChecks, permission: 'approvals.view', end: true },
  { group: 'Administration', label: 'Workflow routes', to: '/approvals/workflows', icon: SlidersHorizontal, permission: 'approvals.configure', workspace: 'administration' },
  { group: 'My work', label: 'Leave', to: '/hr', icon: CalendarDays, permission: 'leave.apply', end: true },
  { group: 'HR', label: 'Leave', to: '/hr', icon: CalendarDays, permission: 'hr.view', workspace: 'hr', end: true },
  { group: 'My work', label: 'Attendance', to: '/hr/attendance', icon: CalendarCheck, permission: 'attendance.self' },
  { group: 'HR', label: 'Attendance', to: '/hr/attendance', icon: CalendarCheck, permission: 'hr.view', workspace: 'hr' },
  { group: 'HR', label: 'Recruitment', to: '/hr/recruitment', icon: UserPlus, permission: 'hr.view', workspace: 'hr' },
  { group: 'HR', label: 'Lifecycle', to: '/hr/lifecycle', icon: Waypoints, permission: 'hr.view', workspace: 'hr' },
  { group: 'HR', label: 'Reports', to: '/hr/reports', icon: BarChart3, permission: 'hr.view', workspace: 'hr' },
  { group: 'Procurement', label: 'Requisitions', to: '/procurement', icon: ShoppingCart, permission: 'procurement.view', workspace: 'procurement', end: true },
  { group: 'Procurement', label: 'Requisitions', to: '/procurement', icon: ShoppingCart, permission: 'procurement.request', workspace: 'procurement', end: true },
  { group: 'Procurement', label: 'Purchase orders', to: '/procurement/orders', icon: Truck, permission: 'procurement.view', workspace: 'procurement' },
  { group: 'Procurement', label: 'Purchase orders', to: '/procurement/orders', icon: Truck, permission: 'inventory.manage', workspace: 'procurement' },
  { group: 'Procurement', label: 'Suppliers', to: '/procurement/suppliers', icon: Package, permission: 'procurement.view', workspace: 'procurement' },
  { group: 'Inventory', label: 'Stock', to: '/inventory', icon: Warehouse, permission: 'inventory.view', workspace: 'inventory', end: true },
  { group: 'Inventory', label: 'Stock', to: '/inventory', icon: Warehouse, permission: 'inventory.manage', workspace: 'inventory', end: true },
  { group: 'Inventory', label: 'Stock reports', to: '/inventory/reports', icon: BarChart3, permission: 'inventory.view', workspace: 'inventory' },
  { group: 'Finance', label: 'Ledger', to: '/finance', icon: Landmark, permission: 'finance.view', workspace: 'finance', end: true },
  { group: 'Finance', label: 'Payments', to: '/finance/payments', icon: Receipt, permission: 'finance.view', workspace: 'finance' },
  { group: 'Finance', label: 'Payments', to: '/finance/payments', icon: Receipt, permission: 'finance.request' },
  { group: 'Finance', label: 'Budgets', to: '/finance/budgets', icon: BarChart3, permission: 'finance.view', workspace: 'finance' },
  { group: 'Finance', label: 'Budgets', to: '/finance/budgets', icon: BarChart3, permission: 'finance.request' },
  { group: 'Finance', label: 'Financial reports', to: '/finance/reports', icon: BarChart3, permission: 'finance.view', workspace: 'finance' },
  { group: 'Payroll', label: 'Payroll', to: '/payroll', icon: Banknote, permission: 'payroll.view' },
  { group: 'Legal', label: 'Legal records', to: '/legal', icon: Scale, permission: 'legal.view_confidential', workspace: 'legal' },
  { group: 'My work', label: 'Legal request', to: '/legal', icon: Scale, permission: 'legal.request' },
  { group: 'Operations', label: 'Daily operations', to: '/operations', icon: ClipboardCheck, permission: 'operations.view', workspace: 'operations' },
  { group: 'Executive', label: 'Department checks', to: '/executive', icon: ClipboardCheck, permission: 'executive.review' },
  { group: 'People', label: 'Employees', to: '/employees', icon: Users, permission: 'employees.view', workspace: 'people' },
  { group: 'Administration', label: 'User accounts', to: '/admin/users', icon: Shield, permission: 'users.view', workspace: 'administration' },
  { group: 'Administration', label: 'Roles', to: '/admin/roles', icon: ClipboardList, permission: 'roles.view', workspace: 'administration' },
  { group: 'Administration', label: 'Audit log', to: '/admin/audit', icon: ScrollText, permission: 'audit.view', workspace: 'administration' },
  { group: 'Settings', label: 'Profile', to: '/settings', icon: UserRound, permission: 'profile.view' },
];

function workspaceOpen(workspaces: string[], workspace?: string): boolean {
  if (!workspace) return true;
  return workspaces.includes('*') || workspaces.includes(workspace);
}

export function visibleNavigation(permissions: string[], workspaces: string[] = ['*']): NavItem[] {
  const seen = new Set<string>();
  return navigation.filter((item) => {
    if (!permissions.includes(item.permission) || !workspaceOpen(workspaces, item.workspace) || seen.has(item.to + item.label)) {
      return false;
    }
    if (seen.has(item.to) && item.to === '/organisation/changes') {
      return false;
    }
    seen.add(item.to);
    seen.add(item.to + item.label);
    return true;
  });
}

export function canOpenPath(path: string, permissions: string[], workspaces: string[]): boolean {
  if (path === '/' || path === '/privacy' || path === '/terms') return true;
  const matches = navigation.filter((item) => path === item.to || path.startsWith(`${item.to}/`));
  if (matches.length === 0) return false;
  const longest = Math.max(...matches.map((item) => item.to.length));
  const candidates = matches.filter((item) => item.to.length === longest);
  const visible = visibleNavigation(permissions, workspaces);
  return candidates.some((item) => visible.some((entry) => entry.to === item.to && entry.permission === item.permission));
}
