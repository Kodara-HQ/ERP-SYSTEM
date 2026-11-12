import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate } from 'react-router-dom';
import { SiteFooter } from '../components/SiteFooter';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, controlClass, ErrorText, Field } from '../components/ui';

const fieldClass = 'h-11 w-full rounded-lg border border-transparent bg-cream px-3 text-sm outline-none focus:border-pine';

export function LoginPage() {
  const { user, signIn } = useAuth();
  const [error, setError] = useState('');
  const form = useForm<{ username: string; password: string }>();
  if (user) return <Navigate to={user.mustChangePassword ? '/account/password' : '/'} replace />;

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <div className="grid flex-1 place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-lg bg-pine text-xl font-semibold text-cream">B</div>
          <div>
            <p className="text-lg font-semibold leading-tight text-ink">BAJOGO ENTERPRISE</p>
            <p className="text-xs font-semibold tracking-[0.22em] text-olive">BAJOGO ERP</p>
          </div>
        </div>
        <form
          className="rounded-2xl border border-line bg-white px-8 py-8 shadow-[0_12px_40px_rgba(62,60,40,0.08)]"
          onSubmit={form.handleSubmit(async (values) => {
            setError('');
            try {
              await signIn(values.username, values.password);
            } catch (reason) {
              setError(reason instanceof ApiError ? reason.message : 'Sign-in failed.');
            }
          })}
        >
          <h1 className="text-2xl font-semibold text-ink">Sign in</h1>
          <p className="mb-6 mt-1 text-sm text-olive">Use the account issued for your role.</p>
          {error ? <div className="mb-4"><ErrorText>{error}</ErrorText></div> : null}
          <div className="grid gap-4">
            <Field label="Username">
              <input className={fieldClass} autoComplete="username" {...form.register('username', { required: true })} />
            </Field>
            <Field label="Password">
              <input className={fieldClass} type="password" autoComplete="current-password" {...form.register('password', { required: true })} />
            </Field>
            <Button className="mt-2 h-11 w-full rounded-lg" type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </div>
        </form>
      </div>
      </div>
      <SiteFooter />
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
