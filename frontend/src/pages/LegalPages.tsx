import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { SiteFooter } from '../components/SiteFooter';

function LegalFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink">
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <Link className="text-sm font-semibold text-pine" to="/">BAJOGO ERP</Link>
        <h1 className="mt-6 text-2xl font-semibold">{title}</h1>
        <div className="mt-4 grid gap-3 text-sm leading-6 text-slate-700">{children}</div>
      </main>
      <SiteFooter />
    </div>
  );
}

export function PrivacyPage() {
  return (
    <LegalFrame title="Privacy policy">
      <p>Zentrix Technologies provides BAJOGO ERP for BAJOGO ENTERPRISE. This policy describes the account and work records the system keeps.</p>
      <p>Your sign-in name, email, roles, and the profile on the Settings page belong to your own account. That page does not open anyone else’s employee file.</p>
      <p>Employee records are available to Human Resources and the system administrator. The system administrator sees standard employee records. Confidential HR, payroll, and legal files stay with the roles that hold those permissions.</p>
      <p>Other roles see the work of their own department. A report download is available only for a report that role is already allowed to open, in CSV, Excel, or PDF.</p>
    </LegalFrame>
  );
}

export function TermsPage() {
  return (
    <LegalFrame title="Terms and conditions">
      <p>BAJOGO ERP is supplied by Zentrix Technologies for use by BAJOGO ENTERPRISE. Use the account issued for your role, and keep the password to yourself.</p>
      <p>Posted financial amounts stay on the books. A correction is a reversing journal, not a deleted or rewritten amount.</p>
      <p>Approval of your own request is not available. Expenditure approval stays with the role that holds that authority.</p>
      <p>These terms apply to use of this system. They do not replace a contract between BAJOGO ENTERPRISE and Zentrix Technologies.</p>
    </LegalFrame>
  );
}
