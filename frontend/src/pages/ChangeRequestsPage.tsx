import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Button, controlClass, ErrorText, Field, PageHeader } from '../components/ui';

interface ChangeRequest {
  id: number;
  referenceNumber: string;
  changeType: string;
  reason: string;
  status: string;
  requestedBy: string;
  payload: { code?: string; name?: string; title?: string };
}

export function ChangeRequestsPage() {
  const { can } = useAuth();
  const client = useQueryClient();
  const form = useForm<{ changeType: string; code: string; name: string; reason: string }>({ defaultValues: { changeType: 'create_department' } });
  const requests = useQuery({
    queryKey: ['change-requests'],
    queryFn: () => api<{ data: ChangeRequest[] }>('/v1/organisation/change-requests?status=all&pageSize=50'),
  });
  const submit = useMutation({
    mutationFn: (values: { changeType: string; code: string; name: string; reason: string }) => api('/v1/organisation/change-requests', {
      method: 'POST',
      body: JSON.stringify({
        changeType: values.changeType,
        reason: values.reason,
        payload: values.changeType.includes('position')
          ? { code: values.code, title: values.name }
          : { code: values.code, name: values.name },
      }),
    }),
    onSuccess: () => {
      form.reset({ changeType: 'create_department', code: '', name: '', reason: '' });
      return client.invalidateQueries({ queryKey: ['change-requests'] });
    },
  });
  const decide = useMutation({
    mutationFn: ({ id, action, comment }: { id: number; action: 'implement' | 'reject'; comment?: string }) => api(`/v1/organisation/change-requests/${id}/${action}`, {
      method: 'POST',
      body: action === 'reject' ? JSON.stringify({ comment }) : undefined,
    }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['change-requests'] }),
  });

  return (
    <section>
      <PageHeader title="Organisational change requests" description="Managers can ask for a department or position. Only a system administrator can implement it, and not their own request." />
      {submit.isError || decide.isError ? <div className="mb-4"><ErrorText>{(submit.error || decide.error) instanceof ApiError ? ((submit.error || decide.error) as ApiError).message : 'The request failed.'}</ErrorText></div> : null}
      {can('organisation.request_change') ? (
        <form className="mb-5 grid gap-3 rounded-lg border border-line bg-white p-4 md:grid-cols-2" onSubmit={form.handleSubmit((values) => submit.mutate(values))}>
          <Field label="Change"><select className={controlClass} {...form.register('changeType')}><option value="create_department">New department</option><option value="create_position">New position</option></select></Field>
          <Field label="Code"><input className={controlClass} {...form.register('code', { required: true })} /></Field>
          <Field label="Name or title"><input className={controlClass} {...form.register('name', { required: true })} /></Field>
          <Field label="Reason"><input className={controlClass} {...form.register('reason', { required: true, minLength: 8 })} /></Field>
          <div className="md:col-span-2"><Button type="submit">Submit request</Button></div>
        </form>
      ) : null}
      <div className="overflow-hidden rounded-lg border border-line bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-canvas text-xs uppercase tracking-wide text-slate-500"><tr>{['Reference', 'Type', 'Requested by', 'Status', ''].map((header) => <th key={header} className="px-4 py-3">{header}</th>)}</tr></thead>
          <tbody>
            {requests.data?.data.map((item) => (
              <tr key={item.id} className="border-t border-line">
                <td className="px-4 py-3 font-semibold">{item.referenceNumber}</td>
                <td className="px-4 py-3">{item.changeType.replaceAll('_', ' ')}{item.payload.code ? ` · ${item.payload.code}` : ''}</td>
                <td className="px-4 py-3">{item.requestedBy}</td>
                <td className="px-4 py-3"><Badge value={item.status} /></td>
                <td className="px-4 py-3 text-right">
                  {can('organisation.implement_change') && item.status === 'submitted' ? (
                    <span className="space-x-3">
                      <button className="font-semibold text-pine" onClick={() => decide.mutate({ id: item.id, action: 'implement' })} type="button">Implement</button>
                      <button className="font-semibold text-[#8d2f2f]" onClick={() => {
                        const comment = window.prompt('Why is this request being rejected?');
                        if (comment && comment.trim().length >= 8) decide.mutate({ id: item.id, action: 'reject', comment: comment.trim() });
                      }} type="button">Reject</button>
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
