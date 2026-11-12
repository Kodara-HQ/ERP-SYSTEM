import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, controlClass, ErrorText, Field, PageHeader } from '../components/ui';

interface Company {
  legalName: string;
  tradingName: string | null;
  registrationNumber: string | null;
  taxIdentificationNumber: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  addressLine: string | null;
  city: string | null;
  country: string | null;
  currencyCode: string;
  timezone: string;
  fiscalYearStartMonth: number;
}

export function CompanyPage() {
  const { can } = useAuth();
  const client = useQueryClient();
  const company = useQuery({ queryKey: ['company'], queryFn: () => api<{ data: Company }>('/v1/company') });
  const form = useForm<Company>();
  const save = useMutation({
    mutationFn: (values: Company) => api('/v1/company', { method: 'PUT', body: JSON.stringify({ ...values, fiscalYearStartMonth: Number(values.fiscalYearStartMonth) }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['company'] }),
  });

  useEffect(() => {
    if (company.data) form.reset(company.data.data);
  }, [company.data, form]);

  const editable = can('company.edit');
  return (
    <section>
      <PageHeader title="Company profile" description="Legal identity used across branches, employees, and later financial records. Currency and timezone are configuration, not assumptions about a location." />
      {save.isError ? <div className="mb-4"><ErrorText>{save.error instanceof ApiError ? save.error.message : 'Save failed.'}</ErrorText></div> : null}
      <form className="grid max-w-4xl gap-4 rounded-lg border border-line bg-white p-5 sm:grid-cols-2" onSubmit={form.handleSubmit((values) => save.mutate(values))}>
        <Field label="Legal name"><input className={controlClass} disabled={!editable} {...form.register('legalName', { required: true })} /></Field>
        <Field label="Trading name"><input className={controlClass} disabled={!editable} {...form.register('tradingName')} /></Field>
        <Field label="Registration number"><input className={controlClass} disabled={!editable} {...form.register('registrationNumber')} /></Field>
        <Field label="Tax identification"><input className={controlClass} disabled={!editable} {...form.register('taxIdentificationNumber')} /></Field>
        <Field label="Email"><input className={controlClass} disabled={!editable} {...form.register('email')} /></Field>
        <Field label="Phone"><input className={controlClass} disabled={!editable} {...form.register('phone')} /></Field>
        <Field label="Address"><input className={controlClass} disabled={!editable} {...form.register('addressLine')} /></Field>
        <Field label="City"><input className={controlClass} disabled={!editable} {...form.register('city')} /></Field>
        <Field label="Country"><input className={controlClass} disabled={!editable} {...form.register('country')} /></Field>
        <Field label="Website"><input className={controlClass} disabled={!editable} {...form.register('website')} /></Field>
        <Field label="Currency"><input className={controlClass} disabled={!editable} maxLength={3} {...form.register('currencyCode', { required: true })} /></Field>
        <Field label="Timezone"><input className={controlClass} disabled={!editable} {...form.register('timezone', { required: true })} /></Field>
        <Field label="Fiscal year starts (month)"><input className={controlClass} disabled={!editable} type="number" min={1} max={12} {...form.register('fiscalYearStartMonth', { required: true, valueAsNumber: true })} /></Field>
        {editable ? <div className="sm:col-span-2"><Button type="submit" disabled={save.isPending}>Save company profile</Button></div> : <p className="text-sm text-slate-500 sm:col-span-2">You can view this profile. Editing is limited to authorised business roles.</p>}
      </form>
    </section>
  );
}
