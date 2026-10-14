import { sql } from '@vercel/postgres';
import { assertPostgresConnectionString, requireAuth, validateAdminPassword } from './lib/auth.js';
import { CURRENT_SEED_VERSION, getDefaultBundles, getDefaultProducts } from './lib/defaultData.js';

const uid = () => Math.random().toString(36).slice(2, 9);
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

async function initDb() {
  assertPostgresConnectionString();
  await sql`CREATE TABLE IF NOT EXISTS pos_projects (id TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES pos_admins(id) ON DELETE CASCADE, name TEXT NOT NULL, seed_version INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE INDEX IF NOT EXISTS pos_projects_admin_id_idx ON pos_projects(admin_id)`;
  await sql`CREATE TABLE IF NOT EXISTS pos_products (project_id TEXT NOT NULL REFERENCES pos_projects(id) ON DELETE CASCADE, id TEXT NOT NULL, name TEXT NOT NULL, price INTEGER NOT NULL, stock INTEGER NOT NULL, product_code TEXT, goods_type TEXT, vtuber_name TEXT, creator_name TEXT, stock_qty INTEGER, initial_stock_qty INTEGER, size TEXT, set_creator_name TEXT, set_group_name TEXT, set_price INTEGER, set_description TEXT, is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY(project_id, id))`;
  await sql`ALTER TABLE pos_products ADD COLUMN IF NOT EXISTS image_url TEXT`;
  await sql`CREATE TABLE IF NOT EXISTS pos_bundles (project_id TEXT NOT NULL REFERENCES pos_projects(id) ON DELETE CASCADE, id TEXT NOT NULL, name TEXT NOT NULL, price INTEGER NOT NULL, items JSONB NOT NULL, PRIMARY KEY(project_id, id))`;
  await sql`CREATE TABLE IF NOT EXISTS pos_sales (project_id TEXT NOT NULL REFERENCES pos_projects(id) ON DELETE CASCADE, id TEXT NOT NULL, time TIMESTAMPTZ NOT NULL, method TEXT NOT NULL, total INTEGER NOT NULL, lines JSONB NOT NULL, PRIMARY KEY(project_id, id))`;
  await sql`CREATE INDEX IF NOT EXISTS pos_sales_project_time_idx ON pos_sales(project_id, time)`;
}

async function assertProject(adminId, projectId) {
  await initDb();
  const project = (await sql`SELECT id FROM pos_projects WHERE id = ${projectId} AND admin_id = ${adminId}`).rows[0];
  if (!project) throw new Error('프로젝트를 찾을 수 없거나 접근 권한이 없습니다.');
}

async function listProjects(adminId) {
  await initDb();
  const result = await sql`SELECT id, name, seed_version, created_at, updated_at FROM pos_projects WHERE admin_id = ${adminId} ORDER BY updated_at DESC, created_at DESC`;
  return { projects: result.rows.map((project) => ({ id: project.id, name: project.name, seedVersion: Number(project.seed_version || 0), createdAt: new Date(project.created_at).toISOString(), updatedAt: new Date(project.updated_at).toISOString() })) };
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
  await seedProject(adminId, id);
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

export default async function handler(req, res) {
  const admin = requireAuth(req, res);
  if (!admin) return;
  try {
    const projectId = req.query?.projectId || req.body?.projectId || req.body?.payload?.projectId;
    if (req.method === 'GET') return res.status(200).json(projectId ? await readState(admin.id, projectId) : await listProjects(admin.id));
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { action, payload = {} } = req.body || {};
    if (action === 'createProject') return res.status(201).json(await createProject(admin.id, payload.name));
    if (!projectId) return res.status(400).json({ error: 'projectId가 필요합니다.' });
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
    return res.status(500).json({ error: error.message || '서버 오류가 발생했습니다.' });
  }
}
