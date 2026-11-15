import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { Badge, Button, controlClass, ErrorText, PageHeader } from '../components/ui';

interface Step {
  stepOrder: number;
  name: string;
  resolver: string;
  roleCode: string | null;
  positionCode: string | null;
  parallelGroup: number | null;
  decisionKind: string;
  requiresExpenditureAuthority: boolean;
  isFinalBusinessStep: boolean;
  minAmount: number | null;
  maxAmount: number | null;
  appliesToDepartmentId: number | null;
  appliesToBranchId: number | null;
  appliesToPositionCode?: string | null;
  conditionFlag?: string;
  escalateAfterHours?: number | null;
  escalationRoleCode?: string | null;
}

interface Workflow {
  id: number;
  code: string;
  name: string;
  description: string | null;
  transactionKind: string;
  completionRoleCode: string | null;
  requiresSupportingDocument?: boolean;
  status: string;
  steps: Step[];
}

export function WorkflowsPage() {
  const client = useQueryClient();
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState<Step[] | null>(null);
  const [error, setError] = useState('');
  const workflows = useQuery({
    queryKey: ['approval-workflows'],
    queryFn: () => api<{ data: Workflow[] }>('/v1/approvals/workflows'),
  });
  const current = workflows.data?.data.find((workflow) => workflow.id === selected) ?? workflows.data?.data[0];
  const steps = draft && current && selected === current.id ? draft : current?.steps ?? [];
  const save = useMutation({
    mutationFn: () => api(`/v1/approvals/workflows/${current?.id}`, {
      method: 'PUT',
      body: JSON.stringify({ steps }),
    }),
    onSuccess: async () => {
      setError('');
      setDraft(null);
      await client.invalidateQueries({ queryKey: ['approval-workflows'] });
    },
    onError: (reason) => setError(reason instanceof ApiError ? reason.message : 'The route was not saved.'),
  });

  const settings = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/v1/approvals/workflows/${current?.id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: async () => { setError(''); await client.invalidateQueries({ queryKey: ['approval-workflows'] }); },
    onError: (reason) => setError(reason instanceof ApiError ? reason.message : 'The route was not saved.'),
  });

  function edit(index: number, field: 'minAmount' | 'maxAmount' | 'escalateAfterHours' | 'conditionFlag', value: string) {
    if (!current) return;
    const parsed = field === 'conditionFlag' ? value : value === '' ? null : Number(value);
    const next = steps.map((step, stepIndex) => stepIndex === index ? { ...step, [field]: parsed } : step);
    setSelected(current.id);
    setDraft(next);
  }

  return (
    <section>
      <PageHeader title="Workflow routes" description="Thresholds, conditions, and escalation are configuration. A request already in progress keeps the route it started with. A step marked 'executive' joins only when the amount reaches the company threshold, exceeds the manager's limit, or special approval is requested." />
      {error ? <div className="mb-4"><ErrorText>{error}</ErrorText></div> : null}
      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <div className="rounded-lg border border-line bg-white">
          {workflows.data?.data.map((workflow) => (
            <button
              key={workflow.id}
              className={`block w-full border-b border-line px-3 py-3 text-left text-sm last:border-b-0 ${current?.id === workflow.id ? 'bg-canvas font-semibold' : ''}`}
              onClick={() => { setSelected(workflow.id); setDraft(null); setError(''); }}
              type="button"
            >
              {workflow.name}
              <div className="text-xs font-normal text-slate-500">{workflow.code}</div>
            </button>
          ))}
        </div>
        {current ? (
          <article className="rounded-lg border border-line bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{current.name}</h2>
              <Badge value={current.transactionKind} />
            </div>
            <p className="mb-2 text-sm text-slate-600">{current.description}</p>
            <label className="mb-4 flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={Boolean(current.requiresSupportingDocument)} disabled={settings.isPending}
                onChange={(event) => settings.mutate({ requiresSupportingDocument: event.target.checked })} />
              Require a supporting document before verification or approval
            </label>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-500">
                  <tr>{['Step', 'Decides by', 'Kind', 'Joins when', 'Minimum', 'Maximum', 'Escalate after (h)'].map((header) => <th key={header} className="px-2 py-2">{header}</th>)}</tr>
                </thead>
                <tbody>
                  {steps.map((step, index) => (
                    <tr key={`${step.stepOrder}-${step.name}`} className="border-t border-line">
                      <td className="px-2 py-2 font-semibold">{step.stepOrder}. {step.name}{step.isFinalBusinessStep ? ' · final' : ''}</td>
                      <td className="px-2 py-2">{step.roleCode || step.positionCode || step.resolver.replaceAll('_', ' ')}{step.parallelGroup ? ` · group ${step.parallelGroup}` : ''}</td>
                      <td className="px-2 py-2 capitalize">{step.decisionKind}{step.requiresExpenditureAuthority ? ' · spend' : ''}</td>
                      <td className="px-2 py-2">
                        <select className={`${controlClass} w-32`} value={step.conditionFlag ?? 'always'} onChange={(event) => edit(index, 'conditionFlag', event.target.value)}>
                          {['always', 'executive', 'special', 'standard'].map((flag) => <option key={flag} value={flag}>{flag}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-2"><input className={`${controlClass} w-28`} type="number" min="0" step="0.01" value={step.minAmount ?? ''} onChange={(event) => edit(index, 'minAmount', event.target.value)} /></td>
                      <td className="px-2 py-2"><input className={`${controlClass} w-28`} type="number" min="0" step="0.01" value={step.maxAmount ?? ''} onChange={(event) => edit(index, 'maxAmount', event.target.value)} /></td>
                      <td className="px-2 py-2"><input className={`${controlClass} w-24`} type="number" min="0" placeholder="default" value={step.escalateAfterHours ?? ''} onChange={(event) => edit(index, 'escalateAfterHours', event.target.value)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4"><Button type="button" disabled={save.isPending || !draft} onClick={() => save.mutate()}>Save route</Button></div>
          </article>
        ) : null}
      </div>
    </section>
  );
}
