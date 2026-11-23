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
  Gavel,
  Library,
  Megaphone,
  Sprout,
  Map as MapIcon,
  CalendarRange,
  ClipboardPen,
  SearchCheck,
  Wheat,
  TrendingUp,
  Tractor,
  FlaskConical,
  HandCoins,
  PackageCheck,
  Inbox,
  Siren,
  Route,
  Globe,
  Mail,
  FileBarChart,
  Target,
  Gauge,
  Users2,
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
  { group: 'Overview', label: 'My dashboard', to: '/', icon: LayoutDashboard, permission: 'dashboard.view' },
  { group: 'Overview', label: 'Company dashboard', to: '/company-overview', icon: Megaphone, permission: 'dashboard.view' },
  { group: 'My work', label: 'Reports and performance', to: '/management', icon: BarChart3, permission: 'reports.submit' },
  { group: 'My work', label: 'Reports and performance', to: '/management', icon: BarChart3, permission: 'reports.review' },
  { group: 'My work', label: 'Department registers', to: '/registers', icon: Library, permission: 'support.request' },
  { group: 'My work', label: 'Department registers', to: '/registers', icon: Library, permission: 'operations.view' },
  { group: 'My work', label: 'Department registers', to: '/registers', icon: Library, permission: 'legal.view_confidential' },
  { group: 'My work', label: 'Department registers', to: '/registers', icon: Library, permission: 'it.view' },
  { group: 'My work', label: 'Department registers', to: '/registers', icon: Library, permission: 'marketing.view' },
  { group: 'Company', label: 'Company profile', to: '/company', icon: Building2, permission: 'company.view', workspace: 'organisation' },
  { group: 'Organisation', label: 'Branches', to: '/organisation/branches', icon: MapPin, permission: 'branches.view', workspace: 'organisation' },
  { group: 'Organisation', label: 'Locations', to: '/organisation/locations', icon: MapPin, permission: 'locations.view', workspace: 'organisation' },
  { group: 'Organisation', label: 'Departments', to: '/organisation/departments', icon: Network, permission: 'departments.view', workspace: 'organisation' },
  { group: 'Organisation', label: 'Positions', to: '/organisation/positions', icon: Briefcase, permission: 'positions.view', workspace: 'organisation' },
  { group: 'My work', label: 'Change requests', to: '/organisation/changes', icon: GitBranch, permission: 'organisation.request_change' },
  { group: 'Organisation', label: 'Change implementation', to: '/organisation/changes', icon: GitBranch, permission: 'organisation.implement_change', workspace: 'organisation' },
  { group: 'Approvals', label: 'Approval requests', to: '/approvals', icon: ListChecks, permission: 'approvals.view', end: true },
  { group: 'Administration', label: 'Approval governance', to: '/admin/governance', icon: Gavel, permission: 'governance.view', workspace: 'administration' },
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
  { group: 'Operations', label: 'Haulage & trips', to: '/haulage', icon: Truck, permission: 'farm.view', workspace: 'operations' },
  { group: 'Farm Operations', label: 'Farm Overview', to: '/farm', icon: Gauge, permission: 'farm.view', workspace: 'operations', end: true },
  { group: 'Farm Operations', label: 'Farm Locations', to: '/farm/locations', icon: MapIcon, permission: 'farm.view', workspace: 'operations' },
  { group: 'Farm Operations', label: 'Farm Supervisors & Teams', to: '/farm/teams', icon: Users2, permission: 'farm.view', workspace: 'operations' },
  { group: 'Farm Operations', label: 'Farm Activity Schedule', to: '/farm/schedule', icon: CalendarRange, permission: 'farm.view', workspace: 'operations' },
  { group: 'Farm Operations', label: 'Daily Farm Activities', to: '/farm/daily', icon: ClipboardPen, permission: 'farm.view', workspace: 'operations' },
  { group: 'Farm Operations', label: 'Farm Inspections', to: '/farm/inspections', icon: SearchCheck, permission: 'farm.view', workspace: 'operations' },
  { group: 'Farm Operations', label: 'Crop Production Monitoring', to: '/farm/crops', icon: Sprout, permission: 'farm.view', workspace: 'operations' },
  { group: 'Farm Operations', label: 'Production Targets', to: '/farm/targets', icon: Target, permission: 'farm.view', workspace: 'operations' },
  { group: 'Farm Operations', label: 'Harvest Monitoring', to: '/farm/harvests', icon: Wheat, permission: 'farm.view', workspace: 'operations' },
  { group: 'Farm Operations', label: 'Yield Performance', to: '/farm/yield', icon: TrendingUp, permission: 'farm.view', workspace: 'operations' },
  { group: 'Farm Operations', label: 'Farm Equipment & Machinery', to: '/farm/equipment', icon: Tractor, permission: 'farm.view', workspace: 'operations' },
  { group: 'Farm Operations', label: 'Farm Inputs & Materials', to: '/farm/inputs', icon: FlaskConical, permission: 'farm.view', workspace: 'operations' },
  { group: 'Farm Operations', label: 'Resource Requests', to: '/farm/requests', icon: HandCoins, permission: 'farm.view', workspace: 'operations' },
  { group: 'Farm Operations', label: 'Farm Produce & Storage', to: '/farm/produce', icon: PackageCheck, permission: 'farm.view', workspace: 'operations' },
  { group: 'Farm Operations', label: 'Pending Reviews & Approvals', to: '/farm/pending', icon: Inbox, permission: 'farm.review', workspace: 'operations' },
  { group: 'Farm Operations', label: 'Farm Issues & Incidents', to: '/farm/incidents', icon: Siren, permission: 'farm.view', workspace: 'operations' },
  { group: 'Farm Operations', label: 'Harvest Dispatch Coordination', to: '/farm/dispatch', icon: Route, permission: 'farm.view', workspace: 'operations' },
  { group: 'Farm Operations', label: 'Farm Reports & Analytics', to: '/farm/reports', icon: FileBarChart, permission: 'farm.view', workspace: 'operations' },
  { group: 'Executive', label: 'Department checks', to: '/executive', icon: ClipboardCheck, permission: 'executive.review' },
  { group: 'Executive', label: 'Reports', to: '/reports', icon: BarChart3, permission: 'executive.review' },
  { group: 'People', label: 'Employees', to: '/employees', icon: Users, permission: 'employees.view', workspace: 'people' },
  { group: 'Administration', label: 'User accounts', to: '/admin/users', icon: Shield, permission: 'users.view', workspace: 'administration' },
  { group: 'Administration', label: 'Roles', to: '/admin/roles', icon: ClipboardList, permission: 'roles.view', workspace: 'administration' },
  { group: 'Administration', label: 'Audit log', to: '/admin/audit', icon: ScrollText, permission: 'audit.view', workspace: 'administration' },
  { group: 'Website', label: 'Website management', to: '/website', icon: Globe, permission: 'website.view', workspace: 'website', end: true },
  { group: 'Website', label: 'Customer enquiries', to: '/website/enquiries', icon: Mail, permission: 'website.enquiries', workspace: 'website' },
  { group: 'HR', label: 'Website applications', to: '/website/applications', icon: UserPlus, permission: 'hr.view', workspace: 'hr' },
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
