import { sql as pool } from '@vercel/postgres';
import { assertPostgresConnectionString, requireAuth, validateAdminPassword } from './lib/auth.js';
import { CURRENT_SEED_VERSION, getDefaultBundles, getDefaultProducts } from './lib/defaultData.js';

export function createHandler(sql) {
const uid = () => globalThis.crypto.randomUUID();
const detachedProjectIds = new Set(['pxwiu2t', 's4fjgga']);
const displayName = (product) => product.name || [product.vtuberName, product.goodsType, product.creatorName ? `(${product.creatorName})` : ''].filter(Boolean).join(' ') || '새 굿즈';

function normalizeProduct(product = {}) {
  if (product.genre != null && (typeof product.genre !== 'string' || product.genre.length > 200)) throw Object.assign(new Error('장르는 200자 이내로 입력해주세요.'), { status: 400 });
  const now = new Date().toISOString();
  const productCode = product.productCode || product.id || uid();
  const stockQty = Number(product.stockQty ?? product.stock ?? 0) || 0;
  return {
    id: String(product.id || productCode),
    name: displayName(product),
    productCode: String(productCode),
    goodsType: product.goodsType || product.name || '새 굿즈',
    vtuberName: product.vtuberName || '',
    creatorName: product.creatorName || '',
    genre: product.genre == null ? null : product.genre.trim(),
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
  await sql`ALTER TABLE pos_products ADD COLUMN IF NOT EXISTS genre TEXT`;
  await sql`ALTER TABLE pos_products ADD COLUMN IF NOT EXISTS sale_number INTEGER CHECK (sale_number > 0)`;
  await sql`CREATE TABLE IF NOT EXISTS pos_bundles (project_id TEXT NOT NULL REFERENCES pos_projects(id) ON DELETE CASCADE, id TEXT NOT NULL, name TEXT NOT NULL, price INTEGER NOT NULL, items JSONB NOT NULL, PRIMARY KEY(project_id, id))`;
  await sql`CREATE TABLE IF NOT EXISTS pos_sales (project_id TEXT NOT NULL REFERENCES pos_projects(id) ON DELETE CASCADE, id TEXT NOT NULL, time TIMESTAMPTZ NOT NULL, method TEXT NOT NULL, total INTEGER NOT NULL, lines JSONB NOT NULL, PRIMARY KEY(project_id, id))`;
  await sql`CREATE TABLE IF NOT EXISTS pos_sale_receipts (
    project_id TEXT NOT NULL REFERENCES pos_projects(id) ON DELETE CASCADE,
    id TEXT NOT NULL, voided BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY(project_id, id)
  )`;
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
  await initInventory();
  initialized = true;
}

// Warehouse quantities are independent of event stock. Allocation is a transfer,
// so offline event sales never compete for an unreserved shared quantity.
async function initInventory() {
  await sql`CREATE TABLE IF NOT EXISTS pos_inventory (
    admin_id TEXT NOT NULL REFERENCES pos_admins(id) ON DELETE CASCADE,
    id TEXT NOT NULL, product JSONB NOT NULL, stock INTEGER NOT NULL CHECK (stock >= 0),
    version INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(admin_id, id))`;
  await sql`ALTER TABLE pos_inventory ADD COLUMN IF NOT EXISTS product_number TEXT, ADD COLUMN IF NOT EXISTS total_received BIGINT CHECK (total_received >= 0), ADD COLUMN IF NOT EXISTS total_estimated BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS pos_inventory_product_number_unique ON pos_inventory(product_number)`;
  await sql`CREATE TABLE IF NOT EXISTS pos_inventory_numbers (
    admin_id TEXT PRIMARY KEY REFERENCES pos_admins(id) ON DELETE CASCADE,
    prefix TEXT NOT NULL UNIQUE CHECK (prefix ~ '^[A-Z]{3}$'), last_number INTEGER NOT NULL DEFAULT 0 CHECK (last_number BETWEEN 0 AND 9999))`;
  await sql`CREATE TABLE IF NOT EXISTS pos_inventory_adjustments (
    admin_id TEXT NOT NULL, inventory_id TEXT NOT NULL, id TEXT PRIMARY KEY,
    delta INTEGER NOT NULL, reason TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY(admin_id,inventory_id) REFERENCES pos_inventory(admin_id,id) ON DELETE CASCADE)`;
  await sql`CREATE TABLE IF NOT EXISTS pos_inventory_links (
    project_id TEXT NOT NULL REFERENCES pos_projects(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL, admin_id TEXT NOT NULL, inventory_id TEXT NOT NULL,
    PRIMARY KEY(project_id, product_id), UNIQUE(project_id, inventory_id),
    FOREIGN KEY(admin_id, inventory_id) REFERENCES pos_inventory(admin_id, id))`;
  await sql`CREATE INDEX IF NOT EXISTS pos_inventory_links_owner_idx ON pos_inventory_links(admin_id,inventory_id)`;
  await sql`CREATE TABLE IF NOT EXISTS pos_inventory_transfers (
    admin_id TEXT NOT NULL REFERENCES pos_admins(id) ON DELETE CASCADE,
    id TEXT NOT NULL, request JSONB NOT NULL, PRIMARY KEY(admin_id, id))`;
}

async function nextInventoryNumber(adminId) {
  let counter = (await sql`SELECT prefix FROM pos_inventory_numbers WHERE admin_id=${adminId}`).rows[0];
  for (let attempt = 0; !counter && attempt < 100; attempt++) {
    const random = uid().replaceAll('-', '').slice(0, 6);
    const prefix = [0,2,4].map(i => String.fromCharCode(65 + parseInt(random.slice(i,i+2),16) % 26)).join('');
    counter = (await sql`INSERT INTO pos_inventory_numbers (admin_id,prefix) VALUES (${adminId},${prefix}) ON CONFLICT DO NOTHING RETURNING prefix`).rows[0];
  }
  if (!counter) throw Object.assign(new Error('상품 번호 접두사를 발급하지 못했습니다. 다시 시도해주세요.'), { status: 409 });
  const row = (await sql`UPDATE pos_inventory_numbers SET last_number=last_number+1 WHERE admin_id=${adminId} AND last_number<9999 RETURNING prefix,last_number`).rows[0];
  if (!row) throw Object.assign(new Error('계정 상품 번호 한도(9999개)에 도달했습니다.'), { status: 409 });
  return `${row.prefix}_${String(row.last_number).padStart(4,'0')}`;
}

async function inventoryState(adminId) {
  // Called only with the account and its project rows locked in the request transaction.
  // Preserve existing event quantities and IDs. Never merge matching names or
  // product codes from independent events, and never count them twice in storage.
  await sql`INSERT INTO pos_inventory (admin_id,id,product,stock)
    SELECT e.admin_id, 'legacy:' || length(p.project_id)::text || ':' || p.project_id || p.id,
      jsonb_build_object('name',p.name,'price',p.price,'goodsType',COALESCE(p.goods_type,p.name),
        'creatorName',COALESCE(p.creator_name,''),'vtuberName',COALESCE(p.vtuber_name,''),'genre',COALESCE(p.genre,''),'imageUrl',p.image_url,'createdAt',COALESCE(p.created_at,NOW())), 0
    FROM pos_products p JOIN pos_projects e ON e.id=p.project_id
    WHERE e.admin_id=${adminId} AND NOT EXISTS (SELECT 1 FROM pos_inventory_links l WHERE l.project_id=p.project_id AND l.product_id=p.id)
    ON CONFLICT (admin_id,id) DO NOTHING`;
  await sql`INSERT INTO pos_inventory_links (project_id,product_id,admin_id,inventory_id)
    SELECT p.project_id,p.id,e.admin_id,'legacy:' || length(p.project_id)::text || ':' || p.project_id || p.id
    FROM pos_products p JOIN pos_projects e ON e.id=p.project_id
    WHERE e.admin_id=${adminId} AND NOT EXISTS (SELECT 1 FROM pos_inventory_links l WHERE l.project_id=p.project_id AND l.product_id=p.id)
    ON CONFLICT DO NOTHING`;
  const items = await sql`SELECT * FROM pos_inventory WHERE admin_id = ${adminId} ORDER BY id`;
  const allocations = await sql`SELECT l.inventory_id, l.product_id, p.project_id,
    e.name AS event_name, e.archived_at, (SELECT revision FROM pos_event_archives WHERE project_id=p.project_id) AS data_revision, COALESCE(p.is_active, TRUE) AS is_active, COALESCE(p.stock_qty,p.stock) AS stock, COALESCE(p.initial_stock_qty,p.stock_qty,p.stock) AS initial_stock
    FROM pos_inventory_links l JOIN pos_products p ON p.project_id=l.project_id AND p.id=l.product_id
    JOIN pos_projects e ON e.id=l.project_id AND e.admin_id=l.admin_id
    WHERE l.admin_id = ${adminId} ORDER BY p.project_id, p.id`;
  const sales = (await sql`SELECT s.project_id,s.lines FROM pos_sales s JOIN pos_projects e ON e.id=s.project_id WHERE e.admin_id=${adminId}`).rows;
  const bundles = (await sql`SELECT b.project_id,b.id,b.items FROM pos_bundles b JOIN pos_projects e ON e.id=b.project_id WHERE e.admin_id=${adminId}`).rows;
  const sold = new Map();
  const addSold = (projectId, productId, qty, estimated = false) => {
    if (!Number.isSafeInteger(qty) || qty <= 0) return;
    const key = JSON.stringify([projectId,productId]);
    const previous = sold.get(key) || { qty: 0, estimated: false };
    sold.set(key, { qty: previous.qty + qty, estimated: previous.estimated || estimated });
  };
  const incompleteEvents = new Set();
  for (const sale of sales) for (const line of sale.lines || []) {
    if (line.type === 'product') addSold(sale.project_id,line.id,Number(line.qty));
    if (line.type === 'bundle') {
      const components = line.subItems || bundles.find(b => b.project_id === sale.project_id && b.id === line.id)?.items;
      if (!components) incompleteEvents.add(sale.project_id);
      for (const component of components || []) addSold(sale.project_id,component.productId,Number(component.qty)*Number(line.qty),!line.subItems);
    }
  }
  const inventory = [];
  for (const row of items.rows) {
    // Legacy imports may have initial_stock=0 despite remaining stock/sales.
    // Establish the assignment baseline without changing physical quantities.
    const linked = allocations.rows.filter(a => a.inventory_id === row.id).map(a => ({ ...a,
      initial_stock: Math.max(Number(a.initial_stock), Number(a.stock) + (sold.get(JSON.stringify([a.project_id,a.product_id]))?.qty || 0)) }));
    const remaining = Number(row.stock) + linked.reduce((sum,a) => sum + Number(a.stock),0);
    const history = linked.map(a => ({ projectId: a.project_id, eventName: a.event_name, productId: a.product_id,
      soldQty: sold.get(JSON.stringify([a.project_id,a.product_id]))?.qty || 0,
      estimated: sold.get(JSON.stringify([a.project_id,a.product_id]))?.estimated || incompleteEvents.has(a.project_id) }));
    let totalEstimated = row.total_estimated;
    let totalReceived = row.total_received == null ? null : Number(row.total_received);
    if (totalReceived == null) {
      // Old records have no receipt ledger. Preserve the highest known opening
      // quantity or remaining + recorded sales, without inventing lost history.
      totalReceived = Math.max(remaining + history.reduce((sum,h) => sum+h.soldQty,0), Number(row.stock) + linked.reduce((sum,a) => sum+Number(a.initial_stock),0));
      totalEstimated = true;
      await sql`UPDATE pos_inventory SET total_received=${totalReceived},total_estimated=TRUE WHERE admin_id=${adminId} AND id=${row.id}`;
    }
    let productNumber = row.product_number;
    if (!productNumber) {
      productNumber = await nextInventoryNumber(adminId);
      await sql`UPDATE pos_inventory SET product_number=${productNumber} WHERE admin_id=${adminId} AND id=${row.id}`;
    }
    if (row.product.removedAt) continue;
    inventory.push({ ...row.product, id: row.id, productNumber, genre: row.product.genre || '', stock: row.stock, version: row.version,
      totalReceived, totalEstimated, totalStock: Number(row.stock) + linked.reduce((sum,a) => sum + Number(a.initial_stock),0), remainingStock: remaining, history, allocations: linked.map(row => ({ ...row, data_revision: detachedProjectIds.has(row.project_id) ? row.data_revision : null })) });
  }
  const inventoryEvents = (await sql`SELECT e.id,e.name,e.archived_at,(SELECT revision FROM pos_event_archives WHERE project_id=e.id) AS data_revision FROM pos_projects e WHERE e.admin_id=${adminId} ORDER BY e.created_at,e.id`).rows;
  return { inventory, inventoryEvents: inventoryEvents.map(event => ({ ...event, data_revision: detachedProjectIds.has(event.id) ? event.data_revision : null })) };
}

function inventoryInteger(value, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum || value > 2147483647) throw Object.assign(new Error('수량·가격은 허용 범위의 정수로 입력해주세요.'), { status: 400 });
  return value;
}

async function syncCommonProduct(adminId, inventoryId, product) {
  await sql`UPDATE pos_products p SET name=${product.name},goods_type=${product.goodsType || product.name},vtuber_name=${product.vtuberName || ''},creator_name=${product.creatorName || ''},genre=${product.genre || ''},image_url=${product.imageUrl || null},updated_at=NOW()
    FROM pos_inventory_links l WHERE l.admin_id=${adminId} AND l.inventory_id=${inventoryId} AND p.project_id=l.project_id AND p.id=l.product_id`;
  await sql`UPDATE pos_projects SET updated_at=NOW() WHERE admin_id=${adminId} AND id IN (SELECT project_id FROM pos_inventory_links WHERE admin_id=${adminId} AND inventory_id=${inventoryId})`;
}

async function inventoryAction(adminId, action, payload) {
  await initDb();
  // Serializes warehouse edits/transfers within one account; event mutations
  // also take their existing project lock. Serialization failures return 409.
  await sql`SELECT id FROM pos_admins WHERE id = ${adminId} FOR UPDATE`;
  await sql`SELECT id FROM pos_projects WHERE admin_id=${adminId} ORDER BY id FOR UPDATE`;
  if (action === 'removeInventory') {
    if (typeof payload.inventoryId !== 'string' || !payload.inventoryId || payload.inventoryId.length > 500) throw Object.assign(new Error('올바른 재고 상품을 선택해주세요.'), { status: 400 });
    const row = (await sql`SELECT * FROM pos_inventory WHERE admin_id=${adminId} AND id=${payload.inventoryId}`).rows[0];
    if (!row) throw Object.assign(new Error('재고를 찾을 수 없습니다.'), { status: 404 });
    if (row.product.removedAt) return inventoryState(adminId);
    if (row.version !== payload.version) throw Object.assign(new Error('재고가 변경되었습니다. 최신 정보를 불러와주세요.'), { status: 409 });
    if (action === 'removeInventory') {
      const active = await sql`SELECT p.id FROM pos_inventory_links l
        JOIN pos_products p ON p.project_id=l.project_id AND p.id=l.product_id
        JOIN pos_projects e ON e.id=l.project_id AND e.admin_id=l.admin_id
        WHERE l.admin_id=${adminId} AND l.inventory_id=${payload.inventoryId}
          AND e.archived_at IS NULL AND COALESCE(p.is_active, TRUE)=TRUE`;
      if (active.rows.length) throw Object.assign(new Error('활성 행사에 등록된 상품이 있습니다. 아래 행사 상품 관리에서 먼저 제거한 뒤 재고 상품을 삭제해주세요.'), { status: 409 });
    }
    const product = { ...row.product, removedAt: new Date().toISOString() };
    await sql`UPDATE pos_inventory SET product=${JSON.stringify(product)}::jsonb,version=version+1 WHERE admin_id=${adminId} AND id=${payload.inventoryId}`;
    return inventoryState(adminId);
  }
  if (action === 'saveEventProduct' || action === 'saveCommonProductImage') {
    const { projectId, productId } = payload;
    if (typeof projectId !== 'string' || !projectId || typeof productId !== 'string' || !productId || productId.length > 500) throw Object.assign(new Error('행사와 상품을 선택해주세요.'), { status: 400 });
    const project = (await sql`SELECT id,archived_at FROM pos_projects WHERE id=${projectId} AND admin_id=${adminId}`).rows[0];
    if (!project) throw Object.assign(new Error('행사 접근 권한이 없습니다.'), { status: 404 });
    if (project.archived_at) throw Object.assign(new Error('보관된 행사에서는 수정할 수 없습니다.'), { status: 409 });
    const revision = await dataRevision(projectId);
    if (revision && payload.dataRevision !== revision) throw Object.assign(new Error('행사 데이터가 변경되었습니다. 새로고침해주세요.'), { status: 409 });
    const priorLink = (await sql`SELECT inventory_id FROM pos_inventory_links WHERE admin_id=${adminId} AND project_id=${projectId} AND product_id=${productId}`).rows[0];
    if (!priorLink) await inventoryState(adminId);
    const row = (await sql`SELECT i.* FROM pos_inventory i JOIN pos_inventory_links l ON l.inventory_id=i.id AND l.admin_id=i.admin_id JOIN pos_products p ON p.id=l.product_id AND p.project_id=l.project_id WHERE i.admin_id=${adminId} AND l.project_id=${projectId} AND l.product_id=${productId} AND COALESCE(p.is_active,TRUE)=TRUE`).rows[0];
    if (!row || row.product.removedAt) throw Object.assign(new Error('공통 상품을 찾을 수 없습니다. 공통 상품·재고 관리를 먼저 열고 다시 시도해주세요.'), { status: 409 });
    if (action === 'saveEventProduct' && row.version !== payload.inventoryVersion && !(!priorLink && payload.inventoryVersion == null && row.version === 0)) throw Object.assign(new Error('공통 상품이 변경되었습니다. 최신 정보를 불러와주세요.'), { status: 409 });
    let product;
    if (action === 'saveCommonProductImage') {
      await updateProductImage(adminId, projectId, { productId, imageUrl: payload.imageUrl });
      product = { ...row.product, imageUrl: payload.imageUrl || null };
    } else {
      const input = payload.product || {};
      for (const key of ['name','goodsType','vtuberName','creatorName','genre']) if (typeof input[key] !== 'string' || input[key].length > 200 || (['name','goodsType'].includes(key) && !input[key].trim())) throw Object.assign(new Error('상품 이름과 굿즈 종류는 필수이며 각 항목은200자 이내여야 합니다.'), { status: 400 });
      const price = inventoryInteger(input.price);
      product = { ...row.product, ...Object.fromEntries(['name','goodsType','vtuberName','creatorName','genre'].map(key => [key,input[key].trim()])) };
      await sql`UPDATE pos_products SET price=${price} WHERE project_id=${projectId} AND id=${productId}`;
    }
    await sql`UPDATE pos_inventory SET product=${JSON.stringify(product)}::jsonb,version=version+1 WHERE admin_id=${adminId} AND id=${row.id}`;
    await syncCommonProduct(adminId, row.id, product);
    return readState(adminId, projectId);
  }
  if (action === 'createEventProduct') {
    const { projectId, product: input = {} } = payload;
    if (typeof projectId !== 'string' || !projectId) throw Object.assign(new Error('행사를 선택해주세요.'), { status: 400 });
    const project = (await sql`SELECT id, archived_at FROM pos_projects WHERE id=${projectId} AND admin_id=${adminId}`).rows[0];
    if (!project) throw Object.assign(new Error('행사 접근 권한이 없습니다.'), { status: 404 });
    if (project.archived_at) throw Object.assign(new Error('보관된 행사에는 상품을 등록할 수 없습니다.'), { status: 409 });
    const revision = await dataRevision(projectId);
    if (revision && payload.dataRevision !== revision) throw Object.assign(new Error('행사 데이터가 분리되었습니다. 새로고침 후 다시 진행해주세요.'), { status: 409 });
    if (typeof input.id !== 'string' || !input.id || input.id.length > 200) throw Object.assign(new Error('잘못된 등록 요청 ID입니다.'), { status: 400 });
    for (const key of ['name', 'goodsType', 'vtuberName', 'creatorName', 'genre']) {
      if (typeof input[key] !== 'string' || input[key].length > 200 || (['name', 'goodsType'].includes(key) && !input[key].trim())) throw Object.assign(new Error('상품 이름과 굿즈 종류는 필수이며 각 항목은 200자 이내로 입력해주세요.'), { status: 400 });
    }
    const stock = inventoryInteger(input.stockQty);
    const price = inventoryInteger(input.price);
    const product = { id: input.id, name: input.name.trim(), goodsType: input.goodsType.trim(), vtuberName: input.vtuberName.trim(), creatorName: input.creatorName.trim(), genre: input.genre.trim(), stockQty: stock, price };
    const request = { action, projectId, product };
    const requestId = `create-event-product:${input.id}`;
    const receipt = (await sql`SELECT request FROM pos_inventory_transfers WHERE admin_id=${adminId} AND id=${requestId}`).rows[0];
    if (receipt) {
      const previous = receipt.request;
      if (previous.action !== action || previous.projectId !== projectId || Object.keys(product).some(key => previous.product?.[key] !== product[key])) throw Object.assign(new Error('이미 처리된 등록 요청과 내용이 다릅니다.'), { status: 409 });
      return readState(adminId, projectId);
    }
    if ((await sql`SELECT id FROM pos_inventory WHERE admin_id=${adminId} AND id=${input.id}`).rows.length || (await sql`SELECT id FROM pos_products WHERE project_id=${projectId} AND id=${input.id}`).rows.length) throw Object.assign(new Error('이미 사용 중인 상품 ID입니다.'), { status: 409 });
    await inventoryAction(adminId, 'saveInventory', { product: { ...product, price: 0, stock, version: -1 } });
    const original = (await sql`SELECT product FROM pos_inventory WHERE admin_id=${adminId} AND id=${input.id}`).rows[0].product;
    await insertProduct(projectId, { ...product, createdAt: original.createdAt, initialStockQty: stock });
    await sql`INSERT INTO pos_inventory_links (project_id,product_id,admin_id,inventory_id) VALUES (${projectId},${input.id},${adminId},${input.id})`;
    await sql`UPDATE pos_inventory SET stock=0 WHERE admin_id=${adminId} AND id=${input.id}`;
    await sql`INSERT INTO pos_inventory_transfers (admin_id,id,request) VALUES (${adminId},${requestId},${JSON.stringify(request)}::jsonb)`;
    await sql`UPDATE pos_projects SET updated_at=NOW() WHERE id=${projectId}`;
    return readState(adminId, projectId);
  }
  if (action === 'saveInventory') {
    const input = payload.product || {};
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200) throw Object.assign(new Error('상품 이름을 입력해주세요. (최대 200자)'), { status: 400 });
    const submittedPrice = input.price == null ? null : inventoryInteger(input.price);
    let stock = inventoryInteger(input.stock);
    if (input.id != null && (typeof input.id !== 'string' || !input.id || input.id.length > 500)) throw Object.assign(new Error('잘못된 상품 ID입니다.'), { status: 400 });
    const id = input.id || uid();
    const old = (await sql`SELECT * FROM pos_inventory WHERE admin_id=${adminId} AND id=${id}`).rows[0];
    if (old?.product?.removedAt) throw Object.assign(new Error('제거된 재고는 수정할 수 없습니다.'), { status: 409 });
    if (input.id && (old ? old.version !== input.version : input.version !== -1)) throw Object.assign(new Error('재고가 변경되었습니다. 새로고침해주세요.'), { status: 409 });
    const price = submittedPrice ?? old?.product?.price ?? 0;
    if (input.genre != null && (typeof input.genre !== 'string' || input.genre.length > 200)) throw Object.assign(new Error('장르는 200자 이내로 입력해주세요.'), { status: 400 });
    const genre = (input.genre ?? old?.product?.genre ?? '').trim();
    const product = { genre, createdAt: old ? old.product.createdAt || null : new Date().toISOString(), imageUrl: old?.product?.imageUrl || null, name: input.name.trim(), price, goodsType: String(input.goodsType || input.name).slice(0,200), creatorName: String(input.creatorName || '').slice(0,200), vtuberName: String(input.vtuberName || '').slice(0,200) };
    // Initialize old totals/numbers before applying a stock delta.
    await inventoryState(adminId);
    if (old) {
      const baseline = (await sql`SELECT total_received FROM pos_inventory WHERE admin_id=${adminId} AND id=${id}`).rows[0];
      if (payload.allocationPlan) {
        const plan = payload.allocationPlan;
        const totalStock = inventoryInteger(plan.totalStock);
        const current = (await inventoryState(adminId)).inventory.find(item => item.id === id);
        if (!Array.isArray(plan.allocations) || plan.allocations.length < current.allocations.length) throw Object.assign(new Error('행사 연결이 변경되었습니다. 새로고침 후 다시 수정해주세요.'), { status: 409 });
        const seen = new Set();
        let assigned = 0;
        const changes = [];
        for (const entry of plan.allocations) {
          if (!entry || typeof entry.projectId !== 'string' || (entry.productId !== null && typeof entry.productId !== 'string')) throw Object.assign(new Error('잘못된 행사 배정 목록입니다.'), { status: 400 });
          const key = JSON.stringify([entry.projectId,entry.productId]);
          let row = current.allocations.find(row => row.project_id === entry.projectId && row.product_id === entry.productId);
          if (!row && entry.productId === null) {
            const event = (await sql`SELECT id,name,archived_at FROM pos_projects WHERE admin_id=${adminId} AND id=${entry.projectId}`).rows[0];
            if (event && !current.allocations.some(a => a.project_id === entry.projectId)) row = { project_id: event.id, product_id: null, archived_at: event.archived_at, stock: 0, initial_stock: 0 };
          }
          if (!row || seen.has(key)) throw Object.assign(new Error('잘못된 행사 배정 목록입니다.'), { status: 400 });
          seen.add(key);
          // A sale/void does not increment the inventory version. Compare event
          // quantities as well, under the same project locks used by checkout.
          if (entry.stock !== Number(row.stock) || entry.initialStock !== Number(row.initial_stock) || (entry.dataRevision ?? null) !== (await dataRevision(row.project_id))) throw Object.assign(new Error('행사 재고 또는 판매 내역이 변경되었습니다. 새로고침 후 다시 수정해주세요.'), { status: 409 });
          const quantity = inventoryInteger(entry.quantity);
          const sold = current.history.find(h => h.projectId === row.project_id && h.productId === row.product_id)?.soldQty || 0;
          const delta = quantity - Number(row.initial_stock);
          if (quantity < sold || Number(row.stock) + delta < 0) throw Object.assign(new Error('행사 배정 수량은 이미 판매·차감한 수량보다 적을 수 없습니다.'), { status: 400 });
          if (row.archived_at && delta > 0) throw Object.assign(new Error('보관된 행사의 배정 수량은 늘릴 수 없습니다.'), { status: 409 });
          assigned += quantity;
          changes.push({ row, quantity, delta });
        }
        if (current.allocations.some(row => !seen.has(JSON.stringify([row.project_id,row.product_id])))) throw Object.assign(new Error('행사 연결이 변경되었습니다. 새로고침해주세요.'), { status: 409 });
        if (assigned > totalStock) throw Object.assign(new Error('행사 배정 수량 합계가 총재고를 초과합니다.'), { status: 400 });
        stock = totalStock - assigned;
        const totalDelta = totalStock - current.totalStock;
        // Lifetime receipts are never reduced by a total correction or transfer.
        const totalReceived = Number(baseline.total_received) + Math.max(0,totalDelta);
        inventoryInteger(totalReceived);
        for (const { row, quantity, delta } of changes) {
          if (!delta) continue;
          const remaining = inventoryInteger(Number(row.stock) + delta);
          if (row.product_id === null) {
            row.product_id = uid();
            await insertProduct(row.project_id, { ...product, id: row.product_id, price: 1000, stockQty: 0, initialStockQty: 0 });
            await sql`INSERT INTO pos_inventory_links (project_id,product_id,admin_id,inventory_id) VALUES (${row.project_id},${row.product_id},${adminId},${id})`;
          }
          await sql`UPDATE pos_products SET stock=${remaining},stock_qty=${remaining},initial_stock_qty=${quantity},updated_at=NOW() WHERE project_id=${row.project_id} AND id=${row.product_id}`;
          await sql`UPDATE pos_projects SET updated_at=NOW() WHERE id=${row.project_id} AND admin_id=${adminId}`;
          const request = { action: 'allocationPlan', projectId: row.project_id, inventoryId: id, direction: delta > 0 ? 'allocate' : 'return', qty: Math.abs(delta) };
          await sql`INSERT INTO pos_inventory_transfers (admin_id,id,request) VALUES (${adminId},${uid()},${JSON.stringify(request)}::jsonb)`;
        }
        await sql`UPDATE pos_inventory SET product=${JSON.stringify(product)}::jsonb,stock=${stock},total_received=${totalReceived},version=version+1 WHERE admin_id=${adminId} AND id=${id}`;
        if (totalDelta) await sql`INSERT INTO pos_inventory_adjustments (admin_id,inventory_id,id,delta,reason) VALUES (${adminId},${id},${uid()},${totalDelta},${totalDelta > 0 ? 'receipt' : 'correction'})`;
        await syncCommonProduct(adminId, id, product);
        return inventoryState(adminId);
      }
      const delta = stock - Number(old.stock);
      const reason = payload.stockChangeType || (delta > 0 ? 'receipt' : 'correction');
      if (delta && (!['receipt','loss','disposal','correction'].includes(reason) || (reason === 'receipt' && delta < 0) || (['loss','disposal'].includes(reason) && delta > 0))) throw Object.assign(new Error('수량 변경 방향에 맞는 입고·분실·폐기·정정 사유를 선택해주세요.'), { status: 400 });
      const total = Number(baseline.total_received) + (delta > 0 && reason === 'receipt' ? delta : 0);
      const allocated = (await sql`SELECT COALESCE(SUM(COALESCE(p.stock_qty,p.stock)),0) AS qty FROM pos_products p JOIN pos_inventory_links l ON l.project_id=p.project_id AND l.product_id=p.id WHERE l.admin_id=${adminId} AND l.inventory_id=${id}`).rows[0];
      if (stock + Number(allocated.qty) > total) throw Object.assign(new Error('남은재고가 누적 입고보다 많습니다. 추가 입고로 반영해주세요.'), { status: 400 });
      await sql`UPDATE pos_inventory SET product=${JSON.stringify(product)}::jsonb, stock=${stock},total_received=${total},version=version+1 WHERE admin_id=${adminId} AND id=${id}`;
      if (delta) await sql`INSERT INTO pos_inventory_adjustments (admin_id,inventory_id,id,delta,reason) VALUES (${adminId},${id},${uid()},${delta},${reason})`;
    } else {
      const productNumber = await nextInventoryNumber(adminId);
      await sql`INSERT INTO pos_inventory (admin_id,id,product,stock,total_received,product_number) VALUES (${adminId},${id},${JSON.stringify(product)}::jsonb,${stock},${stock},${productNumber})`;
      if (stock) await sql`INSERT INTO pos_inventory_adjustments (admin_id,inventory_id,id,delta,reason) VALUES (${adminId},${id},${uid()},${stock},'receipt')`;
    }
    await syncCommonProduct(adminId, id, product);
  } else if (action === 'transferInventory') {
    const { projectId, inventoryId, direction, requestId } = payload;
    const qty = inventoryInteger(payload.qty, 1);
    if (typeof projectId !== 'string' || !projectId || typeof inventoryId !== 'string' || !inventoryId || !['allocate','return'].includes(direction) || typeof requestId !== 'string' || !requestId || requestId.length > 100) throw Object.assign(new Error('잘못된 재고 이동 요청입니다.'), { status: 400 });
    const request = { projectId, inventoryId, direction, qty, ...(payload.dataRevision != null ? { dataRevision: payload.dataRevision } : {}) };
    const receipt = (await sql`SELECT request FROM pos_inventory_transfers WHERE admin_id=${adminId} AND id=${requestId}`).rows[0];
    if (receipt) {
      if (Object.keys(request).some(key => receipt.request[key] !== request[key])) throw Object.assign(new Error('재고 이동 요청 ID가 중복되었습니다.'), { status: 409 });
      return inventoryState(adminId);
    }
    const event = (await sql`SELECT id, archived_at FROM pos_projects WHERE id=${projectId} AND admin_id=${adminId} FOR UPDATE`).rows[0];
    if (!event) throw Object.assign(new Error('행사 접근 권한이 없습니다.'), { status: 404 });
    const revision = await dataRevision(projectId);
    if (revision && payload.dataRevision !== revision) throw Object.assign(new Error('행사 데이터가 변경되었습니다. 새로고침해주세요.'), { status: 409 });
    // Archived events may return unsold stock, but cannot receive new stock.
    if (event.archived_at && direction === 'allocate') throw Object.assign(new Error('보관된 행사에는 배정할 수 없습니다.'), { status: 409 });
    const item = (await sql`SELECT * FROM pos_inventory WHERE admin_id=${adminId} AND id=${inventoryId} FOR UPDATE`).rows[0];
    if (!item) throw Object.assign(new Error('재고를 찾을 수 없습니다.'), { status: 404 });
    if (item.product.removedAt && direction === 'allocate') throw Object.assign(new Error('제거된 재고는 새로 배정할 수 없습니다.'), { status: 409 });
    let link = (await sql`SELECT product_id FROM pos_inventory_links WHERE project_id=${projectId} AND admin_id=${adminId} AND inventory_id=${inventoryId}`).rows[0];
    if (!link) {
      if (direction === 'return') throw Object.assign(new Error('배정된 상품이 없습니다.'), { status: 400 });
      link = { product_id: uid() };
      await insertProduct(projectId, { ...item.product, id: link.product_id, stockQty: 0, initialStockQty: 0 });
      await sql`INSERT INTO pos_inventory_links VALUES (${projectId},${link.product_id},${adminId},${inventoryId})`;
    }
    const product = (await sql`SELECT * FROM pos_products WHERE project_id=${projectId} AND id=${link.product_id}`).rows[0];
    if (!product) throw Object.assign(new Error('배정 상품이 삭제되었습니다. 관리자 확인이 필요합니다.'), { status: 409 });
    const delta = direction === 'allocate' ? qty : -qty;
    const stock = Number(product.stock_qty ?? product.stock) + delta;
    const initial = Number(product.initial_stock_qty ?? product.stock_qty ?? product.stock) + delta;
    inventoryInteger(stock); inventoryInteger(initial); inventoryInteger(item.stock - delta);
    await sql`UPDATE pos_products SET stock=${stock},stock_qty=${stock},initial_stock_qty=${initial},is_active=${direction === 'allocate' ? true : product.is_active !== false},updated_at=NOW() WHERE project_id=${projectId} AND id=${link.product_id}`;
    await sql`UPDATE pos_inventory SET stock=stock-${delta},version=version+1 WHERE admin_id=${adminId} AND id=${inventoryId}`;
    await sql`INSERT INTO pos_inventory_transfers VALUES (${adminId},${requestId},${JSON.stringify(request)}::jsonb)`;
    await sql`UPDATE pos_projects SET updated_at=NOW() WHERE id=${projectId}`;
  } else if (action !== 'listInventory') throw Object.assign(new Error('알 수 없는 재고 작업입니다.'), { status: 400 });
  return inventoryState(adminId);
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

async function insertProduct(projectId, input, onlyMissing = false, saleNumber = null) {
  const product = normalizeProduct(input);
  if (saleNumber == null) await ensureProductSaleNumbers(projectId);
  const position = product.isActive ? (saleNumber ?? Number((await sql`SELECT COALESCE(MAX(sale_number),0)+1 AS next FROM pos_products WHERE project_id=${projectId} AND COALESCE(is_active,TRUE)=TRUE`).rows[0]?.next || 1)) : null;
  if (onlyMissing) {
    await sql`INSERT INTO pos_products (project_id, id, name, price, stock, product_code, goods_type, vtuber_name, creator_name, stock_qty, initial_stock_qty, size, set_creator_name, set_group_name, set_price, set_description, is_active, created_at, updated_at, image_url, genre, sale_number) VALUES (${projectId}, ${product.id}, ${displayName(product)}, ${product.price}, ${product.stockQty}, ${product.productCode}, ${product.goodsType}, ${product.vtuberName}, ${product.creatorName}, ${product.stockQty}, ${product.initialStockQty}, ${product.size}, ${product.setCreatorName}, ${product.setGroupName}, ${product.setPrice}, ${product.setDescription}, ${product.isActive}, ${product.createdAt}, ${product.updatedAt}, ${product.imageUrl}, ${product.genre}, ${position}) ON CONFLICT (project_id, id) DO NOTHING`;
    return;
  }
  await sql`INSERT INTO pos_products (project_id, id, name, price, stock, product_code, goods_type, vtuber_name, creator_name, stock_qty, initial_stock_qty, size, set_creator_name, set_group_name, set_price, set_description, is_active, created_at, updated_at, image_url, genre, sale_number) VALUES (${projectId}, ${product.id}, ${displayName(product)}, ${product.price}, ${product.stockQty}, ${product.productCode}, ${product.goodsType}, ${product.vtuberName}, ${product.creatorName}, ${product.stockQty}, ${product.initialStockQty}, ${product.size}, ${product.setCreatorName}, ${product.setGroupName}, ${product.setPrice}, ${product.setDescription}, ${product.isActive}, ${product.createdAt}, ${product.updatedAt}, ${product.imageUrl}, ${product.genre}, ${position})`;
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

// A project's row lock serializes numbering with catalog and sale mutations.
async function ensureProductSaleNumbers(projectId) {
  await sql`SELECT id FROM pos_projects WHERE id=${projectId} FOR UPDATE`;
  await sql`WITH numbered AS (
    SELECT id,ROW_NUMBER() OVER (ORDER BY sale_number NULLS LAST,COALESCE(product_code,id),id)::integer AS position
    FROM pos_products WHERE project_id=${projectId} AND COALESCE(is_active,TRUE)=TRUE
  ) UPDATE pos_products p SET sale_number=n.position FROM numbered n
    WHERE p.project_id=${projectId} AND p.id=n.id AND p.sale_number IS DISTINCT FROM n.position`;
  await sql`UPDATE pos_products SET sale_number=NULL WHERE project_id=${projectId} AND is_active=FALSE AND sale_number IS NOT NULL`;
}

async function reorderProducts(projectId, payload) {
  await ensureProductSaleNumbers(projectId);
  const current=(await sql`SELECT id FROM pos_products WHERE project_id=${projectId} AND COALESCE(is_active,TRUE)=TRUE ORDER BY sale_number,id`).rows.map(row=>row.id);
  if (!Array.isArray(payload.expectedOrder) || JSON.stringify(payload.expectedOrder)!==JSON.stringify(current)) throw Object.assign(new Error('상품 순서가 변경되었습니다. 새로고침 후 다시 수정해주세요.'),{status:409});
  const target=payload.saleNumber;
  if (!Number.isInteger(target) || target<1 || target>current.length || !current.includes(payload.productId)) throw Object.assign(new Error('판매 번호는 현재 상품 수 안의 양의 정수로 입력해주세요.'),{status:400});
  const next=current.filter(id=>id!==payload.productId);next.splice(target-1,0,payload.productId);
  await sql`UPDATE pos_products p SET sale_number=n.position::integer,updated_at=NOW()
    FROM jsonb_array_elements_text(${JSON.stringify(next)}::jsonb) WITH ORDINALITY AS n(id,position)
    WHERE p.project_id=${projectId} AND p.id=n.id`;
  await sql`UPDATE pos_projects SET updated_at=NOW() WHERE id=${projectId}`;
}

async function readState(adminId, projectId) {
  await assertProject(adminId, projectId);
  await ensureProductSaleNumbers(projectId);
  const [products, bundles, sales] = await Promise.all([
    sql`SELECT p.*, l.inventory_id, i.product_number, i.version AS inventory_version,
      CASE WHEN i.id IS NOT NULL THEN i.product->>'name' ELSE p.name END AS name,
      CASE WHEN i.id IS NOT NULL THEN COALESCE(i.product->>'goodsType',i.product->>'name') ELSE p.goods_type END AS goods_type,
      CASE WHEN i.id IS NOT NULL THEN i.product->>'vtuberName' ELSE p.vtuber_name END AS vtuber_name,
      CASE WHEN i.id IS NOT NULL THEN i.product->>'creatorName' ELSE p.creator_name END AS creator_name,
      CASE WHEN i.id IS NOT NULL THEN i.product->>'imageUrl' ELSE p.image_url END AS image_url,
      CASE WHEN i.id IS NOT NULL THEN COALESCE(i.product->>'genre','') ELSE COALESCE(p.genre,'') END AS genre FROM pos_products p LEFT JOIN pos_inventory_links l ON l.project_id=p.project_id AND l.product_id=p.id AND l.admin_id=${adminId} LEFT JOIN pos_inventory i ON i.admin_id=l.admin_id AND i.id=l.inventory_id WHERE p.project_id = ${projectId} AND COALESCE(p.is_active, TRUE) = TRUE ORDER BY p.sale_number,p.id`,
    sql`SELECT id, name, price, items FROM pos_bundles WHERE project_id = ${projectId} ORDER BY id`,
    sql`SELECT id, time, method, total, lines FROM pos_sales WHERE project_id = ${projectId} ORDER BY time ASC`,
  ]);
  return {
    archivedAt: (await sql`SELECT archived_at FROM pos_projects WHERE id = ${projectId}`).rows[0]?.archived_at || null,
    dataRevision: await dataRevision(projectId),
    products: products.rows.map((product) => ({ id: product.id, saleNumber: product.sale_number == null ? null : Number(product.sale_number), inventoryId: product.inventory_id || null, productNumber: product.product_number || null, inventoryVersion: product.inventory_version ?? null, genre: product.genre || '', productCode: product.product_code || product.id, goodsType: product.goods_type || product.name, vtuberName: product.vtuber_name || '', creatorName: product.creator_name || '', stockQty: Number(product.stock_qty ?? product.stock ?? 0), initialStockQty: Number(product.initial_stock_qty ?? product.stock_qty ?? product.stock ?? 0), size: product.size || null, imageUrl: product.image_url || null, price: Number(product.price) || 0, setCreatorName: product.set_creator_name || null, setGroupName: product.set_group_name || null, setPrice: product.set_price == null ? null : Number(product.set_price) || 0, setDescription: product.set_description || null, isActive: product.is_active !== false, createdAt: new Date(product.created_at).toISOString(), updatedAt: new Date(product.updated_at).toISOString(), name: product.name, stock: Number(product.stock_qty ?? product.stock ?? 0) })),
    bundles: bundles.rows.map((bundle) => ({ ...bundle, items: bundle.items || [] })),
    sales: sales.rows.map((sale) => ({ ...sale, time: new Date(sale.time).toISOString(), lines: sale.lines || [] })),
  };
}

async function replaceProducts(adminId, projectId, products) {
  await assertProject(adminId, projectId);
  const linked = (await sql`SELECT p.*, l.inventory_id, i.product AS common_product FROM pos_products p JOIN pos_inventory_links l ON l.project_id=p.project_id AND l.product_id=p.id JOIN pos_inventory i ON i.admin_id=l.admin_id AND i.id=l.inventory_id WHERE p.project_id=${projectId}`).rows.filter(p => p.inventory_id);
  for (const old of linked.filter(row => row.is_active !== false)) {
    const next = products.find(p => p.id === old.id);
    if (!next || Number(next.stockQty ?? next.stock) !== Number(old.stock_qty ?? old.stock) || Number(next.initialStockQty) !== Number(old.initial_stock_qty ?? old.stock_qty ?? old.stock)) throw Object.assign(new Error('공통 재고 상품은 재고 관리에서 배정·회수해주세요. 삭제 대신 회수 후 행사를 보관할 수 있습니다.'), { status: 409 });
  }
  await ensureProductSaleNumbers(projectId);
  const existingOrder=new Map((await sql`SELECT id,sale_number FROM pos_products WHERE project_id=${projectId}`).rows.map(row=>[row.id,row.sale_number]));
  let nextNumber=[...existingOrder.values()].reduce((max,value)=>Math.max(max,Number(value)||0),0)+1;
  await sql`DELETE FROM pos_products WHERE project_id = ${projectId} AND COALESCE(is_active, TRUE) = TRUE`;
  for (const product of products) {
    const normalized = normalizeProduct(product);
    const source = linked.find(row => row.id === product.id)?.common_product;
    const common = source ? Object.fromEntries(['name','goodsType','vtuberName','creatorName','genre','imageUrl'].map(key => [key, source[key] ?? (key === 'imageUrl' ? null : '')])) : {};
    await insertProduct(projectId, { ...normalized, ...common }, false, existingOrder.get(product.id) ?? nextNumber++);
  }
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
  if ((await sql`SELECT id FROM pos_sale_receipts WHERE project_id = ${projectId} AND id = ${saleId}`).rows[0]) return;
  if ((await sql`SELECT id FROM pos_sales WHERE project_id = ${projectId} AND id = ${saleId}`).rows[0]) return;
  if (!['cash', 'transfer'].includes(method) || !Number.isSafeInteger(total) || total < 0 || total > 2147483647) throw new Error('결제수단과 정수 금액을 확인해주세요.');
  if (cart.some(line => !['product', 'bundle'].includes(line.type) || typeof line.id !== 'string' || !Number.isSafeInteger(line.qty) || line.qty <= 0 || !Number.isSafeInteger(line.unitPrice) || line.unitPrice < 0 || line.unitPrice > 2147483647) || cart.reduce((sum, line) => sum + line.qty * line.unitPrice, 0) !== total) throw new Error('판매 수량과 가격을 확인해주세요.');
  const products = (await sql`SELECT * FROM pos_products WHERE project_id = ${projectId}`).rows;
  const lines = [];
  const soldByProduct = new Map();
  for (const line of cart) {
    if (line.type === 'product') {
      const product = products.find(item => item.id === line.id);
      if (!product || product.is_active === false) throw new Error('상품을 찾을 수 없거나 판매가 중지되었습니다.');
      soldByProduct.set(line.id, (soldByProduct.get(line.id) || 0) + line.qty);
      lines.push({ ...line, name: line.name || product.name, creatorName: line.creatorName ?? product.creator_name ?? '' });
    }
    if (line.type === 'bundle') {
      const bundle = (await sql`SELECT items FROM pos_bundles WHERE project_id = ${projectId} AND id = ${line.id}`).rows[0];
      if (!bundle?.items?.length) throw new Error('세트 구성을 찾을 수 없습니다.');
      if (line.subItems && (!Array.isArray(line.subItems) || line.subItems.length !== bundle.items.length || bundle.items.some((item, index) => item.productId !== line.subItems[index]?.productId || item.qty !== line.subItems[index]?.qty))) {
        const error = new Error('판매 시점과 서버의 세트 구성이 다릅니다. 미전송 주문을 보존하고 구성을 확인해주세요.');
        error.code = '40001';
        throw error;
      }
      const subItems = bundle.items.map(item => {
        const product = products.find(product => product.id === item.productId);
        if (!product || product.is_active === false || !Number.isSafeInteger(item.qty) || item.qty <= 0) throw new Error('세트 구성을 확인해주세요.');
        soldByProduct.set(item.productId, (soldByProduct.get(item.productId) || 0) + item.qty * line.qty);
        const historical = line.subItems?.find(saved => saved.productId === item.productId);
        return { ...item, name: historical?.name ?? product.name, creatorName: historical?.creatorName ?? product.creator_name ?? '', unitPrice: historical?.unitPrice ?? product.price };
      });
      lines.push({ ...line, subItems });
    }
  }
  for (const [productId, sold] of soldByProduct) {
    const product = products.find((item) => item.id === productId);
    if (!product || Number(product.stock_qty ?? product.stock ?? 0) < sold) throw new Error('재고가 부족합니다. 새로고침 후 다시 시도해주세요.');
  }
  for (const [productId, sold] of soldByProduct) await sql`UPDATE pos_products SET stock = stock - ${sold}, stock_qty = COALESCE(stock_qty, stock) - ${sold}, updated_at = NOW() WHERE project_id = ${projectId} AND id = ${productId}`;
  const sale = { id: saleId, time: createdAt || new Date().toISOString(), method, total: Number(total) || 0, lines };
  await sql`INSERT INTO pos_sale_receipts (project_id, id) VALUES (${projectId}, ${saleId}) ON CONFLICT (project_id, id) DO NOTHING`;
  await sql`INSERT INTO pos_sales (project_id, id, time, method, total, lines) VALUES (${projectId}, ${sale.id}, ${sale.time}, ${sale.method}, ${sale.total}, ${JSON.stringify(sale.lines)}::jsonb)`;
  await sql`UPDATE pos_projects SET updated_at = NOW() WHERE id = ${projectId}`;
}

async function voidSale(adminId, projectId, id) {
  await assertProject(adminId, projectId);
  if (typeof id !== 'string' || !id) throw new Error('취소할 판매 ID가 필요합니다.');
  await sql`INSERT INTO pos_sale_receipts (project_id, id, voided) VALUES (${projectId}, ${id}, TRUE) ON CONFLICT (project_id, id) DO UPDATE SET voided = TRUE`;
  const sale = (await sql`SELECT lines FROM pos_sales WHERE project_id = ${projectId} AND id = ${id}`).rows[0];
  if (!sale) return;
  for (const line of sale.lines || []) {
    if (line.type === 'product') await sql`UPDATE pos_products SET stock = stock + ${Number(line.qty) || 0}, stock_qty = COALESCE(stock_qty, stock) + ${Number(line.qty) || 0}, updated_at = NOW() WHERE project_id = ${projectId} AND id = ${line.id}`;
    if (line.type === 'bundle') {
      const bundle = (await sql`SELECT items FROM pos_bundles WHERE project_id = ${projectId} AND id = ${line.id}`).rows[0];
      for (const item of line.subItems || bundle?.items || []) await sql`UPDATE pos_products SET stock = stock + ${(Number(item.qty) || 0) * (Number(line.qty) || 0)}, stock_qty = COALESCE(stock_qty, stock) + ${(Number(item.qty) || 0) * (Number(line.qty) || 0)}, updated_at = NOW() WHERE project_id = ${projectId} AND id = ${item.productId}`;
    }
  }
  await sql`DELETE FROM pos_sales WHERE project_id = ${projectId} AND id = ${id}`;
  await sql`UPDATE pos_projects SET updated_at = NOW() WHERE id = ${projectId}`;
}

async function clearSales(adminId, projectId, password) {
  if (!await validateAdminPassword(adminId, password)) throw new Error('패스워드가 올바르지 않습니다.');
  await assertProject(adminId, projectId);
  await sql`INSERT INTO pos_sale_receipts (project_id, id) SELECT project_id, id FROM pos_sales WHERE project_id = ${projectId} ON CONFLICT (project_id, id) DO NOTHING`;
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
    for (const line of s.lines) {
      if (!line || !['product', 'bundle'].includes(line.type) || !text(line.id) || !text(line.name) || !integer(line.qty, 1) || !integer(line.unitPrice)) invalid();
      if (line.subItems !== undefined) {
        if (!Array.isArray(line.subItems) || !line.subItems.length) invalid();
        for (const item of line.subItems) if (!item || !text(item.productId) || !integer(item.qty, 1) || !integer(item.unitPrice)) invalid();
      }
    }
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
    if (action === 'updateProductImage') {
      const linked = (await sql`SELECT inventory_id FROM pos_inventory_links WHERE admin_id=${admin.id} AND project_id=${req.body.projectId || payload.projectId} AND product_id=${payload.productId}`).rows[0];
      if (linked) return res.status(200).json(await inventoryAction(admin.id, 'saveCommonProductImage', { ...payload, projectId: req.body.projectId || payload.projectId, dataRevision: req.body.dataRevision ?? payload.dataRevision }));
    }
    if (['listInventory', 'saveInventory', 'transferInventory', 'createEventProduct', 'saveEventProduct', 'removeInventory'].includes(action)) return res.status(200).json(await inventoryAction(admin.id, action, payload));
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
        const allocated = (await sql`SELECT p.*, l.inventory_id FROM pos_products p JOIN pos_inventory_links l ON l.project_id=p.project_id AND l.product_id=p.id WHERE p.project_id=${projectId}`).rows.filter(p => p.inventory_id && Number(p.stock_qty ?? p.stock) > 0);
        if (allocated.length) return res.status(409).json({ error: '남은 재고를 재고 관리에서 회수한 뒤 행사를 삭제해주세요.' });
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
    if (action === 'resetDefaults') {
      const linked = (await sql`SELECT p.*, l.inventory_id FROM pos_products p JOIN pos_inventory_links l ON l.project_id=p.project_id AND l.product_id=p.id WHERE p.project_id=${projectId}`).rows.filter(p => p.inventory_id);
      if (linked.length) return res.status(409).json({ error: '공통 재고에 연결된 행사는 기본값으로 초기화할 수 없습니다.' });
    }
    if (action === 'removeProduct') {
      const product = (await sql`SELECT id FROM pos_products WHERE project_id=${projectId} AND id=${payload.productId}`).rows[0];
      if (!product) return res.status(404).json({ error: '상품을 찾을 수 없습니다.' });
      await sql`UPDATE pos_products SET is_active=FALSE,updated_at=NOW() WHERE project_id=${projectId} AND id=${payload.productId}`;
      await sql`UPDATE pos_projects SET updated_at=NOW() WHERE id=${projectId}`;
    }
    else if (action === 'reorderProducts') await reorderProducts(projectId, payload);
    else if (action === 'replaceProducts') await replaceProducts(admin.id, projectId, payload.products || []);
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
    return res.status(error.code === '40001' ? 409 : (error.status || 500)).json({ error: error.code === '40001' ? '프로젝트가 변경되었습니다. 새로고침 후 다시 시도해주세요.' : error.message || '서버 오류가 발생했습니다.' });
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
