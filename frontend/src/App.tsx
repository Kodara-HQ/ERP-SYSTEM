import { type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell';
import { useAuth } from './lib/auth';
import { ApprovalDetailPage, ApprovalsPage } from './pages/ApprovalsPage';
import { AuditPage } from './pages/AuditPage';
import { LoginPage, PasswordPage } from './pages/AuthPages';
import { ChangeRequestsPage } from './pages/ChangeRequestsPage';
import { CompanyPage } from './pages/CompanyPage';
import { DashboardPage } from './pages/DashboardPage';
import { EmployeeDetailPage, EmployeesPage } from './pages/EmployeesPage';
import { AttendancePage, HrReportsPage, LeavePage, LifecyclePage, RecruitmentPage } from './pages/HrPages';
import { BudgetsPage, FinanceReportsPage, LedgerPage, PaymentsPage } from './pages/FinancePages';
import { InventoryPage, OrdersPage, RequisitionsPage, StockReportsPage, SuppliersPage } from './pages/SupplyPages';
import { BranchesPage, DepartmentsPage, LocationsPage, PositionsPage } from './pages/OrganisationPages';
import { RolesPage } from './pages/RolesPage';
import { UsersPage } from './pages/UsersPage';
import { PrivacyPage, TermsPage } from './pages/LegalPages';
import { LegalPage } from './pages/LegalPage';
import { OperationsPage } from './pages/OperationsPage';
import { ExecutivePage } from './pages/ExecutivePage';
import { PayrollPage } from './pages/PayrollPage';
import { SettingsPage } from './pages/SettingsPage';
import { WorkflowsPage } from './pages/WorkflowsPage';

function Guard({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) {
    return <div className="grid min-h-screen place-items-center text-sm text-slate-500">Loading BAJOGO ERP…</div>;
  }
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword) return <Navigate to="/account/password" replace />;
  return children;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/account/password" element={<PasswordPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route element={<Guard><Shell /></Guard>}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/company" element={<CompanyPage />} />
        <Route path="/organisation/branches" element={<BranchesPage />} />
        <Route path="/organisation/locations" element={<LocationsPage />} />
        <Route path="/organisation/departments" element={<DepartmentsPage />} />
        <Route path="/organisation/positions" element={<PositionsPage />} />
        <Route path="/organisation/changes" element={<ChangeRequestsPage />} />
        <Route path="/approvals" element={<ApprovalsPage />} />
        <Route path="/approvals/workflows" element={<WorkflowsPage />} />
        <Route path="/approvals/:id" element={<ApprovalDetailPage />} />
        <Route path="/hr" element={<LeavePage />} />
        <Route path="/hr/attendance" element={<AttendancePage />} />
        <Route path="/hr/recruitment" element={<RecruitmentPage />} />
        <Route path="/hr/lifecycle" element={<LifecyclePage />} />
        <Route path="/hr/reports" element={<HrReportsPage />} />
        <Route path="/procurement" element={<RequisitionsPage />} />
        <Route path="/procurement/orders" element={<OrdersPage />} />
        <Route path="/procurement/suppliers" element={<SuppliersPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/inventory/reports" element={<StockReportsPage />} />
        <Route path="/finance" element={<LedgerPage />} />
        <Route path="/finance/payments" element={<PaymentsPage />} />
        <Route path="/finance/budgets" element={<BudgetsPage />} />
        <Route path="/finance/reports" element={<FinanceReportsPage />} />
        <Route path="/employees" element={<EmployeesPage />} />
        <Route path="/employees/:id" element={<EmployeeDetailPage />} />
        <Route path="/admin/users" element={<UsersPage />} />
        <Route path="/admin/roles" element={<RolesPage />} />
        <Route path="/admin/audit" element={<AuditPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
