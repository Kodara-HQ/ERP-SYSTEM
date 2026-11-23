import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env';
import { asyncRoute } from '../../middleware/asyncHandler';
import { requireAuth, requirePermission } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { requireWorkspace } from '../../services/workspaces';
import { requestMeta } from '../../services/auditService';
import {
  applicationSchema,
  applicationStatusSchema,
  articleWriteSchema,
  blockKeyParamSchema,
  blockUpdateSchema,
  contentKindSchema,
  enquirySchema,
  enquiryStatusSchema,
  galleryWriteSchema,
  idParamSchema,
  imageParamSchema,
  itemWriteSchema,
  listQuerySchema,
  mediaUploadSchema,
  productCategories,
  productImageSchema,
  productWriteSchema,
  settingsSchema,
  slugParamSchema,
  transitionSchema,
  vacancyWriteSchema,
  galleryCategories,
} from './website.schema';
import {
  addProductImage,
  adminArticles,
  adminBlocks,
  adminGallery,
  adminItems,
  adminProduct,
  adminProducts,
  adminVacancies,
  applicationCv,
  createGallery,
  createProduct,
  deleteMedia,
  getSettings,
  listApplications,
  listEnquiries,
  publicArticle,
  publicArticles,
  publicBootstrap,
  publicGallery,
  publicHome,
  publicMedia,
  publicPage,
  publicProduct,
  publicProducts,
  publicVacancies,
  publicVacancy,
  removeContent,
  removeProductImage,
  robotsTxt,
  saveArticle,
  saveItem,
  saveVacancy,
  sitemapXml,
  staffMedia,
  submitApplication,
  submitEnquiry,
  transitionContent,
  updateApplication,
  updateBlock,
  updateEnquiry,
  updateGallery,
  updateProduct,
  updateSettings,
  uploadImage,
  websiteOverview,
  type Actor,
  type ContentKind,
} from './website.service';
import type { Request } from 'express';

function queryText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function actor(req: Request): Actor {
  return {
    userId: req.auth!.userId,
    permissions: [...new Set(req.auth!.grants.map((grant) => grant.permission))],
    ...requestMeta(req),
  };
}

function sendFile(res: { setHeader: (name: string, value: string) => void; send: (body: Buffer) => void }, file: { contentType: string; fileName: string; content: Buffer }, cache: string) {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', cache);
  res.setHeader('Content-Disposition', `inline; filename="${file.fileName.replace(/"/g, '')}"`);
  res.send(file.content);
}

const writeLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many submissions. Try again later.', code: 'RATE_LIMITED' } },
});

export const websitePublicRouter = Router();

websitePublicRouter.get('/bootstrap', asyncRoute(async (_req, res) => {
  res.json({ data: await publicBootstrap() });
}));

websitePublicRouter.get('/home', asyncRoute(async (_req, res) => {
  res.json({ data: await publicHome() });
}));

websitePublicRouter.get('/pages/:key', validate({ params: blockKeyParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await publicPage(req.params.key) });
}));

websitePublicRouter.get('/products', validate({ query: listQuerySchema }), asyncRoute(async (req, res) => {
  const category = queryText(req.query.category);
  if (category && !productCategories.includes(category as typeof productCategories[number])) {
    res.status(422).json({ error: { message: 'That product category is not recognised.', code: 'VALIDATION_ERROR' } });
    return;
  }
  res.json({ data: await publicProducts({ q: queryText(req.query.q), category }) });
}));

websitePublicRouter.get('/products/:slug', validate({ params: slugParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await publicProduct(req.params.slug) });
}));

websitePublicRouter.get('/articles', validate({ query: listQuerySchema }), asyncRoute(async (req, res) => {
  res.json({ data: await publicArticles({ q: queryText(req.query.q), category: queryText(req.query.category) }) });
}));

websitePublicRouter.get('/articles/:slug', validate({ params: slugParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await publicArticle(req.params.slug) });
}));

websitePublicRouter.get('/gallery', validate({ query: listQuerySchema }), asyncRoute(async (req, res) => {
  const category = queryText(req.query.category);
  if (category && !galleryCategories.includes(category as typeof galleryCategories[number])) {
    res.status(422).json({ error: { message: 'That gallery category is not recognised.', code: 'VALIDATION_ERROR' } });
    return;
  }
  res.json({ data: await publicGallery(category) });
}));

websitePublicRouter.get('/vacancies', asyncRoute(async (_req, res) => {
  res.json({ data: await publicVacancies() });
}));

websitePublicRouter.get('/vacancies/:slug', validate({ params: slugParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await publicVacancy(req.params.slug) });
}));

websitePublicRouter.post('/enquiries', env.isTest ? (_req, _res, next) => next() : writeLimit, validate({ body: enquirySchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await submitEnquiry(req.body, requestMeta(req)) });
}));

websitePublicRouter.post('/vacancies/:slug/applications', env.isTest ? (_req, _res, next) => next() : writeLimit, validate({ params: slugParamSchema, body: applicationSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await submitApplication(req.params.slug, req.body, requestMeta(req)) });
}));

websitePublicRouter.get('/media/:id', validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  sendFile(res, await publicMedia(Number(req.params.id)), 'public, max-age=86400');
}));

websitePublicRouter.get('/sitemap.xml', asyncRoute(async (_req, res) => {
  res.type('application/xml').send(await sitemapXml());
}));

websitePublicRouter.get('/robots.txt', asyncRoute(async (_req, res) => {
  res.type('text/plain').send(robotsTxt());
}));

export const websiteRouter = Router();
websiteRouter.use(requireAuth);

const editors = requirePermission('website.view');
const writers = requirePermission('website.edit');
const publishers = requirePermission('website.edit', 'website.publish');
const marketing = requireWorkspace('website');

websiteRouter.get('/overview', marketing, editors, asyncRoute(async (_req, res) => {
  res.json({ data: await websiteOverview() });
}));

websiteRouter.get('/blocks', marketing, editors, asyncRoute(async (_req, res) => {
  res.json({ data: await adminBlocks() });
}));

websiteRouter.patch('/blocks/:id', marketing, publishers, validate({ params: idParamSchema, body: blockUpdateSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await updateBlock(Number(req.params.id), req.body, actor(req)) });
}));

websiteRouter.get('/products', marketing, editors, validate({ query: listQuerySchema }), asyncRoute(async (req, res) => {
  res.json({ data: await adminProducts(queryText(req.query.status)) });
}));

websiteRouter.get('/products/:id', marketing, editors, validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await adminProduct(Number(req.params.id)) });
}));

websiteRouter.post('/products', marketing, writers, validate({ body: productWriteSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createProduct(req.body, actor(req)) });
}));

websiteRouter.patch('/products/:id', marketing, publishers, validate({ params: idParamSchema, body: productWriteSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await updateProduct(Number(req.params.id), req.body, actor(req)) });
}));

websiteRouter.post('/products/:id/images', marketing, publishers, validate({ params: idParamSchema, body: productImageSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await addProductImage(Number(req.params.id), req.body, actor(req)) });
}));

websiteRouter.delete('/products/:id/images/:imageId', marketing, publishers, validate({ params: imageParamSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await removeProductImage(Number(req.params.id), Number(req.params.imageId), actor(req)) });
}));

websiteRouter.get('/articles', marketing, editors, asyncRoute(async (_req, res) => {
  res.json({ data: await adminArticles() });
}));

websiteRouter.post('/articles', marketing, writers, validate({ body: articleWriteSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await saveArticle(null, req.body, actor(req)) });
}));

websiteRouter.patch('/articles/:id', marketing, publishers, validate({ params: idParamSchema, body: articleWriteSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await saveArticle(Number(req.params.id), req.body, actor(req)) });
}));

websiteRouter.get('/gallery', marketing, editors, asyncRoute(async (_req, res) => {
  res.json({ data: await adminGallery() });
}));

websiteRouter.post('/gallery', marketing, writers, validate({ body: galleryWriteSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await createGallery(req.body, actor(req)) });
}));

websiteRouter.patch('/gallery/:id', marketing, publishers, validate({ params: idParamSchema, body: galleryWriteSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await updateGallery(Number(req.params.id), req.body, actor(req)) });
}));

websiteRouter.get('/items', marketing, editors, validate({ query: listQuerySchema }), asyncRoute(async (req, res) => {
  res.json({ data: await adminItems(queryText(req.query.type)) });
}));

websiteRouter.post('/items', marketing, writers, validate({ body: itemWriteSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await saveItem(null, req.body, actor(req)) });
}));

websiteRouter.patch('/items/:id', marketing, publishers, validate({ params: idParamSchema, body: itemWriteSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await saveItem(Number(req.params.id), req.body, actor(req)) });
}));

websiteRouter.get('/vacancies', marketing, editors, asyncRoute(async (_req, res) => {
  res.json({ data: await adminVacancies() });
}));

websiteRouter.post('/vacancies', marketing, writers, validate({ body: vacancyWriteSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await saveVacancy(null, req.body, actor(req)) });
}));

websiteRouter.patch('/vacancies/:id', marketing, publishers, validate({ params: idParamSchema, body: vacancyWriteSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await saveVacancy(Number(req.params.id), req.body, actor(req)) });
}));

websiteRouter.post('/media', marketing, writers, validate({ body: mediaUploadSchema }), asyncRoute(async (req, res) => {
  res.status(201).json({ data: await uploadImage(req.body, actor(req)) });
}));

websiteRouter.delete('/media/:id', marketing, writers, validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  await deleteMedia(Number(req.params.id), actor(req));
  res.json({ data: { deleted: true } });
}));

websiteRouter.get('/media/:id/file', marketing, editors, validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  sendFile(res, await staffMedia(Number(req.params.id)), 'private, max-age=3600');
}));

websiteRouter.get('/settings', marketing, editors, asyncRoute(async (_req, res) => {
  res.json({ data: await getSettings() });
}));

websiteRouter.put('/settings', marketing, writers, validate({ body: settingsSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await updateSettings(req.body, actor(req)) });
}));

websiteRouter.get('/enquiries', marketing, requirePermission('website.enquiries'), asyncRoute(async (_req, res) => {
  res.json({ data: await listEnquiries() });
}));

websiteRouter.patch('/enquiries/:id', marketing, requirePermission('website.enquiries'), validate({ params: idParamSchema, body: enquiryStatusSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await updateEnquiry(Number(req.params.id), req.body.status, actor(req)) });
}));

websiteRouter.get('/applications', requireWorkspace('hr'), requirePermission('hr.view'), asyncRoute(async (_req, res) => {
  res.json({ data: await listApplications() });
}));

websiteRouter.patch('/applications/:id', requireWorkspace('hr'), requirePermission('hr.manage'), validate({ params: idParamSchema, body: applicationStatusSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await updateApplication(Number(req.params.id), req.body.status, actor(req)) });
}));

websiteRouter.get('/applications/:id/cv', requireWorkspace('hr'), requirePermission('hr.view'), validate({ params: idParamSchema }), asyncRoute(async (req, res) => {
  const file = await applicationCv(Number(req.params.id));
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `attachment; filename="${file.fileName.replace(/"/g, '')}"`);
  res.send(file.content);
}));

websiteRouter.post('/:kind/:id/transition', marketing, publishers, validate({ params: contentKindSchema.merge(idParamSchema), body: transitionSchema }), asyncRoute(async (req, res) => {
  res.json({ data: await transitionContent(req.params.kind as ContentKind, Number(req.params.id), req.body.action, actor(req)) });
}));

websiteRouter.delete('/:kind/:id', marketing, publishers, validate({ params: contentKindSchema.merge(idParamSchema) }), asyncRoute(async (req, res) => {
  await removeContent(req.params.kind as ContentKind, Number(req.params.id), actor(req));
  res.json({ data: { deleted: true } });
}));
