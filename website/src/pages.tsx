import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from './api';
import { EmptyNote, EnquiryForm, GoldButton, LineButton, PageBanner, Photo, Prose, useSeo } from './Site';
import { Band, delay, Eyebrow, FeatureGrid, Heading, Icon, RichText, SpecList, Steps, type Groups, type IconName } from './sections';
import { availabilityLabels, categoryLabels, type ArticleCard, type Block, type GalleryCard, type HomeData, type Item, type ProductCard, type Vacancy } from './types';

export function HomePage() {
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<{ data: HomeData }>('/v1/public/website/home').then((payload) => setData(payload.data)).catch(() => setError('The homepage could not be loaded from the company records.'));
  }, []);
  useSeo(data?.settings.seoTitle ?? 'BAJOGO ENTERPRISE', data?.hero?.metaDescription ?? data?.settings.seoDescription, data?.hero?.image?.url);
  if (error) return <p className="mx-auto max-w-3xl px-4 py-20 text-center">{error}</p>;
  if (!data) return <p className="px-4 py-20 text-center text-sm text-ink/60">Loading BAJOGO ENTERPRISE…</p>;
  const hero = data.hero;
  const heading = hero?.content.heading ?? hero?.title ?? data.settings.tradingName;
  const supporting = hero?.content.supporting ?? hero?.summary;

  return (
    <>
      <section className="relative min-h-[88vh] overflow-hidden bg-deep text-white">
        {hero?.image ? <img src={hero.image.url} alt={hero.image.alt} className="kenburns absolute inset-0 h-full w-full object-cover" /> : null}
        <div className="absolute inset-0 bg-gradient-to-r from-deep via-deep/88 to-deep/20" />
        <div aria-hidden="true" className="drift pointer-events-none absolute -left-32 bottom-10 h-96 w-96 glow-gold" />
        <a href="#divisions" aria-label="Scroll to the business areas" className="nudge absolute bottom-24 left-1/2 hidden -translate-x-1/2 text-white/70 hover:text-gold md:block">
          <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        </a>
        <div className="relative mx-auto flex min-h-[88vh] max-w-7xl items-center px-4 py-20">
          <div className="rise max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.32em] text-gold">{hero?.title ?? 'BAJOGO ENTERPRISE'}</p>
            <h1 className="mt-4 font-display text-5xl font-semibold leading-tight md:text-7xl">{heading}</h1>
            {supporting ? <p className="mt-5 max-w-xl text-lg text-white/85">{supporting}</p> : null}
            <div className="mt-8 flex flex-wrap gap-3">
              {hero?.content.primaryLabel && hero.content.primaryHref ? <GoldButton to={hero.content.primaryHref}>{hero.content.primaryLabel}</GoldButton> : null}
              {hero?.content.secondaryLabel && hero.content.secondaryHref ? <LineButton to={hero.content.secondaryHref} light>{hero.content.secondaryLabel}</LineButton> : null}
            </div>
          </div>
        </div>
      </section>

      <section id="divisions" className="relative mx-auto -mt-16 grid max-w-7xl scroll-mt-24 gap-5 px-4 md:grid-cols-3">
        {data.divisions.map((item, index) => (
          <article key={item.id} className="reveal group overflow-hidden rounded-3xl bg-white shadow-card transition duration-300 hover:-translate-y-2 hover:shadow-[0_28px_60px_rgba(0,59,32,0.2)]" style={{ '--delay': `${index * 120}ms` } as CSSProperties}>
            <div className="relative overflow-hidden">
              <Photo image={item.image} className="h-52 w-full transition duration-700 group-hover:scale-110" />
              <div className="absolute inset-x-0 bottom-0 h-1 origin-left scale-x-0 bg-gold transition duration-500 group-hover:scale-x-100" />
            </div>
            <div className="p-6">
              <h2 className="font-display text-2xl text-deep">{item.title}</h2>
              <p className="mt-2 text-sm leading-6 text-ink/75">{item.summary}</p>
              {item.href ? <Link to={item.href} className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-forest">Explore More <Arrow /></Link> : null}
            </div>
          </article>
        ))}
      </section>

      {data.products.length > 0 ? <CommodityRibbon products={data.products} /> : null}

      <section className="mx-auto max-w-7xl px-4 py-20">
        <div className="reveal mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-forest">Catalogue</p>
            <h2 className="mt-2 font-display text-4xl text-deep">Featured agricultural commodities</h2>
          </div>
          <LineButton to="/commodities">View All Products</LineButton>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {data.products.map((product, index) => <ProductTile key={product.slug} product={product} index={index} />)}
        </div>
      </section>

      {data.about ? (
        <section className="overflow-hidden bg-white">
          <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-20 lg:grid-cols-2">
            <div className="reveal relative">
              <div aria-hidden="true" className="absolute -bottom-4 -left-4 h-full w-full rounded-3xl border-2 border-gold/60" />
              <div className="group relative overflow-hidden rounded-3xl shadow-card">
                <Photo image={data.about.image} className="h-[420px] w-full transition duration-[1.2s] group-hover:scale-105" />
              </div>
            </div>
            <div className="reveal" style={{ '--delay': '150ms' } as CSSProperties}>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-forest">The company</p>
              <h2 className="mt-2 font-display text-4xl text-deep">{data.about.title}</h2>
              <p className="mt-4 text-lg leading-8 text-ink/80">{data.about.summary}</p>
              <Prose text={data.about.body} />
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {data.about.content.mission ? <Fact label="Mission" text={data.about.content.mission} /> : null}
                {data.about.content.vision ? <Fact label="Vision" text={data.about.content.vision} /> : null}
              </div>
              {data.values.length > 0 ? (
                <ul className="mt-6 flex flex-wrap gap-2">
                  {data.values.map((value) => <li key={value.id} className="rounded-full bg-mist px-3 py-1 text-sm font-semibold text-forest">{value.title}</li>)}
                </ul>
              ) : null}
              <div className="mt-6"><LineButton to="/about">Learn More</LineButton></div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="mx-auto max-w-7xl px-4 py-20">
        <h2 className="reveal font-display text-4xl text-deep">Why choose BAJOGO ENTERPRISE?</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.strengths.map((item, index) => (
            <article key={item.id} className="reveal group relative overflow-hidden rounded-3xl border border-forest/10 bg-white p-6 transition duration-300 hover:-translate-y-1 hover:border-gold/60 hover:shadow-card" style={{ '--delay': `${(index % 3) * 100}ms` } as CSSProperties}>
              <span aria-hidden="true" className="absolute -right-2 -top-4 font-display text-7xl text-forest/5 transition duration-500 group-hover:text-gold/20">{String(index + 1).padStart(2, '0')}</span>
              <span aria-hidden="true" className="mb-4 block h-1 w-10 rounded-full bg-gold transition-all duration-500 group-hover:w-20" />
              <h3 className="font-display text-2xl text-forest">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-ink/75">{item.summary}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="relative overflow-hidden bg-forest text-white">
        <div aria-hidden="true" className="drift pointer-events-none absolute -right-20 -top-20 h-72 w-72 glow-gold" />
        <div className="reveal relative mx-auto max-w-7xl px-4 py-16">
          <h2 className="font-display text-4xl">Company highlights</h2>
          {data.highlights.length === 0 ? (
            <p className="mt-4 max-w-2xl text-white/80">Approved operating figures appear here only after they are recorded and published. No demonstration numbers are shown.</p>
          ) : (
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {data.highlights.map((item) => (
                <article key={item.id} className="rounded-3xl bg-white/10 p-5">
                  <div className="font-display text-4xl text-gold">{item.metricValue}</div>
                  <h3 className="mt-2 font-bold">{item.title}</h3>
                  {item.metricNote ? <p className="mt-1 text-sm text-white/75">{item.metricNote}</p> : null}
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-20">
        <div className="reveal mb-8 flex items-end justify-between">
          <h2 className="font-display text-4xl text-deep">Latest news and updates</h2>
          <Link to="/news" className="text-sm font-bold text-forest">View all</Link>
        </div>
        {data.articles.length === 0 ? <EmptyNote>Company news is published here after approval.</EmptyNote> : (
          <div className="grid gap-5 md:grid-cols-3">{data.articles.map((article) => <ArticleTile key={article.slug} article={article} />)}</div>
        )}
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-4 py-20">
          <div className="reveal mb-8 flex items-end justify-between">
            <h2 className="font-display text-4xl text-deep">Gallery</h2>
            <Link to="/gallery" className="text-sm font-bold text-forest">View Gallery</Link>
          </div>
          {data.gallery.length === 0 ? <EmptyNote>Photographs are published here only after they are approved.</EmptyNote> : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">{data.gallery.map((item) => <GalleryTile key={item.id} item={item} />)}</div>
          )}
        </div>
      </section>

      {data.cta ? (
        <section className="relative overflow-hidden bg-deep text-white">
          <div aria-hidden="true" className="drift pointer-events-none absolute -bottom-24 right-1/4 h-80 w-80 glow-gold" />
          <div className="reveal relative mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-6 px-4 py-16">
            <div>
              <h2 className="font-display text-5xl">{data.cta.title}</h2>
              <p className="mt-3 max-w-xl text-lg text-white/80">{data.cta.summary}</p>
            </div>
            {data.cta.content.buttonLabel && data.cta.content.buttonHref ? <GoldButton to={data.cta.content.buttonHref}>{data.cta.content.buttonLabel}</GoldButton> : null}
          </div>
        </section>
      ) : null}
    </>
  );
}

function Fact({ label, text }: { label: string; text: string }) {
  return <div className="rounded-2xl bg-mist p-4"><div className="text-xs font-bold uppercase tracking-wide text-forest">{label}</div><p className="mt-1 text-sm leading-6">{text}</p></div>;
}

function Arrow() {
  return <svg viewBox="0 0 24 24" className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
}

function CommodityRibbon({ products }: { products: ProductCard[] }) {
  const loop = [...products, ...products];
  return (
    <section aria-label="Commodities we trade" className="marquee mt-16 overflow-hidden border-y border-forest/10 bg-white py-5">
      <ul className="marquee-track flex w-max items-center gap-10">
        {loop.map((product, index) => (
          <li key={`${product.slug}-${index}`} aria-hidden={index >= products.length} className="flex items-center gap-3">
            <Link to={`/commodities/${product.slug}`} tabIndex={index >= products.length ? -1 : undefined} className="group flex items-center gap-3">
              <span className="block h-12 w-12 overflow-hidden rounded-full ring-2 ring-gold/60">
                <Photo image={product.image} className="h-full w-full transition duration-500 group-hover:scale-125" />
              </span>
              <span className="font-display text-xl text-deep transition group-hover:text-forest">{product.name}</span>
            </Link>
            <span aria-hidden="true" className="ml-7 h-2 w-2 rotate-45 bg-gold" />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProductTile({ product, index = 0 }: { product: ProductCard; index?: number }) {
  return (
    <article className="reveal group overflow-hidden rounded-3xl bg-white shadow-card transition duration-300 hover:-translate-y-2 hover:shadow-[0_28px_60px_rgba(0,59,32,0.2)]" style={{ '--delay': `${(index % 3) * 110}ms` } as CSSProperties}>
      <div className="relative overflow-hidden">
        <Photo image={product.image} className="h-56 w-full transition duration-700 group-hover:scale-110" />
        <span className="absolute left-4 top-4 rounded-full bg-white/90 px-3 py-1 text-xs font-bold uppercase tracking-wide text-forest backdrop-blur">{categoryLabels[product.category] ?? product.category}</span>
      </div>
      <div className="p-5">
        <h3 className="font-display text-2xl text-deep">{product.name}</h3>
        <p className="mt-2 text-sm leading-6 text-ink/75">{product.summary}</p>
        <div className="mt-4 flex gap-4 text-sm font-bold">
          <Link to={`/commodities/${product.slug}`} className="inline-flex items-center gap-1 text-forest">View Details <Arrow /></Link>
          <Link to={`/contact?category=agricultural&product=${encodeURIComponent(product.name)}`} className="text-deep">Enquire Now</Link>
        </div>
      </div>
    </article>
  );
}

function ArticleTile({ article }: { article: ArticleCard }) {
  return (
    <article className="reveal group overflow-hidden rounded-3xl bg-white shadow-card transition duration-300 hover:-translate-y-1">
      <div className="overflow-hidden"><Photo image={article.image} className="h-48 w-full transition duration-700 group-hover:scale-110" /></div>
      <div className="p-5">
        <p className="text-xs font-bold uppercase tracking-wide text-forest">{article.publishedOn ?? 'Date on publication'} · {article.category}</p>
        <h3 className="mt-2 font-display text-2xl text-deep">{article.title}</h3>
        <p className="mt-2 text-sm leading-6 text-ink/75">{article.summary}</p>
        <Link to={`/news/${article.slug}`} className="mt-4 inline-block text-sm font-bold text-forest">Read More</Link>
      </div>
    </article>
  );
}

function GalleryTile({ item }: { item: GalleryCard }) {
  return (
    <Link to={`/gallery?category=${item.category}`} className="reveal group relative block overflow-hidden rounded-3xl shadow-card">
      <Photo image={item.image} className="h-56 w-full transition duration-700 group-hover:scale-110" />
      <span className="absolute inset-0 bg-gradient-to-t from-deep/80 via-transparent to-transparent" />
      <span className="absolute inset-x-0 bottom-0 p-4 text-white">
        <span className="block text-[11px] font-bold uppercase tracking-[0.2em] text-gold">{categoryLabels[item.category] ?? item.category}</span>
        <Caption text={item.caption || item.image?.alt} className="mt-0.5 block font-semibold" />
      </span>
    </Link>
  );
}

type PageData = { block: Block; groups?: Groups; values?: Item[]; leaders?: Item[]; divisions?: Item[]; gallery?: GalleryCard[]; services?: Item[] };

function usePage(key: string) {
  const [page, setPage] = useState<PageData | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    api<{ data: PageData }>(`/v1/public/website/pages/${key}`).then((payload) => setPage(payload.data)).catch(() => setFailed(true));
  }, [key]);
  return { page, failed };
}

function Loading({ children }: { children: ReactNode }) {
  return <p className="px-4 py-24 text-center text-sm text-ink/60">{children}</p>;
}

export function AboutPage() {
  const { page, failed } = usePage('about.profile');
  useSeo(page?.block.metaTitle ?? 'About Us | BAJOGO ENTERPRISE', page?.block.metaDescription, page?.block.image?.url);
  if (failed) return <Loading>The company profile could not be loaded.</Loading>;
  if (!page) return <Loading>Loading the company profile…</Loading>;
  const { block } = page;
  const content = block.content;
  const pillars = [
    ['Who we are', content.who, 'users'],
    ['How we work', content.approach, 'doc'],
    ['Our communities', content.community, 'leaf'],
  ].filter((entry): entry is [string, string, IconName] => Boolean(entry[1]));
  const values = page.values ?? [];
  const leaders = page.leaders ?? [];
  const gallery = page.gallery ?? [];
  return (
    <>
      <PageBanner title={block.title} text={block.summary} image={block.image} />

      <Band tone="white">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="reveal">
            <Eyebrow>Company overview</Eyebrow>
            <h2 className="mt-2 font-display text-3xl text-deep md:text-4xl">Three connected businesses, one accountable partner</h2>
            <div className="mt-6"><RichText text={block.body} /></div>
          </div>
          <div className="reveal relative" style={delay(1, 150)}>
            <div aria-hidden="true" className="absolute -right-4 -top-4 h-full w-full rounded-3xl border-2 border-gold/60" />
            <div className="group relative overflow-hidden rounded-3xl shadow-card">
              <Photo image={block.image} className="h-[460px] w-full transition duration-[1.2s] group-hover:scale-105" />
            </div>
          </div>
        </div>
      </Band>

      {pillars.length > 0 ? (
        <Band>
          <div className="grid gap-5 md:grid-cols-3">
            {pillars.map(([title, text, icon], index) => (
              <article key={title} className="reveal rounded-3xl bg-white p-7 shadow-card" style={delay(index, 120)}>
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gold text-deep"><Icon name={icon} /></span>
                <h3 className="mt-4 font-display text-2xl text-deep">{title}</h3>
                <p className="mt-3 text-sm leading-7 text-ink/75">{text}</p>
              </article>
            ))}
          </div>
        </Band>
      ) : null}

      {content.mission || content.vision ? (
        <Band tone="deep">
          <div className="grid gap-6 md:grid-cols-2">
            {[['Our mission', content.mission], ['Our vision', content.vision]].filter((entry) => entry[1]).map(([label, text], index) => (
              <div key={label} className="reveal rounded-3xl border border-white/10 bg-white/5 p-8" style={delay(index, 150)}>
                <Eyebrow light>{label}</Eyebrow>
                <p className="mt-4 font-display text-2xl leading-snug text-white md:text-3xl">{text}</p>
              </div>
            ))}
          </div>
        </Band>
      ) : null}

      {content.history ? (
        <Band tone="white">
          <Heading eyebrow="Our story" title="Our history" />
          <div className="mt-6 max-w-3xl"><RichText text={content.history} /></div>
        </Band>
      ) : null}

      {values.length > 0 ? (
        <Band>
          <Heading eyebrow="What guides us" title="Our core values" center />
          <div className="mt-10"><FeatureGrid items={values} icons={['shield', 'spark', 'box', 'users', 'doc', 'truck']} /></div>
        </Band>
      ) : null}

      {(page.divisions ?? []).length > 0 ? (
        <Band tone="white">
          <Heading eyebrow="What we do" title="Our business divisions" />
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {(page.divisions ?? []).map((item, index) => (
              <Link key={item.id} to={item.href ?? '/'} className="reveal group overflow-hidden rounded-3xl bg-cream shadow-card transition duration-300 hover:-translate-y-2" style={delay(index, 110)}>
                <div className="overflow-hidden"><Photo image={item.image} className="h-52 w-full transition duration-700 group-hover:scale-110" /></div>
                <div className="p-6">
                  <h3 className="font-display text-xl text-deep">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-ink/75">{item.summary}</p>
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-forest">Learn more <Arrow /></span>
                </div>
              </Link>
            ))}
          </div>
        </Band>
      ) : null}

      {leaders.length > 0 ? (
        <Band>
          <Heading eyebrow="Leadership" title="Management and leadership" />
          <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {leaders.map((item, index) => (
              <article key={item.id} className="reveal overflow-hidden rounded-3xl bg-white shadow-card" style={delay(index % 3)}>
                {item.image ? <Photo image={item.image} className="h-64 w-full" /> : null}
                <div className="p-6">
                  <h3 className="font-display text-2xl text-deep">{item.title}</h3>
                  <p className="text-sm font-semibold text-forest">{item.summary}</p>
                  <div className="mt-3 text-sm"><Prose text={item.body} /></div>
                </div>
              </article>
            ))}
          </div>
        </Band>
      ) : null}

      {gallery.length > 0 ? (
        <Band tone="white">
          <Heading eyebrow="Gallery" title="Inside the company" />
          <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-3">{gallery.map((item) => <GalleryTile key={item.id} item={item} />)}</div>
        </Band>
      ) : null}

      <CallToAction title="Work with BAJOGO ENTERPRISE" text="Tell us what you need to buy, sell or move, and we will reply with the next steps." />
    </>
  );
}

function CallToAction({ title, text, to = '/contact', label = 'Contact us' }: { title: string; text: string; to?: string; label?: string }) {
  return (
    <Band tone="deep">
      <div className="reveal flex flex-wrap items-center justify-between gap-6">
        <div className="max-w-2xl">
          <h2 className="font-display text-4xl text-white">{title}</h2>
          <p className="mt-3 text-lg text-white/80">{text}</p>
        </div>
        <GoldButton to={to}>{label}</GoldButton>
      </div>
    </Band>
  );
}

const commodityFilters = ['', 'cashew', 'soybean', 'shea', 'cassava', 'cocoa', 'ginger', 'other'];

export function CommoditiesPage() {
  const [params, setParams] = useSearchParams();
  const [products, setProducts] = useState<ProductCard[] | null>(null);
  const { page } = usePage('commodities.page');
  const q = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  useEffect(() => {
    const search = new URLSearchParams();
    if (q) search.set('q', q);
    if (category) search.set('category', category);
    api<{ data: ProductCard[] }>(`/v1/public/website/products?${search.toString()}`).then((payload) => setProducts(payload.data)).catch(() => setProducts([]));
  }, [q, category]);
  useSeo(page?.block.metaTitle ?? 'Agricultural Commodities | BAJOGO ENTERPRISE', page?.block.metaDescription ?? 'Agricultural commodities from BAJOGO ENTERPRISE.', page?.block.image?.url);
  const block = page?.block;
  const steps = page?.groups?.steps ?? [];
  return (
    <>
      <PageBanner title={block?.title ?? 'Agricultural Commodities'} text={block?.summary} image={block?.image} />

      {block ? (
        <Band tone="white">
          <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="reveal">
              <Eyebrow>What we supply</Eyebrow>
              <h2 className="mt-2 font-display text-3xl text-deep md:text-4xl">Ghanaian produce, checked and graded</h2>
              <div className="mt-6"><RichText text={block.body} /></div>
            </div>
            <div className="grid content-start gap-4">
              {[['Who we supply', block.content.buyers, 'box'], ['Supply to us', block.content.suppliers, 'leaf']].filter((entry) => entry[1]).map(([label, text, icon], index) => (
                <div key={label} className="reveal flex gap-4 rounded-3xl bg-mist p-6" style={delay(index, 150)}>
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gold text-deep"><Icon name={icon as IconName} /></span>
                  <div><h3 className="font-display text-xl text-deep">{label}</h3><p className="mt-1 text-sm leading-6 text-ink/75">{text}</p></div>
                </div>
              ))}
            </div>
          </div>
        </Band>
      ) : null}

      <Band>
        <Heading eyebrow="Catalogue" title="Our commodities" />
        <form className="reveal mt-6 flex flex-wrap gap-3" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const next = new URLSearchParams(params);
          const term = String(form.get('q') ?? '');
          if (term) next.set('q', term); else next.delete('q');
          setParams(next);
        }}>
          <input name="q" defaultValue={q} placeholder="Search commodities" className="field max-w-md" />
          <button className="rounded-full bg-forest px-5 py-3 text-sm font-bold text-white" type="submit">Search</button>
        </form>
        <div className="mt-4 flex flex-wrap gap-2">
          {commodityFilters.map((value) => (
            <button key={value || 'all'} type="button" onClick={() => {
              const next = new URLSearchParams(params);
              if (value) next.set('category', value); else next.delete('category');
              setParams(next);
            }} className={`rounded-full px-4 py-2 text-sm font-bold transition ${category === value ? 'bg-forest text-white' : 'bg-white text-forest hover:bg-mist'}`}>
              {value ? categoryLabels[value] : 'All'}
            </button>
          ))}
        </div>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {products == null ? <p>Loading products…</p> : products.length === 0 ? <EmptyNote>No published commodities match that search.</EmptyNote> : products.map((product, index) => <ProductTile key={product.slug} product={product} index={index} />)}
        </div>
      </Band>

      {steps.length > 0 ? (
        <Band tone="white">
          <Heading eyebrow="Our process" title="From farm gate to your warehouse" />
          <div className="mt-10"><Steps items={steps} /></div>
        </Band>
      ) : null}

      <CallToAction title="Need a commodity we have not listed?" text="Tell us the product, specification and quantity. We will tell you honestly whether we can supply it." to="/contact?category=agricultural" label="Send a request" />
    </>
  );
}

const journey = [
  { title: 'Sourcing', text: 'Bought from farmers and aggregators and sun-dried on clean tarpaulins.' },
  { title: 'Storage', text: 'Bagged and kept in our warehouse, ready for buyers.' },
  { title: 'Haulage', text: 'Loaded, covered and dispatched to the buyer.' },
];

/**
 * Short silent product film. It plays only while on screen, never for visitors who ask for reduced motion,
 * and always has controls so it can be paused.
 */
function ProductVideo({ video, name }: { video: { url: string; poster: string | null }; name: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) void element.play().catch(() => undefined);
      else element.pause();
    }, { threshold: 0.4 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [video.url]);

  return (
    <section className="reveal overflow-hidden rounded-3xl bg-deep text-white shadow-card">
      <div className="grid items-center gap-0 md:grid-cols-[0.85fr_1.15fr]">
        <div className="bg-black/30 p-4 md:p-5">
          <video
            ref={ref}
            className="mx-auto aspect-[9/16] max-h-[560px] w-full rounded-2xl bg-black object-cover"
            src={video.url}
            poster={video.poster ?? undefined}
            muted
            loop
            playsInline
            controls
            preload="metadata"
            aria-label={`${name}: from the farm to delivery`}
          />
        </div>
        <div className="p-6 md:p-8">
          <Eyebrow light>On the ground</Eyebrow>
          <h2 className="mt-2 font-display text-3xl">From the farm to delivery</h2>
          <p className="mt-3 text-sm leading-7 text-white/75">How our {name.toLowerCase()} move from collection points in the cashew belt to our buyers.</p>
          <ol className="mt-6 grid gap-4">
            {journey.map((step, index) => (
              <li key={step.title} className="flex gap-4">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gold font-bold text-deep">{index + 1}</span>
                <div>
                  <h3 className="font-semibold text-gold">{step.title}</h3>
                  <p className="mt-0.5 text-sm leading-6 text-white/80">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/** The gallery photographs for this commodity, opened in the same viewer as the Gallery page. */
function ProductPhotos({ category, name }: { category: string; name: string }) {
  const [items, setItems] = useState<GalleryCard[]>([]);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  useEffect(() => {
    setItems([]);
    api<{ data: GalleryCard[] }>(`/v1/public/website/gallery?category=${encodeURIComponent(category)}`)
      .then((payload) => setItems(payload.data.filter((item) => item.image)))
      .catch(() => setItems([]));
  }, [category]);
  if (items.length < 3) return null;
  return (
    <Band tone="mist">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <Heading eyebrow="In pictures" title={`Our ${name.toLowerCase()} operation`} text="Quality checks, drying, storage and loading, photographed at our operations." />
        <LineButton to={`/gallery?category=${encodeURIComponent(category)}`}>Open the gallery</LineButton>
      </div>
      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setOpenIndex(index)}
            className={`reveal group relative overflow-hidden rounded-2xl text-left shadow-card focus-visible:outline-offset-4 ${index === 0 ? 'col-span-2 row-span-2' : ''}`}
            style={delay(index % 4, 70)}
            aria-label={`Open photograph: ${item.caption || item.image?.alt || ''}`}
          >
            <Photo image={item.image} className={`w-full transition duration-700 group-hover:scale-105 ${index === 0 ? 'h-[22rem] md:h-[30rem]' : 'h-44 md:h-56'}`} />
            <span className="absolute inset-0 bg-gradient-to-t from-deep/80 via-transparent to-transparent opacity-70 transition duration-300 group-hover:opacity-100" />
            {item.caption?.startsWith('Quality control') ? (
              <span className="absolute left-3 top-3 rounded-full bg-gold px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-deep">Quality control</span>
            ) : null}
            <Caption
              text={(item.caption || item.image?.alt || '').replace(/^Quality control:\s*(.)/, (_match, first: string) => first.toUpperCase())}
              className={`absolute inset-x-0 bottom-0 p-3 font-semibold leading-snug text-white ${index === 0 ? 'text-lg md:p-5 md:text-xl' : 'text-xs md:text-sm'}`}
            />
          </button>
        ))}
      </div>
      {openIndex != null && items[openIndex] ? (
        <Lightbox items={items} index={openIndex} onChange={setOpenIndex} onClose={() => setOpenIndex(null)} />
      ) : null}
    </Band>
  );
}

export function ProductPage() {
  const { slug = '' } = useParams();
  const [product, setProduct] = useState<ProductCard | null>(null);
  const [others, setOthers] = useState<ProductCard[]>([]);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    setMissing(false);
    setProduct(null);
    api<{ data: ProductCard }>(`/v1/public/website/products/${slug}`).then((payload) => setProduct(payload.data)).catch(() => setMissing(true));
    api<{ data: ProductCard[] }>('/v1/public/website/products').then((payload) => setOthers(payload.data.filter((item) => item.slug !== slug).slice(0, 3))).catch(() => setOthers([]));
  }, [slug]);
  useSeo(product ? `${product.metaTitle || product.name}` : 'Commodity | BAJOGO ENTERPRISE', product?.metaDescription || product?.summary, product?.image?.url);
  if (missing) return <Loading>That commodity is not published.</Loading>;
  if (!product) return <Loading>Loading product…</Loading>;
  const pictures = product.images?.length ? product.images : product.image ? [product.image] : [];
  const availability = availabilityLabels[product.availabilityStatus] ?? product.availabilityStatus;
  return (
    <>
      <PageBanner title={product.name} text={product.summary} image={product.image} />
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="grid gap-10">
          <div className="reveal grid gap-3 sm:grid-cols-2">
            {pictures.map((picture, index) => (
              <div key={picture.id} className={`group overflow-hidden rounded-3xl shadow-card ${pictures.length === 1 ? 'sm:col-span-2' : ''}`}>
                <Photo image={picture} className={`w-full transition duration-700 group-hover:scale-105 ${pictures.length === 1 || index === 0 ? 'h-80' : 'h-64'}`} />
              </div>
            ))}
          </div>

          {product.video ? <ProductVideo video={product.video} name={product.name} /> : null}

          <section className="reveal">
            <Eyebrow>Overview</Eyebrow>
            <h2 className="mt-2 font-display text-3xl text-deep">About our {product.name.toLowerCase()}</h2>
            <div className="mt-4"><RichText text={product.description} /></div>
          </section>

          <section className="reveal rounded-3xl bg-white p-6 shadow-card md:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-2xl text-deep">Typical specification</h2>
              <span className="rounded-full bg-mist px-3 py-1 text-xs font-bold uppercase tracking-wide text-forest">Agreed per contract</span>
            </div>
            <div className="mt-5"><SpecList text={product.specifications} /></div>
          </section>

          <div className="grid gap-4 md:grid-cols-2">
            <section className="reveal rounded-3xl bg-white p-6 shadow-card">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gold text-deep"><Icon name="scale" /></span>
              <h2 className="mt-4 font-display text-xl text-deep">Quality and grading</h2>
              <p className="mt-2 text-sm leading-7 text-ink/75">{product.gradeInformation || 'Confirmed for each contract.'}</p>
            </section>
            <section className="reveal rounded-3xl bg-white p-6 shadow-card" style={delay(1, 120)}>
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gold text-deep"><Icon name="box" /></span>
              <h2 className="mt-4 font-display text-xl text-deep">Packaging and delivery</h2>
              <p className="mt-2 text-sm leading-7 text-ink/75">{product.packaging || 'Confirmed for each contract.'}</p>
            </section>
          </div>
          {product.availabilityStatus !== 'unspecified' ? <p className="text-sm font-semibold text-forest">Availability: {availability}</p> : null}
        </div>
        <div className="lg:sticky lg:top-28 lg:self-start">
          <EnquiryForm category="agricultural" product={product.name} heading={`Enquire about ${product.name}`} />
        </div>
      </div>

      <ProductPhotos category={product.category} name={product.name} />

      {others.length > 0 ? (
        <Band tone="white">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <Heading eyebrow="Also from BAJOGO" title="Other commodities" />
            <LineButton to="/commodities">View all</LineButton>
          </div>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{others.map((item, index) => <ProductTile key={item.slug} product={item} index={index} />)}</div>
        </Band>
      ) : null}
    </>
  );
}

export function StoryPage({ pageKey, pathEnquiry }: { pageKey: string; pathEnquiry: 'gold' | 'haulage' }) {
  const { page, failed } = usePage(pageKey);
  useSeo(page?.block.metaTitle ?? 'BAJOGO ENTERPRISE', page?.block.metaDescription, page?.block.image?.url);
  if (failed) return <Loading>This page could not be loaded.</Loading>;
  if (!page) return <Loading>Loading…</Loading>;
  const { block } = page;
  const gold = pathEnquiry === 'gold';
  const services = page.services ?? [];
  const standards = page.groups?.standards ?? [];
  const steps = page.groups?.steps ?? [];
  const gallery = page.gallery ?? [];
  const licence = [
    ['Licence', block.content.licenceName],
    ['Number', block.content.licenceNumber],
    ['Issued by', block.content.licenceAuthority],
    ['Valid until', block.content.licenceExpiry],
  ].filter((entry) => entry[1]);
  return (
    <>
      <PageBanner title={block.title} text={block.summary} image={block.image} />

      <Band tone="white">
        <div className="grid items-start gap-12 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="reveal">
            <Eyebrow>{gold ? 'Responsible gold' : 'Moving your goods'}</Eyebrow>
            <h2 className="mt-2 font-display text-3xl text-deep md:text-4xl">{gold ? 'Lawful, transparent, fully recorded' : 'Planned, documented, delivered'}</h2>
            <div className="mt-6"><RichText text={block.body} /></div>
          </div>
          <div className="reveal grid gap-4" style={delay(1, 150)}>
            <div className="group overflow-hidden rounded-3xl shadow-card"><Photo image={block.image} className="h-72 w-full transition duration-700 group-hover:scale-105" /></div>
            {gold ? (
              <div className="rounded-3xl bg-deep p-6 text-white">
                <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-gold text-deep"><Icon name="shield" className="h-5 w-5" /></span><h3 className="font-display text-xl">Licence details</h3></div>
                {licence.length === 0 ? <p className="mt-3 text-sm leading-6 text-white/75">The company’s licence details are published here once they are recorded.</p> : (
                  <dl className="mt-4 grid gap-3">{licence.map(([label, value]) => <div key={label}><dt className="text-xs font-bold uppercase tracking-wide text-gold">{label}</dt><dd className="mt-0.5">{value}</dd></div>)}</dl>
                )}
              </div>
            ) : (
              <div className="grid gap-3">
                {[['Coverage', block.content.coverage, 'map'], ['Capacity and rates', block.content.fleetNote, 'truck']].filter((entry) => entry[1]).map(([label, text, icon]) => (
                  <div key={label} className="flex gap-4 rounded-3xl bg-mist p-5">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gold text-deep"><Icon name={icon as IconName} /></span>
                    <div><h3 className="font-display text-lg text-deep">{label}</h3><p className="mt-1 text-sm leading-6 text-ink/75">{text}</p></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Band>

      {gold && standards.length > 0 ? (
        <Band tone="deep">
          <Heading eyebrow="Our standards" title="How we handle every gold transaction" light />
          <div className="mt-10"><FeatureGrid items={standards} icons={['shield', 'users', 'leaf', 'scale', 'doc']} dark /></div>
        </Band>
      ) : null}

      {!gold && services.length > 0 ? (
        <Band>
          <Heading eyebrow="Services" title="What we offer" />
          <div className="mt-10"><FeatureGrid items={services} icons={['truck', 'leaf', 'map', 'doc']} columns="md:grid-cols-2 lg:grid-cols-4" /></div>
        </Band>
      ) : null}
      {gold && services.length > 0 ? (
        <Band>
          <Heading eyebrow="Activities" title="Confirmed activities" />
          <div className="mt-10"><FeatureGrid items={services} icons={['scale', 'doc', 'shield']} /></div>
        </Band>
      ) : null}

      {steps.length > 0 ? (
        <Band tone={gold ? 'white' : 'white'}>
          <Heading eyebrow="How it works" title={gold ? 'The transaction process' : 'From booking to delivery'} />
          <div className="mt-10"><Steps items={steps} /></div>
        </Band>
      ) : null}

      {gallery.length > 0 ? (
        <Band>
          <Heading eyebrow="Gallery" title={gold ? 'Photographs' : 'Fleet and operations'} />
          <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-3">{gallery.map((item) => <GalleryTile key={item.id} item={item} />)}</div>
        </Band>
      ) : null}

      <Band tone="mist">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="reveal">
            <Eyebrow>{gold ? 'Gold enquiries' : 'Request a quote'}</Eyebrow>
            <h2 className="mt-2 font-display text-3xl text-deep md:text-4xl">{gold ? 'Discuss a transaction' : 'Tell us what you need to move'}</h2>
            <p className="mt-4 text-base leading-8 text-ink/75">{gold
              ? 'Describe the nature and approximate size of the transaction. We reply only on activities within the company’s licence.'
              : 'Include the cargo, quantity, pickup and delivery points, and your dates. We will confirm the vehicle, schedule and rate in writing.'}</p>
          </div>
          <EnquiryForm category={pathEnquiry} heading={gold ? 'Gold enquiry' : 'Haulage enquiry'} />
        </div>
      </Band>
    </>
  );
}

export function NewsPage() {
  const [params, setParams] = useSearchParams();
  const [articles, setArticles] = useState<ArticleCard[] | null>(null);
  const q = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  useEffect(() => {
    const search = new URLSearchParams();
    if (q) search.set('q', q);
    if (category) search.set('category', category);
    api<{ data: ArticleCard[] }>(`/v1/public/website/articles?${search.toString()}`).then((payload) => setArticles(payload.data)).catch(() => setArticles([]));
  }, [q, category]);
  useSeo('News and Updates | BAJOGO ENTERPRISE', 'Published news from BAJOGO ENTERPRISE.');
  const categories = [...new Set((articles ?? []).map((article) => article.category))];
  return (
    <>
      <PageBanner title="News and Updates" text="Announcements the company has approved for publication." />
      <div className="mx-auto max-w-7xl px-4 py-12">
        <form className="flex gap-3" onSubmit={(event) => {
          event.preventDefault();
          const next = new URLSearchParams(params);
          const term = String(new FormData(event.currentTarget).get('q') ?? '');
          if (term) next.set('q', term); else next.delete('q');
          setParams(next);
        }}>
          <input name="q" defaultValue={q} placeholder="Search news" className="field max-w-md" />
          <button className="rounded-full bg-forest px-5 text-sm font-bold text-white" type="submit">Search</button>
        </form>
        <div className="mt-4 flex flex-wrap gap-2">
          <Filter active={!category} onClick={() => { const next = new URLSearchParams(params); next.delete('category'); setParams(next); }}>All</Filter>
          {categories.map((value) => <Filter key={value} active={category === value} onClick={() => { const next = new URLSearchParams(params); next.set('category', value); setParams(next); }}>{value}</Filter>)}
        </div>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {articles == null ? <p>Loading news…</p> : articles.length === 0 ? <EmptyNote>No published articles match that search.</EmptyNote> : articles.map((article) => <ArticleTile key={article.slug} article={article} />)}
        </div>
      </div>
    </>
  );
}

function Filter({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} className={`rounded-full px-4 py-2 text-sm font-bold ${active ? 'bg-gold text-deep' : 'bg-white'}`}>{children}</button>;
}

export function ArticlePage() {
  const { slug = '' } = useParams();
  const [article, setArticle] = useState<ArticleCard | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    api<{ data: ArticleCard }>(`/v1/public/website/articles/${slug}`).then((payload) => setArticle(payload.data)).catch(() => setMissing(true));
  }, [slug]);
  useSeo(article ? `${article.metaTitle || article.title} | BAJOGO ENTERPRISE` : 'News | BAJOGO ENTERPRISE', article?.metaDescription || article?.summary, article?.image?.url);
  if (missing) return <p className="px-4 py-20 text-center">That article is not published.</p>;
  if (!article) return <p className="px-4 py-20 text-center">Loading article…</p>;
  return (
    <>
      <PageBanner title={article.title} text={article.summary} image={article.image} />
      <article className="mx-auto max-w-3xl px-4 py-12">
        <p className="text-sm font-bold text-forest">{article.publishedOn} · {article.category}</p>
        <div className="mt-6"><Prose text={article.body} /></div>
        {article.related && article.related.length > 0 ? (
          <div className="mt-12">
            <h2 className="font-display text-3xl text-deep">Related news</h2>
            <div className="mt-4 grid gap-4">{article.related.map((item) => <Link key={item.slug} to={`/news/${item.slug}`} className="font-semibold text-forest">{item.title}</Link>)}</div>
          </div>
        ) : null}
      </article>
    </>
  );
}

/** Shows a trailing "Photo: name, licence" credit on its own small line. */
function Caption({ text, className }: { text: string | null | undefined; className: string }) {
  if (!text) return null;
  const match = /^(.*?)\.?\s+(Photo:.*)$/.exec(text);
  if (!match) return <span className={className}>{text}</span>;
  return <><span className={className}>{match[1]}</span><span className="mt-1 block text-xs font-normal text-white/70">{match[2]}</span></>;
}

const galleryOrder = ['cashew', 'soybean', 'shea', 'cassava', 'cocoa', 'ginger', 'warehouses', 'haulage', 'gold', 'activities'];

export function GalleryPage() {
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<GalleryCard[] | null>(null);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const { page } = usePage('gallery.page');
  const category = params.get('category') ?? '';
  useEffect(() => {
    api<{ data: GalleryCard[] }>('/v1/public/website/gallery').then((payload) => setItems(payload.data)).catch(() => setItems([]));
  }, []);
  useSeo(page?.block.metaTitle ?? 'Gallery | BAJOGO ENTERPRISE', page?.block.metaDescription ?? 'Photographs from BAJOGO ENTERPRISE.', page?.block.image?.url);
  const counts = new Map<string, number>();
  for (const item of items ?? []) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  const categories = galleryOrder.filter((value) => counts.has(value));
  const shown = (items ?? []).filter((item) => !category || item.category === category);
  const choose = (value: string) => {
    const next = new URLSearchParams();
    if (value) next.set('category', value);
    setParams(next, { replace: true });
    setOpenIndex(null);
  };
  return (
    <>
      <PageBanner title={page?.block.title ?? 'Gallery'} text={page?.block.summary} image={page?.block.image} />
      <div className="mx-auto max-w-7xl px-4 py-14">
        <div className="reveal flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <Eyebrow>Photo gallery</Eyebrow>
            <h2 className="mt-2 font-display text-3xl text-deep md:text-4xl">{category ? categoryLabels[category] ?? category : 'All photographs'}</h2>
            {page?.block.body ? <p className="mt-3 text-base leading-7 text-ink/75">{page.block.body}</p> : null}
          </div>
          {items ? <p className="text-sm font-semibold text-forest">{shown.length} {shown.length === 1 ? 'photograph' : 'photographs'}</p> : null}
        </div>

        {categories.length > 0 ? (
          <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Filter by category">
            {['', ...categories].map((value) => {
              const active = category === value;
              const count = value ? counts.get(value) ?? 0 : items?.length ?? 0;
              return (
                <button key={value || 'all'} type="button" role="tab" aria-selected={active} onClick={() => choose(value)}
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition ${active ? 'bg-forest text-white shadow-card' : 'bg-white text-forest hover:bg-mist'}`}>
                  {value ? categoryLabels[value] ?? value : 'All'}
                  <span className={`rounded-full px-2 text-xs ${active ? 'bg-white/20' : 'bg-mist'}`}>{count}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="mt-8">
          {items == null ? <Loading>Loading gallery…</Loading> : shown.length === 0 ? (
            <EmptyNote>{category ? 'No photographs in this category yet.' : 'Photographs will appear here once they are approved.'}</EmptyNote>
          ) : (
            <div key={category} className="columns-1 gap-4 sm:columns-2 lg:columns-3">
              {shown.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setOpenIndex(index)}
                  className="reveal group relative mb-4 block w-full break-inside-avoid overflow-hidden rounded-3xl text-left shadow-card focus-visible:outline-offset-4"
                  style={delay(index % 3, 90)}
                  aria-label={`Open photograph: ${item.caption || item.image?.alt || ''}`}
                >
                  <Photo image={item.image} className={`w-full transition duration-700 group-hover:scale-105 ${['h-72', 'h-96', 'h-64'][index % 3]}`} />
                  <span className="absolute inset-0 bg-gradient-to-t from-deep/85 via-deep/10 to-transparent opacity-80 transition duration-300 group-hover:opacity-100" />
                  <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-5 text-white">
                    <span>
                      <span className="block text-[11px] font-bold uppercase tracking-[0.2em] text-gold">{categoryLabels[item.category] ?? item.category}</span>
                      <Caption text={item.caption || item.image?.alt} className="mt-1 block font-display text-xl leading-snug" />
                    </span>
                    <span className="grid h-10 w-10 shrink-0 translate-y-2 place-items-center rounded-full bg-white/15 opacity-0 backdrop-blur transition duration-300 group-hover:translate-y-0 group-hover:opacity-100">
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <CallToAction title="Interested in these commodities?" text="Ask us about specifications, quantities and delivery for any commodity in the gallery." to="/contact?category=agricultural" label="Send an enquiry" />

      {openIndex != null && shown[openIndex] ? (
        <Lightbox items={shown} index={openIndex} onChange={setOpenIndex} onClose={() => setOpenIndex(null)} />
      ) : null}
    </>
  );
}

function Lightbox({ items, index, onChange, onClose }: { items: GalleryCard[]; index: number; onChange: (index: number) => void; onClose: () => void }) {
  const item = items[index];
  const count = items.length;
  const go = (step: number) => onChange((index + step + count) % count);
  const [touchX, setTouchX] = useState<number | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') go(1);
      if (event.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  });
  if (!item.image) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Photograph viewer"
      className="page-enter fixed inset-0 z-50 flex flex-col bg-deep/95 backdrop-blur-sm"
      onClick={onClose}
      onTouchStart={(event) => setTouchX(event.touches[0].clientX)}
      onTouchEnd={(event) => {
        if (touchX == null) return;
        const dx = event.changedTouches[0].clientX - touchX;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
        setTouchX(null);
      }}
    >
      <div className="flex items-center justify-between px-4 py-4 text-white" onClick={(event) => event.stopPropagation()}>
        <span className="text-sm font-semibold text-white/70">{index + 1} / {count}</span>
        <button type="button" onClick={onClose} autoFocus className="grid h-11 w-11 place-items-center rounded-full bg-white/10 hover:bg-white/20" aria-label="Close">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 sm:px-20">
        {count > 1 ? (
          <button type="button" onClick={(event) => { event.stopPropagation(); go(-1); }} className="absolute left-3 z-10 grid h-12 w-12 place-items-center rounded-full bg-white/10 text-white hover:bg-gold hover:text-deep sm:left-6" aria-label="Previous photograph">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
        ) : null}
        <figure key={item.id} className="page-enter flex max-h-full flex-col items-center" onClick={(event) => event.stopPropagation()}>
          <img src={item.image.url} alt={item.image.alt} className="max-h-[72vh] max-w-full rounded-2xl object-contain shadow-2xl" />
          <figcaption className="mt-4 text-center text-white">
            <span className="block text-[11px] font-bold uppercase tracking-[0.2em] text-gold">{categoryLabels[item.category] ?? item.category}</span>
            <Caption text={item.caption || item.image.alt} className="mt-1 block font-display text-xl" />
          </figcaption>
        </figure>
        {count > 1 ? (
          <button type="button" onClick={(event) => { event.stopPropagation(); go(1); }} className="absolute right-3 z-10 grid h-12 w-12 place-items-center rounded-full bg-white/10 text-white hover:bg-gold hover:text-deep sm:right-6" aria-label="Next photograph">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
          </button>
        ) : null}
      </div>
      {count > 1 ? (
        <div className="flex justify-center gap-2 overflow-x-auto px-4 py-4" onClick={(event) => event.stopPropagation()}>
          {items.map((thumb, thumbIndex) => (
            <button key={thumb.id} type="button" onClick={() => onChange(thumbIndex)} aria-label={`Show photograph ${thumbIndex + 1}`}
              className={`h-14 w-20 shrink-0 overflow-hidden rounded-lg ring-2 transition ${thumbIndex === index ? 'opacity-100 ring-gold' : 'opacity-50 ring-transparent hover:opacity-90'}`}>
              <Photo image={thumb.image} className="h-full w-full" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function CareersPage() {
  const [jobs, setJobs] = useState<Vacancy[] | null>(null);
  const { page } = usePage('careers.page');
  useEffect(() => { api<{ data: Vacancy[] }>('/v1/public/website/vacancies').then((payload) => setJobs(payload.data)).catch(() => setJobs([])); }, []);
  useSeo(page?.block.metaTitle ?? 'Careers | BAJOGO ENTERPRISE', page?.block.metaDescription ?? 'Vacancies at BAJOGO ENTERPRISE.');
  const block = page?.block;
  const benefits = page?.groups?.benefits ?? [];
  const steps = page?.groups?.steps ?? [];
  return (
    <>
      <PageBanner title={block?.title ?? 'Careers'} text={block?.summary} image={block?.image} />

      {block ? (
        <Band tone="white">
          <div className="grid gap-10 lg:grid-cols-[1fr_1fr]">
            <div className="reveal">
              <Eyebrow>Join our team</Eyebrow>
              <h2 className="mt-2 font-display text-3xl text-deep md:text-4xl">People who do the job properly</h2>
              <div className="mt-6"><RichText text={block.body} /></div>
            </div>
            <FeatureGrid items={benefits} icons={['leaf', 'spark', 'shield', 'doc']} columns="sm:grid-cols-2" />
          </div>
        </Band>
      ) : null}

      <Band>
        <Heading eyebrow="Open positions" title="Current vacancies" />
        <div className="mt-8 grid gap-4">
          {jobs == null ? <p>Loading vacancies…</p> : jobs.length === 0 ? (
            <div className="reveal flex flex-wrap items-center gap-5 rounded-3xl border border-dashed border-forest/25 bg-white p-8">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-mist text-forest"><Icon name="users" className="h-7 w-7" /></span>
              <p className="max-w-2xl flex-1 text-base leading-7 text-ink/75">{block?.content.noVacancies ?? 'There are no open positions at the moment.'}</p>
            </div>
          ) : jobs.map((job, index) => (
            <Link key={job.slug} to={`/careers/${job.slug}`} className="reveal group flex flex-wrap items-center justify-between gap-4 rounded-3xl bg-white p-6 shadow-card transition duration-300 hover:-translate-y-1" style={delay(index % 4)}>
              <div className="max-w-3xl">
                <h3 className="font-display text-2xl text-deep">{job.title}</h3>
                {job.locationLabel ? <p className="mt-1 text-sm font-semibold text-forest">{job.locationLabel}</p> : null}
                <p className="mt-2 text-sm leading-6 text-ink/75">{job.summary}</p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-gold px-5 py-2 text-sm font-bold text-deep">View role <Arrow /></span>
            </Link>
          ))}
        </div>
      </Band>

      {steps.length > 0 ? (
        <Band tone="white">
          <Heading eyebrow="Recruitment" title="How we hire" />
          <div className="mt-10"><Steps items={steps} /></div>
        </Band>
      ) : null}
    </>
  );
}

export function JobPage() {
  const { slug = '' } = useParams();
  const [job, setJob] = useState<Vacancy | null>(null);
  const [missing, setMissing] = useState(false);
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { api<{ data: Vacancy }>(`/v1/public/website/vacancies/${slug}`).then((payload) => setJob(payload.data)).catch(() => setMissing(true)); }, [slug]);
  useSeo(job ? `${job.metaTitle || job.title} | Careers` : 'Career | BAJOGO ENTERPRISE', job?.metaDescription || job?.summary);
  if (missing) return <p className="px-4 py-20 text-center">That vacancy is not published.</p>;
  if (!job) return <p className="px-4 py-20 text-center">Loading vacancy…</p>;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const file = form.get('cv');
    let cv = null;
    if (file instanceof File && file.size > 0) {
      const contentBase64 = await fileToBase64(file);
      cv = { fileName: file.name, contentType: file.type, contentBase64 };
    }
    const response = await fetch(`/api/v1/public/website/vacancies/${slug}/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: form.get('fullName'),
        email: form.get('email'),
        phone: form.get('phone') || null,
        message: form.get('message'),
        faxNumber: form.get('faxNumber') || '',
        cv,
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setError(payload?.error?.message ?? 'The application could not be sent.');
      return;
    }
    setDone('Your application has been received by human resources.');
    formElement.reset();
  }

  return (
    <>
      <PageBanner title={job.title} text={job.locationLabel || job.summary} />
      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-12 lg:grid-cols-2">
        <div>
          <Prose text={job.description} />
          <h2 className="mt-8 font-display text-3xl text-deep">Requirements</h2>
          <Prose text={job.requirements || 'Requirements will be published when the company records them.'} />
        </div>
        {job.applicationsEnabled ? (
          <form className="grid h-fit gap-3 rounded-3xl bg-white p-6 shadow-card" onSubmit={onSubmit}>
            <h2 className="font-display text-3xl text-deep">Apply</h2>
            {done ? <p className="text-sm text-forest">{done}</p> : null}
            {error ? <p className="text-sm text-red-800">{error}</p> : null}
            <input name="fullName" required placeholder="Full name" className="field" />
            <input name="email" type="email" required placeholder="Email" className="field" />
            <input name="phone" placeholder="Telephone" className="field" />
            <textarea name="message" required minLength={10} rows={5} placeholder="Covering note" className="field" />
            <label className="text-sm font-semibold">CV (PDF or Word, optional)<input name="cv" type="file" accept=".pdf,.docx,application/pdf" className="mt-1 block w-full text-sm" /></label>
            <label className="absolute -left-[9999px]" aria-hidden="true">Fax<input name="faxNumber" tabIndex={-1} autoComplete="off" /></label>
            <button className="rounded-full bg-gold px-5 py-3 text-sm font-bold text-deep" type="submit">Submit application</button>
          </form>
        ) : <EmptyNote>Applications are not open for this vacancy.</EmptyNote>}
      </div>
    </>
  );
}

export function ContactPage() {
  const [params] = useSearchParams();
  const { page } = usePage('contact.page');
  useSeo(page?.block.metaTitle ?? 'Contact Us | BAJOGO ENTERPRISE', page?.block.metaDescription ?? 'Contact BAJOGO ENTERPRISE.');
  return (
    <>
      <PageBanner title={page?.block.title ?? 'Contact Us'} text={page?.block.summary} image={page?.block.image} />
      <ContactBody page={page} category={params.get('category') ?? 'general'} product={params.get('product') ?? ''} />
    </>
  );
}

function ContactBody({ page, category, product }: { page: PageData | null; category: string; product: string }) {
  const [boot, setBoot] = useState<HomeData['settings'] | null>(null);
  useEffect(() => { api<{ data: { settings: HomeData['settings'] } }>('/v1/public/website/bootstrap').then((payload) => setBoot(payload.data.settings)).catch(() => setBoot(null)); }, []);
  const place = boot ? [boot.addressLine, boot.city, boot.country].filter(Boolean).join(', ') : '';
  const map = boot?.mapUrl && /^https:\/\/(www\.)?(google\.[a-z.]+|maps\.google\.[a-z.]+)\/maps/i.test(boot.mapUrl) ? boot.mapUrl : null;
  const topics = page?.groups?.topics ?? [];
  const details = [
    ['phone', 'Telephone', boot?.phone, boot?.phone ? `tel:${boot.phone.replace(/\s+/g, '')}` : null],
    ['doc', 'Email', boot?.email, boot?.email ? `mailto:${boot.email}` : null],
    ['map', 'Office', place || null, null],
  ].filter((entry) => entry[2]) as Array<[IconName, string, string, string | null]>;
  return (
    <>
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-14 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="grid content-start gap-6">
          {page ? (
            <div className="reveal">
              <Eyebrow>Get in touch</Eyebrow>
              <h2 className="mt-2 font-display text-3xl text-deep">How to reach us</h2>
              <div className="mt-4"><RichText text={page.block.body} /></div>
            </div>
          ) : null}
          <aside className="reveal relative overflow-hidden rounded-3xl bg-deep p-7 text-white">
            <div aria-hidden="true" className="drift pointer-events-none absolute -right-16 -top-16 h-48 w-48 glow-gold" />
            <h2 className="relative font-display text-2xl">Contact details</h2>
            {details.length === 0 ? <p className="relative mt-3 text-sm leading-6 text-white/75">Please use the form. Our telephone, email and office address are listed here once they are published.</p> : (
              <ul className="relative mt-5 grid gap-4">
                {details.map(([icon, label, value, href]) => (
                  <li key={label} className="flex gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gold text-deep"><Icon name={icon} className="h-5 w-5" /></span>
                    <div><div className="text-xs font-bold uppercase tracking-wide text-gold">{label}</div>{href ? <a href={href} className="hover:text-gold">{value}</a> : <span>{value}</span>}</div>
                  </li>
                ))}
              </ul>
            )}
            {page?.block.content.response ? <p className="relative mt-6 border-t border-white/10 pt-4 text-sm leading-6 text-white/75">{page.block.content.response}</p> : null}
            {map ? <iframe title="Office location" src={map} className="relative mt-6 h-56 w-full rounded-2xl border-0" loading="lazy" /> : boot?.mapUrl ? <a className="relative mt-4 inline-block text-gold" href={boot.mapUrl}>Open the office location</a> : null}
          </aside>
        </div>
        <div className="reveal" style={delay(1, 150)}><EnquiryForm category={category} product={product} /></div>
      </div>
      {topics.length > 0 ? (
        <Band tone="white">
          <Heading eyebrow="We can help with" title="What you can contact us about" />
          <div className="mt-8"><FeatureGrid items={topics} icons={['box', 'leaf', 'truck', 'scale', 'users']} columns="sm:grid-cols-2 lg:grid-cols-5" /></div>
        </Band>
      ) : null}
    </>
  );
}

export function LegalPage({ pageKey }: { pageKey: string }) {
  const { page, failed } = usePage(pageKey);
  const block = page?.block ?? null;
  useSeo(block?.metaTitle ?? 'BAJOGO ENTERPRISE', block?.metaDescription);
  if (failed) return <Loading>This page could not be loaded.</Loading>;
  if (!block) return <Loading>Loading…</Loading>;
  return (
    <>
      <PageBanner title={block.title} text={block.summary} />
      <div className="mx-auto max-w-3xl px-4 py-14">
        <div className="reveal rounded-3xl bg-white p-7 shadow-card md:p-10"><RichText text={block.body} /></div>
      </div>
    </>
  );
}


export function NotFoundPage() {
  useSeo('Page not found | BAJOGO ENTERPRISE');
  return <div className="px-4 py-24 text-center"><h1 className="font-display text-5xl text-deep">Page not found</h1><Link to="/" className="mt-6 inline-block font-bold text-forest">Back to the homepage</Link></div>;
}

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
