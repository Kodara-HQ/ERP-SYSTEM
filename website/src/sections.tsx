import type { CSSProperties, ReactNode } from 'react';
import type { Item } from './types';

/** A page response from /pages/:key: the block plus any item groups that page shows. */
export type Groups = Record<string, Item[] | undefined>;

export function delay(index: number, step = 100): CSSProperties {
  return { '--delay': `${index * step}ms` } as CSSProperties;
}

export function Eyebrow({ children, light = false }: { children: ReactNode; light?: boolean }) {
  return <p className={`text-xs font-bold uppercase tracking-[0.24em] ${light ? 'text-gold' : 'text-forest'}`}>{children}</p>;
}

export function Heading({ eyebrow, title, text, light = false, center = false }: { eyebrow?: string; title: string; text?: string | null; light?: boolean; center?: boolean }) {
  return (
    <div className={`reveal ${center ? 'mx-auto max-w-2xl text-center' : 'max-w-3xl'}`}>
      {eyebrow ? <Eyebrow light={light}>{eyebrow}</Eyebrow> : null}
      <h2 className={`mt-2 font-display text-3xl md:text-4xl ${light ? 'text-white' : 'text-deep'}`}>{title}</h2>
      {text ? <p className={`mt-3 text-lg leading-8 ${light ? 'text-white/80' : 'text-ink/75'}`}>{text}</p> : null}
    </div>
  );
}

/** Paragraphs separated by blank lines. A paragraph that opens with a short "Heading." gets that heading in bold. */
export function RichText({ text, light = false }: { text: string | null | undefined; light?: boolean }) {
  if (!text) return null;
  const paragraphs = text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  return (
    <div className={`grid gap-4 text-base leading-8 ${light ? 'text-white/85' : 'text-ink/80'}`}>
      {paragraphs.map((paragraph, index) => {
        const lead = /^([A-Z][A-Za-z ,’'-]{2,40})\.\s+([\s\S]+)$/.exec(paragraph);
        if (lead && lead[1].split(' ').length <= 5) {
          return <p key={index}><strong className={light ? 'text-white' : 'text-deep'}>{lead[1]}.</strong> {lead[2]}</p>;
        }
        return <p key={index} className="whitespace-pre-line">{paragraph}</p>;
      })}
    </div>
  );
}

/** Text whose lines start with "•" becomes a checked list; other lines stay as paragraphs. */
export function SpecList({ text }: { text: string | null | undefined }) {
  if (!text) return <p className="text-sm text-ink/60">Confirmed for each contract.</p>;
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length === 0) return;
    out.push(
      <ul key={`list-${out.length}`} className="grid gap-2">
        {bullets.map((bullet, index) => {
          const [label, ...rest] = bullet.split(':');
          return (
            <li key={index} className="flex gap-3 rounded-2xl bg-mist px-4 py-3 text-sm">
              <Check />
              {rest.length > 0 ? <span><strong className="text-deep">{label}:</strong>{rest.join(':')}</span> : <span>{bullet}</span>}
            </li>
          );
        })}
      </ul>,
    );
    bullets = [];
  };
  for (const line of lines) {
    if (line.startsWith('•')) bullets.push(line.replace(/^•\s*/, ''));
    else {
      flush();
      out.push(<p key={`p-${out.length}`} className="text-sm leading-7 text-ink/75">{line}</p>);
    }
  }
  flush();
  return <div className="grid gap-3">{out}</div>;
}

export function Check({ className = 'mt-0.5 h-4 w-4 shrink-0 text-forest' }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
}

const icons: Record<string, string> = {
  leaf: 'M5 19c0-8 6-14 15-14 0 9-6 15-14 15H5zm0 0l8-8',
  truck: 'M3 6h11v10H3zM14 10h4l3 3v3h-7zM7 19a2 2 0 100-4 2 2 0 000 4zm10 0a2 2 0 100-4 2 2 0 000 4z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zm-3 9l2 2 4-4',
  scale: 'M12 4v16M5 20h14M6 8h12M6 8l-3 6a3 3 0 006 0L6 8zm12 0l-3 6a3 3 0 006 0l-3-6z',
  doc: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  users: 'M9 11a4 4 0 100-8 4 4 0 000 8zm-6 10a6 6 0 0112 0M17 11a3 3 0 100-6M21 21a5 5 0 00-4-4.9',
  box: 'M3 7l9-4 9 4v10l-9 4-9-4V7zm0 0l9 4 9-4M12 11v10',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zm0 0v14m6-12v14',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z',
};

export type IconName = keyof typeof icons;

export function Icon({ name, className = 'h-6 w-6' }: { name: IconName; className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icons[name]} /></svg>;
}

/** Cards with an icon, title and text. */
export function FeatureGrid({ items, icons: names, columns = 'md:grid-cols-2 lg:grid-cols-3', dark = false }: { items: Item[]; icons: IconName[]; columns?: string; dark?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div className={`grid gap-4 ${columns}`}>
      {items.map((item, index) => (
        <article
          key={item.id}
          className={`reveal group rounded-3xl p-6 transition duration-300 hover:-translate-y-1 ${dark ? 'bg-white/10 text-white hover:bg-white/15' : 'border border-forest/10 bg-white hover:border-gold/60 hover:shadow-card'}`}
          style={delay(index % 3)}
        >
          <span className={`grid h-12 w-12 place-items-center rounded-2xl transition duration-300 group-hover:rotate-[-6deg] ${dark ? 'bg-gold text-deep' : 'bg-mist text-forest group-hover:bg-gold group-hover:text-deep'}`}>
            <Icon name={names[index % names.length]} />
          </span>
          <h3 className={`mt-4 font-display text-xl ${dark ? 'text-white' : 'text-deep'}`}>{item.title}</h3>
          {item.summary ? <p className={`mt-2 text-sm leading-6 ${dark ? 'text-white/80' : 'text-ink/75'}`}>{item.summary}</p> : null}
        </article>
      ))}
    </div>
  );
}

/** Numbered process steps joined by a line. */
export function Steps({ items }: { items: Item[] }) {
  if (items.length === 0) return null;
  return (
    <ol className="relative grid gap-6 md:grid-flow-col md:auto-cols-fr md:gap-4">
      <span aria-hidden="true" className="absolute left-6 top-6 hidden h-0.5 w-[calc(100%-3rem)] bg-gradient-to-r from-gold via-gold/60 to-gold/20 md:block" />
      <span aria-hidden="true" className="absolute bottom-6 left-6 top-6 w-0.5 bg-gradient-to-b from-gold via-gold/60 to-gold/20 md:hidden" />
      {items.map((item, index) => (
        <li key={item.id} className="reveal relative flex gap-4 md:block" style={delay(index, 120)}>
          <span className="relative z-10 grid h-12 w-12 shrink-0 place-items-center rounded-full bg-deep font-display text-lg text-gold ring-4 ring-cream">{index + 1}</span>
          <div className="md:mt-4 md:pr-4">
            <h3 className="font-display text-xl text-deep">{item.title}</h3>
            {item.summary ? <p className="mt-1 text-sm leading-6 text-ink/75">{item.summary}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Band({ children, tone = 'cream', className = '' }: { children: ReactNode; tone?: 'cream' | 'white' | 'deep' | 'mist'; className?: string }) {
  const tones = { cream: 'bg-cream', white: 'bg-white', deep: 'relative overflow-hidden bg-deep text-white', mist: 'bg-mist' };
  return (
    <section className={`${tones[tone]} ${className}`}>
      {tone === 'deep' ? <div aria-hidden="true" className="drift pointer-events-none absolute -right-24 -top-24 h-80 w-80 glow-gold" /> : null}
      <div className="relative mx-auto max-w-7xl px-4 py-16 md:py-20">{children}</div>
    </section>
  );
}
