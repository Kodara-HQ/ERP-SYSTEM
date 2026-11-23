import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import type { Bootstrap, Picture, Settings } from './types';

export function useSeo(title: string, description?: string | null, image?: string | null) {
  useEffect(() => {
    document.title = title;
    const set = (name: string, content: string, property = false) => {
      const attr = property ? 'property' : 'name';
      let tag = document.head.querySelector(`meta[${attr}="${name}"]`);
      if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute(attr, name);
        document.head.appendChild(tag);
      }
      tag.setAttribute('content', content);
    };
    if (description) {
      set('description', description);
      set('og:description', description, true);
    }
    set('og:title', title, true);
    set('og:type', 'website', true);
    set('og:url', window.location.href, true);
    if (image) set('og:image', new URL(image, window.location.origin).href, true);
  }, [title, description, image]);
}

export function Photo({ image, className = '' }: { image: Picture | null; className?: string }) {
  if (!image) {
    return <div className={`bg-gradient-to-br from-forest to-deep ${className}`} />;
  }
  return <img src={image.url} alt={image.alt} loading="lazy" className={`object-cover ${className}`} />;
}

export function GoldButton({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to} className="shine inline-flex items-center justify-center rounded-full bg-gold px-6 py-3 text-sm font-bold text-deep shadow-[0_10px_30px_rgba(230,179,35,0.35)] transition hover:-translate-y-0.5 hover:bg-[#f0c43d]">{children}</Link>;
}

/** Fades elements marked `.reveal` into view as they scroll in, including ones added after data loads. */
function useReveal(routeKey: string) {
  useEffect(() => {
    const root = document.getElementById('content');
    if (!root) return;
    if (!('IntersectionObserver' in window)) {
      root.querySelectorAll('.reveal').forEach((node) => node.classList.add('in'));
      return;
    }
    const seen = new WeakSet<Element>();
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    const scan = () => root.querySelectorAll('.reveal:not(.in)').forEach((node) => {
      if (!seen.has(node)) { seen.add(node); io.observe(node); }
    });
    scan();
    const mo = new MutationObserver(scan);
    mo.observe(root, { childList: true, subtree: true });
    return () => { io.disconnect(); mo.disconnect(); };
  }, [routeKey]);
}

function useScrolled(offset = 24) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > offset);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [offset]);
  return scrolled;
}

export function LineButton({ to, children, light = false }: { to: string; children: ReactNode; light?: boolean }) {
  return <Link to={to} className={`inline-flex items-center justify-center rounded-full border px-6 py-3 text-sm font-bold transition hover:-translate-y-0.5 ${light ? 'border-white/70 text-white hover:bg-white hover:text-deep' : 'border-forest text-forest hover:bg-forest hover:text-white'}`}>{children}</Link>;
}

/** True when the bottom of the page (the footer) is in view. */
function useNearEnd(margin = 160) {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const check = () => setNear(window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - margin);
    check();
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => { window.removeEventListener('scroll', check); window.removeEventListener('resize', check); };
  }, [margin]);
  return near;
}

const socialIcons: Record<string, string> = {
  Facebook: 'M14 8h3V4h-3a4 4 0 00-4 4v2H8v4h2v8h4v-8h3l1-4h-4V8z',
  X: 'M4 4l16 16M20 4L4 20',
  LinkedIn: 'M4 9h4v11H4zM6 4a2 2 0 110 4 2 2 0 010-4zm4 5h4v1.6c.6-1 1.9-1.8 3.5-1.8 3 0 3.5 2 3.5 4.6V20h-4v-5.5c0-1.3-.2-2.3-1.5-2.3s-1.5 1-1.5 2.2V20h-4z',
  Instagram: 'M7 3h10a4 4 0 014 4v10a4 4 0 01-4 4H7a4 4 0 01-4-4V7a4 4 0 014-4zm5 5a4 4 0 100 8 4 4 0 000-8zm5.5-2.5h.01',
};

function socialLinks(settings: Settings) {
  return [
    ['Facebook', settings.facebookUrl],
    ['X', settings.twitterUrl],
    ['LinkedIn', settings.linkedinUrl],
    ['Instagram', settings.instagramUrl],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
}

function Social({ settings, large = false }: { settings: Settings; large?: boolean }) {
  const links = socialLinks(settings);
  if (links.length === 0) return null;
  return (
    <div className={`flex ${large ? 'gap-2' : 'gap-3'}`}>
      {links.map(([label, href]) => (
        <a key={label} href={href} aria-label={label} target="_blank" rel="noreferrer"
          className={large
            ? 'grid h-10 w-10 place-items-center rounded-full border border-white/15 text-white/80 transition hover:-translate-y-0.5 hover:border-gold hover:bg-gold hover:text-deep'
            : 'text-white/80 hover:text-gold'}>
          <svg viewBox="0 0 24 24" className={large ? 'h-[18px] w-[18px]' : 'h-4 w-4'} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={socialIcons[label]} /></svg>
        </a>
      ))}
    </div>
  );
}

function FooterLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="group inline-flex items-center gap-2 py-1 text-sm text-white/75 transition hover:text-white">
      <svg viewBox="0 0 24 24" className="h-3 w-3 -translate-x-1 text-gold opacity-0 transition duration-300 group-hover:translate-x-0 group-hover:opacity-100" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
      <span className="-ml-5 transition-[margin] duration-300 group-hover:ml-0">{children}</span>
    </Link>
  );
}

function FooterHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="flex items-center gap-3 text-xs font-bold uppercase tracking-[0.24em] text-gold">
      {children}
      <span aria-hidden="true" className="h-px flex-1 bg-gradient-to-r from-gold/40 to-transparent" />
    </h2>
  );
}

const contactIcons = {
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z',
  email: 'M3 6h18v12H3zM3 7l9 6 9-6',
  place: 'M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11zm0-8a3 3 0 100-6 3 3 0 000 6z',
};

function SiteFooter({ settings, commodities, place }: { settings: Settings; commodities: Bootstrap['commodities']; place: string }) {
  const contacts = [
    ['phone', 'Call us', settings.phone, settings.phone ? `tel:${settings.phone.replace(/\s+/g, '')}` : null],
    ['email', 'Email us', settings.email, settings.email ? `mailto:${settings.email}` : null],
    ['place', 'Visit us', place || null, settings.mapUrl],
  ].filter((entry) => entry[2]) as Array<[keyof typeof contactIcons, string, string, string | null]>;
  const year = new Date().getFullYear();
  return (
    <footer className="relative overflow-hidden bg-[#00271A] text-cream">
      <div aria-hidden="true" className="h-1 bg-gradient-to-r from-transparent via-gold to-transparent" />
      <div aria-hidden="true" className="drift glow-gold pointer-events-none absolute -left-40 top-10 h-[28rem] w-[28rem]" />
      <img aria-hidden="true" src="/brand/bajogo-mark.png" alt="" className="pointer-events-none absolute -bottom-24 -right-24 hidden h-[26rem] w-[26rem] rounded-full opacity-[0.04] grayscale lg:block" />

      <div className="relative mx-auto grid max-w-7xl grid-cols-2 gap-x-6 gap-y-12 px-4 pb-12 pt-16 lg:grid-cols-12 lg:gap-8">
        <div className="col-span-2 lg:col-span-4">
          <Link to="/" className="group inline-flex items-center gap-4">
            <img src="/brand/bajogo-mark.png" alt="" className="h-16 w-16 rounded-full object-cover ring-2 ring-gold/70 transition duration-500 group-hover:rotate-[-8deg]" />
            <span className="leading-tight">
              <span className="block font-display text-3xl font-semibold tracking-wide text-white">BAJOGO</span>
              <span className="block text-[11px] font-bold uppercase tracking-[0.3em] text-gold">Enterprise</span>
            </span>
          </Link>
          <p className="mt-6 max-w-sm text-sm leading-7 text-white/70">{settings.footerText}</p>
          <ul className="mt-6 flex flex-wrap gap-2 text-xs font-semibold">
            {[['Agriculture', '/commodities'], ['Gold', '/gold-buying'], ['Logistics', '/haulage']].map(([label, to]) => (
              <li key={label}><Link to={to} className="inline-block rounded-full border border-white/15 px-3 py-1.5 text-white/80 transition hover:border-gold hover:text-gold">{label}</Link></li>
            ))}
          </ul>
          <div className="mt-6"><Social settings={settings} large /></div>
        </div>

        <nav aria-label="Explore" className="col-span-1 lg:col-span-2">
          <FooterHeading>Explore</FooterHeading>
          <div className="mt-5 grid">
            <FooterLink to="/about">About Us</FooterLink>
            <FooterLink to="/gold-buying">Gold Buying</FooterLink>
            <FooterLink to="/haulage">Haulage &amp; Logistics</FooterLink>
            <FooterLink to="/news">News &amp; Updates</FooterLink>
            <FooterLink to="/gallery">Gallery</FooterLink>
            <FooterLink to="/careers">Careers</FooterLink>
          </div>
        </nav>

        <nav aria-label="Commodities" className="col-span-1 lg:col-span-2">
          <FooterHeading>Commodities</FooterHeading>
          <div className="mt-5 grid">
            {commodities.map((item) => <FooterLink key={item.slug} to={`/commodities/${item.slug}`}>{item.name}</FooterLink>)}
            <FooterLink to="/commodities">All commodities</FooterLink>
          </div>
        </nav>

        <div className="col-span-2 lg:col-span-4">
          <FooterHeading>Get in touch</FooterHeading>
          {contacts.length > 0 ? (
            <ul className="mt-5 grid gap-4">
              {contacts.map(([icon, label, value, href]) => (
                <li key={icon} className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/5 text-gold ring-1 ring-white/10">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={contactIcons[icon]} /></svg>
                  </span>
                  <span>
                    <span className="block text-[11px] font-bold uppercase tracking-[0.18em] text-white/50">{label}</span>
                    {href ? <a href={href} className="text-sm text-white transition hover:text-gold">{value}</a> : <span className="text-sm text-white">{value}</span>}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-5 text-sm leading-7 text-white/70">Send us a message about buying, supplying, haulage or careers. Our team replies on business days.</p>
          )}
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/contact" className="shine inline-flex items-center gap-2 rounded-full bg-gold px-5 py-2.5 text-sm font-bold text-deep transition hover:-translate-y-0.5">
              Start an enquiry
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </Link>
            <a href={settings.staffLoginUrl} className="inline-flex items-center gap-2 rounded-full border border-white/20 px-5 py-2.5 text-sm font-bold text-white transition hover:border-gold hover:text-gold">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 11h12v10H6zM8 11V7a4 4 0 018 0v4" /></svg>
              Staff Login
            </a>
          </div>
        </div>
      </div>

      <div className="relative border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 text-xs text-white/55 md:flex-row md:items-center md:justify-between">
          <span>© {year} {settings.legalName || settings.tradingName}. All rights reserved.</span>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link to="/privacy" className="transition hover:text-gold">Privacy Policy</Link>
            <Link to="/terms" className="transition hover:text-gold">Terms of Service</Link>
            <Link to="/contact" className="transition hover:text-gold">Contact</Link>
            <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="group inline-flex items-center gap-2 font-semibold text-white/80 transition hover:text-gold">
              Back to top
              <span className="grid h-7 w-7 place-items-center rounded-full border border-white/20 transition group-hover:-translate-y-0.5 group-hover:border-gold">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
              </span>
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}

// Drop-down in the main menu. On a desktop it opens while the pointer is over it and closes
// as soon as the pointer moves to another item; a click toggles it on touch screens.
// It also closes on a click elsewhere, on Escape, and when a page is chosen.
function NavMenu({ label, active, resetKey, children }: { label: string; active: boolean; resetKey: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const hoverable = () => window.matchMedia('(hover: hover) and (min-width: 1024px)').matches;

  useEffect(() => { setOpen(false); }, [resetKey]);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const enter = () => { if (!hoverable()) return; window.clearTimeout(timer.current); setOpen(true); };
  const leave = () => { if (!hoverable()) return; window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setOpen(false), 120); };

  return (
    <div ref={box} className="relative" onMouseEnter={enter} onMouseLeave={leave}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }}>
      <button type="button" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((value) => !value)}
        className={`flex w-full items-center gap-1 rounded-full px-3 py-2 text-left text-sm font-semibold transition hover:bg-mist ${active ? 'text-forest' : 'text-ink'}`}>
        {label}
        <svg viewBox="0 0 20 20" className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden="true"><path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open ? (
        <div className="z-20 grid min-w-52 rounded-2xl border border-forest/10 bg-white p-2 shadow-card lg:absolute lg:left-0 lg:top-full lg:mt-1">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function SiteFrame({ boot, children }: { boot: Bootstrap; children: ReactNode }) {
  const { settings, commodities } = boot;
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const scrolled = useScrolled();
  const farDown = useScrolled(700);
  const nearEnd = useNearEnd();
  useEffect(() => {
    setOpen(false);
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [location.pathname]);
  useReveal(location.pathname + location.search);
  const place = [settings.addressLine, settings.city, settings.country].filter(Boolean).join(', ');

  return (
    <div className="min-h-screen bg-cream text-ink">
      <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-gold focus:px-3 focus:py-2">Skip to content</a>
      <header className={`sticky top-0 z-40 transition-shadow duration-300 ${scrolled ? 'shadow-[0_10px_30px_rgba(0,59,32,0.12)]' : ''}`}>
        <div className={`overflow-hidden bg-deep text-cream transition-[max-height] duration-300 ${scrolled ? 'max-h-0' : 'max-h-16'}`}>
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-1 px-4 py-2 text-xs">
            {settings.phone ? <a href={`tel:${settings.phone.replace(/\s+/g, '')}`} className="hover:text-gold">{settings.phone}</a> : null}
            {settings.email ? <a href={`mailto:${settings.email}`} className="hidden hover:text-gold sm:inline">{settings.email}</a> : null}
            {place ? <span className="hidden lg:inline">{place}</span> : null}
            {!settings.phone && !settings.email && !place ? <span className="text-white/80">Agricultural commodities <span className="text-gold">·</span> Gold <span className="text-gold">·</span> Haulage &amp; logistics</span> : null}
            <span className="ml-auto flex items-center gap-4">
              <Social settings={settings} />
              <a href={settings.staffLoginUrl} className="font-semibold text-white/80 hover:text-gold">Staff Login</a>
            </span>
          </div>
        </div>
        <div className="border-b border-forest/10 bg-white/95 backdrop-blur">
          <div className={`mx-auto flex max-w-7xl items-center gap-4 px-4 transition-[padding] duration-300 ${scrolled ? 'py-2' : 'py-3'}`}>
            <Link to="/" className="group flex items-center gap-3">
              <img src="/brand/bajogo-mark.png" alt="" className={`rounded-full object-cover ring-2 ring-gold/70 transition-all duration-500 group-hover:rotate-[-8deg] ${scrolled ? 'h-10 w-10' : 'h-12 w-12'}`} />
              <span className="leading-tight">
                <span className="block font-display text-xl font-semibold tracking-wide text-deep">BAJOGO</span>
                <span className="block text-[10px] font-bold uppercase tracking-[0.22em] text-forest">Enterprise</span>
              </span>
            </Link>
            <button type="button" className="ml-auto rounded-full border border-forest/20 px-3 py-2 text-sm font-bold text-forest lg:hidden" aria-expanded={open} onClick={() => setOpen((value) => !value)}>Menu</button>
            <nav className={`${open ? 'absolute inset-x-0 top-full grid gap-1 border-b bg-white p-4 shadow-card' : 'hidden'} lg:static lg:ml-auto lg:flex lg:items-center lg:gap-1 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none`}>
              <NavLink to="/" end className={navClass}>Home</NavLink>
              <NavLink to="/about" className={navClass}>About Us</NavLink>
              <NavMenu label="Agricultural Commodities" active={location.pathname.startsWith('/commodities')} resetKey={location.pathname + location.search}>
                <Link className="rounded-xl px-3 py-2 text-sm hover:bg-mist" to="/commodities">All commodities</Link>
                {commodities.map((item) => (
                  <Link key={item.slug} className="rounded-xl px-3 py-2 text-sm hover:bg-mist" to={`/commodities/${item.slug}`}>{item.name}</Link>
                ))}
                <Link className="rounded-xl px-3 py-2 text-sm hover:bg-mist" to="/commodities?category=other">Other Commodities</Link>
              </NavMenu>
              <NavLink to="/gold-buying" className={navClass}>Gold Buying</NavLink>
              <NavLink to="/haulage" className={navClass}>Haulage & Logistics</NavLink>
              <NavLink to="/news" className={navClass}>News & Updates</NavLink>
              <NavLink to="/gallery" className={navClass}>Gallery</NavLink>
              <NavLink to="/careers" className={navClass}>Careers</NavLink>
              <NavLink to="/contact" className={navClass}>Contact Us</NavLink>
              <Link to="/contact" className="mt-2 rounded-full bg-gold px-4 py-2 text-center text-sm font-bold text-deep lg:ml-2 lg:mt-0">Get In Touch</Link>
            </nav>
          </div>
        </div>
      </header>
      <main id="content"><div key={location.pathname} className="page-enter">{children}</div></main>
      <button
        type="button"
        aria-label="Back to top"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        className={`fixed bottom-5 right-5 z-40 grid h-12 w-12 place-items-center rounded-full bg-gold text-deep shadow-card transition duration-300 hover:-translate-y-1 ${farDown && !nearEnd ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0'}`}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
      </button>
      <SiteFooter settings={settings} commodities={commodities} place={place} />
    </div>
  );
}

function navClass({ isActive }: { isActive: boolean }) {
  return `rounded-full px-3 py-2 text-sm font-semibold ${isActive ? 'bg-mist text-forest' : 'text-ink hover:bg-mist'}`;
}

export function PageBanner({ title, text, image }: { title: string; text?: string | null; image?: Picture | null }) {
  return (
    <section className="relative overflow-hidden bg-deep text-white">
      {image ? <Photo image={image} className="kenburns absolute inset-0 h-full w-full opacity-45" /> : null}
      <div className="absolute inset-0 bg-gradient-to-r from-deep via-deep/85 to-forest/40" />
      <div aria-hidden="true" className="drift pointer-events-none absolute -right-24 -top-24 h-80 w-80 glow-gold" />
      <div aria-hidden="true" className="drift pointer-events-none absolute -bottom-32 left-1/3 h-72 w-72 glow-forest [animation-delay:-7s]" />
      <div className="rise relative mx-auto max-w-7xl px-4 py-20">
        <p className="text-xs font-bold uppercase tracking-[0.28em] text-gold">BAJOGO ENTERPRISE</p>
        <h1 className="mt-3 max-w-3xl font-display text-4xl font-semibold md:text-6xl">{title}</h1>
        {text ? <p className="mt-4 max-w-2xl text-lg text-white/85">{text}</p> : null}
      </div>
    </section>
  );
}

export function Prose({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return <div className="grid gap-4 whitespace-pre-line text-base leading-7 text-ink/80">{text}</div>;
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="rounded-3xl border border-dashed border-forest/20 bg-white px-6 py-10 text-center text-sm text-ink/70">{children}</p>;
}

export function EnquiryForm({ category, product, heading = 'Send an enquiry' }: { category?: string; product?: string; heading?: string }) {
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setDone('');
    // Keep the element: React clears event.currentTarget once the handler awaits.
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending(true);
    try {
      const response = await fetch('/api/v1/public/website/enquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: form.get('fullName'),
          companyName: form.get('companyName') || null,
          email: form.get('email'),
          telephone: form.get('telephone') || null,
          category: form.get('category'),
          productOrService: form.get('productOrService') || null,
          subject: form.get('subject'),
          message: form.get('message'),
          faxNumber: form.get('faxNumber') || '',
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? 'The enquiry could not be sent.');
      setDone(payload?.data?.confirmationSent
        ? `Your enquiry has been received and we will get back to you shortly. A confirmation has been sent to ${String(form.get('email'))}.`
        : 'Your enquiry has been received and we will get back to you shortly.');
      formElement.reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The enquiry could not be sent.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="grid gap-4 rounded-3xl bg-white p-6 shadow-card" onSubmit={onSubmit}>
      <h2 className="font-display text-3xl text-deep">{heading}</h2>
      {done ? <p className="rounded-2xl bg-mist px-4 py-3 text-sm text-forest">{done}</p> : null}
      {error ? <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p> : null}
      <label className="grid gap-1 text-sm font-semibold">Full name<input name="fullName" required className="field" /></label>
      <label className="grid gap-1 text-sm font-semibold">Company name<input name="companyName" className="field" /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold">Email<input name="email" type="email" required className="field" /></label>
        <label className="grid gap-1 text-sm font-semibold">Telephone<input name="telephone" className="field" /></label>
      </div>
      <label className="grid gap-1 text-sm font-semibold">Enquiry category
        <select name="category" defaultValue={category ?? 'general'} className="field">
          <option value="agricultural">Agricultural Commodities</option>
          <option value="gold">Gold Buying</option>
          <option value="haulage">Haulage & Logistics</option>
          <option value="general">General Enquiries</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm font-semibold">Product or service<input name="productOrService" defaultValue={product ?? ''} className="field" /></label>
      <label className="grid gap-1 text-sm font-semibold">Subject<input name="subject" required className="field" /></label>
      <label className="grid gap-1 text-sm font-semibold">Message<textarea name="message" required minLength={10} rows={5} className="field" /></label>
      <label className="absolute -left-[9999px]" aria-hidden="true">Fax<input name="faxNumber" tabIndex={-1} autoComplete="off" /></label>
      <button type="submit" disabled={pending} className="rounded-full bg-forest px-6 py-3 text-sm font-bold text-white disabled:opacity-60">{pending ? 'Sending…' : 'Send enquiry'}</button>
    </form>
  );
}
