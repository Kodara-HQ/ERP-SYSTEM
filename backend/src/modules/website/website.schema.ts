import { z } from 'zod';

const slug = z.string().trim().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and hyphens.');
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((value) => (value && value.trim() ? value.trim() : null));
const requiredText = (max: number) => z.string().trim().min(2).max(max);

export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });
export const imageParamSchema = z.object({
  id: z.coerce.number().int().positive(),
  imageId: z.coerce.number().int().positive(),
});
export const slugParamSchema = z.object({ slug });
export const blockKeyParamSchema = z.object({
  key: z.string().trim().regex(/^[a-z0-9]+(?:[.][a-z0-9-]+)+$/),
});

export const statusSchema = z.enum(['draft', 'pending_approval', 'approved', 'published']);
export const transitionSchema = z.object({
  action: z.enum(['submit', 'approve', 'publish', 'reject', 'unpublish']),
});

export const listQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  category: z.string().trim().max(40).optional(),
  status: statusSchema.optional(),
  type: z.enum(['division', 'strength', 'highlight', 'leader', 'service', 'value']).optional(),
});

export const productCategories = ['cashew', 'soybean', 'shea', 'cassava', 'cocoa', 'ginger', 'other'] as const;
export const galleryCategories = ['cashew', 'soybean', 'shea', 'cassava', 'cocoa', 'ginger', 'warehouses', 'haulage', 'gold', 'activities'] as const;

const href = z.string().trim().max(300).refine((value) => value.startsWith('/') && !value.startsWith('//') || /^https:\/\/[^\s]+$/i.test(value), 'Use a site path or an https link.');

export const blockUpdateSchema = z.object({
  title: requiredText(200),
  summary: optionalText(1000),
  body: optionalText(20000),
  content: z.record(z.string(), z.union([z.string(), z.null()])).optional(),
  mediaId: z.number().int().positive().nullable().optional(),
  metaTitle: optionalText(180),
  metaDescription: optionalText(320),
});

export const productWriteSchema = z.object({
  slug,
  name: requiredText(160),
  summary: requiredText(500),
  description: requiredText(8000),
  category: z.enum(productCategories),
  specifications: optionalText(4000),
  gradeInformation: optionalText(4000),
  packaging: optionalText(2000),
  availabilityStatus: z.enum(['unspecified', 'available', 'limited', 'unavailable']),
  featured: z.boolean(),
  sortOrder: z.number().int().min(0).max(9999),
  metaTitle: optionalText(180),
  metaDescription: optionalText(320),
});

export const articleWriteSchema = z.object({
  slug,
  title: requiredText(200),
  summary: requiredText(500),
  body: requiredText(20000),
  category: requiredText(40),
  featured: z.boolean(),
  publishedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  heroMediaId: z.number().int().positive().nullable().optional(),
  metaTitle: optionalText(180),
  metaDescription: optionalText(320),
});

export const galleryWriteSchema = z.object({
  mediaId: z.number().int().positive(),
  category: z.enum(galleryCategories),
  caption: optionalText(300),
  featuredOnHome: z.boolean(),
  sortOrder: z.number().int().min(0).max(9999),
});

export const itemWriteSchema = z.object({
  itemType: z.enum(['division', 'strength', 'highlight', 'leader', 'service', 'value']),
  title: requiredText(200),
  summary: optionalText(1000),
  body: optionalText(8000),
  metricValue: optionalText(80),
  metricNote: optionalText(255),
  groupKey: optionalText(40),
  mediaId: z.number().int().positive().nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999),
  href: href.nullable().optional(),
});

export const vacancyWriteSchema = z.object({
  slug,
  title: requiredText(160),
  locationLabel: optionalText(160),
  summary: requiredText(500),
  description: requiredText(8000),
  requirements: optionalText(8000),
  applicationsEnabled: z.boolean(),
  metaTitle: optionalText(180),
  metaDescription: optionalText(320),
});

const httpsUrl = z.string().trim().max(255).nullable().optional().refine((value) => !value || /^https:\/\/[^\s]+$/i.test(value), 'Use an https link.');

export const settingsSchema = z.object({
  phone: optionalText(40),
  email: z.string().trim().email().max(180).nullable().optional().or(z.literal('')).transform((value) => value || null),
  addressLine: optionalText(255),
  city: optionalText(120),
  country: optionalText(120),
  mapUrl: z.string().trim().max(500).nullable().optional().refine((value) => !value || /^https:\/\/[^\s]+$/i.test(value), 'Use an https map link.'),
  facebookUrl: httpsUrl,
  twitterUrl: httpsUrl,
  linkedinUrl: httpsUrl,
  instagramUrl: httpsUrl,
  footerText: optionalText(800),
  seoTitle: optionalText(180),
  seoDescription: optionalText(320),
  staffLoginUrl: z.string().trim().max(255).nullable().optional().refine((value) => !value || /^https?:\/\/[^\s]+$/i.test(value), 'Use the ERP login address.'),
});

export const mediaUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.string().trim().min(1).max(120),
  contentBase64: z.string().min(1),
  altText: requiredText(255),
});

export const productImageSchema = z.object({
  mediaId: z.number().int().positive(),
  isPrimary: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

const honeypot = z.string().max(200).optional().default('');

export const enquirySchema = z.object({
  fullName: requiredText(120),
  companyName: optionalText(160),
  email: z.string().trim().email().max(180),
  telephone: z.string().trim().max(40).nullable().optional().transform((value) => (value && value.trim() ? value.trim() : null))
    .refine((value) => value === null || /^[0-9+().\-\s]{7,40}$/.test(value), 'Enter a telephone number.'),
  category: z.enum(['agricultural', 'gold', 'haulage', 'general']),
  productOrService: optionalText(160),
  subject: requiredText(160),
  message: z.string().trim().min(10).max(4000),
  faxNumber: honeypot,
});

export const applicationSchema = z.object({
  fullName: requiredText(120),
  email: z.string().trim().email().max(180),
  phone: z.string().trim().max(40).nullable().optional().transform((value) => (value && value.trim() ? value.trim() : null))
    .refine((value) => value === null || /^[0-9+().\-\s]{7,40}$/.test(value), 'Enter a telephone number.'),
  message: z.string().trim().min(10).max(4000),
  faxNumber: honeypot,
  cv: z.object({
    fileName: z.string().trim().min(1).max(200),
    contentType: z.string().trim().min(1).max(120),
    contentBase64: z.string().min(1),
  }).nullable().optional(),
});

export const enquiryStatusSchema = z.object({ status: z.enum(['new', 'read', 'closed']) });
export const applicationStatusSchema = z.object({ status: z.enum(['new', 'reviewed']) });

export const contentKinds = ['products', 'articles', 'gallery', 'vacancies', 'items', 'blocks'] as const;
export const contentKindSchema = z.object({ kind: z.enum(contentKinds) });
