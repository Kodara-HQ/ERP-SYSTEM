import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { execute, queryOne } from '../../database/query';
import { pool } from '../../database/pool';
import type { RowDataPacket } from '../../database/rows';
import { blocks, gallery, imageAlt, items, launchArticle, products, type BlockText, type ItemText, type ProductText } from './website.content';

const assetDir = path.resolve(__dirname, '../../../assets/website');

function poster(base: string, accent: string, motif: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800">
  <rect width="1200" height="800" fill="${base}"/>
  <circle cx="860" cy="400" r="230" fill="${accent}"/>
  <circle cx="860" cy="400" r="168" fill="none" stroke="#E6B323" stroke-width="12"/>
  <circle cx="280" cy="620" r="90" fill="none" stroke="#E6B323" stroke-width="8" opacity="0.7"/>
  ${motif}
</svg>`;
}

const motifs: Record<string, string> = {
  cashew: '<ellipse cx="860" cy="400" rx="70" ry="110" fill="#F4E2B0"/><path d="M820 470c40 50 90 20 70-40" fill="none" stroke="#6B3E1E" stroke-width="8"/>',
  soybean: '<ellipse cx="820" cy="390" rx="36" ry="52" fill="#E6D38A"/><ellipse cx="890" cy="420" rx="36" ry="52" fill="#F3E6B0"/><ellipse cx="860" cy="350" rx="36" ry="52" fill="#D7C07A"/>',
  shea: '<circle cx="860" cy="400" r="78" fill="#6E4B2A"/><circle cx="830" cy="370" r="18" fill="#8A6340"/>',
  cassava: '<rect x="800" y="300" width="120" height="200" rx="60" fill="#F7F1DE"/><rect x="830" y="340" width="60" height="120" rx="30" fill="#E7D7B0"/>',
  cocoa: '<ellipse cx="860" cy="400" rx="64" ry="100" fill="#C4622D"/><path d="M860 310v180M810 400h100" stroke="#F8F7F0" stroke-width="6"/>',
  ginger: '<path d="M800 460c40-120 120-120 140-20-40 20-30 70-70 80-40 8-80-10-70-60z" fill="#E2B15A"/>',
  gold: '<circle cx="860" cy="400" r="70" fill="#E6B323"/><circle cx="820" cy="450" r="36" fill="#F0CB5A"/><circle cx="910" cy="440" r="28" fill="#C99612"/>',
  haulage: '<rect x="760" y="390" width="220" height="70" rx="8" fill="#F8F7F0"/><circle cx="810" cy="470" r="22" fill="#E6B323"/><circle cx="930" cy="470" r="22" fill="#E6B323"/><rect x="800" y="350" width="90" height="50" fill="#F8F7F0"/>',
  warehouse: '<rect x="760" y="300" width="220" height="200" fill="#F8F7F0" opacity="0.15"/><rect x="790" y="360" width="40" height="140" fill="#E6B323"/><rect x="860" y="330" width="40" height="170" fill="#F8F7F0"/><rect x="930" y="390" width="40" height="110" fill="#E6B323"/>',
  hero: '<rect x="640" y="180" width="420" height="460" fill="#F8F7F0" opacity="0.08"/>',
  about: '<path d="M760 520c80-180 280-180 320 0" fill="#E6B323" opacity="0.35"/>',
};

const motifFor: Record<string, string> = {
  about: 'warehouse',
  'division-agriculture': 'warehouse',
  'division-gold': 'gold',
  'division-haulage': 'haulage',
};

/** A seed-owned row is one no person has created or edited in Website management. */
const untouched = 'created_by IS NULL AND updated_by IS NULL';

function seeded(row: RowDataPacket | null | undefined): boolean {
  return row != null && (row.seeded === true || Number(row.seeded) === 1);
}

function bundled(assetKey: string): { content: Buffer; contentType: string; fileName: string } | null {
  const candidates: Array<[string, string]> = [
    [`${assetKey}.jpg`, 'image/jpeg'],
    [`${assetKey}.jpeg`, 'image/jpeg'],
    [`${assetKey}.png`, 'image/png'],
    [`${assetKey}.webp`, 'image/webp'],
  ];
  for (const [name, contentType] of candidates) {
    const file = path.join(assetDir, name);
    if (fs.existsSync(file)) return { content: fs.readFileSync(file), contentType, fileName: name };
  }
  return null;
}

async function ensureImage(assetKey: string): Promise<number> {
  const alt = imageAlt[assetKey] ?? assetKey;
  const motif = motifFor[assetKey] ?? products.find((product) => product.image === assetKey)?.category ?? assetKey;
  const file = bundled(assetKey);
  const isGold = assetKey.includes('gold');
  const svg = poster(isGold ? '#003B20' : '#064B27', isGold ? '#1F6A3A' : '#0A5A30', motifs[motif] ?? motifs.hero);
  const payload = file ?? { content: Buffer.from(svg), contentType: 'image/svg+xml', fileName: `${assetKey}.svg` };
  const sha256 = createHash('sha256').update(payload.content).digest('hex');
  const existing = await queryOne<RowDataPacket>(pool, 'SELECT id, sha256, alt_text, uploaded_by FROM website_media WHERE asset_key = ?', [assetKey]);
  if (existing) {
    // Refresh the bundled photo and its description unless staff replaced the image themselves.
    if (existing.uploaded_by == null && (String(existing.sha256) !== sha256 || String(existing.alt_text ?? '') !== alt)) {
      await execute(
        pool,
        `UPDATE website_media
         SET file_name = ?, content_type = ?, byte_size = ?, alt_text = ?, sha256 = ?, content = ?, kind = 'image'
         WHERE id = ?`,
        [payload.fileName, payload.contentType, payload.content.length, alt, sha256, payload.content, existing.id],
      );
    }
    return Number(existing.id);
  }
  const created = await execute(
    pool,
    `INSERT INTO website_media (asset_key, kind, file_name, content_type, byte_size, alt_text, sha256, content)
     VALUES (?, 'image', ?, ?, ?, ?, ?, ?)`,
    [assetKey, payload.fileName, payload.contentType, payload.content.length, alt, sha256, payload.content],
  );
  return created.insertId;
}

async function ensureBlock(input: BlockText, mediaId: number | null): Promise<void> {
  const values = [
    input.title,
    input.summary ?? null,
    input.body ?? null,
    JSON.stringify(input.content ?? {}),
    mediaId,
    input.metaTitle ?? null,
    input.metaDescription ?? null,
  ];
  const existing = await queryOne<RowDataPacket>(pool, `SELECT id, (${untouched}) AS seeded FROM website_blocks WHERE block_key = ?`, [input.key]);
  if (existing) {
    if (seeded(existing)) {
      await execute(
        pool,
        `UPDATE website_blocks
         SET title = ?, summary = ?, body = ?, content = ?, media_id = ?, meta_title = ?, meta_description = ?
         WHERE id = ?`,
        [...values, existing.id],
      );
    }
    return;
  }
  await execute(
    pool,
    `INSERT INTO website_blocks
      (block_key, title, summary, body, content, media_id, meta_title, meta_description, status, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'published', CURRENT_TIMESTAMP)`,
    [input.key, ...values],
  );
}

async function syncItems(list: ItemText[], images: Map<string, number>): Promise<void> {
  const order = new Map<string, number>();
  const kept: number[] = [];
  for (const item of list) {
    const group = item.groupKey ?? null;
    const slot = `${item.type}:${group ?? ''}`;
    const sortOrder = (order.get(slot) ?? 0) + 1;
    order.set(slot, sortOrder);
    const mediaId = item.image ? images.get(item.image) ?? null : null;
    const existing = await queryOne<RowDataPacket>(
      pool,
      `SELECT id, (${untouched}) AS seeded FROM website_items
       WHERE item_type = ? AND title = ? AND COALESCE(group_key, '') = ?`,
      [item.type, item.title, group ?? ''],
    );
    if (existing) {
      kept.push(Number(existing.id));
      if (seeded(existing)) {
        await execute(
          pool,
          'UPDATE website_items SET summary = ?, body = ?, media_id = ?, sort_order = ? WHERE id = ?',
          [item.summary, item.body ?? null, mediaId, sortOrder, existing.id],
        );
      }
      continue;
    }
    const created = await execute(
      pool,
      `INSERT INTO website_items (item_type, title, summary, body, group_key, media_id, sort_order, status, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'published', CURRENT_TIMESTAMP)`,
      [item.type, item.title, item.summary, item.body ?? null, group, mediaId, sortOrder],
    );
    kept.push(created.insertId);
  }
  // Retire earlier opening items that this list replaced. Rows staff created or edited are left alone.
  if (kept.length > 0) {
    await execute(pool, `DELETE FROM website_items WHERE ${untouched} AND id NOT IN (${kept.map(() => '?').join(', ')})`, kept);
  }
}

async function ensureProduct(input: ProductText, sortOrder: number, imageId: number): Promise<void> {
  const values = [
    input.name,
    input.summary,
    input.description,
    input.category,
    input.specifications,
    input.gradeInformation,
    input.packaging,
    `${input.name} | BAJOGO ENTERPRISE`,
    input.metaDescription,
  ];
  let product = await queryOne<RowDataPacket>(pool, `SELECT id, (${untouched}) AS seeded FROM website_products WHERE slug = ?`, [input.slug]);
  if (!product) {
    const created = await execute(
      pool,
      `INSERT INTO website_products
        (slug, name, summary, description, category, specifications, grade_information, packaging, meta_title, meta_description,
         availability_status, featured, sort_order, status, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unspecified', 1, ?, 'published', CURRENT_TIMESTAMP)`,
      [input.slug, ...values, sortOrder],
    );
    product = { id: created.insertId } as RowDataPacket;
  } else if (seeded(product)) {
    await execute(
      pool,
      `UPDATE website_products
       SET name = ?, summary = ?, description = ?, category = ?, specifications = ?, grade_information = ?, packaging = ?,
           meta_title = ?, meta_description = ?, sort_order = ?
       WHERE id = ?`,
      [...values, sortOrder, product.id],
    );
  }
  if (input.video) {
    // Fills the video only when none is set. A changed video is kept; to hide the seeded one, set video_url to ''.
    await execute(
      pool,
      'UPDATE website_products SET video_url = ?, video_poster_url = ? WHERE id = ? AND video_url IS NULL',
      [input.video.url, input.video.poster, product.id],
    );
  }
  const image = await queryOne<RowDataPacket>(pool, 'SELECT id FROM website_product_images WHERE product_id = ? AND media_id = ?', [product.id, imageId]);
  if (!image) {
    await execute(pool, 'INSERT INTO website_product_images (product_id, media_id, sort_order, is_primary) VALUES (?, ?, 0, 1)', [product.id, imageId]);
  }
}

async function syncGallery(images: Map<string, number>): Promise<void> {
  const kept: number[] = [];
  for (let index = 0; index < gallery.length; index += 1) {
    const entry = gallery[index];
    const mediaId = images.get(entry.image);
    if (!mediaId) continue;
    const values = [entry.category, entry.caption, entry.featured ? 1 : 0, index + 1];
    const existing = await queryOne<RowDataPacket>(pool, `SELECT id, (${untouched}) AS seeded FROM website_gallery WHERE media_id = ?`, [mediaId]);
    if (existing) {
      kept.push(Number(existing.id));
      if (seeded(existing)) {
        await execute(pool, 'UPDATE website_gallery SET category = ?, caption = ?, featured_on_home = ?, sort_order = ? WHERE id = ?', [...values, existing.id]);
      }
      continue;
    }
    const created = await execute(
      pool,
      `INSERT INTO website_gallery (media_id, category, caption, featured_on_home, sort_order, status, published_at)
       VALUES (?, ?, ?, ?, ?, 'published', CURRENT_TIMESTAMP)`,
      [mediaId, ...values],
    );
    kept.push(created.insertId);
  }
  if (kept.length > 0) {
    await execute(pool, `DELETE FROM website_gallery WHERE ${untouched} AND id NOT IN (${kept.map(() => '?').join(', ')})`, kept);
  }
}

async function ensureLaunchArticle(imageId: number): Promise<void> {
  const values = [launchArticle.title, launchArticle.summary, launchArticle.body, launchArticle.category, imageId];
  const existing = await queryOne<RowDataPacket>(pool, `SELECT id, (${untouched}) AS seeded FROM website_articles WHERE slug = ?`, [launchArticle.slug]);
  if (existing) {
    if (seeded(existing)) {
      await execute(pool, 'UPDATE website_articles SET title = ?, summary = ?, body = ?, category = ?, hero_media_id = ? WHERE id = ?', [...values, existing.id]);
    }
    return;
  }
  await execute(
    pool,
    `INSERT INTO website_articles (slug, title, summary, body, category, hero_media_id, featured, published_on, status, published_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_DATE, 'published', CURRENT_TIMESTAMP)`,
    [launchArticle.slug, ...values],
  );
}

/** Inserts the public pages, products, and opening photographs, and refreshes any that staff have not edited. Safe to run more than once. */
export async function seedWebsiteContent(): Promise<void> {
  const footer = 'BAJOGO ENTERPRISE is a Ghanaian company in agricultural commodities, licensed gold activity, and haulage and logistics, connecting producers with reliable markets.';
  const seoTitle = 'BAJOGO ENTERPRISE | Agricultural Commodities, Gold and Logistics in Ghana';
  const seoDescription = 'BAJOGO ENTERPRISE sources and supplies Ghanaian agricultural commodities, trades gold within its licence, and provides haulage and logistics.';
  const settings = await queryOne<RowDataPacket>(pool, 'SELECT id, updated_by FROM website_settings WHERE id = 1');
  if (!settings) {
    await execute(pool, 'INSERT INTO website_settings (id, footer_text, seo_title, seo_description) VALUES (1, ?, ?, ?)', [footer, seoTitle, seoDescription]);
  } else if (settings.updated_by == null) {
    await execute(pool, 'UPDATE website_settings SET footer_text = ?, seo_title = ?, seo_description = ? WHERE id = 1', [footer, seoTitle, seoDescription]);
  }

  const images = new Map<string, number>();
  for (const key of Object.keys(imageAlt)) images.set(key, await ensureImage(key));

  for (const block of blocks) await ensureBlock(block, block.image ? images.get(block.image) ?? null : null);
  await syncItems(items, images);
  for (let index = 0; index < products.length; index += 1) {
    const product = products[index];
    await ensureProduct(product, index + 1, images.get(product.image)!);
  }
  await syncGallery(images);
  await ensureLaunchArticle(images.get(launchArticle.image)!);
}
