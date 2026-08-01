import { sql } from '@vercel/postgres';
import { assertPostgresConnectionString, requireAuth, validateAdminPassword } from './lib/auth.js';
import { CURRENT_SEED_VERSION, getDefaultBundles, getDefaultProducts } from './lib/defaultData.js';

const uid = () => Math.random().toString(36).slice(2, 9);
const displayName = (p) => p.name || [p.vtuberName, p.goodsType, p.creatorName ? `(${p.creatorName})` : ''].filter(Boolean).join(' ') || '새 굿즈';

function normalizeProduct(p) {
  const now = new Date().toISOString();
  const productCode = p.productCode || p.id || uid();
  const stockQty = Number(p.stockQty ?? p.stock ?? 0) || 0;
  return { id: String(p.id || productCode), productCode: String(productCode), goodsType: p.goodsType || p.name || '새 굿즈', vtuberName: p.vtuberName || '', creatorName: p.creatorName || '', stockQty, initialStockQty: Number(p.initialStockQty ?? stockQty) || 0, size: p.size || null, price: Number(p.price) || 0, setCreatorName: p.setCreatorName || null, setGroupName: p.setGroupName || null, setPrice: p.setPrice == null ? null : Number(p.setPrice) || 0, setDescription: p.setDescription || null, isActive: p.isActive !== false, createdAt: p.createdAt || now, updatedAt: now };
}

async function initDb() {
  assertPostgresConnectionString();
  await sql`CREATE TABLE IF NOT EXISTS pos_projects (id TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES pos_admins(id) ON DELETE CASCADE, name TEXT NOT NULL, seed_version INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE INDEX IF NOT EXISTS pos_projects_admin_id_idx ON pos_projects(admin_id)`;
  await sql`CREATE TABLE IF NOT EXISTS pos_products (project_id TEXT NOT NULL REFERENCES pos_projects(id) ON DELETE CASCADE, id TEXT NOT NULL, name TEXT NOT NULL, price INTEGER NOT NULL, stock INTEGER NOT NULL, product_code TEXT, goods_type TEXT, vtuber_name TEXT, creator_name TEXT, stock_qty INTEGER, initial_stock_qty INTEGER, size TEXT, set_creator_name TEXT, set_group_name TEXT, set_price INTEGER, set_description TEXT, is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY(project_id, id))`;
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
  return { projects: result.rows.map((p) => ({ id: p.id, name: p.name, seedVersion: Number(p.seed_version || 0), createdAt: new Date(p.created_at).toISOString(), updatedAt: new Date(p.updated_at).toISOString() })) };
}

async function seedProject(adminId, projectId) {
  await assertProject(adminId, projectId);
  await sql`DELETE FROM pos_products WHERE project_id = ${projectId}`;
  await sql`DELETE FROM pos_bundles WHERE project_id = ${projectId}`;
  await sql`DELETE FROM pos_sales WHERE project_id = ${projectId}`;
  for (const p of getDefaultProducts()) {
    const product = normalizeProduct(p);
    await sql`INSERT INTO pos_products (project_id, id, name, price, stock, product_code, goods_type, vtuber_name, creator_name, stock_qty, initial_stock_qty, size, set_creator_name, set_group_name, set_price, set_description, is_active, created_at, updated_at) VALUES (${projectId}, ${product.id}, ${displayName(product)}, ${product.price}, ${product.stockQty}, ${product.productCode}, ${product.goodsType}, ${product.vtuberName}, ${product.creatorName}, ${product.stockQty}, ${product.initialStockQty}, ${product.size}, ${product.setCreatorName}, ${product.setGroupName}, ${product.setPrice}, ${product.setDescription}, ${product.isActive}, ${product.createdAt}, ${product.updatedAt})`;
  }
  for (const b of getDefaultBundles()) await sql`INSERT INTO pos_bundles (project_id, id, name, price, items) VALUES (${projectId}, ${b.id}, ${b.name}, ${b.price}, ${JSON.stringify(b.items)}::jsonb)`;
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
  return { products: products.rows.map((p) => ({ id: p.id, productCode: p.product_code || p.id, goodsType: p.goods_type || p.name, vtuberName: p.vtuber_name || '', creatorName: p.creator_name || '', stockQty: Number(p.stock_qty ?? p.stock ?? 0), initialStockQty: Number(p.initial_stock_qty ?? p.stock_qty ?? p.stock ?? 0), size: p.size || null, price: Number(p.price) || 0, setCreatorName: p.set_creator_name || null, setGroupName: p.set_group_name || null, setPrice: p.set_price == null ? null : Number(p.set_price) || 0, setDescription: p.set_description || null, isActive: p.is_active !== false, createdAt: new Date(p.created_at).toISOString(), updatedAt: new Date(p.updated_at).toISOString(), name: p.name, stock: Number(p.stock_qty ?? p.stock ?? 0) })), bundles: bundles.rows.map((b) => ({ ...b, items: b.items || [] })), sales: sales.rows.map((s) => ({ ...s, time: new Date(s.time).toISOString(), lines: s.lines || [] })) };
}

async function replaceProducts(adminId, projectId, products) {
  await assertProject(adminId, projectId);
  await sql`DELETE FROM pos_products WHERE project_id = ${projectId}`;
  for (const p of products) {
    const product = normalizeProduct(p);
    await sql`INSERT INTO pos_products (project_id, id, name, price, stock, product_code, goods_type, vtuber_name, creator_name, stock_qty, initial_stock_qty, size, set_creator_name, set_group_name, set_price, set_description, is_active, created_at, updated_at) VALUES (${projectId}, ${product.id}, ${displayName(product)}, ${product.price}, ${product.stockQty}, ${product.productCode}, ${product.goodsType}, ${product.vtuberName}, ${product.creatorName}, ${product.stockQty}, ${product.initialStockQty}, ${product.size}, ${product.setCreatorName}, ${product.setGroupName}, ${product.setPrice}, ${product.setDescription}, ${product.isActive}, ${product.createdAt}, ${product.updatedAt})`;
  }
  await sql`UPDATE pos_projects SET updated_at = NOW() WHERE id = ${projectId}`;
}

async function replaceBundles(adminId, projectId, bundles) {
  await assertProject(adminId, projectId);
  await sql`DELETE FROM pos_bundles WHERE project_id = ${projectId}`;
  for (const b of bundles) await sql`INSERT INTO pos_bundles (project_id, id, name, price, items) VALUES (${projectId}, ${b.id || uid()}, ${b.name || '새 세트'}, ${Number(b.price) || 0}, ${JSON.stringify(b.items || [])}::jsonb)`;
  await sql`UPDATE pos_projects SET updated_at = NOW() WHERE id = ${projectId}`;
async function updateProduct(productInput) {
  await initDb();
  const product = normalizeProduct(productInput || {});
  const result = await sql`
    UPDATE pos_products
    SET name = ${productDisplayName(product)},
        price = ${product.price},
        stock = ${product.stockQty},
        product_code = ${product.productCode},
        goods_type = ${product.goodsType},
        vtuber_name = ${product.vtuberName},
        creator_name = ${product.creatorName},
        stock_qty = ${product.stockQty},
        initial_stock_qty = ${product.initialStockQty},
        size = ${product.size},
        set_creator_name = ${product.setCreatorName},
        set_group_name = ${product.setGroupName},
        set_price = ${product.setPrice},
        set_description = ${product.setDescription},
        is_active = ${product.isActive},
        updated_at = NOW()
    WHERE id = ${product.id}
  `;
  if (result.rowCount === 0) throw new Error('수정할 상품을 찾을 수 없습니다. 새 상품은 + 굿즈 추가 후 저장해주세요.');
}

async function saveCatalog({ products = [], bundles = [] }) {
  await initDb();
  await sql`UPDATE pos_products SET is_active = FALSE, updated_at = NOW()`;
  for (const p of products) {
    const product = normalizeProduct(p);
    await sql`
      INSERT INTO pos_products (id, name, price, stock, product_code, goods_type, vtuber_name, creator_name, stock_qty, initial_stock_qty, size, set_creator_name, set_group_name, set_price, set_description, is_active, created_at, updated_at)
      VALUES (${product.id}, ${productDisplayName(product)}, ${product.price}, ${product.stockQty}, ${product.productCode}, ${product.goodsType}, ${product.vtuberName}, ${product.creatorName}, ${product.stockQty}, ${product.initialStockQty}, ${product.size}, ${product.setCreatorName}, ${product.setGroupName}, ${product.setPrice}, ${product.setDescription}, TRUE, ${product.createdAt}, ${product.updatedAt})
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          price = EXCLUDED.price,
          stock = EXCLUDED.stock,
          product_code = EXCLUDED.product_code,
          goods_type = EXCLUDED.goods_type,
          vtuber_name = EXCLUDED.vtuber_name,
          creator_name = EXCLUDED.creator_name,
          stock_qty = EXCLUDED.stock_qty,
          initial_stock_qty = EXCLUDED.initial_stock_qty,
          size = EXCLUDED.size,
          set_creator_name = EXCLUDED.set_creator_name,
          set_group_name = EXCLUDED.set_group_name,
          set_price = EXCLUDED.set_price,
          set_description = EXCLUDED.set_description,
          is_active = TRUE,
          updated_at = NOW()
    `;
  }

  await sql`DELETE FROM pos_bundles`;
  for (const b of bundles) {
    await sql`INSERT INTO pos_bundles (id, name, price, items) VALUES (${b.id || uid()}, ${b.name || '새 세트'}, ${Number(b.price) || 0}, ${JSON.stringify(b.items || [])}::jsonb)`;
  }
}

async function upsertDefaultCatalog() {
  await initDb();
  for (const p of getDefaultProducts()) {
    const product = normalizeProduct(p);
    await sql`
      INSERT INTO pos_products (id, name, price, stock, product_code, goods_type, vtuber_name, creator_name, stock_qty, initial_stock_qty, size, set_creator_name, set_group_name, set_price, set_description, is_active, created_at, updated_at)
      VALUES (${product.id}, ${productDisplayName(product)}, ${product.price}, ${product.stockQty}, ${product.productCode}, ${product.goodsType}, ${product.vtuberName}, ${product.creatorName}, ${product.stockQty}, ${product.initialStockQty}, ${product.size}, ${product.setCreatorName}, ${product.setGroupName}, ${product.setPrice}, ${product.setDescription}, ${product.isActive}, ${product.createdAt}, ${product.updatedAt})
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          price = EXCLUDED.price,
          product_code = EXCLUDED.product_code,
          goods_type = EXCLUDED.goods_type,
          vtuber_name = EXCLUDED.vtuber_name,
          creator_name = EXCLUDED.creator_name,
          initial_stock_qty = EXCLUDED.initial_stock_qty,
          size = EXCLUDED.size,
          set_creator_name = EXCLUDED.set_creator_name,
          set_group_name = EXCLUDED.set_group_name,
          set_price = EXCLUDED.set_price,
          set_description = EXCLUDED.set_description,
          is_active = TRUE,
          updated_at = NOW()
    `;
  }
  for (const b of getDefaultBundles()) {
    await sql`
      INSERT INTO pos_bundles (id, name, price, items)
      VALUES (${b.id}, ${b.name}, ${b.price}, ${JSON.stringify(b.items)}::jsonb)
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          price = EXCLUDED.price,
          items = EXCLUDED.items
    `;
  }
  await sql`INSERT INTO pos_meta (key, value) VALUES ('seed_version', ${String(CURRENT_SEED_VERSION)}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
}

async function replaceBundles(bundles) {
  await initDb();
  await sql`DELETE FROM pos_bundles`;
  for (const b of bundles) {
    await sql`INSERT INTO pos_bundles (id, name, price, items) VALUES (${b.id || uid()}, ${b.name || '새 세트'}, ${Number(b.price) || 0}, ${JSON.stringify(b.items || [])}::jsonb)`;
  }
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
    const product = products.find((p) => p.id === productId);
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
}

export default async function handler(req, res) {
  const admin = requireAuth(req, res);
  if (!admin) return;
  try {
    const projectId = req.query?.projectId || req.body?.projectId || req.body?.payload?.projectId;
    if (req.method === 'GET') return res.status(200).json(projectId ? await readState(admin.id, projectId) : await listProjects(admin.id));
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { action, payload } = req.body || {};
    if (!action && Array.isArray(req.body?.items)) await finalizeExternalSale(req.body);
    else if (action === 'replaceProducts') await replaceProducts(payload?.products || []);
    else if (action === 'updateProduct') await updateProduct(payload?.product);
    else if (action === 'saveCatalog') await saveCatalog(payload || {});
    else if (action === 'replaceBundles') await replaceBundles(payload?.bundles || []);
    else if (action === 'finalizeSale') await finalizeSale(payload || {});
    else if (action === 'voidSale') await voidSale(payload?.id);
    else if (action === 'clearSales') await clearSales(payload?.password);
    else if (action === 'upsertDefaults') await upsertDefaultCatalog();
    else if (action === 'resetDefaults') { await replaceProducts(getDefaultProducts()); await replaceBundles(getDefaultBundles()); }
    else return res.status(400).json({ error: '알 수 없는 작업입니다.' });
    return res.status(200).json(await readState(admin.id, projectId));
  } catch (error) {
    return res.status(500).json({ error: error.message || '서버 오류가 발생했습니다.' });
  }
}