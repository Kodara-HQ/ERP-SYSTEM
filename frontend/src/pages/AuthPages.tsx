import { useState, type ReactNode } from 'react';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { Eye, EyeOff } from 'lucide-react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { SiteFooter } from '../components/SiteFooter';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, controlClass, ErrorText, Field } from '../components/ui';

const fieldClass = 'h-12 w-full rounded-lg border border-line bg-white px-3.5 text-sm outline-none transition focus:border-pine focus:ring-2 focus:ring-pine/15';

type ResetMethod = 'email' | 'administrator';

/** Brand panel on the left, form on the right. Shared by sign-in and the forgotten-password pages. */
function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white lg:flex-row">
      <aside className="flex flex-col items-center justify-center bg-[#1F2428] px-6 py-6 text-center lg:w-1/2 lg:px-12">
        <img
          src="/brand/bajogo-logo-panel.jpg"
          alt="BAJOGO ENTERPRISE — Growing Today. Feeding Tomorrow."
          className="w-64 sm:w-80 lg:w-full lg:max-w-xl"
        />
        <div className="mt-6 hidden max-w-sm lg:block">
          <div className="mx-auto mb-5 h-px w-24 bg-gradient-to-r from-transparent via-[#D4AF61] to-transparent" />
          <p className="text-sm leading-relaxed text-[#C9CDD2]">
            People, payroll, procurement, stock and finance for BAJOGO ENTERPRISE, in one place.
          </p>
        </div>
      </aside>

      <main className="flex flex-1 flex-col">
        <div className="flex flex-1 items-center justify-center px-6 py-10 sm:px-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
        <SiteFooter />
      </main>
    </div>
  );
}

function Eyebrow() {
  return <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#B08D45]">BAJOGO ERP</p>;
}

function PasswordInput({ registration, autoComplete, autoFocus = false }: { registration: UseFormRegisterReturn; autoComplete: string; autoFocus?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input className={`${fieldClass} pr-11`} type={show ? 'text' : 'password'} autoComplete={autoComplete} autoFocus={autoFocus} {...registration} />
      <button
        type="button"
        className="absolute inset-y-0 right-0 grid w-11 place-items-center text-olive hover:text-ink"
        onClick={() => setShow((value) => !value)}
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}

const passwordRules = [
  { label: 'At least 12 characters', test: (value: string) => value.length >= 12 },
  { label: 'An upper-case letter', test: (value: string) => /[A-Z]/.test(value) },
  { label: 'A lower-case letter', test: (value: string) => /[a-z]/.test(value) },
  { label: 'A digit', test: (value: string) => /[0-9]/.test(value) },
];

function PasswordRules({ value }: { value: string }) {
  return (
    <ul className="grid grid-cols-2 gap-1 text-xs">
      {passwordRules.map((rule) => {
        const ok = rule.test(value);
        return <li key={rule.label} className={ok ? 'text-pine' : 'text-slate-500'}>{ok ? '✓' : '○'} {rule.label}</li>;
      })}
    </ul>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-pine/20 bg-[#EEF5F0] px-4 py-4 text-sm leading-relaxed text-pine">{children}</div>;
}

function errorText(reason: unknown, fallback: string) {
  if (!(reason instanceof ApiError)) return fallback;
  return reason.details?.length ? reason.details.map((detail) => detail.message).join(' ') : reason.message;
}

export function LoginPage() {
  const { user, signIn } = useAuth();
  const [error, setError] = useState('');
  const form = useForm<{ username: string; password: string }>();
  if (user) return <Navigate to={user.mustChangePassword ? '/account/password' : '/'} replace />;

  return (
    <AuthShell>
      <form
        onSubmit={form.handleSubmit(async (values) => {
          setError('');
          try {
            await signIn(values.username, values.password);
          } catch (reason) {
            setError(reason instanceof ApiError ? reason.message : 'Sign-in failed.');
          }
        })}
      >
        <Eyebrow />
        <h1 className="mt-2 text-3xl font-semibold text-ink">Welcome back</h1>
        <p className="mb-8 mt-2 text-sm text-olive">Sign in with the account issued for your role.</p>
        {error ? <div className="mb-4"><ErrorText>{error}</ErrorText></div> : null}
        <div className="grid gap-5">
          <Field label="Username">
            <input className={fieldClass} autoComplete="username" autoFocus {...form.register('username', { required: true })} />
          </Field>
          <div>
            <Field label="Password">
              <PasswordInput autoComplete="current-password" registration={form.register('password', { required: true })} />
            </Field>
            <div className="mt-2 text-right">
              <Link to="/forgot-password" className="text-sm font-semibold text-pine hover:underline">Forgot password?</Link>
            </div>
          </div>
          <Button className="h-12 w-full rounded-lg text-base" type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </div>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [error, setError] = useState('');
  const [sent, setSent] = useState<ResetMethod | null>(null);
  const method = useQuery({
    queryKey: ['password-reset-method'],
    queryFn: () => api<{ data: { method: ResetMethod } }>('/v1/auth/password-reset', {}, false),
    retry: false,
  });
  const byEmail = method.data?.data.method === 'email';
  const form = useForm<{ identifier: string }>();

  return (
    <AuthShell>
      <Eyebrow />
      <h1 className="mt-2 text-3xl font-semibold text-ink">Forgot your password?</h1>
      {sent ? (
        <div className="mt-6 grid gap-4">
          <Notice>
            {sent === 'email'
              ? 'If that matches an account, we have emailed a link to reset the password. It expires in 30 minutes. Check your spam folder if it does not arrive.'
              : 'If that matches an account, your request has been sent to the system administrator. They will set a temporary password and give it to you in person or by phone. You will choose your own password when you sign in with it.'}
          </Notice>
          <Link to="/login" className="text-sm font-semibold text-pine hover:underline">Back to sign in</Link>
        </div>
      ) : (
        <form
          onSubmit={form.handleSubmit(async (values) => {
            setError('');
            try {
              const result = await api<{ data: { method: ResetMethod } }>('/v1/auth/forgot-password', { method: 'POST', body: JSON.stringify(values) }, false);
              setSent(result.data.method);
            } catch (reason) {
              setError(errorText(reason, 'The request could not be sent.'));
            }
          })}
        >
          <p className="mb-8 mt-2 text-sm text-olive">
            {byEmail
              ? 'Enter your username or work email and we will email you a link to choose a new password.'
              : 'Enter your username or work email. The system administrator will be asked to reset your password.'}
          </p>
          {error ? <div className="mb-4"><ErrorText>{error}</ErrorText></div> : null}
          <div className="grid gap-5">
            <Field label="Username or work email">
              <input className={fieldClass} autoComplete="username" autoFocus {...form.register('identifier', { required: true })} />
            </Field>
            <Button className="h-12 w-full rounded-lg text-base" type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Sending…' : byEmail ? 'Email me a reset link' : 'Ask for a reset'}
            </Button>
            <Link to="/login" className="text-center text-sm font-semibold text-pine hover:underline">Back to sign in</Link>
          </div>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const check = useQuery({
    queryKey: ['reset-token', token],
    enabled: token.length >= 20,
    retry: false,
    queryFn: () => api<{ data: { username: string } }>('/v1/auth/reset-password/check', { method: 'POST', body: JSON.stringify({ token }) }, false),
  });
  const form = useForm<{ newPassword: string; confirm: string }>();
  const newPassword = form.watch('newPassword') ?? '';
  const invalid = token.length < 20 || check.isError;

  return (
    <AuthShell>
      <Eyebrow />
      <h1 className="mt-2 text-3xl font-semibold text-ink">Choose a new password</h1>
      {done ? (
        <div className="mt-6 grid gap-4">
          <Notice>Your password has been changed. Sign in with your new password.</Notice>
          <Link to="/login" className="text-sm font-semibold text-pine hover:underline">Go to sign in</Link>
        </div>
      ) : invalid ? (
        <div className="mt-6 grid gap-4">
          <ErrorText>{errorText(check.error, 'This reset link is not valid. Ask for a new one.')}</ErrorText>
          <Link to="/forgot-password" className="text-sm font-semibold text-pine hover:underline">Ask for a new link</Link>
        </div>
      ) : !check.data ? (
        <p className="mt-6 text-sm text-olive">Checking your link…</p>
      ) : (
        <form
          onSubmit={form.handleSubmit(async (values) => {
            setError('');
            if (values.newPassword !== values.confirm) {
              setError('The two passwords are different.');
              return;
            }
            try {
              await api('/v1/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, newPassword: values.newPassword }) }, false);
              setDone(true);
            } catch (reason) {
              setError(errorText(reason, 'Password was not changed.'));
            }
          })}
        >
          <p className="mb-8 mt-2 text-sm text-olive">For the account <span className="font-semibold text-ink">{check.data.data.username}</span>.</p>
          {error ? <div className="mb-4"><ErrorText>{error}</ErrorText></div> : null}
          <div className="grid gap-5">
            <Field label="New password">
              <PasswordInput autoFocus autoComplete="new-password" registration={form.register('newPassword', { required: true, validate: (value) => passwordRules.every((rule) => rule.test(value)) })} />
            </Field>
            <PasswordRules value={newPassword} />
            <Field label="Type it again">
              <PasswordInput autoComplete="new-password" registration={form.register('confirm', { required: true })} />
            </Field>
            <Button className="h-12 w-full rounded-lg text-base" type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Saving…' : 'Save new password'}
            </Button>
          </div>
        </form>
      )}
    </AuthShell>
  );
}

export function PasswordPage() {
  const { user, refreshUser, signOut } = useAuth();
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const form = useForm<{ currentPassword: string; newPassword: string }>();
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <div className="grid flex-1 place-items-center px-4">
      <form
        className="w-full max-w-md rounded-lg border border-line bg-white p-6"
        onSubmit={form.handleSubmit(async (values) => {
          setError('');
          try {
            await api('/v1/auth/change-password', { method: 'POST', body: JSON.stringify(values) });
            await refreshUser();
            setDone(true);
          } catch (reason) {
            setError(reason instanceof ApiError ? reason.message : 'Password was not changed.');
          }
        })}
      >
        <h1 className="text-2xl font-semibold">Change password</h1>
        <p className="mt-1 mb-5 text-sm text-slate-600">{user.mustChangePassword ? 'Your temporary password must be replaced before you continue.' : 'Choose a password of at least 12 characters.'}</p>
        {error ? <div className="mb-4"><ErrorText>{error}</ErrorText></div> : null}
        {done ? <p className="text-sm text-pine">Password changed.</p> : null}
        <div className="grid gap-4">
          <Field label="Current password"><input className={controlClass} type="password" {...form.register('currentPassword', { required: true })} /></Field>
          <Field label="New password"><input className={controlClass} type="password" {...form.register('newPassword', { required: true, minLength: 12 })} /></Field>
          <Button type="submit">Update password</Button>
          <button className="text-sm text-slate-500" type="button" onClick={() => signOut()}>Sign out</button>
        </div>
      </form>
      </div>
      <SiteFooter />
    </div>
  );
}
