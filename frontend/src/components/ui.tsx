import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  const styles = {
    primary: 'bg-pine text-cream hover:bg-navy',
    secondary: 'border border-line bg-white text-ink hover:bg-cream',
    danger: 'bg-[#8d2f2f] text-white hover:bg-[#742626]',
    ghost: 'text-slate-600 hover:bg-slate-100',
  }[variant];
  return (
    <button
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-md px-3.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
      {...props}
    />
  );
}

export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-semibold text-slate-700">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-[#8d2f2f]">{error}</span> : null}
    </label>
  );
}

export const controlClass = 'h-10 w-full rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-pine';

export function Badge({ value }: { value: string }) {
  const tone = value === 'active' || value === 'implemented' || value === 'approved' || value === 'received' || value === 'issued' || value === 'ordered'
    ? 'bg-khaki text-navy'
    : value === 'inactive' || value === 'rejected' || value === 'disabled' || value === 'exited'
      ? 'bg-cream text-olive'
      : value === 'confidential' || value === 'restricted' || value === 'locked' || value === 'submitted'
        ? 'bg-pine text-cream'
        : 'bg-cream text-pine';
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${tone}`}>{value.replaceAll('_', ' ')}</span>;
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-navy/50 p-4 sm:items-center" onMouseDown={onClose}>
      <div className="w-full max-w-xl rounded-lg bg-white shadow-card" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="text-sm text-slate-500" onClick={onClose} type="button">Close</button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line bg-white px-4 py-10 text-center text-sm text-slate-500">{children}</div>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-[#8d2f2f]">{children}</div>;
}
