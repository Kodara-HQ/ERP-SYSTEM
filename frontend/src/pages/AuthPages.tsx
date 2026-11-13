import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Eye, EyeOff } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { SiteFooter } from '../components/SiteFooter';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, controlClass, ErrorText, Field } from '../components/ui';

const fieldClass = 'h-12 w-full rounded-lg border border-line bg-white px-3.5 text-sm outline-none transition focus:border-pine focus:ring-2 focus:ring-pine/15';

export function LoginPage() {
  const { user, signIn } = useAuth();
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const form = useForm<{ username: string; password: string }>();
  if (user) return <Navigate to={user.mustChangePassword ? '/account/password' : '/'} replace />;

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
          <form
            className="w-full max-w-sm"
            onSubmit={form.handleSubmit(async (values) => {
              setError('');
              try {
                await signIn(values.username, values.password);
              } catch (reason) {
                setError(reason instanceof ApiError ? reason.message : 'Sign-in failed.');
              }
            })}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#B08D45]">BAJOGO ERP</p>
            <h1 className="mt-2 text-3xl font-semibold text-ink">Welcome back</h1>
            <p className="mb-8 mt-2 text-sm text-olive">Sign in with the account issued for your role.</p>
            {error ? <div className="mb-4"><ErrorText>{error}</ErrorText></div> : null}
            <div className="grid gap-5">
              <Field label="Username">
                <input className={fieldClass} autoComplete="username" autoFocus {...form.register('username', { required: true })} />
              </Field>
              <Field label="Password">
                <div className="relative">
                  <input
                    className={`${fieldClass} pr-11`}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    {...form.register('password', { required: true })}
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 grid w-11 place-items-center text-olive hover:text-ink"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </Field>
              <Button className="mt-2 h-12 w-full rounded-lg text-base" type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Signing in…' : 'Sign in'}
              </Button>
            </div>
            <p className="mt-8 text-xs text-slate-500">Can't sign in? Contact your system administrator.</p>
          </form>
        </div>
        <SiteFooter />
      </main>
    </div>
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
