import { Link } from 'react-router-dom';

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-white">
      <div className="flex flex-wrap items-center gap-x-10 gap-y-2 px-6 py-4 text-sm text-slate-500">
        <span>© 2026 Zentrix Technologies. All rights reserved</span>
        <Link className="text-slate-500 hover:text-ink" to="/privacy">Privacy policy</Link>
        <Link className="text-slate-500 hover:text-ink" to="/terms">Terms and conditions</Link>
      </div>
    </footer>
  );
}
