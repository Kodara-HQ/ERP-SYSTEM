import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, controlClass, Empty, ErrorText, PageHeader } from '../components/ui';

type Row = Record<string, unknown>;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? '');
      resolve(value.slice(value.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function uploadImage(file: File, altText: string) {
  const contentBase64 = await fileToBase64(file);
  const payload = await api<{ data: { id: number } }>('/v1/website/media', {
    method: 'POST',
    body: JSON.stringify({ fileName: file.name, contentType: file.type, contentBase64, altText }),
  });
  return payload.data.id;
}

function Workflow({ kind, id, status }: { kind: string; id: number; status: string }) {
  const { can } = useAuth();
  const client = useQueryClient();
  const act = useMutation({
    mutationFn: (action: string) => api(`/v1/website/${kind}/${id}/transition`, { method: 'POST', body: JSON.stringify({ action }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['website'] }),
  });
  const actions = status === 'draft' && can('website.edit') ? [['submit', 'Submit for approval']]
    : status === 'pending_approval' && can('website.publish') ? [['approve', 'Approve'], ['reject', 'Return to draft']]
      : status === 'approved' && can('website.publish') ? [['publish', 'Publish'], ['reject', 'Return to draft']]
        : status === 'published' && can('website.publish') ? [['unpublish', 'Unpublish']] : [];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="rounded-full bg-cream px-2 py-0.5 text-xs font-semibold capitalize text-pine">{status.replaceAll('_', ' ')}</span>
      {actions.map(([action, label]) => <Button key={action} type="button" variant={action === 'reject' || action === 'unpublish' ? 'secondary' : 'primary'} onClick={() => act.mutate(action)}>{label}</Button>)}
    </div>
  );
}

export function WebsiteAdminPage() {
  const [tab, setTab] = useState('pages');
  const tabs = ['pages', 'products', 'news', 'gallery', 'careers', 'highlights', 'settings'];
  return (
    <section>
      <PageHeader title="Website management" description="Drafts stay off the public site until they are approved and published. Content is stored in the BAJOGO ERP database." />
      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((item) => <button key={item} type="button" className={`rounded-full px-3 py-1.5 text-sm font-semibold capitalize ${tab === item ? 'bg-pine text-cream' : 'bg-white'}`} onClick={() => setTab(item)}>{item}</button>)}
      </div>
      {tab === 'pages' ? <PagesTab /> : null}
      {tab === 'products' ? <ProductsTab /> : null}
      {tab === 'news' ? <NewsTab /> : null}
      {tab === 'gallery' ? <GalleryTab /> : null}
      {tab === 'careers' ? <CareersTab /> : null}
      {tab === 'highlights' ? <ItemsTab /> : null}
      {tab === 'settings' ? <SettingsTab /> : null}
    </section>
  );
}

function PagesTab() {
  const blocks = useQuery({ queryKey: ['website', 'blocks'], queryFn: () => api<{ data: Row[] }>('/v1/website/blocks') });
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: (row: Row) => api(`/v1/website/blocks/${row.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        title: row.title,
        summary: row.summary,
        body: row.body,
        content: row.content ?? {},
        mediaId: row.mediaId ?? null,
        metaTitle: row.metaTitle,
        metaDescription: row.metaDescription,
      }),
    }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['website', 'blocks'] }),
  });
  if (blocks.isLoading) return <p className="text-sm">Loading pages…</p>;
  if (blocks.isError) return <ErrorText>{blocks.error instanceof ApiError ? blocks.error.message : 'Could not load pages.'}</ErrorText>;
  return (
    <div className="grid gap-4">
      {blocks.data?.data.map((block) => <BlockEditor key={String(block.id)} block={block} onSave={(row) => save.mutate(row)} pending={save.isPending} />)}
    </div>
  );
}

function BlockEditor({ block, onSave, pending }: { block: Row; onSave: (row: Row) => void; pending: boolean }) {
  const [row, setRow] = useState(block);
  const content = (row.content ?? {}) as Record<string, string | null>;
  const image = row.image as { id?: number; fileUrl?: string; alt?: string } | null;
  return (
    <form className="grid gap-3 rounded-lg border border-line bg-white p-4" onSubmit={(event) => { event.preventDefault(); onSave({ ...row, mediaId: image?.id ?? null }); }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{String(row.key)}</h2>
        <Workflow kind="blocks" id={Number(row.id)} status={String(row.status)} />
      </div>
      <input className={controlClass} value={String(row.title ?? '')} onChange={(event) => setRow({ ...row, title: event.target.value })} />
      <textarea className={`${controlClass} h-20`} value={String(row.summary ?? '')} onChange={(event) => setRow({ ...row, summary: event.target.value })} />
      <textarea className={`${controlClass} h-32`} value={String(row.body ?? '')} onChange={(event) => setRow({ ...row, body: event.target.value })} />
      <div className="grid gap-2 sm:grid-cols-2">
        {Object.entries(content).map(([key, value]) => (
          <label key={key} className="text-xs font-semibold">{key}
            <input className={controlClass} value={value ?? ''} onChange={(event) => setRow({ ...row, content: { ...content, [key]: event.target.value || null } })} />
          </label>
        ))}
      </div>
      {image?.fileUrl ? <img src={image.fileUrl} alt={image.alt ?? ''} className="h-28 w-48 rounded-md object-cover" /> : null}
      <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const id = await uploadImage(file, String(row.title ?? 'Website image'));
        setRow({ ...row, mediaId: id, image: { id, fileUrl: `/api/v1/website/media/${id}/file`, alt: String(row.title) } });
      }} />
      <Button type="submit" disabled={pending}>Save draft fields</Button>
    </form>
  );
}

function ProductsTab() {
  const products = useQuery({ queryKey: ['website', 'products'], queryFn: () => api<{ data: Row[] }>('/v1/website/products') });
  const client = useQueryClient();
  const [form, setForm] = useState({ slug: '', name: '', summary: '', description: '', category: 'other' });
  const create = useMutation({
    mutationFn: () => api('/v1/website/products', { method: 'POST', body: JSON.stringify({ ...form, availabilityStatus: 'unspecified', featured: false, sortOrder: 50, specifications: null, gradeInformation: null, packaging: null, metaTitle: null, metaDescription: null }) }),
    onSuccess: () => { client.invalidateQueries({ queryKey: ['website', 'products'] }); setForm({ slug: '', name: '', summary: '', description: '', category: 'other' }); },
  });
  return (
    <div className="grid gap-4">
      <form className="grid gap-2 rounded-lg border border-line bg-white p-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
        <h2 className="sm:col-span-2 font-semibold">Add a commodity</h2>
        <p className="sm:col-span-2 text-sm text-slate-600">Leave grade, specification, packaging, and price blank until the company confirms them. This form does not ask for those.</p>
        {(['slug', 'name', 'summary', 'description'] as const).map((field) => <input key={field} required placeholder={field} className={controlClass} value={form[field]} onChange={(event) => setForm({ ...form, [field]: event.target.value })} />)}
        <select className={controlClass} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
          {['cashew', 'soybean', 'shea', 'cassava', 'cocoa', 'ginger', 'other'].map((item) => <option key={item}>{item}</option>)}
        </select>
        <Button type="submit">Create draft</Button>
        {create.isError ? <ErrorText>{create.error instanceof ApiError ? create.error.message : 'Could not create the product.'}</ErrorText> : null}
      </form>
      {products.data?.data.map((product) => (
        <article key={String(product.id)} className="rounded-lg border border-line bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><h3 className="font-semibold">{String(product.name)}</h3><p className="text-sm text-slate-600">{String(product.summary)}</p></div>
            <Workflow kind="products" id={Number(product.id)} status={String(product.status)} />
          </div>
          <label className="mt-3 block text-xs font-semibold">Add photograph
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const mediaId = await uploadImage(file, String(product.name));
              await api(`/v1/website/products/${product.id}/images`, { method: 'POST', body: JSON.stringify({ mediaId, isPrimary: true, sortOrder: 0 }) });
              products.refetch();
            }} />
          </label>
        </article>
      ))}
      {products.data?.data.length === 0 ? <Empty>No commodities yet.</Empty> : null}
    </div>
  );
}

function NewsTab() {
  const articles = useQuery({ queryKey: ['website', 'articles'], queryFn: () => api<{ data: Row[] }>('/v1/website/articles') });
  const client = useQueryClient();
  const [form, setForm] = useState({ slug: '', title: '', summary: '', body: '', category: 'company' });
  const create = useMutation({
    mutationFn: () => api('/v1/website/articles', { method: 'POST', body: JSON.stringify({ ...form, featured: false, publishedOn: null, heroMediaId: null, metaTitle: null, metaDescription: null }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['website', 'articles'] }),
  });
  return (
    <div className="grid gap-4">
      <form className="grid gap-2 rounded-lg border border-line bg-white p-4" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
        <h2 className="font-semibold">New article</h2>
        {(['slug', 'title', 'summary', 'category'] as const).map((field) => <input key={field} required className={controlClass} placeholder={field} value={form[field]} onChange={(event) => setForm({ ...form, [field]: event.target.value })} />)}
        <textarea required className={`${controlClass} h-28`} placeholder="Article" value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} />
        <Button type="submit">Create draft</Button>
      </form>
      {articles.data?.data.map((article) => (
        <article key={String(article.id)} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-white p-4">
          <div><h3 className="font-semibold">{String(article.title)}</h3><p className="text-sm">{String(article.summary)}</p></div>
          <Workflow kind="articles" id={Number(article.id)} status={String(article.status)} />
        </article>
      ))}
    </div>
  );
}

function GalleryTab() {
  const gallery = useQuery({ queryKey: ['website', 'gallery'], queryFn: () => api<{ data: Row[] }>('/v1/website/gallery') });
  const client = useQueryClient();
  const [category, setCategory] = useState('activities');
  const [caption, setCaption] = useState('');
  const [error, setError] = useState('');
  return (
    <div className="grid gap-4">
      <form className="grid gap-2 rounded-lg border border-line bg-white p-4" onSubmit={async (event) => {
        event.preventDefault();
        setError('');
        const file = (event.currentTarget.elements.namedItem('photo') as HTMLInputElement).files?.[0];
        if (!file) return;
        try {
          const mediaId = await uploadImage(file, caption || category);
          await api('/v1/website/gallery', { method: 'POST', body: JSON.stringify({ mediaId, category, caption: caption || null, featuredOnHome: true, sortOrder: 0 }) });
          setCaption('');
          client.invalidateQueries({ queryKey: ['website', 'gallery'] });
        } catch (reason) {
          setError(reason instanceof ApiError ? reason.message : 'Upload failed.');
        }
      }}>
        <h2 className="font-semibold">Upload a photograph</h2>
        <p className="text-sm text-slate-600">The image stays a draft until it is approved and published. Do not upload a vehicle as company-owned unless that has been confirmed.</p>
        <select className={controlClass} value={category} onChange={(event) => setCategory(event.target.value)}>
          {['cashew', 'soybean', 'shea', 'cassava', 'cocoa', 'ginger', 'warehouses', 'haulage', 'gold', 'activities'].map((item) => <option key={item}>{item}</option>)}
        </select>
        <input className={controlClass} placeholder="Caption" value={caption} onChange={(event) => setCaption(event.target.value)} />
        <input name="photo" type="file" accept="image/jpeg,image/png,image/webp,image/gif" required />
        {error ? <ErrorText>{error}</ErrorText> : null}
        <Button type="submit">Upload as draft</Button>
      </form>
      <div className="grid gap-3 sm:grid-cols-2">
        {gallery.data?.data.map((item) => {
          const image = item.image as { fileUrl?: string; alt?: string } | null;
          return (
            <article key={String(item.id)} className="rounded-lg border border-line bg-white p-3">
              {image?.fileUrl ? <img src={image.fileUrl} alt={image.alt ?? ''} className="h-40 w-full rounded-md object-cover" /> : null}
              <p className="mt-2 text-sm">{String(item.caption ?? item.category)}</p>
              <Workflow kind="gallery" id={Number(item.id)} status={String(item.status)} />
            </article>
          );
        })}
      </div>
    </div>
  );
}

function CareersTab() {
  const jobs = useQuery({ queryKey: ['website', 'vacancies'], queryFn: () => api<{ data: Row[] }>('/v1/website/vacancies') });
  const client = useQueryClient();
  const [form, setForm] = useState({ slug: '', title: '', locationLabel: '', summary: '', description: '', requirements: '' });
  const create = useMutation({
    mutationFn: () => api('/v1/website/vacancies', { method: 'POST', body: JSON.stringify({ ...form, locationLabel: form.locationLabel || null, requirements: form.requirements || null, applicationsEnabled: true, metaTitle: null, metaDescription: null }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['website', 'vacancies'] }),
  });
  return (
    <div className="grid gap-4">
      <form className="grid gap-2 rounded-lg border border-line bg-white p-4" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
        <h2 className="font-semibold">New vacancy</h2>
        {(['slug', 'title', 'locationLabel', 'summary', 'description', 'requirements'] as const).map((field) => <input key={field} required={field !== 'locationLabel' && field !== 'requirements'} className={controlClass} placeholder={field} value={form[field]} onChange={(event) => setForm({ ...form, [field]: event.target.value })} />)}
        <Button type="submit">Create draft</Button>
      </form>
      {jobs.data?.data.map((job) => (
        <article key={String(job.id)} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-white p-4">
          <h3 className="font-semibold">{String(job.title)}</h3>
          <Workflow kind="vacancies" id={Number(job.id)} status={String(job.status)} />
        </article>
      ))}
    </div>
  );
}

function ItemsTab() {
  const items = useQuery({ queryKey: ['website', 'items'], queryFn: () => api<{ data: Row[] }>('/v1/website/items') });
  const client = useQueryClient();
  const [form, setForm] = useState({ itemType: 'highlight', title: '', summary: '', metricValue: '', metricNote: '' });
  const create = useMutation({
    mutationFn: () => api('/v1/website/items', { method: 'POST', body: JSON.stringify({ ...form, summary: form.summary || null, metricValue: form.metricValue || null, metricNote: form.metricNote || null, body: null, groupKey: null, mediaId: null, href: null, sortOrder: 10 }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['website', 'items'] }),
  });
  return (
    <div className="grid gap-4">
      <form className="grid gap-2 rounded-lg border border-line bg-white p-4" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
        <h2 className="font-semibold">Strength, value, highlight, leader, or service</h2>
        <p className="text-sm text-slate-600">For a highlight, enter only a figure that comes from company records. Leave the number blank if it is not confirmed.</p>
        <select className={controlClass} value={form.itemType} onChange={(event) => setForm({ ...form, itemType: event.target.value })}>
          {['highlight', 'strength', 'value', 'leader', 'service', 'division'].map((item) => <option key={item}>{item}</option>)}
        </select>
        <input required className={controlClass} placeholder="Title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        <input className={controlClass} placeholder="Summary" value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} />
        <input className={controlClass} placeholder="Figure, if confirmed" value={form.metricValue} onChange={(event) => setForm({ ...form, metricValue: event.target.value })} />
        <input className={controlClass} placeholder="What the figure refers to" value={form.metricNote} onChange={(event) => setForm({ ...form, metricNote: event.target.value })} />
        <Button type="submit">Create draft</Button>
      </form>
      {items.data?.data.map((item) => (
        <article key={String(item.id)} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-white p-4">
          <div><p className="text-xs uppercase text-slate-500">{String(item.itemType)}</p><h3 className="font-semibold">{String(item.title)} {item.metricValue ? `· ${String(item.metricValue)}` : ''}</h3></div>
          <Workflow kind="items" id={Number(item.id)} status={String(item.status)} />
        </article>
      ))}
    </div>
  );
}

function SettingsTab() {
  const settings = useQuery({ queryKey: ['website', 'settings'], queryFn: () => api<{ data: Row }>('/v1/website/settings') });
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: (values: Row) => api('/v1/website/settings', { method: 'PUT', body: JSON.stringify(values) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['website', 'settings'] }),
  });
  if (!settings.data) return <p className="text-sm">Loading contact settings…</p>;
  const published = settings.data.data.published as Row;
  return (
    <form className="grid max-w-3xl gap-3 rounded-lg border border-line bg-white p-4" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const values = Object.fromEntries([...form.entries()].map(([key, value]) => [key, value === '' ? null : value]));
      save.mutate(values);
    }}>
      <p className="text-sm text-slate-600">Blank fields fall back to the company profile. The public site currently shows {String(published.phone ?? 'no telephone')} and {String(published.email ?? 'no email')}.</p>
      {['phone', 'email', 'addressLine', 'city', 'country', 'mapUrl', 'facebookUrl', 'twitterUrl', 'linkedinUrl', 'instagramUrl', 'footerText', 'seoTitle', 'seoDescription', 'staffLoginUrl'].map((field) => (
        <label key={field} className="text-sm font-semibold">{field}
          <input name={field} className={controlClass} defaultValue={String(settings.data?.data[field] ?? '')} />
        </label>
      ))}
      <Button type="submit">Save website settings</Button>
      {save.isError ? <ErrorText>{save.error instanceof ApiError ? save.error.message : 'Save failed.'}</ErrorText> : null}
      {save.isSuccess ? <p className="text-sm text-pine">Saved.</p> : null}
    </form>
  );
}

export function WebsiteEnquiriesPage() {
  const rows = useQuery({ queryKey: ['website', 'enquiries'], queryFn: () => api<{ data: Row[] }>('/v1/website/enquiries') });
  const client = useQueryClient();
  const update = useMutation({
    mutationFn: (input: { id: number; status: string }) => api(`/v1/website/enquiries/${input.id}`, { method: 'PATCH', body: JSON.stringify({ status: input.status }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['website', 'enquiries'] }),
  });
  return (
    <section>
      <PageHeader title="Customer enquiries" description="Messages sent from the public website. They are visible to staff with website enquiry permission." />
      <div className="grid gap-3">
        {rows.data?.data.length === 0 ? <Empty>No enquiries yet.</Empty> : null}
        {rows.data?.data.map((row) => (
          <article key={String(row.id)} className="rounded-lg border border-line bg-white p-4">
            <div className="flex flex-wrap justify-between gap-2">
              <h2 className="font-semibold">{String(row.subject)}</h2>
              <span className="text-xs font-semibold uppercase">{String(row.status)} · {String(row.category)}</span>
            </div>
            <p className="text-sm">{String(row.fullName)} · {String(row.email)} {row.telephone ? `· ${String(row.telephone)}` : ''}</p>
            <p className="mt-2 whitespace-pre-line text-sm">{String(row.message)}</p>
            <div className="mt-3 flex gap-2">
              <Button type="button" variant="secondary" onClick={() => update.mutate({ id: Number(row.id), status: 'read' })}>Mark read</Button>
              <Button type="button" variant="secondary" onClick={() => update.mutate({ id: Number(row.id), status: 'closed' })}>Close</Button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function WebsiteApplicationsPage() {
  const rows = useQuery({ queryKey: ['website', 'applications'], queryFn: () => api<{ data: Row[] }>('/v1/website/applications') });
  const client = useQueryClient();
  const update = useMutation({
    mutationFn: (id: number) => api(`/v1/website/applications/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'reviewed' }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['website', 'applications'] }),
  });
  return (
    <section>
      <PageHeader title="Website applications" description="Job applications from the public site. Only human resources can open this list." />
      <div className="grid gap-3">
        {rows.data?.data.length === 0 ? <Empty>No applications yet.</Empty> : null}
        {rows.data?.data.map((row) => (
          <article key={String(row.id)} className="rounded-lg border border-line bg-white p-4">
            <h2 className="font-semibold">{String(row.fullName)} — {String(row.vacancyTitle)}</h2>
            <p className="text-sm">{String(row.email)} {row.phone ? `· ${String(row.phone)}` : ''}</p>
            <p className="mt-2 whitespace-pre-line text-sm">{String(row.message)}</p>
            {row.hasCv ? <a className="mt-2 inline-block text-sm font-semibold text-pine" href={`/api/v1/website/applications/${row.id}/cv`}>Download CV</a> : null}
            <div className="mt-3"><Button type="button" variant="secondary" onClick={() => update.mutate(Number(row.id))}>Mark reviewed</Button></div>
          </article>
        ))}
      </div>
    </section>
  );
}
