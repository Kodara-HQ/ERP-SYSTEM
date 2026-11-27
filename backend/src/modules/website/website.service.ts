import { createHash } from 'crypto';
import type { z } from 'zod';
import { pool } from '../../database/pool';
import type { RowDataPacket } from '../../database/rows';
import { execute, query, queryOne, scalar, withTransaction } from '../../database/query';
import { env } from '../../config/env';
import { writeAudit } from '../../services/auditService';
import { mailConfigured, sendMail } from '../../services/mail';
import { HttpError, notFound } from '../../utils/httpError';
import type {
  applicationSchema,
  articleWriteSchema,
  blockUpdateSchema,
  enquirySchema,
  galleryWriteSchema,
  itemWriteSchema,
  productImageSchema,
  productWriteSchema,
  settingsSchema,
  vacancyWriteSchema,
} from './website.schema';

type ProductInput = z.infer<typeof productWriteSchema>;
type ArticleInput = z.infer<typeof articleWriteSchema>;
type GalleryInput = z.infer<typeof galleryWriteSchema>;
type ItemInput = z.infer<typeof itemWriteSchema>;
type VacancyInput = z.infer<typeof vacancyWriteSchema>;
type BlockInput = z.infer<typeof blockUpdateSchema>;
type SettingsInput = z.infer<typeof settingsSchema>;
type EnquiryInput = z.infer<typeof enquirySchema>;
type ApplicationInput = z.infer<typeof applicationSchema>;

export interface Actor {
  userId: number;
  permissions: string[];
  ipAddress: string | null;
  userAgent: string | null;
}

const tables = {
  products: 'website_products',
  articles: 'website_articles',
  gallery: 'website_gallery',
  vacancies: 'website_vacancies',
  items: 'website_items',
  blocks: 'website_blocks',
} as const;

export type ContentKind = keyof typeof tables;

const transitions: Record<string, Record<string, { status: string; permission: string }>> = {
  draft: { submit: { status: 'pending_approval', permission: 'website.edit' } },
  pending_approval: {
    approve: { status: 'approved', permission: 'website.publish' },
    reject: { status: 'draft', permission: 'website.publish' },
  },
  approved: {
    publish: { status: 'published', permission: 'website.publish' },
    reject: { status: 'draft', permission: 'website.publish' },
  },
  published: { unpublish: { status: 'draft', permission: 'website.publish' } },
};

const blockFields: Record<string, string[]> = {
  'home.hero': ['heading', 'supporting', 'primaryLabel', 'primaryHref', 'secondaryLabel', 'secondaryHref'],
  'home.about': ['mission', 'vision'],
  'home.cta': ['buttonLabel', 'buttonHref'],
  'about.profile': ['who', 'history', 'mission', 'vision', 'approach', 'community'],
  'commodities.page': ['buyers', 'suppliers'],
  'gold.page': ['licenceName', 'licenceNumber', 'licenceAuthority', 'licenceExpiry'],
  'haulage.page': ['fleetNote', 'coverage'],
  'careers.page': ['noVacancies'],
  'contact.page': ['response'],
};

const publicPages = new Set(['about.profile', 'commodities.page', 'gold.page', 'haulage.page', 'gallery.page', 'careers.page', 'contact.page', 'legal.privacy', 'legal.terms']);

/** Item groups (service items by group key) each public page shows, keyed by the name the page reads them under. */
const pageGroups: Record<string, Record<string, string>> = {
  'commodities.page': { steps: 'commodities-process' },
  'gold.page': { standards: 'gold-standard', steps: 'gold-process' },
  'haulage.page': { steps: 'haulage-process' },
  'careers.page': { benefits: 'careers-benefit', steps: 'careers-process' },
  'contact.page': { topics: 'contact-topic' },
};

async function groupsFor(key: string) {
  const output: Record<string, Awaited<ReturnType<typeof publishedItems>>> = {};
  for (const [name, group] of Object.entries(pageGroups[key] ?? {})) output[name] = await publishedItems('service', group);
  return output;
}
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']);

function text(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function flag(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function parseJson(value: unknown): Record<string, string | null> {
  if (value == null || value === '') return {};
  try {
    const source = typeof value === 'string' ? JSON.parse(value) as unknown : value;
    if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
    const output: Record<string, string | null> = {};
    for (const [key, item] of Object.entries(source as Record<string, unknown>)) {
      output[key] = item == null || String(item).trim() === '' ? null : String(item);
    }
    return output;
  } catch {
    return {};
  }
}

function safeHref(value: string): string {
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  if (/^https:\/\/[^\s]+$/i.test(value)) return value;
  throw new HttpError(422, 'Links must be a site path or an https address.', 'INVALID_LINK');
}

function cleanContent(key: string, content: Record<string, string | null> | undefined): Record<string, string | null> {
  const output: Record<string, string | null> = {};
  for (const field of blockFields[key] ?? []) {
    const raw = content?.[field];
    const value = raw && raw.trim() ? raw.trim().slice(0, 4000) : null;
    output[field] = value && /href$/i.test(field) ? safeHref(value) : value;
  }
  return output;
}

function imageRef(id: unknown, alt: unknown, admin = false, version?: unknown) {
  if (id == null) return null;
  const mediaId = Number(id);
  // The content hash in the URL lets browsers cache the image yet fetch it again once it is replaced.
  const tag = typeof version === 'string' && version ? `?v=${version.slice(0, 12)}` : '';
  return {
    id: mediaId,
    url: `/api/v1/public/website/media/${mediaId}${tag}`,
    ...(admin ? { fileUrl: `/api/v1/website/media/${mediaId}/file` } : {}),
    alt: alt == null ? '' : String(alt),
  };
}

function like(value: string): string {
  return `%${value.toLowerCase().replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function assertPermission(actor: Actor, permission: string): void {
  if (!actor.permissions.includes(permission)) {
    throw new HttpError(403, 'You do not have permission to perform this action.', 'FORBIDDEN');
  }
}

function assertCanEdit(actor: Actor, status: string): void {
  if (actor.permissions.includes('website.publish')) return;
  if (status === 'draft' && actor.permissions.includes('website.edit')) return;
  throw new HttpError(403, 'A publisher can change approved content. Editors can change drafts.', 'FORBIDDEN');
}

async function audit(db: Parameters<typeof writeAudit>[0], actor: Actor, action: string, entityType: string, entityId: number | null, value: unknown, previous?: unknown) {
  await writeAudit(db, {
    userId: actor.userId,
    action,
    module: 'website',
    entityType,
    entityId,
    previousValue: previous,
    newValue: value,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });
}

async function write(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
      throw new HttpError(409, 'That web address is already in use.', 'DUPLICATE');
    }
    throw error;
  }
}

function mapBlock(row: RowDataPacket, admin = false) {
  return {
    id: Number(row.id),
    key: String(row.block_key),
    title: String(row.title),
    summary: text(row.summary),
    body: text(row.body),
    content: parseJson(row.content),
    image: imageRef(row.media_id, row.alt_text, admin, row.media_sha),
    status: String(row.status),
    metaTitle: text(row.meta_title),
    metaDescription: text(row.meta_description),
    updatedAt: row.updated_at ?? null,
  };
}

function mapItem(row: RowDataPacket, admin = false) {
  const body = text(row.body);
  return {
    id: Number(row.id),
    itemType: String(row.item_type),
    title: String(row.title),
    summary: text(row.summary),
    body,
    href: body && (body.startsWith('/') || body.startsWith('https://')) ? body : null,
    metricValue: text(row.metric_value),
    metricNote: text(row.metric_note),
    groupKey: text(row.group_key),
    sortOrder: Number(row.sort_order),
    status: String(row.status),
    image: imageRef(row.media_id, row.alt_text, admin, row.media_sha),
  };
}

function mapProduct(row: RowDataPacket, images: ReturnType<typeof imageRef>[] = [], admin = false) {
  return {
    id: Number(row.id),
    slug: String(row.slug),
    name: String(row.name),
    summary: String(row.summary),
    description: admin || row.description != null ? text(row.description) : undefined,
    category: String(row.category),
    specifications: text(row.specifications),
    gradeInformation: text(row.grade_information),
    packaging: text(row.packaging),
    availabilityStatus: String(row.availability_status),
    featured: flag(row.featured),
    sortOrder: Number(row.sort_order),
    status: String(row.status),
    metaTitle: text(row.meta_title),
    metaDescription: text(row.meta_description),
    image: imageRef(row.image_id, row.alt_text, admin, row.media_sha),
    images: images.filter((image) => image != null),
    video: text(row.video_url) ? { url: String(row.video_url), poster: text(row.video_poster_url) } : null,
  };
}

async function productImages(productId: number, admin = false) {
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT pi.id AS link_id, pi.media_id AS image_id, pi.is_primary, pi.sort_order, m.alt_text, m.sha256 AS media_sha
     FROM website_product_images pi
     JOIN website_media m ON m.id = pi.media_id
     WHERE pi.product_id = ?
     ORDER BY pi.is_primary DESC, pi.sort_order, pi.id`,
    [productId],
  );
  return rows.map((row) => ({ ...imageRef(row.image_id, row.alt_text, admin, row.media_sha)!, linkId: Number(row.link_id), isPrimary: flag(row.is_primary) }));
}

async function requireImage(id: number): Promise<void> {
  const row = await queryOne<RowDataPacket>(pool, 'SELECT id, kind FROM website_media WHERE id = ?', [id]);
  if (!row || String(row.kind) !== 'image') throw new HttpError(422, 'Choose an image from the website library.', 'INVALID_MEDIA');
}

function mapSettings(settings: RowDataPacket, company: RowDataPacket | null) {
  const mapUrl = text(settings.map_url);
  return {
    legalName: text(company?.legal_name) ?? 'BAJOGO ENTERPRISE',
    tradingName: text(company?.trading_name) ?? text(company?.legal_name) ?? 'BAJOGO ENTERPRISE',
    phone: text(settings.phone) ?? text(company?.phone),
    email: text(settings.email) ?? text(company?.email),
    addressLine: text(settings.address_line) ?? text(company?.address_line),
    city: text(settings.city) ?? text(company?.city),
    country: text(settings.country) ?? text(company?.country),
    mapUrl: mapUrl && /^https:\/\//i.test(mapUrl) ? mapUrl : null,
    facebookUrl: text(settings.facebook_url),
    twitterUrl: text(settings.twitter_url),
    linkedinUrl: text(settings.linkedin_url),
    instagramUrl: text(settings.instagram_url),
    footerText: text(settings.footer_text),
    seoTitle: text(settings.seo_title) ?? 'BAJOGO ENTERPRISE',
    seoDescription: text(settings.seo_description),
    staffLoginUrl: text(settings.staff_login_url) ?? `${env.erpPublicUrl}/login`,
  };
}

async function loadSettings() {
  const settings = await queryOne<RowDataPacket>(pool, 'SELECT * FROM website_settings WHERE id = 1');
  if (!settings) throw notFound('Website settings');
  const company = await queryOne<RowDataPacket>(
    pool,
    'SELECT legal_name, trading_name, phone, email, address_line, city, country FROM companies ORDER BY id LIMIT 1',
  );
  return mapSettings(settings, company);
}

async function publishedItems(type: string, groupKey?: string) {
  const params: unknown[] = [type];
  let sql = `SELECT i.*, m.alt_text, m.sha256 AS media_sha FROM website_items i
    LEFT JOIN website_media m ON m.id = i.media_id
    WHERE i.status = 'published' AND i.item_type = ?`;
  if (groupKey) {
    sql += ' AND i.group_key = ?';
    params.push(groupKey);
  }
  sql += ' ORDER BY i.sort_order, i.id';
  const rows = await query<RowDataPacket[]>(pool, sql, params);
  return rows.map((row) => mapItem(row));
}

const blockSelect = `SELECT b.*, m.alt_text, m.sha256 AS media_sha FROM website_blocks b LEFT JOIN website_media m ON m.id = b.media_id`;

export async function publicBootstrap() {
  const settings = await loadSettings();
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT slug, name, category FROM website_products WHERE status = 'published' ORDER BY sort_order, name`,
  );
  return {
    settings,
    commodities: rows.map((row) => ({ slug: String(row.slug), name: String(row.name), category: String(row.category) })),
  };
}

export async function publicHome() {
  const settings = await loadSettings();
  const blocks = await query<RowDataPacket[]>(
    pool,
    `${blockSelect} WHERE b.status = 'published' AND b.block_key IN ('home.hero', 'home.about', 'home.cta')`,
  );
  const byKey = new Map(blocks.map((row) => [String(row.block_key), mapBlock(row)]));
  const products = await query<RowDataPacket[]>(
    pool,
    `SELECT p.id, p.slug, p.name, p.summary, p.category, p.availability_status, p.featured, p.sort_order, p.status,
            p.specifications, p.grade_information, p.packaging, p.meta_title, p.meta_description, p.description,
            pi.media_id AS image_id, m.alt_text, m.sha256 AS media_sha
     FROM website_products p
     LEFT JOIN website_product_images pi ON pi.product_id = p.id AND pi.is_primary = 1
     LEFT JOIN website_media m ON m.id = pi.media_id
     WHERE p.status = 'published' AND p.featured = 1
     ORDER BY p.sort_order, p.name
     LIMIT 6`,
  );
  const articles = await query<RowDataPacket[]>(
    pool,
    `SELECT a.id, a.slug, a.title, a.summary, a.category, a.published_on, a.hero_media_id AS image_id, m.alt_text, m.sha256 AS media_sha
     FROM website_articles a
     LEFT JOIN website_media m ON m.id = a.hero_media_id
     WHERE a.status = 'published'
     ORDER BY a.published_on DESC NULLS LAST, a.published_at DESC NULLS LAST, a.id DESC
     LIMIT 3`,
  );
  const gallery = await query<RowDataPacket[]>(
    pool,
    `SELECT g.id, g.category, g.caption, g.media_id AS image_id, m.alt_text, m.sha256 AS media_sha
     FROM website_gallery g JOIN website_media m ON m.id = g.media_id
     WHERE g.status = 'published' AND g.featured_on_home = 1
     ORDER BY g.sort_order, g.id DESC LIMIT 6`,
  );
  return {
    settings,
    hero: byKey.get('home.hero') ?? null,
    about: byKey.get('home.about') ?? null,
    cta: byKey.get('home.cta') ?? null,
    divisions: await publishedItems('division'),
    strengths: await publishedItems('strength'),
    values: await publishedItems('value'),
    highlights: await publishedItems('highlight'),
    products: products.map((row) => mapProduct(row)),
    articles: articles.map((row) => ({
      id: Number(row.id),
      slug: String(row.slug),
      title: String(row.title),
      summary: String(row.summary),
      category: String(row.category),
      publishedOn: row.published_on ?? null,
      image: imageRef(row.image_id, row.alt_text, false, row.media_sha),
    })),
    gallery: gallery.map((row) => ({
      id: Number(row.id),
      category: String(row.category),
      caption: text(row.caption),
      image: imageRef(row.image_id, row.alt_text, false, row.media_sha),
    })),
  };
}

export async function publicPage(key: string) {
  if (!publicPages.has(key)) throw notFound('Page');
  const row = await queryOne<RowDataPacket>(pool, `${blockSelect} WHERE b.block_key = ? AND b.status = 'published'`, [key]);
  if (!row) throw notFound('Page');
  const block = mapBlock(row);
  if (key === 'about.profile') {
    return {
      block,
      values: await publishedItems('value'),
      leaders: await publishedItems('leader'),
      divisions: await publishedItems('division'),
      gallery: await galleryRows('activities'),
    };
  }
  if (key === 'gold.page') {
    return { block, services: await publishedItems('service', 'gold'), gallery: await galleryRows('gold'), groups: await groupsFor(key) };
  }
  if (key === 'haulage.page') {
    return { block, services: await publishedItems('service', 'haulage'), gallery: await galleryRows('haulage'), groups: await groupsFor(key) };
  }
  return { block, groups: await groupsFor(key) };
}

async function galleryRows(category?: string) {
  const params: unknown[] = [];
  let sql = `SELECT g.id, g.category, g.caption, g.media_id AS image_id, m.alt_text, m.sha256 AS media_sha
    FROM website_gallery g JOIN website_media m ON m.id = g.media_id
    WHERE g.status = 'published'`;
  if (category) {
    sql += ' AND g.category = ?';
    params.push(category);
  }
  sql += ' ORDER BY g.sort_order, g.id DESC';
  const rows = await query<RowDataPacket[]>(pool, sql, params);
  return rows.map((row) => ({
    id: Number(row.id),
    category: String(row.category),
    caption: text(row.caption),
    image: imageRef(row.image_id, row.alt_text, false, row.media_sha),
  }));
}

export async function publicProducts(filters: { q?: string; category?: string }) {
  const params: unknown[] = [];
  let sql = `SELECT p.*, pi.media_id AS image_id, m.alt_text, m.sha256 AS media_sha
    FROM website_products p
    LEFT JOIN website_product_images pi ON pi.product_id = p.id AND pi.is_primary = 1
    LEFT JOIN website_media m ON m.id = pi.media_id
    WHERE p.status = 'published'`;
  if (filters.category) {
    sql += ' AND p.category = ?';
    params.push(filters.category);
  }
  if (filters.q) {
    sql += ` AND (LOWER(p.name) LIKE ? ESCAPE '\\\\' OR LOWER(p.summary) LIKE ? ESCAPE '\\\\' OR LOWER(p.description) LIKE ? ESCAPE '\\\\')`;
    const pattern = like(filters.q);
    params.push(pattern, pattern, pattern);
  }
  sql += ' ORDER BY p.sort_order, p.name';
  const rows = await query<RowDataPacket[]>(pool, sql, params);
  return rows.map((row) => mapProduct(row));
}

export async function publicProduct(slug: string) {
  const row = await queryOne<RowDataPacket>(
    pool,
    `SELECT p.*, pi.media_id AS image_id, m.alt_text, m.sha256 AS media_sha
     FROM website_products p
     LEFT JOIN website_product_images pi ON pi.product_id = p.id AND pi.is_primary = 1
     LEFT JOIN website_media m ON m.id = pi.media_id
     WHERE p.slug = ? AND p.status = 'published'`,
    [slug],
  );
  if (!row) throw notFound('Product');
  const images = await productImages(Number(row.id));
  const related = await query<RowDataPacket[]>(
    pool,
    `SELECT p.id, p.slug, p.name, p.summary, p.category, p.availability_status, p.featured, p.sort_order, p.status,
            p.specifications, p.grade_information, p.packaging, p.description, p.meta_title, p.meta_description,
            pi.media_id AS image_id, m.alt_text, m.sha256 AS media_sha
     FROM website_products p
     LEFT JOIN website_product_images pi ON pi.product_id = p.id AND pi.is_primary = 1
     LEFT JOIN website_media m ON m.id = pi.media_id
     WHERE p.status = 'published' AND p.category = ? AND p.id <> ?
     ORDER BY p.sort_order LIMIT 3`,
    [row.category, row.id],
  );
  return { ...mapProduct(row, images), related: related.map((item) => mapProduct(item)) };
}

export async function publicArticles(filters: { q?: string; category?: string }) {
  const params: unknown[] = [];
  let sql = `SELECT a.id, a.slug, a.title, a.summary, a.category, a.published_on, a.featured, a.hero_media_id AS image_id, m.alt_text, m.sha256 AS media_sha
    FROM website_articles a LEFT JOIN website_media m ON m.id = a.hero_media_id
    WHERE a.status = 'published'`;
  if (filters.category) {
    sql += ' AND a.category = ?';
    params.push(filters.category);
  }
  if (filters.q) {
    sql += ` AND (LOWER(a.title) LIKE ? ESCAPE '\\\\' OR LOWER(a.summary) LIKE ? ESCAPE '\\\\')`;
    const pattern = like(filters.q);
    params.push(pattern, pattern);
  }
  sql += ' ORDER BY a.featured DESC, a.published_on DESC NULLS LAST, a.id DESC';
  const rows = await query<RowDataPacket[]>(pool, sql, params);
  return rows.map((row) => ({
    id: Number(row.id),
    slug: String(row.slug),
    title: String(row.title),
    summary: String(row.summary),
    category: String(row.category),
    featured: flag(row.featured),
    publishedOn: row.published_on ?? null,
    image: imageRef(row.image_id, row.alt_text, false, row.media_sha),
  }));
}

export async function publicArticle(slug: string) {
  const row = await queryOne<RowDataPacket>(
    pool,
    `SELECT a.*, a.hero_media_id AS image_id, m.alt_text, m.sha256 AS media_sha
     FROM website_articles a LEFT JOIN website_media m ON m.id = a.hero_media_id
     WHERE a.slug = ? AND a.status = 'published'`,
    [slug],
  );
  if (!row) throw notFound('Article');
  const related = await publicArticles({ category: String(row.category) });
  return {
    id: Number(row.id),
    slug: String(row.slug),
    title: String(row.title),
    summary: String(row.summary),
    body: String(row.body),
    category: String(row.category),
    publishedOn: row.published_on ?? null,
    metaTitle: text(row.meta_title),
    metaDescription: text(row.meta_description),
    image: imageRef(row.image_id, row.alt_text, false, row.media_sha),
    related: related.filter((item) => item.slug !== slug).slice(0, 3),
  };
}

export async function publicGallery(category?: string) {
  return galleryRows(category);
}

export async function publicVacancies() {
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT id, slug, title, location_label, summary, applications_enabled, published_at
     FROM website_vacancies WHERE status = 'published' ORDER BY published_at DESC NULLS LAST, id DESC`,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    slug: String(row.slug),
    title: String(row.title),
    locationLabel: text(row.location_label),
    summary: String(row.summary),
    applicationsEnabled: flag(row.applications_enabled),
    publishedAt: row.published_at ?? null,
  }));
}

export async function publicVacancy(slug: string) {
  const row = await queryOne<RowDataPacket>(pool, 'SELECT * FROM website_vacancies WHERE slug = ? AND status = ?', [slug, 'published']);
  if (!row) throw notFound('Vacancy');
  return {
    id: Number(row.id),
    slug: String(row.slug),
    title: String(row.title),
    locationLabel: text(row.location_label),
    summary: String(row.summary),
    description: String(row.description),
    requirements: text(row.requirements),
    applicationsEnabled: flag(row.applications_enabled),
    metaTitle: text(row.meta_title),
    metaDescription: text(row.meta_description),
  };
}

export async function submitEnquiry(input: EnquiryInput, meta: { ipAddress: string | null; userAgent: string | null }) {
  if (input.faxNumber.trim()) return { accepted: true };
  const created = await withTransaction(async (db) => {
    const result = await execute(
      db,
      `INSERT INTO website_enquiries
        (full_name, company_name, email, telephone, category, product_or_service, subject, message, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new')`,
      [input.fullName, input.companyName ?? null, input.email, input.telephone ?? null, input.category, input.productOrService ?? null, input.subject, input.message],
    );
    await writeAudit(db, {
      userId: null,
      action: 'website.enquiry',
      module: 'website',
      entityType: 'website_enquiry',
      entityId: result.insertId,
      newValue: { category: input.category, subject: input.subject },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return result.insertId;
  });
  const confirmationSent = await sendEnquiryEmails(created, input);
  return { accepted: true, id: created, confirmationSent };
}

function enquiryReference(id: number) {
  return `ENQ-${String(id).padStart(5, '0')}`;
}

/** Confirms receipt to the customer and tells the company inbox. Returns whether the customer's copy was sent. */
async function sendEnquiryEmails(id: number, input: EnquiryInput): Promise<boolean> {
  if (!mailConfigured()) return false;
  const settings = await loadSettings().catch(() => null);
  const company = settings?.tradingName || 'BAJOGO ENTERPRISE';
  const reference = enquiryReference(id);
  const contactLines = [settings?.phone ? `Phone: ${settings.phone}` : null, settings?.email ? `Email: ${settings.email}` : null, `Website: ${env.websitePublicUrl}`].filter(Boolean).join('\n');

  const confirmation = sendMail({
    to: input.email,
    replyTo: settings?.email || undefined,
    subject: `We have received your enquiry (${reference})`,
    text: [
      `Dear ${input.fullName},`,
      '',
      `Thank you for contacting ${company}. We have received your enquiry and a member of our team will get back to you as soon as possible.`,
      '',
      `Reference: ${reference}`,
      `Subject: ${input.subject}`,
      input.productOrService ? `Product or service: ${input.productOrService}` : null,
      '',
      'Your message:',
      input.message,
      '',
      'If you need to add anything, simply reply to this email and quote the reference above.',
      '',
      'Kind regards,',
      company,
      contactLines,
    ].filter((line) => line !== null).join('\n'),
  });

  const notifyTo = env.mail.enquiryNotifyTo || settings?.email;
  const notification = notifyTo
    ? sendMail({
        to: notifyTo,
        replyTo: input.email,
        subject: `New website enquiry ${reference}: ${input.subject}`,
        text: [
          'A new enquiry was sent from the website.',
          '',
          `Reference: ${reference}`,
          `Name: ${input.fullName}`,
          input.companyName ? `Company: ${input.companyName}` : null,
          `Email: ${input.email}`,
          input.telephone ? `Telephone: ${input.telephone}` : null,
          `Topic: ${input.category}`,
          input.productOrService ? `Product or service: ${input.productOrService}` : null,
          `Subject: ${input.subject}`,
          '',
          input.message,
          '',
          `Reply to this email to answer the customer, and mark the enquiry as handled in the ERP: ${env.erpPublicUrl}/website`,
        ].filter((line) => line !== null).join('\n'),
      })
    : Promise.resolve(false);

  const [sent] = await Promise.all([confirmation, notification]);
  return sent;
}

export async function submitApplication(slug: string, input: ApplicationInput, meta: { ipAddress: string | null; userAgent: string | null }) {
  if (input.faxNumber.trim()) return { accepted: true };
  const vacancy = await queryOne<RowDataPacket>(pool, 'SELECT id, applications_enabled FROM website_vacancies WHERE slug = ? AND status = ?', [slug, 'published']);
  if (!vacancy) throw notFound('Vacancy');
  if (!flag(vacancy.applications_enabled)) throw new HttpError(403, 'Applications are not open for this vacancy.', 'APPLICATIONS_CLOSED');
  let cvId: number | null = null;
  if (input.cv) cvId = await storeFile(input.cv, 'document', null, null);
  const created = await withTransaction(async (db) => {
    const result = await execute(
      db,
      `INSERT INTO website_applications (vacancy_id, full_name, email, phone, message, cv_media_id, status)
       VALUES (?, ?, ?, ?, ?, ?, 'new')`,
      [vacancy.id, input.fullName, input.email, input.phone ?? null, input.message, cvId],
    );
    await writeAudit(db, {
      userId: null,
      action: 'website.application',
      module: 'website',
      entityType: 'website_application',
      entityId: result.insertId,
      newValue: { vacancyId: Number(vacancy.id) },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return result.insertId;
  });
  return { accepted: true, id: created };
}

export async function publicMedia(id: number) {
  const row = await queryOne<RowDataPacket>(
    pool,
    `SELECT m.content, m.content_type, m.file_name, m.kind
     FROM website_media m
     WHERE m.id = ? AND m.kind = 'image'
       AND (
         EXISTS (SELECT 1 FROM website_product_images pi JOIN website_products p ON p.id = pi.product_id WHERE pi.media_id = m.id AND p.status = 'published')
         OR EXISTS (SELECT 1 FROM website_gallery g WHERE g.media_id = m.id AND g.status = 'published')
         OR EXISTS (SELECT 1 FROM website_articles a WHERE a.hero_media_id = m.id AND a.status = 'published')
         OR EXISTS (SELECT 1 FROM website_blocks b WHERE b.media_id = m.id AND b.status = 'published')
         OR EXISTS (SELECT 1 FROM website_items i WHERE i.media_id = m.id AND i.status = 'published')
       )`,
    [id],
  );
  if (!row || !imageTypes.has(String(row.content_type))) throw notFound('Image');
  return { contentType: String(row.content_type), fileName: String(row.file_name), content: asBuffer(row.content) };
}

export async function staffMedia(id: number) {
  const row = await queryOne<RowDataPacket>(pool, 'SELECT content, content_type, file_name, kind FROM website_media WHERE id = ? AND kind = ?', [id, 'image']);
  if (!row || !imageTypes.has(String(row.content_type))) throw notFound('Image');
  return { contentType: String(row.content_type), fileName: String(row.file_name), content: asBuffer(row.content) };
}

export async function sitemapXml() {
  const products = await query<RowDataPacket[]>(pool, `SELECT slug FROM website_products WHERE status = 'published' ORDER BY slug`);
  const articles = await query<RowDataPacket[]>(pool, `SELECT slug FROM website_articles WHERE status = 'published' ORDER BY slug`);
  const vacancies = await query<RowDataPacket[]>(pool, `SELECT slug FROM website_vacancies WHERE status = 'published' ORDER BY slug`);
  const paths = [
    '/',
    '/about',
    '/commodities',
    '/gold-buying',
    '/haulage',
    '/news',
    '/gallery',
    '/careers',
    '/contact',
    '/privacy',
    '/terms',
    ...products.map((row) => `/commodities/${row.slug}`),
    ...articles.map((row) => `/news/${row.slug}`),
    ...vacancies.map((row) => `/careers/${row.slug}`),
  ];
  const body = paths.map((item) => `  <url><loc>${escapeXml(`${env.websitePublicUrl}${item}`)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export function robotsTxt(): string {
  return `User-agent: *\nAllow: /\nSitemap: ${env.websitePublicUrl}/sitemap.xml\n`;
}

export async function websiteOverview() {
  const sections = ['website_blocks', 'website_products', 'website_articles', 'website_gallery', 'website_vacancies', 'website_items'] as const;
  const content: Record<string, { draft: number; pending: number; published: number }> = {};
  for (const table of sections) {
    content[table] = {
      draft: await scalar(pool, `SELECT COUNT(*) FROM ${table} WHERE status = 'draft'`),
      pending: await scalar(pool, `SELECT COUNT(*) FROM ${table} WHERE status = 'pending_approval'`),
      published: await scalar(pool, `SELECT COUNT(*) FROM ${table} WHERE status = 'published'`),
    };
  }
  return {
    content,
    newEnquiries: await scalar(pool, `SELECT COUNT(*) FROM website_enquiries WHERE status = 'new'`),
    newApplications: await scalar(pool, `SELECT COUNT(*) FROM website_applications WHERE status = 'new'`),
  };
}

export async function adminBlocks() {
  const rows = await query<RowDataPacket[]>(pool, `${blockSelect} ORDER BY b.block_key`);
  return rows.map((row) => mapBlock(row, true));
}

export async function updateBlock(id: number, input: BlockInput, actor: Actor) {
  const current = await queryOne<RowDataPacket>(pool, 'SELECT * FROM website_blocks WHERE id = ?', [id]);
  if (!current) throw notFound('Page');
  assertCanEdit(actor, String(current.status));
  const mediaId = input.mediaId === undefined ? current.media_id : input.mediaId;
  if (mediaId) await requireImage(Number(mediaId));
  const content = cleanContent(String(current.block_key), input.content);
  await withTransaction(async (db) => {
    await execute(
      db,
      `UPDATE website_blocks
       SET title = ?, summary = ?, body = ?, content = ?, media_id = ?, meta_title = ?, meta_description = ?, updated_by = ?
       WHERE id = ?`,
      [input.title, input.summary ?? null, input.body ?? null, JSON.stringify(content), mediaId ?? null, input.metaTitle ?? null, input.metaDescription ?? null, actor.userId, id],
    );
    await audit(db, actor, 'website.update', 'website_block', id, { key: current.block_key, title: input.title }, { title: current.title, status: current.status });
  });
  const saved = await queryOne<RowDataPacket>(pool, `${blockSelect} WHERE b.id = ?`, [id]);
  return mapBlock(saved!, true);
}

export async function adminProducts(status?: string) {
  const params: unknown[] = [];
  let sql = `SELECT p.*, pi.media_id AS image_id, m.alt_text, m.sha256 AS media_sha
    FROM website_products p
    LEFT JOIN website_product_images pi ON pi.product_id = p.id AND pi.is_primary = 1
    LEFT JOIN website_media m ON m.id = pi.media_id`;
  if (status) {
    sql += ' WHERE p.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY p.sort_order, p.name';
  const rows = await query<RowDataPacket[]>(pool, sql, params);
  return rows.map((row) => mapProduct(row, [], true));
}

export async function adminProduct(id: number) {
  const row = await queryOne<RowDataPacket>(
    pool,
    `SELECT p.*, pi.media_id AS image_id, m.alt_text, m.sha256 AS media_sha FROM website_products p
     LEFT JOIN website_product_images pi ON pi.product_id = p.id AND pi.is_primary = 1
     LEFT JOIN website_media m ON m.id = pi.media_id WHERE p.id = ?`,
    [id],
  );
  if (!row) throw notFound('Product');
  return mapProduct(row, await productImages(id, true), true);
}

export async function createProduct(input: ProductInput, actor: Actor) {
  assertPermission(actor, 'website.edit');
  let id = 0;
  await write(() => withTransaction(async (db) => {
    const result = await execute(
      db,
      `INSERT INTO website_products
        (slug, name, summary, description, category, specifications, grade_information, packaging, availability_status, featured, sort_order, status, meta_title, meta_description, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
      [input.slug, input.name, input.summary, input.description, input.category, input.specifications ?? null, input.gradeInformation ?? null, input.packaging ?? null, input.availabilityStatus, input.featured ? 1 : 0, input.sortOrder, input.metaTitle ?? null, input.metaDescription ?? null, actor.userId, actor.userId],
    );
    id = result.insertId;
    await audit(db, actor, 'website.create', 'website_product', id, { slug: input.slug, name: input.name });
  }));
  return adminProduct(id);
}

export async function updateProduct(id: number, input: ProductInput, actor: Actor) {
  const current = await queryOne<RowDataPacket>(pool, 'SELECT id, status, slug FROM website_products WHERE id = ?', [id]);
  if (!current) throw notFound('Product');
  assertCanEdit(actor, String(current.status));
  await write(() => withTransaction(async (db) => {
    await execute(
      db,
      `UPDATE website_products
       SET slug = ?, name = ?, summary = ?, description = ?, category = ?, specifications = ?, grade_information = ?, packaging = ?,
           availability_status = ?, featured = ?, sort_order = ?, meta_title = ?, meta_description = ?, updated_by = ?
       WHERE id = ?`,
      [input.slug, input.name, input.summary, input.description, input.category, input.specifications ?? null, input.gradeInformation ?? null, input.packaging ?? null, input.availabilityStatus, input.featured ? 1 : 0, input.sortOrder, input.metaTitle ?? null, input.metaDescription ?? null, actor.userId, id],
    );
    await audit(db, actor, 'website.update', 'website_product', id, { slug: input.slug }, { slug: current.slug, status: current.status });
  }));
  return adminProduct(id);
}

export async function addProductImage(productId: number, input: z.infer<typeof productImageSchema>, actor: Actor) {
  const product = await queryOne<RowDataPacket>(pool, 'SELECT id, status FROM website_products WHERE id = ?', [productId]);
  if (!product) throw notFound('Product');
  assertCanEdit(actor, String(product.status));
  await requireImage(input.mediaId);
  await withTransaction(async (db) => {
    if (input.isPrimary !== false) {
      await execute(db, 'UPDATE website_product_images SET is_primary = 0 WHERE product_id = ?', [productId]);
    }
    await execute(
      db,
      `INSERT INTO website_product_images (product_id, media_id, sort_order, is_primary)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order), is_primary = VALUES(is_primary)`,
      [productId, input.mediaId, input.sortOrder ?? 0, input.isPrimary === false ? 0 : 1],
    );
    await audit(db, actor, 'website.image', 'website_product', productId, { mediaId: input.mediaId });
  });
  return adminProduct(productId);
}

export async function removeProductImage(productId: number, imageId: number, actor: Actor) {
  const product = await queryOne<RowDataPacket>(pool, 'SELECT status FROM website_products WHERE id = ?', [productId]);
  if (!product) throw notFound('Product');
  assertCanEdit(actor, String(product.status));
  await execute(pool, 'DELETE FROM website_product_images WHERE id = ? AND product_id = ?', [imageId, productId]);
  return adminProduct(productId);
}

export async function adminArticles() {
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT a.*, a.hero_media_id AS image_id, m.alt_text, m.sha256 AS media_sha FROM website_articles a
     LEFT JOIN website_media m ON m.id = a.hero_media_id ORDER BY a.updated_at DESC`,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    slug: String(row.slug),
    title: String(row.title),
    summary: String(row.summary),
    body: String(row.body),
    category: String(row.category),
    featured: flag(row.featured),
    publishedOn: row.published_on ?? null,
    heroMediaId: row.hero_media_id == null ? null : Number(row.hero_media_id),
    status: String(row.status),
    metaTitle: text(row.meta_title),
    metaDescription: text(row.meta_description),
    image: imageRef(row.image_id, row.alt_text, true, row.media_sha),
  }));
}

export async function saveArticle(id: number | null, input: ArticleInput, actor: Actor) {
  if (input.heroMediaId) await requireImage(input.heroMediaId);
  if (id == null) assertPermission(actor, 'website.edit');
  const current = id == null ? null : await queryOne<RowDataPacket>(pool, 'SELECT id, status FROM website_articles WHERE id = ?', [id]);
  if (id != null && !current) throw notFound('Article');
  if (current) assertCanEdit(actor, String(current.status));
  let saved = id ?? 0;
  await write(() => withTransaction(async (db) => {
    if (current) {
      await execute(
        db,
        `UPDATE website_articles
         SET slug = ?, title = ?, summary = ?, body = ?, category = ?, featured = ?, published_on = ?, hero_media_id = ?, meta_title = ?, meta_description = ?, updated_by = ?
         WHERE id = ?`,
        [input.slug, input.title, input.summary, input.body, input.category, input.featured ? 1 : 0, input.publishedOn ?? null, input.heroMediaId ?? null, input.metaTitle ?? null, input.metaDescription ?? null, actor.userId, id],
      );
    } else {
      const result = await execute(
        db,
        `INSERT INTO website_articles
          (slug, title, summary, body, category, featured, published_on, hero_media_id, status, meta_title, meta_description, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
        [input.slug, input.title, input.summary, input.body, input.category, input.featured ? 1 : 0, input.publishedOn ?? null, input.heroMediaId ?? null, input.metaTitle ?? null, input.metaDescription ?? null, actor.userId, actor.userId],
      );
      saved = result.insertId;
    }
    await audit(db, actor, current ? 'website.update' : 'website.create', 'website_article', saved, { slug: input.slug, title: input.title });
  }));
  const row = await queryOne<RowDataPacket>(pool, 'SELECT id, slug, title, status FROM website_articles WHERE id = ?', [saved]);
  return row;
}

export async function adminGallery() {
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT g.*, m.alt_text, m.sha256 AS media_sha, m.id AS image_id FROM website_gallery g JOIN website_media m ON m.id = g.media_id ORDER BY g.sort_order, g.id DESC`,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    category: String(row.category),
    caption: text(row.caption),
    featuredOnHome: flag(row.featured_on_home),
    sortOrder: Number(row.sort_order),
    status: String(row.status),
    image: imageRef(row.image_id, row.alt_text, true, row.media_sha),
  }));
}

export async function createGallery(input: GalleryInput, actor: Actor) {
  assertPermission(actor, 'website.edit');
  await requireImage(input.mediaId);
  const result = await withTransaction(async (db) => {
    const created = await execute(
      db,
      `INSERT INTO website_gallery (media_id, category, caption, featured_on_home, sort_order, status, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`,
      [input.mediaId, input.category, input.caption ?? null, input.featuredOnHome ? 1 : 0, input.sortOrder, actor.userId, actor.userId],
    );
    await audit(db, actor, 'website.create', 'website_gallery', created.insertId, { category: input.category, mediaId: input.mediaId });
    return created.insertId;
  });
  return { id: result };
}

export async function updateGallery(id: number, input: GalleryInput, actor: Actor) {
  const current = await queryOne<RowDataPacket>(pool, 'SELECT id, status FROM website_gallery WHERE id = ?', [id]);
  if (!current) throw notFound('Gallery item');
  assertCanEdit(actor, String(current.status));
  await requireImage(input.mediaId);
  await withTransaction(async (db) => {
    await execute(
      db,
      `UPDATE website_gallery SET media_id = ?, category = ?, caption = ?, featured_on_home = ?, sort_order = ?, updated_by = ? WHERE id = ?`,
      [input.mediaId, input.category, input.caption ?? null, input.featuredOnHome ? 1 : 0, input.sortOrder, actor.userId, id],
    );
    await audit(db, actor, 'website.update', 'website_gallery', id, { category: input.category });
  });
  return { id };
}

export async function adminItems(type?: string) {
  const params: unknown[] = [];
  let sql = `SELECT i.*, m.alt_text, m.sha256 AS media_sha FROM website_items i LEFT JOIN website_media m ON m.id = i.media_id`;
  if (type) {
    sql += ' WHERE i.item_type = ?';
    params.push(type);
  }
  sql += ' ORDER BY i.item_type, i.sort_order, i.id';
  const rows = await query<RowDataPacket[]>(pool, sql, params);
  return rows.map((row) => mapItem(row, true));
}

export async function saveItem(id: number | null, input: ItemInput, actor: Actor) {
  if (input.mediaId) await requireImage(input.mediaId);
  if (id == null) assertPermission(actor, 'website.edit');
  const current = id == null ? null : await queryOne<RowDataPacket>(pool, 'SELECT id, status FROM website_items WHERE id = ?', [id]);
  if (id != null && !current) throw notFound('Item');
  if (current) assertCanEdit(actor, String(current.status));
  const body = input.href ?? input.body ?? null;
  let saved = id ?? 0;
  await withTransaction(async (db) => {
    if (current) {
      await execute(
        db,
        `UPDATE website_items
         SET item_type = ?, title = ?, summary = ?, body = ?, metric_value = ?, metric_note = ?, group_key = ?, media_id = ?, sort_order = ?, updated_by = ?
         WHERE id = ?`,
        [input.itemType, input.title, input.summary ?? null, body, input.metricValue ?? null, input.metricNote ?? null, input.groupKey ?? null, input.mediaId ?? null, input.sortOrder, actor.userId, id],
      );
    } else {
      const result = await execute(
        db,
        `INSERT INTO website_items
          (item_type, title, summary, body, metric_value, metric_note, group_key, media_id, sort_order, status, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
        [input.itemType, input.title, input.summary ?? null, body, input.metricValue ?? null, input.metricNote ?? null, input.groupKey ?? null, input.mediaId ?? null, input.sortOrder, actor.userId, actor.userId],
      );
      saved = result.insertId;
    }
    await audit(db, actor, current ? 'website.update' : 'website.create', 'website_item', saved, { title: input.title, itemType: input.itemType });
  });
  return { id: saved };
}

export async function adminVacancies() {
  const rows = await query<RowDataPacket[]>(pool, 'SELECT * FROM website_vacancies ORDER BY updated_at DESC');
  return rows.map((row) => ({
    id: Number(row.id),
    slug: String(row.slug),
    title: String(row.title),
    locationLabel: text(row.location_label),
    summary: String(row.summary),
    description: String(row.description),
    requirements: text(row.requirements),
    applicationsEnabled: flag(row.applications_enabled),
    status: String(row.status),
    metaTitle: text(row.meta_title),
    metaDescription: text(row.meta_description),
  }));
}

export async function saveVacancy(id: number | null, input: VacancyInput, actor: Actor) {
  if (id == null) assertPermission(actor, 'website.edit');
  const current = id == null ? null : await queryOne<RowDataPacket>(pool, 'SELECT id, status FROM website_vacancies WHERE id = ?', [id]);
  if (id != null && !current) throw notFound('Vacancy');
  if (current) assertCanEdit(actor, String(current.status));
  let saved = id ?? 0;
  await write(() => withTransaction(async (db) => {
    if (current) {
      await execute(
        db,
        `UPDATE website_vacancies
         SET slug = ?, title = ?, location_label = ?, summary = ?, description = ?, requirements = ?, applications_enabled = ?, meta_title = ?, meta_description = ?, updated_by = ?
         WHERE id = ?`,
        [input.slug, input.title, input.locationLabel ?? null, input.summary, input.description, input.requirements ?? null, input.applicationsEnabled ? 1 : 0, input.metaTitle ?? null, input.metaDescription ?? null, actor.userId, id],
      );
    } else {
      const result = await execute(
        db,
        `INSERT INTO website_vacancies
          (slug, title, location_label, summary, description, requirements, applications_enabled, status, meta_title, meta_description, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
        [input.slug, input.title, input.locationLabel ?? null, input.summary, input.description, input.requirements ?? null, input.applicationsEnabled ? 1 : 0, input.metaTitle ?? null, input.metaDescription ?? null, actor.userId, actor.userId],
      );
      saved = result.insertId;
    }
    await audit(db, actor, current ? 'website.update' : 'website.create', 'website_vacancy', saved, { slug: input.slug, title: input.title });
  }));
  return { id: saved };
}

export async function transitionContent(kind: ContentKind, id: number, action: string, actor: Actor) {
  const table = tables[kind];
  const current = await queryOne<RowDataPacket>(pool, `SELECT id, status FROM ${table} WHERE id = ?`, [id]);
  if (!current) throw notFound('Content');
  const step = transitions[String(current.status)]?.[action];
  if (!step) throw new HttpError(409, 'That publishing step is not available from the current state.', 'INVALID_TRANSITION');
  assertPermission(actor, step.permission);
  await withTransaction(async (db) => {
    await execute(
      db,
      `UPDATE ${table}
       SET status = ?, updated_by = ?, approved_by = CASE WHEN ? IN ('approved', 'published') THEN ? ELSE approved_by END,
           published_at = CASE WHEN ? = 'published' THEN CURRENT_TIMESTAMP ELSE published_at END
       WHERE id = ?`,
      [step.status, actor.userId, step.status, actor.userId, step.status, id],
    );
    if (kind === 'articles' && step.status === 'published') {
      await execute(db, 'UPDATE website_articles SET published_on = COALESCE(published_on, CURRENT_DATE) WHERE id = ?', [id]);
    }
    await audit(db, actor, 'website.transition', table, id, { status: step.status, action }, { status: current.status });
  });
  return { id, status: step.status };
}

export async function removeContent(kind: ContentKind, id: number, actor: Actor) {
  if (kind === 'blocks') throw new HttpError(409, 'Website pages stay in place. Edit or unpublish them.', 'PROTECTED');
  const table = tables[kind];
  const current = await queryOne<RowDataPacket>(pool, `SELECT id, status FROM ${table} WHERE id = ?`, [id]);
  if (!current) throw notFound('Content');
  assertCanEdit(actor, 'draft');
  if (String(current.status) !== 'draft') throw new HttpError(409, 'Return the record to draft before deleting it.', 'NOT_DRAFT');
  if (kind === 'vacancies') {
    const applications = await scalar(pool, 'SELECT COUNT(*) FROM website_applications WHERE vacancy_id = ?', [id]);
    if (applications > 0) throw new HttpError(409, 'This vacancy has applications and cannot be deleted.', 'IN_USE');
  }
  await withTransaction(async (db) => {
    await execute(db, `DELETE FROM ${table} WHERE id = ? AND status = 'draft'`, [id]);
    await audit(db, actor, 'website.delete', table, id, { deleted: true }, { status: current.status });
  });
}

export async function uploadImage(input: { fileName: string; contentType: string; contentBase64: string; altText: string }, actor: Actor) {
  assertPermission(actor, 'website.edit');
  const id = await storeFile(input, 'image', input.altText, actor.userId);
  await writeAudit(pool, {
    userId: actor.userId,
    action: 'website.media_upload',
    module: 'website',
    entityType: 'website_media',
    entityId: id,
    newValue: { fileName: input.fileName, altText: input.altText },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });
  return { id, altText: input.altText, fileUrl: `/api/v1/website/media/${id}/file` };
}

export async function deleteMedia(id: number, actor: Actor) {
  assertPermission(actor, 'website.edit');
  const row = await queryOne<RowDataPacket>(pool, 'SELECT id FROM website_media WHERE id = ?', [id]);
  if (!row) throw notFound('File');
  const used = await scalar(
    pool,
    `SELECT
      (SELECT COUNT(*) FROM website_product_images WHERE media_id = ?) +
      (SELECT COUNT(*) FROM website_gallery WHERE media_id = ?) +
      (SELECT COUNT(*) FROM website_articles WHERE hero_media_id = ?) +
      (SELECT COUNT(*) FROM website_blocks WHERE media_id = ?) +
      (SELECT COUNT(*) FROM website_items WHERE media_id = ?) +
      (SELECT COUNT(*) FROM website_applications WHERE cv_media_id = ?)`,
    [id, id, id, id, id, id],
  );
  if (used > 0) throw new HttpError(409, 'This file is still used by website content.', 'IN_USE');
  await withTransaction(async (db) => {
    await execute(db, 'DELETE FROM website_media WHERE id = ?', [id]);
    await audit(db, actor, 'website.media_delete', 'website_media', id, { deleted: true });
  });
}

export async function getSettings() {
  const row = await queryOne<RowDataPacket>(pool, 'SELECT * FROM website_settings WHERE id = 1');
  if (!row) throw notFound('Website settings');
  return {
    phone: text(row.phone),
    email: text(row.email),
    addressLine: text(row.address_line),
    city: text(row.city),
    country: text(row.country),
    mapUrl: text(row.map_url),
    facebookUrl: text(row.facebook_url),
    twitterUrl: text(row.twitter_url),
    linkedinUrl: text(row.linkedin_url),
    instagramUrl: text(row.instagram_url),
    footerText: text(row.footer_text),
    seoTitle: text(row.seo_title),
    seoDescription: text(row.seo_description),
    staffLoginUrl: text(row.staff_login_url),
    published: await loadSettings(),
  };
}

export async function updateSettings(input: SettingsInput, actor: Actor) {
  assertPermission(actor, 'website.edit');
  await withTransaction(async (db) => {
    await execute(
      db,
      `UPDATE website_settings
       SET phone = ?, email = ?, address_line = ?, city = ?, country = ?, map_url = ?, facebook_url = ?, twitter_url = ?,
           linkedin_url = ?, instagram_url = ?, footer_text = ?, seo_title = ?, seo_description = ?, staff_login_url = ?, updated_by = ?
       WHERE id = 1`,
      [input.phone ?? null, input.email ?? null, input.addressLine ?? null, input.city ?? null, input.country ?? null, input.mapUrl ?? null, input.facebookUrl ?? null, input.twitterUrl ?? null, input.linkedinUrl ?? null, input.instagramUrl ?? null, input.footerText ?? null, input.seoTitle ?? null, input.seoDescription ?? null, input.staffLoginUrl ?? null, actor.userId],
    );
    await audit(db, actor, 'website.settings', 'website_settings', 1, { phone: input.phone ?? null, email: input.email ?? null, city: input.city ?? null });
  });
  return getSettings();
}

export async function listEnquiries() {
  const rows = await query<RowDataPacket[]>(pool, 'SELECT * FROM website_enquiries ORDER BY created_at DESC, id DESC');
  return rows.map((row) => ({
    id: Number(row.id),
    fullName: String(row.full_name),
    companyName: text(row.company_name),
    email: String(row.email),
    telephone: text(row.telephone),
    category: String(row.category),
    productOrService: text(row.product_or_service),
    subject: String(row.subject),
    message: String(row.message),
    status: String(row.status),
    createdAt: row.created_at,
  }));
}

export async function updateEnquiry(id: number, status: string, actor: Actor) {
  const current = await queryOne<RowDataPacket>(pool, 'SELECT id, status FROM website_enquiries WHERE id = ?', [id]);
  if (!current) throw notFound('Enquiry');
  await withTransaction(async (db) => {
    await execute(db, 'UPDATE website_enquiries SET status = ?, handled_by = ? WHERE id = ?', [status, actor.userId, id]);
    await audit(db, actor, 'website.enquiry_status', 'website_enquiry', id, { status }, { status: current.status });
  });
  return { id, status };
}

export async function listApplications() {
  const rows = await query<RowDataPacket[]>(
    pool,
    `SELECT a.id, a.vacancy_id, v.title AS vacancy_title, a.full_name, a.email, a.phone, a.message, a.cv_media_id, a.status, a.created_at
     FROM website_applications a JOIN website_vacancies v ON v.id = a.vacancy_id
     ORDER BY a.created_at DESC, a.id DESC`,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    vacancyId: Number(row.vacancy_id),
    vacancyTitle: String(row.vacancy_title),
    fullName: String(row.full_name),
    email: String(row.email),
    phone: text(row.phone),
    message: String(row.message),
    hasCv: row.cv_media_id != null,
    status: String(row.status),
    createdAt: row.created_at,
  }));
}

export async function updateApplication(id: number, status: string, actor: Actor) {
  const current = await queryOne<RowDataPacket>(pool, 'SELECT id FROM website_applications WHERE id = ?', [id]);
  if (!current) throw notFound('Application');
  await withTransaction(async (db) => {
    await execute(db, 'UPDATE website_applications SET status = ? WHERE id = ?', [status, id]);
    await audit(db, actor, 'website.application_status', 'website_application', id, { status });
  });
  return { id, status };
}

export async function applicationCv(id: number) {
  const row = await queryOne<RowDataPacket>(
    pool,
    `SELECT m.content, m.content_type, m.file_name
     FROM website_applications a JOIN website_media m ON m.id = a.cv_media_id
     WHERE a.id = ? AND m.kind = 'document'`,
    [id],
  );
  if (!row) throw notFound('Application file');
  return { contentType: String(row.content_type), fileName: String(row.file_name), content: asBuffer(row.content) };
}

const imageSignatures: Record<string, { extensions: string[]; test: (content: Buffer) => boolean }> = {
  'image/jpeg': { extensions: ['.jpg', '.jpeg'], test: (content) => content.length > 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff },
  'image/png': { extensions: ['.png'], test: (content) => content.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' },
  'image/webp': { extensions: ['.webp'], test: (content) => content.subarray(0, 4).toString() === 'RIFF' && content.subarray(8, 12).toString() === 'WEBP' },
  'image/gif': { extensions: ['.gif'], test: (content) => content.subarray(0, 6).toString() === 'GIF87a' || content.subarray(0, 6).toString() === 'GIF89a' },
};

const documentSignatures: Record<string, { extensions: string[]; test: (content: Buffer) => boolean }> = {
  'application/pdf': { extensions: ['.pdf'], test: (content) => content.subarray(0, 4).toString() === '%PDF' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    extensions: ['.docx'],
    test: (content) => content[0] === 0x50 && content[1] === 0x4b,
  },
};

async function storeFile(input: { fileName: string; contentType: string; contentBase64: string }, kind: 'image' | 'document', altText: string | null, userId: number | null) {
  const signatures = kind === 'image' ? imageSignatures : documentSignatures;
  const spec = signatures[input.contentType.toLowerCase()];
  const fileName = input.fileName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 200);
  if (!spec || !spec.extensions.some((extension) => fileName.toLowerCase().endsWith(extension))) {
    throw new HttpError(422, kind === 'image' ? 'Upload a JPEG, PNG, WEBP, or GIF image.' : 'Attach a PDF or Word document.', 'INVALID_FILE');
  }
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(input.contentBase64)) throw new HttpError(422, 'The file content is not valid.', 'INVALID_FILE');
  const content = Buffer.from(input.contentBase64, 'base64');
  const limit = kind === 'image' ? 4 * 1024 * 1024 : 2 * 1024 * 1024;
  if (content.length === 0 || content.length > limit) throw new HttpError(413, `The file must be under ${kind === 'image' ? '4' : '2'} MB.`, 'FILE_TOO_LARGE');
  if (!spec.test(content)) throw new HttpError(422, 'The file contents do not match its type.', 'INVALID_FILE');
  const sha256 = createHash('sha256').update(content).digest('hex');
  const result = await execute(
    pool,
    `INSERT INTO website_media (kind, file_name, content_type, byte_size, alt_text, sha256, content, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [kind, fileName, input.contentType.toLowerCase(), content.length, altText, sha256, content, userId],
  );
  return result.insertId;
}

function asBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  throw notFound('File');
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
