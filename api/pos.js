import { sql as pool } from '@vercel/postgres';
import { assertPostgresConnectionString, requireAuth, validateAdminPassword } from './lib/auth.js';
import { CURRENT_SEED_VERSION, getDefaultBundles, getDefaultProducts } from './lib/defaultData.js';

export function createHandler(sql) {
const uid = () => globalThis.crypto.randomUUID();
const detachedProjectIds = new Set(['pxwiu2t', 's4fjgga']);
const displayName = (product) => product.name || [product.vtuberName, product.goodsType, product.creatorName ? `(${product.creatorName})` : ''].filter(Boolean).join(' ') || '새 굿즈';

function normalizeProduct(product = {}) {
  const now = new Date().toISOString();
  const productCode = product.productCode || product.id || uid();
  const stockQty = Number(product.stockQty ?? product.stock ?? 0) || 0;
  return {
    id: String(product.id || productCode),
    productCode: String(productCode),
    goodsType: product.goodsType || product.name || '새 굿즈',
    vtuberName: product.vtuberName || '',
    creatorName: product.creatorName || '',
    stockQty,
    initialStockQty: Number(product.initialStockQty ?? stockQty) || 0,
    size: product.size || null,
    imageUrl: product.imageUrl || null,
    price: Number(product.price) || 0,
    setCreatorName: product.setCreatorName || null,
    setGroupName: product.setGroupName || null,
    setPrice: product.setPrice == null ? null : Number(product.setPrice) || 0,
    setDescription: product.setDescription || null,
    isActive: product.isActive !== false,
    createdAt: product.createdAt || now,
    updatedAt: now,
  };
}

let initialized = false;
async function initDb() {
  if (initialized) return;
  assertPostgresConnectionString();
  await sql`CREATE TABLE IF NOT EXISTS pos_projects (id TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES pos_admins(id) ON DELETE CASCADE, name TEXT NOT NULL, seed_version INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`ALTER TABLE pos_projects ADD COLUMN IF NOT EXISTS seed_version INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE pos_projects ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`;
  await sql`CREATE INDEX IF NOT EXISTS pos_projects_admin_id_idx ON pos_projects(admin_id)`;
  await sql`CREATE TABLE IF NOT EXISTS pos_products (project_id TEXT NOT NULL REFERENCES pos_projects(id) ON DELETE CASCADE, id TEXT NOT NULL, name TEXT NOT NULL, price INTEGER NOT NULL, stock INTEGER NOT NULL, product_code TEXT, goods_type TEXT, vtuber_name TEXT, creator_name TEXT, stock_qty INTEGER, initial_stock_qty INTEGER, size TEXT, set_creator_name TEXT, set_group_name TEXT, set_price INTEGER, set_description TEXT, is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY(project_id, id))`;
  await sql`ALTER TABLE pos_products ADD COLUMN IF NOT EXISTS image_url TEXT`;
  await sql`CREATE TABLE IF NOT EXISTS pos_bundles (project_id TEXT NOT NULL REFERENCES pos_projects(id) ON DELETE CASCADE, id TEXT NOT NULL, name TEXT NOT NULL, price INTEGER NOT NULL, items JSONB NOT NULL, PRIMARY KEY(project_id, id))`;
  await sql`CREATE TABLE IF NOT EXISTS pos_sales (project_id TEXT NOT NULL REFERENCES pos_projects(id) ON DELETE CASCADE, id TEXT NOT NULL, time TIMESTAMPTZ NOT NULL, method TEXT NOT NULL, total INTEGER NOT NULL, lines JSONB NOT NULL, PRIMARY KEY(project_id, id))`;
  // Upgrade pre-project tables atomically. Unowned legacy rows stay NULL and
  // cannot be read/deleted by project-scoped requests; never guess their owner.
  await sql`DO $$
    DECLARE table_name TEXT; legacy_pk TEXT;
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_class t
        WHERE t.oid IN ('pos_products'::regclass, 'pos_bundles'::regclass, 'pos_sales'::regclass)
          AND (NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = t.oid AND a.attname = 'project_id' AND NOT a.attisdropped)
            OR EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attname = 'id'
              WHERE c.conrelid = t.oid AND c.contype = 'p' AND c.conkey = ARRAY[a.attnum]))
      ) THEN RETURN; END IF;
      LOCK TABLE pos_products, pos_bundles, pos_sales IN ACCESS EXCLUSIVE MODE;
      FOREACH table_name IN ARRAY ARRAY['pos_products', 'pos_bundles', 'pos_sales'] LOOP
        EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS project_id TEXT REFERENCES pos_projects(id) ON DELETE CASCADE', table_name);
        SELECT c.conname INTO legacy_pk
          FROM pg_constraint c JOIN pg_attribute a
            ON a.attrelid = c.conrelid AND a.attname = 'id'
          WHERE c.conrelid = table_name::regclass AND c.contype = 'p'
            AND c.conkey = ARRAY[a.attnum];
        IF legacy_pk IS NOT NULL THEN
          EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', table_name, legacy_pk);
        END IF;
        EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I (project_id, id)', table_name || '_project_id_id_uidx', table_name);
      END LOOP;
    END $$`;
  await sql`ALTER TABLE pos_products
    ADD COLUMN IF NOT EXISTS product_code TEXT,
    ADD COLUMN IF NOT EXISTS goods_type TEXT,
    ADD COLUMN IF NOT EXISTS vtuber_name TEXT,
    ADD COLUMN IF NOT EXISTS creator_name TEXT,
    ADD COLUMN IF NOT EXISTS stock_qty INTEGER,
    ADD COLUMN IF NOT EXISTS initial_stock_qty INTEGER,
    ADD COLUMN IF NOT EXISTS size TEXT,
    ADD COLUMN IF NOT EXISTS set_creator_name TEXT,
    ADD COLUMN IF NOT EXISTS set_group_name TEXT,
    ADD COLUMN IF NOT EXISTS set_price INTEGER,
    ADD COLUMN IF NOT EXISTS set_description TEXT,
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`;
  await sql`CREATE INDEX IF NOT EXISTS pos_sales_project_time_idx ON pos_sales(project_id, time)`;
  await sql`CREATE TABLE IF NOT EXISTS pos_event_archives (
    project_id TEXT PRIMARY KEY, revision TEXT NOT NULL, archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), snapshot JSONB NOT NULL
  )`;
  // Only the two admin event IDs explicitly supplied by the owner are reset.
  // Keep a complete snapshot and marker in the same transaction as the reset.
  await sql`DO $$
    DECLARE target_id TEXT;
    BEGIN
      LOCK TABLE pos_projects, pos_products, pos_bundles, pos_sales, pos_event_archives IN SHARE ROW EXCLUSIVE MODE;
      FOR target_id IN SELECT id FROM pos_projects
        WHERE admin_id = 'admin' AND id IN ('pxwiu2t', 's4fjgga') AND name <> '7월 서코행사' LOOP
        IF EXISTS (SELECT 1 FROM pos_event_archives WHERE project_id = target_id) THEN CONTINUE; END IF;
        INSERT INTO pos_event_archives (project_id, revision, snapshot)
        SELECT target_id, 'separate-july-data-v1', jsonb_build_object(
          'project', (SELECT to_jsonb(p) FROM pos_projects p WHERE p.id = target_id),
          'products', COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM pos_products p WHERE p.project_id = target_id), '[]'::jsonb),
          'bundles', COALESCE((SELECT jsonb_agg(to_jsonb(b)) FROM pos_bundles b WHERE b.project_id = target_id), '[]'::jsonb),
          'sales', COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM pos_sales s WHERE s.project_id = target_id), '[]'::jsonb));
        DELETE FROM pos_sales WHERE project_id = target_id;
        DELETE FROM pos_bundles WHERE project_id = target_id;
        DELETE FROM pos_products WHERE project_id = target_id;
        UPDATE pos_projects SET seed_version = 0, updated_at = NOW() WHERE id = target_id;
      END LOOP;
    END $$`;
  // The owner of the pre-project event has been explicitly designated as admin.
  // One transaction and table locks make adoption repeatable across requests.
  await sql`DO $$
    DECLARE target_id TEXT;
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pos_admins WHERE id = 'admin') THEN RETURN; END IF;
      LOCK TABLE pos_projects, pos_products, pos_bundles, pos_sales IN SHARE ROW EXCLUSIVE MODE;
      IF NOT EXISTS (SELECT 1 FROM pos_products WHERE project_id IS NULL)
        AND NOT EXISTS (SELECT 1 FROM pos_bundles WHERE project_id IS NULL)
        AND NOT EXISTS (SELECT 1 FROM pos_sales WHERE project_id IS NULL) THEN RETURN; END IF;
      SELECT id INTO target_id FROM pos_projects
        WHERE admin_id = 'admin' AND name = '7월 서코행사' ORDER BY created_at, id LIMIT 1;
      IF target_id IS NULL THEN
        target_id := 'legacy-admin-july-seoul-comic';
        INSERT INTO pos_projects (id, admin_id, name) VALUES (target_id, 'admin', '7월 서코행사');
      END IF;
      UPDATE pos_products SET project_id = target_id WHERE project_id IS NULL;
      UPDATE pos_bundles SET project_id = target_id WHERE project_id IS NULL;
      UPDATE pos_sales SET project_id = target_id WHERE project_id IS NULL;
    END $$`;
  initialized = true;
}

async function assertProject(adminId, projectId) {
  await initDb();
  const project = (await sql`SELECT id FROM pos_projects WHERE id = ${projectId} AND admin_id = ${adminId}`).rows[0];
  if (!project) throw new Error('프로젝트를 찾을 수 없거나 접근 권한이 없습니다.');
}

async function dataRevision(projectId) {
  if (!detachedProjectIds.has(projectId)) return null;
  return (await sql`SELECT revision FROM pos_event_archives WHERE project_id = ${projectId}`).rows[0]?.revision || null;
}

async function listProjects(adminId) {
  await initDb();
  const result = await sql`SELECT id, name, seed_version, archived_at, created_at, updated_at FROM pos_projects WHERE admin_id = ${adminId} ORDER BY updated_at DESC, created_at DESC`;
  return { projects: result.rows.map((project) => ({ id: project.id, name: project.name, archivedAt: project.archived_at ? new Date(project.archived_at).toISOString() : null, seedVersion: Number(project.seed_version || 0), createdAt: new Date(project.created_at).toISOString(), updatedAt: new Date(project.updated_at).toISOString() })) };
}

async function insertProduct(projectId, input, onlyMissing = false) {
  const product = normalizeProduct(input);
  if (onlyMissing) {
    await sql`INSERT INTO pos_products (project_id, id, name, price, stock, product_code, goods_type, vtuber_name, creator_name, stock_qty, initial_stock_qty, size, set_creator_name, set_group_name, set_price, set_description, is_active, created_at, updated_at, image_url) VALUES (${projectId}, ${product.id}, ${displayName(product)}, ${product.price}, ${product.stockQty}, ${product.productCode}, ${product.goodsType}, ${product.vtuberName}, ${product.creatorName}, ${product.stockQty}, ${product.initialStockQty}, ${product.size}, ${product.setCreatorName}, ${product.setGroupName}, ${product.setPrice}, ${product.setDescription}, ${product.isActive}, ${product.createdAt}, ${product.updatedAt}, ${product.imageUrl}) ON CONFLICT (project_id, id) DO NOTHING`;
    return;
  }
  await sql`INSERT INTO pos_products (project_id, id, name, price, stock, product_code, goods_type, vtuber_name, creator_name, stock_qty, initial_stock_qty, size, set_creator_name, set_group_name, set_price, set_description, is_active, created_at, updated_at, image_url) VALUES (${projectId}, ${product.id}, ${displayName(product)}, ${product.price}, ${product.stockQty}, ${product.productCode}, ${product.goodsType}, ${product.vtuberName}, ${product.creatorName}, ${product.stockQty}, ${product.initialStockQty}, ${product.size}, ${product.setCreatorName}, ${product.setGroupName}, ${product.setPrice}, ${product.setDescription}, ${product.isActive}, ${product.createdAt}, ${product.updatedAt}, ${product.imageUrl})`;
}

async function seedProject(adminId, projectId) {
  await assertProject(adminId, projectId);
  await sql`DELETE FROM pos_products WHERE project_id = ${projectId}`;
  await sql`DELETE FROM pos_bundles WHERE project_id = ${projectId}`;
  for (const product of getDefaultProducts()) await insertProduct(projectId, product);
  for (const bundle of getDefaultBundles()) await sql`INSERT INTO pos_bundles (project_id, id, name, price, items) VALUES (${projectId}, ${bundle.id}, ${bundle.name}, ${bundle.price}, ${JSON.stringify(bundle.items)}::jsonb)`;
  await sql`UPDATE pos_projects SET seed_version = ${CURRENT_SEED_VERSION}, updated_at = NOW() WHERE id = ${projectId}`;
}

async function addMissingDefaults(adminId, projectId) {
  await assertProject(adminId, projectId);
  // Existing rows, including inactive products and customized bundles, are preserved.
  for (const product of getDefaultProducts()) await insertProduct(projectId, product, true);
  for (const bundle of getDefaultBundles()) await sql`INSERT INTO pos_bundles (project_id, id, name, price, items) VALUES (${projectId}, ${bundle.id}, ${bundle.name}, ${bundle.price}, ${JSON.stringify(bundle.items)}::jsonb) ON CONFLICT (project_id, id) DO NOTHING`;
  await sql`UPDATE pos_projects SET seed_version = ${CURRENT_SEED_VERSION}, updated_at = NOW() WHERE id = ${projectId}`;
}

async function createProject(adminId, name) {
  const projectName = String(name || '').trim();
  if (!projectName) throw new Error('프로젝트 이름을 입력해주세요.');
  await initDb();
  const id = uid();
  await sql`INSERT INTO pos_projects (id, admin_id, name) VALUES (${id}, ${adminId}, ${projectName})`;
  return { project: { id, name: projectName } };
}

async function readState(adminId, projectId) {
  await assertProject(adminId, projectId);
  const [products, bundles, sales] = await Promise.all([
    sql`SELECT * FROM pos_products WHERE project_id = ${projectId} AND COALESCE(is_active, TRUE) = TRUE ORDER BY id`,
    sql`SELECT id, name, price, items FROM pos_bundles WHERE project_id = ${projectId} ORDER BY id`,
    sql`SELECT id, time, method, total, lines FROM pos_sales WHERE project_id = ${projectId} ORDER BY time ASC`,
  ]);
  return {
    archivedAt: (await sql`SELECT archived_at FROM pos_projects WHERE id = ${projectId}`).rows[0]?.archived_at || null,
    dataRevision: await dataRevision(projectId),
    products: products.rows.map((product) => ({ id: product.id, productCode: product.product_code || product.id, goodsType: product.goods_type || product.name, vtuberName: product.vtuber_name || '', creatorName: product.creator_name || '', stockQty: Number(product.stock_qty ?? product.stock ?? 0), initialStockQty: Number(product.initial_stock_qty ?? product.stock_qty ?? product.stock ?? 0), size: product.size || null, imageUrl: product.image_url || null, price: Number(product.price) || 0, setCreatorName: product.set_creator_name || null, setGroupName: product.set_group_name || null, setPrice: product.set_price == null ? null : Number(product.set_price) || 0, setDescription: product.set_description || null, isActive: product.is_active !== false, createdAt: new Date(product.created_at).toISOString(), updatedAt: new Date(product.updated_at).toISOString(), name: product.name, stock: Number(product.stock_qty ?? product.stock ?? 0) })),
    bundles: bundles.rows.map((bundle) => ({ ...bundle, items: bundle.items || [] })),
    sales: sales.rows.map((sale) => ({ ...sale, time: new Date(sale.time).toISOString(), lines: sale.lines || [] })),
  };
}

async function replaceProducts(adminId, projectId, products) {
  await assertProject(adminId, projectId);
  await sql`DELETE FROM pos_products WHERE project_id = ${projectId}`;
  for (const product of products) await insertProduct(projectId, product);
  await sql`UPDATE pos_projects SET updated_at = NOW() WHERE id = ${projectId}`;
}

async function updateProductImage(adminId, projectId, { productId, imageUrl }) {
  await assertProject(adminId, projectId);
  if (imageUrl != null) {
    const url = new URL(imageUrl);
    const prefix = `/products/${encodeURIComponent(projectId)}/${encodeURIComponent(productId)}/`;
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.public.blob.vercel-storage.com') || !url.pathname.startsWith(prefix)) throw new Error('올바른 상품 이미지 URL이 아닙니다.');
  }
  await sql`UPDATE pos_products SET image_url = ${imageUrl || null}, updated_at = NOW() WHERE project_id = ${projectId} AND id = ${productId}`;
}

async function replaceBundles(adminId, projectId, bundles) {
  await assertProject(adminId, projectId);
  await sql`DELETE FROM pos_bundles WHERE project_id = ${projectId}`;
  for (const bundle of bundles) await sql`INSERT INTO pos_bundles (project_id, id, name, price, items) VALUES (${projectId}, ${bundle.id || uid()}, ${bundle.name || '새 세트'}, ${Number(bundle.price) || 0}, ${JSON.stringify(bundle.items || [])}::jsonb)`;
  await sql`UPDATE pos_projects SET updated_at = NOW() WHERE id = ${projectId}`;
}

async function finalizeSale(adminId, projectId, { localOrderId, createdAt, method, total, cart }) {
  await assertProject(adminId, projectId);
  if (!Array.isArray(cart) || !cart.length) throw new Error('장바구니가 비어 있습니다.');
  const saleId = localOrderId || uid();
  if ((await sql`SELECT id FROM pos_sales WHERE project_id = ${projectId} AND id = ${saleId}`).rows[0]) return;
  const products = (await sql`SELECT id, stock, stock_qty FROM pos_products WHERE project_id = ${projectId}`).rows;
  const soldByProduct = new Map();
  for (const line of cart) {
    if (line.type === 'product') soldByProduct.set(line.id, (soldByProduct.get(line.id) || 0) + Number(line.qty || 0));
    if (line.type === 'bundle') {
      const bundle = (await sql`SELECT items FROM pos_bundles WHERE project_id = ${projectId} AND id = ${line.id}`).rows[0];
      for (const item of bundle?.items || []) soldByProduct.set(item.productId, (soldByProduct.get(item.productId) || 0) + Number(item.qty || 0) * Number(line.qty || 0));
    }
  }
  for (const [productId, sold] of soldByProduct) {
    const product = products.find((item) => item.id === productId);
    if (!product || Number(product.stock_qty ?? product.stock ?? 0) < sold) throw new Error('재고가 부족합니다. 새로고침 후 다시 시도해주세요.');
  }
  for (const [productId, sold] of soldByProduct) await sql`UPDATE pos_products SET stock = stock - ${sold}, stock_qty = COALESCE(stock_qty, stock) - ${sold}, updated_at = NOW() WHERE project_id = ${projectId} AND id = ${productId}`;
  const sale = { id: saleId, time: createdAt || new Date().toISOString(), method, total: Number(total) || 0, lines: cart.map(({ subItems, ...line }) => line) };
  await sql`INSERT INTO pos_sales (project_id, id, time, method, total, lines) VALUES (${projectId}, ${sale.id}, ${sale.time}, ${sale.method}, ${sale.total}, ${JSON.stringify(sale.lines)}::jsonb)`;
  await sql`UPDATE pos_projects SET updated_at = NOW() WHERE id = ${projectId}`;
}

async function voidSale(adminId, projectId, id) {
  await assertProject(adminId, projectId);
  const sale = (await sql`SELECT lines FROM pos_sales WHERE project_id = ${projectId} AND id = ${id}`).rows[0];
  if (!sale) return;
  for (const line of sale.lines || []) {
    if (line.type === 'product') await sql`UPDATE pos_products SET stock = stock + ${Number(line.qty) || 0}, stock_qty = COALESCE(stock_qty, stock) + ${Number(line.qty) || 0}, updated_at = NOW() WHERE project_id = ${projectId} AND id = ${line.id}`;
    if (line.type === 'bundle') {
      const bundle = (await sql`SELECT items FROM pos_bundles WHERE project_id = ${projectId} AND id = ${line.id}`).rows[0];
      for (const item of bundle?.items || []) await sql`UPDATE pos_products SET stock = stock + ${(Number(item.qty) || 0) * (Number(line.qty) || 0)}, stock_qty = COALESCE(stock_qty, stock) + ${(Number(item.qty) || 0) * (Number(line.qty) || 0)}, updated_at = NOW() WHERE project_id = ${projectId} AND id = ${item.productId}`;
    }
  }
  await sql`DELETE FROM pos_sales WHERE project_id = ${projectId} AND id = ${id}`;
  await sql`UPDATE pos_projects SET updated_at = NOW() WHERE id = ${projectId}`;
}

async function clearSales(adminId, projectId, password) {
  if (!await validateAdminPassword(adminId, password)) throw new Error('패스워드가 올바르지 않습니다.');
  await assertProject(adminId, projectId);
  await sql`DELETE FROM pos_sales WHERE project_id = ${projectId}`;
  await sql`UPDATE pos_projects SET updated_at = NOW() WHERE id = ${projectId}`;
}

async function snapshot(projectId) {
  const project = (await sql`SELECT name, archived_at, seed_version FROM pos_projects WHERE id = ${projectId}`).rows[0];
  const products = (await sql`SELECT * FROM pos_products WHERE project_id = ${projectId} ORDER BY id`).rows;
  const bundles = (await sql`SELECT * FROM pos_bundles WHERE project_id = ${projectId} ORDER BY id`).rows;
  const sales = (await sql`SELECT * FROM pos_sales WHERE project_id = ${projectId} ORDER BY time, id`).rows;
  // No account credentials or offline command queue is included.
  return { format: 'my-booth-project', version: 1, exportedAt: new Date().toISOString(), project, products, bundles, sales };
}

function validateBackup(backup) {
  const invalid = () => { throw new Error('지원하지 않거나 손상된 프로젝트 백업입니다.'); };
  const integer = (value, min = 0) => Number.isInteger(value) && value >= min && value <= 2147483647;
  const text = value => typeof value === 'string' && value.length > 0 && value.length <= 500;
  if (!backup || backup.format !== 'my-booth-project' || backup.version !== 1 || !backup.project || !text(backup.project.name)) invalid();
  if (encodeURIComponent(JSON.stringify(backup)).replace(/%[0-9A-F]{2}/g, 'x').length > 3 * 1024 * 1024) invalid();
  for (const key of ['products', 'bundles', 'sales']) {
    if (!Array.isArray(backup[key]) || backup[key].length > 50000) invalid();
    const ids = new Set();
    for (const row of backup[key]) {
      if (!row || !text(row.id) || ids.has(row.id)) invalid();
      ids.add(row.id);
    }
  }
  for (const p of backup.products) {
    if (!text(p.name) || !integer(p.price) || !integer(p.stock) || (p.stock_qty != null && !integer(p.stock_qty)) || (p.initial_stock_qty != null && !integer(p.initial_stock_qty)) || (p.set_price != null && !integer(p.set_price)) || (p.is_active != null && typeof p.is_active !== 'boolean')) invalid();
    if (p.image_url != null) {
      const image = new URL(p.image_url);
      if (image.protocol !== 'https:' || !image.hostname.endsWith('.public.blob.vercel-storage.com')) invalid();
    }
  }
  for (const b of backup.bundles) {
    if (!text(b.name) || !integer(b.price) || !Array.isArray(b.items)) invalid();
    for (const item of b.items) if (!item || !text(item.productId) || !integer(item.qty, 1)) invalid();
  }
  for (const s of backup.sales) {
    if (!['cash', 'transfer'].includes(s.method) || !integer(s.total) || typeof s.time !== 'string' || !Number.isFinite(Date.parse(s.time)) || !Array.isArray(s.lines)) invalid();
    for (const line of s.lines) if (!line || !['product', 'bundle'].includes(line.type) || !text(line.id) || !text(line.name) || !integer(line.qty, 1) || !integer(line.unitPrice)) invalid();
  }
}

async function importProject(adminId, name, backup, duplicate = false) {
  const id = uid();
  const archivedAt = duplicate ? null : new Date().toISOString();
  const seedVersion = Number.isInteger(backup.project.seed_version) && backup.project.seed_version >= 0 && backup.project.seed_version <= 2147483647 ? backup.project.seed_version : 0;
  await sql`INSERT INTO pos_projects (id, admin_id, name, archived_at, seed_version) VALUES (${id}, ${adminId}, ${name}, ${archivedAt}, ${seedVersion})`;
  // Replace the original project_id; never trust ownership or IDs from a file.
  const products = backup.products.map(row => ({ ...row, project_id: id, ...(duplicate ? { stock: 0, stock_qty: 0, initial_stock_qty: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } : {}) }));
  const bundles = backup.bundles.map(row => ({ ...row, project_id: id }));
  const sales = duplicate ? [] : backup.sales.map(row => ({ ...row, project_id: id }));
  await sql`INSERT INTO pos_products SELECT * FROM jsonb_populate_recordset(NULL::pos_products, ${JSON.stringify(products)}::jsonb)`;
  await sql`INSERT INTO pos_bundles SELECT * FROM jsonb_populate_recordset(NULL::pos_bundles, ${JSON.stringify(bundles)}::jsonb)`;
  await sql`INSERT INTO pos_sales SELECT * FROM jsonb_populate_recordset(NULL::pos_sales, ${JSON.stringify(sales)}::jsonb)`;
  return { project: { id, name, archivedAt }, ...await listProjects(adminId) };
}

async function handler(req, res) {
  const admin = requireAuth(req, res);
  if (!admin) return;
  try {
    const projectId = req.query?.projectId || req.body?.projectId || req.body?.payload?.projectId;
    if (req.method === 'GET') return res.status(200).json(projectId ? await readState(admin.id, projectId) : await listProjects(admin.id));
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { action, payload = {} } = req.body || {};
    if (action === 'createProject') return res.status(201).json(await createProject(admin.id, payload.name));
    if (action === 'restoreProject') {
      if (!await validateAdminPassword(admin.id, payload.password)) return res.status(403).json({ error: '패스워드가 올바르지 않습니다.' });
      const name = typeof payload.name === 'string' ? payload.name.trim() : '';
      if (!name || name.length > 100) return res.status(400).json({ error: '새 프로젝트 이름은 1~100자로 입력해주세요.' });
      try { validateBackup(payload.backup); } catch { return res.status(400).json({ error: '지원하지 않거나 손상된 프로젝트 백업입니다.' }); }
      await initDb();
      return res.status(201).json(await importProject(admin.id, name, payload.backup));
    }
    if (!projectId) return res.status(400).json({ error: 'projectId가 필요합니다.' });
    if (['archiveProject', 'unarchiveProject', 'duplicateProject', 'backupProject'].includes(action)) {
      await initDb();
      const project = (await sql`SELECT id, archived_at FROM pos_projects WHERE id = ${projectId} AND admin_id = ${admin.id} FOR UPDATE`).rows[0];
      if (!project) return res.status(404).json({ error: '프로젝트를 찾을 수 없거나 접근 권한이 없습니다.' });
      if (!await validateAdminPassword(admin.id, payload.password)) return res.status(403).json({ error: '패스워드가 올바르지 않습니다.' });
      if (action === 'backupProject') {
        const backup = await snapshot(projectId);
        if (encodeURIComponent(JSON.stringify(backup)).replace(/%[0-9A-F]{2}/g, 'x').length > 3 * 1024 * 1024) return res.status(413).json({ error: '프로젝트가 백업 파일 한도(3MiB)를 초과했습니다. 별도 데이터 내보내기가 필요합니다.' });
        return res.status(200).json({ backup });
      }
      if (action === 'duplicateProject') {
        const name = typeof payload.name === 'string' ? payload.name.trim() : '';
        if (!name || name.length > 100) return res.status(400).json({ error: '새 프로젝트 이름은 1~100자로 입력해주세요.' });
        return res.status(201).json(await importProject(admin.id, name, await snapshot(projectId), true));
      }
      const archivedAt = action === 'archiveProject' ? new Date().toISOString() : null;
      await sql`UPDATE pos_projects SET archived_at = ${archivedAt}, updated_at = NOW() WHERE id = ${projectId} AND admin_id = ${admin.id}`;
      return res.status(200).json(await listProjects(admin.id));
    }
    if (action === 'renameProject' || action === 'deleteProject') {
      await initDb();
      const project = (await sql`SELECT name, archived_at FROM pos_projects WHERE id = ${projectId} AND admin_id = ${admin.id} FOR UPDATE`).rows[0];
      if (!project) return res.status(404).json({ error: '프로젝트를 찾을 수 없거나 접근 권한이 없습니다.' });
      if (action === 'renameProject') {
        if (!await validateAdminPassword(admin.id, payload.password)) return res.status(403).json({ error: '패스워드가 올바르지 않습니다.' });
        if (project.archived_at) return res.status(409).json({ error: '보관된 행사입니다. 보관을 해제한 뒤 변경해주세요.' });
        const name = typeof payload.name === 'string' ? payload.name.trim() : '';
        if (!name || name.length > 100) return res.status(400).json({ error: '프로젝트 이름은 1~100자로 입력해주세요.' });
        await sql`UPDATE pos_projects SET name = ${name}, updated_at = NOW() WHERE id = ${projectId} AND admin_id = ${admin.id}`;
      } else {
        if (!await validateAdminPassword(admin.id, payload.password)) return res.status(403).json({ error: '패스워드가 올바르지 않습니다.' });
        if (payload.confirmName !== project.name) return res.status(400).json({ error: '프로젝트 이름을 정확히 입력해주세요.' });
        // One statement: FK cascades delete products, bundles and sales atomically.
        const deleted = await sql`DELETE FROM pos_projects WHERE id = ${projectId} AND admin_id = ${admin.id} AND name = ${payload.confirmName} RETURNING id`;
        if (!deleted.rows.length) return res.status(409).json({ error: '프로젝트가 변경되었습니다. 목록을 새로고침해주세요.' });
      }
      return res.status(200).json(await listProjects(admin.id));
    }
    await initDb();
    const writable = (await sql`SELECT id, archived_at FROM pos_projects WHERE id = ${projectId} AND admin_id = ${admin.id} FOR UPDATE`).rows[0];
    if (!writable) throw new Error('프로젝트를 찾을 수 없거나 접근 권한이 없습니다.');
    if (writable.archived_at) return res.status(409).json({ error: '보관된 행사입니다. 보관을 해제한 뒤 판매·수정을 진행해주세요.' });
    if (detachedProjectIds.has(projectId)) {
      await assertProject(admin.id, projectId);
      const revision = await dataRevision(projectId);
      if (revision && req.body?.dataRevision !== revision) return res.status(409).json({ error: '행사 데이터가 분리되었습니다. 새로고침 후 다시 진행해주세요.' });
    }
    if (action === 'replaceProducts') await replaceProducts(admin.id, projectId, payload.products || []);
    else if (action === 'updateProductImage') await updateProductImage(admin.id, projectId, payload);
    else if (action === 'replaceBundles') await replaceBundles(admin.id, projectId, payload.bundles || []);
    else if (action === 'finalizeSale') await finalizeSale(admin.id, projectId, payload || {});
    else if (action === 'voidSale') await voidSale(admin.id, projectId, payload.id);
    else if (action === 'clearSales') await clearSales(admin.id, projectId, payload.password);
    else if (action === 'resetDefaults') await seedProject(admin.id, projectId);
    else if (action === 'upsertDefaults') await addMissingDefaults(admin.id, projectId);
    else return res.status(400).json({ error: '알 수 없는 작업입니다.' });
    return res.status(200).json(await readState(admin.id, projectId));
  } catch (error) {
    return res.status(error.code === '40001' ? 409 : 500).json({ error: error.code === '40001' ? '프로젝트가 변경되었습니다. 새로고침 후 다시 시도해주세요.' : error.message || '서버 오류가 발생했습니다.' });
  }
}
handler.initDb = initDb;
return handler;
}

export default async function transactionalHandler(req, res) {
  if (!requireAuth(req, res)) return;
  // Every mutation and lifecycle change shares the project's row lock until commit.
  let client;
  try {
    client = await pool.connect();
    const handler = createHandler(client.sql.bind(client));
    await handler.initDb();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    let status = 200;
    let body;
    await handler(req, { status(code) { status = code; return this; }, json(value) { body = value; return this; } });
    await client.query(status >= 400 ? 'ROLLBACK' : 'COMMIT');
    return res.status(status).json(body);
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    return res.status(error.code === '40001' ? 409 : 500).json({ error: error.code === '40001' ? '프로젝트가 변경되었습니다. 새로고침 후 다시 시도해주세요.' : '프로젝트 작업에 실패했습니다. 다시 시도해주세요.' });
  } finally { client?.release(); }
}
