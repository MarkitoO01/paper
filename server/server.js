import dotenv from 'dotenv';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import path from 'node:path';
import zlib from 'node:zlib';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const app = express();
const { Pool, Client } = pg;
pg.types.setTypeParser(1082, value => value);

const dbConfig = {
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'allegra',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres'
};

let pool = new Pool(dbConfig);
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_USER = process.env.ADMIN_USER || 'allegra';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET precisa ter pelo menos 32 caracteres.');
}
if (!ADMIN_PASSWORD_HASH) {
  throw new Error('Configure ADMIN_PASSWORD_HASH no arquivo .env.');
}

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '15mb' }));

const todayISO = () => new Date().toISOString().slice(0, 10);
const num = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const nonNeg = (v, decimals = 2) => {
  const n = num(v);
  if (n <= 0) return 0;
  const factor = 10 ** decimals;
  return Math.max(0, Math.round(n * factor) / factor);
};
const posNum = (v, fallback = 1, decimals = 3) => {
  const n = num(v);
  const val = n > 0 ? n : fallback;
  const factor = 10 ** decimals;
  return Math.max(1 / factor, Math.round(val * factor) / factor);
};

const MONTHS_EN = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
};

export function date(v, fallback = null) {
  if (!v) return fallback;
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? fallback : v.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (!s) return fallback;

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|T|\s)/);
  if (m) {
    const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})(?:$|\s)/);
  if (m) {
    const day = Number(m[1]), month = Number(m[2]), year = Number(m[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  m = s.match(/^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})(?:\s+(\d{4}))?/);
  if (m) {
    const month = MONTHS_EN[m[1].toLowerCase()];
    const day = Number(m[2]);
    const year = m[3] ? Number(m[3]) : new Date().getFullYear();
    if (month && day >= 1 && day <= 31) {
      return `${String(year).padStart(4, '0')}-${month}-${String(day).padStart(2, '0')}`;
    }
  }

  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return fallback;
}

const VALID_STAGES = ['Criação de Arte', 'Em Produção', 'Finalizado', 'Entregue'];
export function normalizeStage(v) {
  const raw = String(v || '').trim();
  if (!raw) return 'Criação de Arte';
  if (VALID_STAGES.includes(raw)) return raw;
  const folded = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (folded.includes('producao') || folded.includes('produzindo')) return 'Em Produção';
  if (folded.includes('finaliz') || folded.includes('pronto')) return 'Finalizado';
  if (folded.includes('entreg')) return 'Entregue';
  if (folded.includes('arte') || folded.includes('criacao')) return 'Criação de Arte';
  return 'Criação de Arte';
}

const nullableId = v => (v !== undefined && v !== null && String(v).trim() !== '' ? String(v).trim() : null);
const safeArray = v => (Array.isArray(v) ? v : []);
const cloneLine = line => ({ ...line, id: String(line?.id || randomUUID()) });

const referenceTables = new Set(['clientes', 'estoque', 'vendas', 'controles_da_producao']);
async function existingReference(db, table, value) {
  const id = nullableId(value);
  if (!id) return null;
  if (!referenceTables.has(table)) throw new Error('Referência inválida.');
  const result = await db.query(`SELECT id FROM ${table} WHERE id=$1`, [id]);
  return result.rowCount ? id : null;
}

async function resolveUniqueChildId(db, table, parentColumn, parentId, candidateId, usedIds) {
  let id = nullableId(candidateId) || randomUUID();
  if (usedIds.has(id)) {
    id = `${parentId}-${usedIds.size + 1}-${randomUUID().slice(0, 8)}`;
  }
  const existing = await db.query(`SELECT ${parentColumn} AS owner FROM ${table} WHERE id=$1`, [id]);
  if (existing.rowCount && String(existing.rows[0].owner) !== String(parentId)) {
    id = `${parentId}-${usedIds.size + 1}-${randomUUID().slice(0, 8)}`;
  }
  usedIds.add(id);
  return id;
}

async function ensureProduct(db, name, defaultPrice = 0) {
  const productName = String(name || 'Produto').trim() || 'Produto';
  const price = nonNeg(defaultPrice, 2);
  const { rows } = await db.query(
    `INSERT INTO produtos(nome, nome_normalizado, preco_padrao)
     VALUES($1, lower(btrim($1)), $2)
     ON CONFLICT(nome_normalizado) DO UPDATE
       SET nome = EXCLUDED.nome,
           preco_padrao = CASE WHEN EXCLUDED.preco_padrao > 0 THEN EXCLUDED.preco_padrao ELSE produtos.preco_padrao END,
           atualizado_em = now()
     RETURNING id`,
    [productName, price]
  );
  return rows[0].id;
}

async function insertMaterials(db, table, parentColumn, parentId, materials) {
  const allowed = {
    venda_item_insumos: 'venda_item_id',
    controle_item_insumos: 'controle_item_id'
  };
  if (allowed[table] !== parentColumn) throw new Error('Relacionamento de insumos inválido.');
  for (const material of safeArray(materials)) {
    const stockId = await existingReference(db, 'estoque', material.stockId ?? material.estoque_id);
    const name = String(material.name ?? material.nome_insumo ?? '').trim();
    const qty = nonNeg(material.qty ?? material.quantidade_por_item ?? material.quantidade, 3);
    const unitCost = nonNeg(material.unitCost ?? material.custo_unitario, 4);
    await db.query(
      `INSERT INTO ${table}(${parentColumn}, estoque_id, nome_insumo, quantidade_por_item, custo_unitario)
       VALUES($1, $2, $3, $4, $5)`,
      [parentId, stockId, name, qty, unitCost]
    );
  }
}

async function upsertSales(db, records) {
  for (const sale of safeArray(records)) {
    if (!sale || !sale.id) continue;
    const saleId = String(sale.id);
    const saleDate = date(sale.date ?? sale.data_venda, todayISO());
    const orderDate = date(sale.orderDate ?? sale.data_pedido, saleDate);
    const dueDate = date(sale.due ?? sale.previsao_entrega, null);
    const clientId = await existingReference(db, 'clientes', sale.clientId ?? sale.cliente_id);
    const clientName = String(sale.clientName ?? sale.nome_cliente ?? 'Cliente avulso');
    const clientPhone = String(sale.clientPhone ?? sale.telefone_cliente ?? '');
    const address = String(sale.address ?? sale.endereco_entrega ?? '');
    const product = String(sale.product ?? sale.produto_resumo ?? '');
    const qty = posNum(sale.qty ?? sale.quantidade, 1, 3);
    const total = nonNeg(sale.total, 2);
    const paid = nonNeg(sale.paid ?? sale.recebido, 2);
    const cost = nonNeg(sale.cost ?? sale.custo, 2);
    const payment = String(sale.payment ?? sale.pagamento ?? '');
    const delivery = String(sale.delivery ?? sale.entrega ?? '');

    await db.query(
      `INSERT INTO vendas(
         id, data_venda, data_pedido, cliente_id, nome_cliente, telefone_cliente,
         endereco_entrega, produto_resumo, quantidade, total, recebido, custo,
         pagamento, entrega, previsao_entrega
       )
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT(id) DO UPDATE SET
         data_venda = EXCLUDED.data_venda,
         data_pedido = EXCLUDED.data_pedido,
         cliente_id = EXCLUDED.cliente_id,
         nome_cliente = EXCLUDED.nome_cliente,
         telefone_cliente = EXCLUDED.telefone_cliente,
         endereco_entrega = EXCLUDED.endereco_entrega,
         produto_resumo = EXCLUDED.produto_resumo,
         quantidade = EXCLUDED.quantidade,
         total = EXCLUDED.total,
         recebido = EXCLUDED.recebido,
         custo = EXCLUDED.custo,
         pagamento = EXCLUDED.pagamento,
         entrega = EXCLUDED.entrega,
         previsao_entrega = EXCLUDED.previsao_entrega`,
      [
        saleId, saleDate, orderDate, clientId, clientName, clientPhone,
        address, product, qty, total, paid, cost, payment, delivery, dueDate
      ]
    );

    const hasExplicitItems = Array.isArray(sale.items) && sale.items.length > 0;
    const existingItemsCount = hasExplicitItems
      ? 0
      : (await db.query('SELECT count(*)::int AS cnt FROM venda_itens WHERE venda_id=$1', [saleId])).rows[0]?.cnt || 0;

    if (hasExplicitItems || existingItemsCount === 0) {
      await db.query('DELETE FROM venda_itens WHERE venda_id=$1', [saleId]);
      let items = safeArray(sale.items).map(cloneLine);
      if (!items.length) {
        items = [{
          id: randomUUID(),
          name: product || 'Produto',
          qty,
          unitPrice: total / qty,
          paidAmount: paid,
          composition: safeArray(sale.composition)
        }];
      } else if (items.length === 1 && !safeArray(items[0].composition).length && safeArray(sale.composition).length) {
        items[0].composition = safeArray(sale.composition);
      }

      const usedIds = new Set();
      for (const item of items) {
        const itemId = await resolveUniqueChildId(db, 'venda_itens', 'venda_id', saleId, item.id, usedIds);
        const itemName = String(item.name ?? item.nome_produto ?? product ?? 'Produto').trim() || 'Produto';
        const itemQty = posNum(item.qty ?? item.quantidade, 1, 3);
        const itemUnitPrice = nonNeg(item.unitPrice ?? item.preco_unitario, 2);
        const itemPaid = nonNeg(item.paidAmount ?? item.recebido, 2);
        const productId = await ensureProduct(db, itemName, itemUnitPrice);

        await db.query(
          `INSERT INTO venda_itens(id, venda_id, produto_id, nome_produto, quantidade, preco_unitario, recebido)
           VALUES($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT(id) DO UPDATE SET
             venda_id = EXCLUDED.venda_id,
             produto_id = EXCLUDED.produto_id,
             nome_produto = EXCLUDED.nome_produto,
             quantidade = EXCLUDED.quantidade,
             preco_unitario = EXCLUDED.preco_unitario,
             recebido = EXCLUDED.recebido`,
          [itemId, saleId, productId, itemName, itemQty, itemUnitPrice, itemPaid]
        );
        await db.query('DELETE FROM venda_item_insumos WHERE venda_item_id=$1', [itemId]);
        await insertMaterials(db, 'venda_item_insumos', 'venda_item_id', itemId, item.composition);
      }
    }
  }
}

async function upsertProduction(db, records) {
  for (const order of safeArray(records)) {
    if (!order || !order.id) continue;
    const orderId = String(order.id);
    const saleId = await existingReference(db, 'vendas', order.saleId ?? order.venda_id);
    const clientId = await existingReference(db, 'clientes', order.clientId ?? order.cliente_id);
    const clientName = String(order.clientName ?? order.nome_cliente ?? 'Cliente avulso');
    const clientPhone = String(order.clientPhone ?? order.telefone_cliente ?? '');
    const address = String(order.address ?? order.endereco_entrega ?? '');
    const product = String(order.product ?? order.produto_resumo ?? '');
    const qty = posNum(order.qty ?? order.quantidade, 1, 3);
    const total = nonNeg(order.total, 2);
    const paid = nonNeg(order.paid ?? order.recebido, 2);
    const cost = nonNeg(order.cost ?? order.custo, 2);
    const orderDate = date(order.orderDate ?? order.date ?? order.data_pedido, todayISO());
    const dueDate = date(order.due ?? order.previsao_entrega, null);
    const delivery = String(order.delivery ?? order.tipo_entrega ?? 'Loja') || 'Loja';
    const payment = String(order.payment ?? order.pagamento ?? '');
    const stage = normalizeStage(order.stage ?? order.etapa ?? order.status);

    await db.query(
      `INSERT INTO controles_da_producao(
         id, venda_id, cliente_id, nome_cliente, telefone_cliente, endereco_entrega,
         produto_resumo, quantidade, total, recebido, custo, data_pedido,
         previsao_entrega, tipo_entrega, pagamento, etapa, atualizado_em
       )
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now())
       ON CONFLICT(id) DO UPDATE SET
         venda_id = EXCLUDED.venda_id,
         cliente_id = EXCLUDED.cliente_id,
         nome_cliente = EXCLUDED.nome_cliente,
         telefone_cliente = EXCLUDED.telefone_cliente,
         endereco_entrega = EXCLUDED.endereco_entrega,
         produto_resumo = EXCLUDED.produto_resumo,
         quantidade = EXCLUDED.quantidade,
         total = EXCLUDED.total,
         recebido = EXCLUDED.recebido,
         custo = EXCLUDED.custo,
         data_pedido = EXCLUDED.data_pedido,
         previsao_entrega = EXCLUDED.previsao_entrega,
         tipo_entrega = EXCLUDED.tipo_entrega,
         pagamento = EXCLUDED.pagamento,
         etapa = EXCLUDED.etapa,
         atualizado_em = now()`,
      [
        orderId, saleId, clientId, clientName, clientPhone, address,
        product, qty, total, paid, cost, orderDate, dueDate, delivery, payment, stage
      ]
    );

    const hasExplicitItems = Array.isArray(order.items) && order.items.length > 0;
    const existingItemsCount = hasExplicitItems
      ? 0
      : (await db.query('SELECT count(*)::int AS cnt FROM controle_producao_itens WHERE controle_id=$1', [orderId])).rows[0]?.cnt || 0;

    if (hasExplicitItems || existingItemsCount === 0) {
      await db.query('DELETE FROM controle_producao_itens WHERE controle_id=$1', [orderId]);
      let items = safeArray(order.items).map(cloneLine);
      if (!items.length) {
        items = [{
          id: randomUUID(),
          name: product || 'Produto',
          qty,
          unitPrice: total / qty,
          paidAmount: paid,
          composition: safeArray(order.composition)
        }];
      } else if (items.length === 1 && !safeArray(items[0].composition).length && safeArray(order.composition).length) {
        items[0].composition = safeArray(order.composition);
      }

      const usedIds = new Set();
      for (const item of items) {
        const itemId = await resolveUniqueChildId(db, 'controle_producao_itens', 'controle_id', orderId, item.id, usedIds);
        const itemName = String(item.name ?? item.nome_produto ?? product ?? 'Produto').trim() || 'Produto';
        const itemQty = posNum(item.qty ?? item.quantidade, 1, 3);
        const itemUnitPrice = nonNeg(item.unitPrice ?? item.preco_unitario, 2);
        const itemPaid = nonNeg(item.paidAmount ?? item.recebido, 2);
        const productId = await ensureProduct(db, itemName, itemUnitPrice);

        await db.query(
          `INSERT INTO controle_producao_itens(id, controle_id, produto_id, nome_produto, quantidade, preco_unitario, recebido)
           VALUES($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT(id) DO UPDATE SET
             controle_id = EXCLUDED.controle_id,
             produto_id = EXCLUDED.produto_id,
             nome_produto = EXCLUDED.nome_produto,
             quantidade = EXCLUDED.quantidade,
             preco_unitario = EXCLUDED.preco_unitario,
             recebido = EXCLUDED.recebido`,
          [itemId, orderId, productId, itemName, itemQty, itemUnitPrice, itemPaid]
        );
        await db.query('DELETE FROM controle_item_insumos WHERE controle_item_id=$1', [itemId]);
        await insertMaterials(db, 'controle_item_insumos', 'controle_item_id', itemId, item.composition);
      }
    }
  }
}

async function upsertChanges(db, changes = {}) {
  const deleteOrder = [
    ['quotes', 'orcamentos'],
    ['orders', 'controles_da_producao'],
    ['sales', 'vendas'],
    ['purchases', 'compras'],
    ['models', 'modelos'],
    ['expenses', 'despesas'],
    ['stock', 'estoque'],
    ['clients', 'clientes']
  ];
  for (const [key, table] of deleteOrder) {
    for (const id of safeArray(changes[key]?.delete)) {
      await db.query(`DELETE FROM ${table} WHERE id=$1`, [String(id)]);
    }
  }

  for (const c of safeArray(changes.clients?.upsert)) {
    if (!c || !c.id) continue;
    await db.query(
      `INSERT INTO clientes(id, nome, telefone, nascimento, endereco, atualizado_em)
       VALUES($1,$2,$3,$4,$5,now())
       ON CONFLICT(id) DO UPDATE SET
         nome = EXCLUDED.nome,
         telefone = EXCLUDED.telefone,
         nascimento = EXCLUDED.nascimento,
         endereco = EXCLUDED.endereco,
         atualizado_em = now()`,
      [
        String(c.id),
        String(c.name ?? c.nome ?? '').trim() || 'Cliente',
        String(c.phone ?? c.telefone ?? ''),
        date(c.birth ?? c.nascimento, null),
        String(c.address ?? c.endereco ?? '')
      ]
    );
  }

  for (const s of safeArray(changes.stock?.upsert)) {
    if (!s || !s.id) continue;
    const rawMin = s.minimum !== undefined ? s.minimum : s.quantidade_minima;
    const minimum = rawMin === null || rawMin === undefined || rawMin === '' ? null : nonNeg(rawMin, 3);
    await db.query(
      `INSERT INTO estoque(id, nome, unidade, quantidade, quantidade_minima, custo_unitario, atualizado_em)
       VALUES($1,$2,$3,$4,$5,$6,now())
       ON CONFLICT(id) DO UPDATE SET
         nome = EXCLUDED.nome,
         unidade = EXCLUDED.unidade,
         quantidade = EXCLUDED.quantidade,
         quantidade_minima = EXCLUDED.quantidade_minima,
         custo_unitario = EXCLUDED.custo_unitario,
         atualizado_em = now()`,
      [
        String(s.id),
        String(s.name ?? s.nome ?? '').trim() || 'Insumo',
        String(s.unit ?? s.unidade ?? 'un') || 'un',
        nonNeg(s.qty ?? s.quantidade, 3),
        minimum,
        nonNeg(s.unitCost ?? s.custo_unitario, 4)
      ]
    );
  }

  for (const prod of safeArray(changes.products?.upsert)) {
    const name = String(prod?.name ?? prod?.nome ?? '').trim();
    if (!name) continue;
    await ensureProduct(db, name, prod?.defaultPrice ?? prod?.preco_padrao ?? 0);
  }

  for (const p of safeArray(changes.purchases?.upsert)) {
    if (!p || !p.id) continue;
    const purchaseId = String(p.id);
    const items = safeArray(p.items);
    const computedTotal = items.reduce(
      (sum, item) => sum + posNum(item.qty ?? item.quantidade, 1, 3) * nonNeg(item.unitCost ?? item.custo_unitario, 4),
      0
    );
    await db.query(
      `INSERT INTO compras(id, data_compra, fornecedor, total)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(id) DO UPDATE SET
         data_compra = EXCLUDED.data_compra,
         fornecedor = EXCLUDED.fornecedor,
         total = EXCLUDED.total`,
      [
        purchaseId,
        date(p.date ?? p.data_compra, todayISO()),
        String(p.supplier ?? p.fornecedor ?? ''),
        nonNeg(p.total ?? computedTotal, 2)
      ]
    );
    if (Array.isArray(p.items)) {
      await db.query('DELETE FROM compra_itens WHERE compra_id=$1', [purchaseId]);
      for (const item of items) {
        const qty = posNum(item.qty ?? item.quantidade, 1, 3);
        const unitCost = nonNeg(item.unitCost ?? item.custo_unitario, 4);
        const subtotal = nonNeg(item.subtotal ?? qty * unitCost, 2);
        await db.query(
          `INSERT INTO compra_itens(compra_id, estoque_id, nome_insumo, quantidade, custo_unitario, subtotal)
           VALUES($1,$2,$3,$4,$5,$6)`,
          [
            purchaseId,
            await existingReference(db, 'estoque', item.stockId ?? item.estoque_id),
            String(item.name ?? item.nome_insumo ?? ''),
            qty,
            unitCost,
            subtotal
          ]
        );
      }
    }
  }

  for (const e of safeArray(changes.expenses?.upsert)) {
    if (!e || !e.id) continue;
    await db.query(
      `INSERT INTO despesas(id, descricao, valor, data_despesa)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(id) DO UPDATE SET
         descricao = EXCLUDED.descricao,
         valor = EXCLUDED.valor,
         data_despesa = EXCLUDED.data_despesa`,
      [
        String(e.id),
        String(e.description ?? e.descricao ?? ''),
        nonNeg(e.amount ?? e.valor, 2),
        date(e.date ?? e.data_despesa, todayISO())
      ]
    );
  }

  for (const m of safeArray(changes.models?.upsert)) {
    if (!m || !m.id) continue;
    const modelId = String(m.id);
    await db.query(
      `INSERT INTO modelos(id, nome)
       VALUES($1,$2)
       ON CONFLICT(id) DO UPDATE SET nome = EXCLUDED.nome`,
      [modelId, String(m.name ?? m.nome ?? '')]
    );
    if (Array.isArray(m.composition)) {
      await db.query('DELETE FROM modelo_insumos WHERE modelo_id=$1', [modelId]);
      for (const item of safeArray(m.composition)) {
        await db.query(
          `INSERT INTO modelo_insumos(modelo_id, estoque_id, nome_insumo, quantidade, custo_unitario)
           VALUES($1,$2,$3,$4,$5)`,
          [
            modelId,
            await existingReference(db, 'estoque', item.stockId ?? item.estoque_id),
            String(item.name ?? item.nome_insumo ?? ''),
            nonNeg(item.qty ?? item.quantidade, 3),
            nonNeg(item.unitCost ?? item.custo_unitario, 4)
          ]
        );
      }
    }
  }

  await upsertSales(db, changes.sales?.upsert);
  await upsertProduction(db, changes.orders?.upsert);

  for (const q of safeArray(changes.quotes?.upsert)) {
    if (!q || !q.id) continue;
    const quoteId = String(q.id);
    const quoteDate = date(q.date ?? q.data_orcamento, todayISO());
    const orderDate = date(q.orderDate ?? q.data_pedido, quoteDate);
    const dueDate = date(q.due ?? q.previsao_entrega, null);
    const rawDepositAmt = q.depositAmount !== undefined ? q.depositAmount : q.valor_entrada;
    const depositAmount = rawDepositAmt === null || rawDepositAmt === undefined || rawDepositAmt === ''
      ? null
      : nonNeg(rawDepositAmt, 2);

    await db.query(
      `INSERT INTO orcamentos(
         id, data_orcamento, data_pedido, previsao_entrega, cliente_id, nome_cliente,
         telefone_cliente, endereco_entrega, nome_produto, nome_composicao, quantidade,
         preco, custo, margem, tipo_margem, percentual_sinal, pagamento, entrega,
         status, venda_id, controle_id, valor_entrada
       )
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       ON CONFLICT(id) DO UPDATE SET
         data_orcamento = EXCLUDED.data_orcamento,
         data_pedido = EXCLUDED.data_pedido,
         previsao_entrega = EXCLUDED.previsao_entrega,
         cliente_id = EXCLUDED.cliente_id,
         nome_cliente = EXCLUDED.nome_cliente,
         telefone_cliente = EXCLUDED.telefone_cliente,
         endereco_entrega = EXCLUDED.endereco_entrega,
         nome_produto = EXCLUDED.nome_produto,
         nome_composicao = EXCLUDED.nome_composicao,
         quantidade = EXCLUDED.quantidade,
         preco = EXCLUDED.preco,
         custo = EXCLUDED.custo,
         margem = EXCLUDED.margem,
         tipo_margem = EXCLUDED.tipo_margem,
         percentual_sinal = EXCLUDED.percentual_sinal,
         pagamento = EXCLUDED.pagamento,
         entrega = EXCLUDED.entrega,
         status = EXCLUDED.status,
         venda_id = EXCLUDED.venda_id,
         controle_id = EXCLUDED.controle_id,
         valor_entrada = EXCLUDED.valor_entrada`,
      [
        quoteId,
        quoteDate,
        orderDate,
        dueDate,
        await existingReference(db, 'clientes', q.clientId ?? q.cliente_id),
        String(q.clientName ?? q.nome_cliente ?? 'Cliente avulso'),
        String(q.clientPhone ?? q.telefone_cliente ?? ''),
        String(q.address ?? q.endereco_entrega ?? ''),
        String(q.product ?? q.nome_produto ?? ''),
        String(q.compositionName ?? q.nome_composicao ?? ''),
        posNum(q.qty ?? q.quantidade, 1, 3),
        nonNeg(q.price ?? q.preco, 2),
        nonNeg(q.cost ?? q.custo, 2),
        num(q.margin ?? q.margem),
        String(q.marginMode ?? q.tipo_margem ?? 'margin'),
        nonNeg(q.deposit ?? q.percentual_sinal ?? 50, 3),
        String(q.payment ?? q.pagamento ?? ''),
        String(q.delivery ?? q.entrega ?? 'Loja'),
        String(q.status ?? 'Aguardando aprovação'),
        await existingReference(db, 'vendas', q.saleId ?? q.venda_id),
        await existingReference(db, 'controles_da_producao', q.orderId ?? q.controle_id),
        depositAmount
      ]
    );
    if (Array.isArray(q.composition)) {
      await db.query('DELETE FROM orcamento_insumos WHERE orcamento_id=$1', [quoteId]);
      for (const item of safeArray(q.composition)) {
        await db.query(
          `INSERT INTO orcamento_insumos(orcamento_id, estoque_id, nome_insumo, quantidade, custo_unitario)
           VALUES($1,$2,$3,$4,$5)`,
          [
            quoteId,
            await existingReference(db, 'estoque', item.stockId ?? item.estoque_id),
            String(item.name ?? item.nome_insumo ?? ''),
            nonNeg(item.qty ?? item.quantidade, 3),
            nonNeg(item.unitCost ?? item.custo_unitario, 4)
          ]
        );
      }
    }
  }

  if (changes.settings) {
    const s = Array.isArray(changes.settings) ? changes.settings[0] : changes.settings;
    if (s && typeof s === 'object') {
      await db.query(
        `INSERT INTO configuracoes(id, negocio, telefone, endereco, estoque_baixo, atualizado_em)
         VALUES(1, $1, $2, $3, $4, now())
         ON CONFLICT(id) DO UPDATE SET
           negocio = EXCLUDED.negocio,
           telefone = EXCLUDED.telefone,
           endereco = EXCLUDED.endereco,
           estoque_baixo = EXCLUDED.estoque_baixo,
           atualizado_em = now()`,
        [
          String(s.business ?? s.negocio ?? 'Allegra gráfica & personalizados'),
          String(s.phone ?? s.telefone ?? ''),
          String(s.address ?? s.endereco ?? ''),
          posNum(s.lowStock ?? s.estoque_baixo ?? 5, 5, 3)
        ]
      );
    }
  }
}

function wholeStateChanges(payload = {}) {
  const changes = {};
  for (const key of ['clients', 'stock', 'products', 'purchases', 'expenses', 'quotes', 'orders', 'sales', 'models']) {
    changes[key] = { upsert: safeArray(payload[key]), delete: [] };
  }
  changes.settings = payload.settings || {};
  return changes;
}

async function ensureDatabaseExists() {
  const candidates = Array.from(new Set([dbConfig.host, '127.0.0.1', '192.168.1.6']));
  let lastError = null;

  for (const candidateHost of candidates) {
    try {
      const testClient = new Client({ ...dbConfig, host: candidateHost });
      await testClient.connect();
      await testClient.end();
      if (candidateHost !== dbConfig.host) {
        dbConfig.host = candidateHost;
        pool = new Pool(dbConfig);
      }
      return;
    } catch (error) {
      if (error?.code === '3D000') {
        const adminClient = new Client({ ...dbConfig, host: candidateHost, database: 'postgres' });
        await adminClient.connect();
        try {
          const dbName = dbConfig.database.replace(/[^a-zA-Z0-9_]/g, '');
          await adminClient.query(`CREATE DATABASE ${dbName}`);
          console.log(`Banco de dados "${dbName}" criado automaticamente em ${candidateHost}:${dbConfig.port}.`);
          if (candidateHost !== dbConfig.host) {
            dbConfig.host = candidateHost;
            pool = new Pool(dbConfig);
          }
          return;
        } finally {
          await adminClient.end();
        }
      }
      lastError = error;
    }
  }
  if (lastError) throw lastError;
}

async function initializeDatabase() {
  await ensureDatabaseExists();
  const schema = await readFile(path.resolve(__dirname, '..', 'database', '02-tabelas-relacionais.sql'), 'utf8');
  await pool.query(schema);
  const migration = await pool.query('SELECT version FROM schema_migrations WHERE version=1');
  const legacy = await pool.query(
    `SELECT to_regclass('public.business_state') AS table_name,
            to_regclass('public.business_state_legacy') AS archive_name`
  );
  if (!migration.rowCount) {
    let payload = {};
    if (legacy.rows[0].table_name) {
      const result = await pool.query('SELECT payload FROM business_state WHERE id=1');
      payload = result.rows[0]?.payload || {};
    }
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await upsertChanges(db, wholeStateChanges(payload));
      await db.query('INSERT INTO schema_migrations(version) VALUES(1)');
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }
  if (legacy.rows[0].table_name && !legacy.rows[0].archive_name) {
    await pool.query('ALTER TABLE business_state RENAME TO business_state_legacy');
  }
}

function mapBy(rows, key) {
  const out = new Map();
  for (const row of safeArray(rows)) {
    const k = row[key];
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(row);
  }
  return out;
}

export const ENTITY_QUERIES = [
  ['clientes', 'SELECT * FROM clientes ORDER BY criado_em ASC, id ASC'],
  ['estoque', 'SELECT * FROM estoque ORDER BY lower(nome) ASC, id ASC'],
  ['produtos', 'SELECT * FROM produtos ORDER BY id ASC'],
  ['compras', 'SELECT * FROM compras ORDER BY data_compra ASC, criado_em ASC, id ASC'],
  ['compra_itens', 'SELECT * FROM compra_itens ORDER BY id ASC'],
  ['orcamentos', 'SELECT * FROM orcamentos ORDER BY data_orcamento ASC, criado_em ASC, id ASC'],
  ['orcamento_insumos', 'SELECT * FROM orcamento_insumos ORDER BY id ASC'],
  ['vendas', 'SELECT * FROM vendas ORDER BY data_venda ASC, criado_em ASC, id ASC'],
  ['venda_itens', 'SELECT * FROM venda_itens ORDER BY venda_id ASC, id ASC'],
  ['venda_item_insumos', 'SELECT * FROM venda_item_insumos ORDER BY id ASC'],
  ['controles_da_producao', 'SELECT * FROM controles_da_producao ORDER BY criado_em ASC, id ASC'],
  ['controle_producao_itens', 'SELECT * FROM controle_producao_itens ORDER BY controle_id ASC, id ASC'],
  ['controle_item_insumos', 'SELECT * FROM controle_item_insumos ORDER BY id ASC'],
  ['despesas', 'SELECT * FROM despesas ORDER BY data_despesa ASC, criado_em ASC, id ASC'],
  ['modelos', 'SELECT * FROM modelos ORDER BY criado_em ASC, id ASC'],
  ['modelo_insumos', 'SELECT * FROM modelo_insumos ORDER BY id ASC'],
  ['configuracoes', 'SELECT * FROM configuracoes ORDER BY id ASC']
];

export async function readRelationalEntities(db = pool) {
  const result = await Promise.all(ENTITY_QUERIES.map(([, sql]) => db.query(sql)));
  return Object.fromEntries(ENTITY_QUERIES.map(([name], i) => [name, result[i].rows]));
}

export function buildStateFromEntities(data = {}) {
  const purchaseItems = mapBy(data.compra_itens, 'compra_id');
  const quoteItems = mapBy(data.orcamento_insumos, 'orcamento_id');
  const saleItems = mapBy(data.venda_itens, 'venda_id');
  const orderItems = mapBy(data.controle_producao_itens, 'controle_id');
  const modelItems = mapBy(data.modelo_insumos, 'modelo_id');
  const saleMaterials = mapBy(data.venda_item_insumos, 'venda_item_id');
  const orderMaterials = mapBy(data.controle_item_insumos, 'controle_item_id');
  const materialsFor = (row, map, key) => map.get(row[key]) || [];

  const orderIdBySaleId = new Map();
  for (const o of safeArray(data.controles_da_producao)) {
    if (o.venda_id) orderIdBySaleId.set(String(o.venda_id), String(o.id));
  }

  const sales = safeArray(data.vendas).map(s => {
    const items = (saleItems.get(s.id) || []).map(i => ({
      id: String(i.id),
      name: i.nome_produto,
      qty: num(i.quantidade),
      unitPrice: num(i.preco_unitario),
      paidAmount: num(i.recebido),
      composition: materialsFor(i, saleMaterials, 'id').map(m => ({
        stockId: m.estoque_id || '',
        name: m.nome_insumo,
        qty: num(m.quantidade_por_item),
        unitCost: num(m.custo_unitario)
      }))
    }));
    return {
      id: String(s.id),
      orderId: orderIdBySaleId.get(String(s.id)) || '',
      date: date(s.data_venda) || '',
      orderDate: date(s.data_pedido || s.data_venda) || '',
      clientId: s.cliente_id || '',
      clientName: s.nome_cliente || 'Cliente avulso',
      clientPhone: s.telefone_cliente || '',
      address: s.endereco_entrega || '',
      product: s.produto_resumo || '',
      qty: num(s.quantidade) || 1,
      total: num(s.total),
      paid: num(s.recebido),
      cost: num(s.custo),
      payment: s.pagamento || '',
      delivery: s.entrega || '',
      due: date(s.previsao_entrega) || '',
      items,
      composition: items.flatMap(i => i.composition)
    };
  });

  const orders = safeArray(data.controles_da_producao).map(o => {
    const items = (orderItems.get(o.id) || []).map(i => ({
      id: String(i.id),
      name: i.nome_produto,
      qty: num(i.quantidade),
      unitPrice: num(i.preco_unitario),
      paidAmount: num(i.recebido),
      composition: materialsFor(i, orderMaterials, 'id').map(m => ({
        stockId: m.estoque_id || '',
        name: m.nome_insumo,
        qty: num(m.quantidade_por_item),
        unitCost: num(m.custo_unitario)
      }))
    }));
    const orderDate = date(o.data_pedido) || '';
    return {
      id: String(o.id),
      saleId: o.venda_id || '',
      clientId: o.cliente_id || '',
      clientName: o.nome_cliente || 'Cliente avulso',
      clientPhone: o.telefone_cliente || '',
      address: o.endereco_entrega || '',
      product: o.produto_resumo || '',
      qty: num(o.quantidade) || 1,
      total: num(o.total),
      paid: num(o.recebido),
      cost: num(o.custo),
      date: orderDate,
      orderDate,
      due: date(o.previsao_entrega) || '',
      delivery: o.tipo_entrega || 'Loja',
      payment: o.pagamento || '',
      stage: normalizeStage(o.etapa),
      items,
      composition: items.flatMap(i => i.composition)
    };
  });

  const quotes = safeArray(data.orcamentos).map(q => ({
    id: String(q.id),
    date: date(q.data_orcamento) || '',
    orderDate: date(q.data_pedido || q.data_orcamento) || '',
    due: date(q.previsao_entrega) || '',
    clientId: q.cliente_id || '',
    clientName: q.nome_cliente || 'Cliente avulso',
    clientPhone: q.telefone_cliente || '',
    address: q.endereco_entrega || '',
    product: q.nome_produto || '',
    compositionName: q.nome_composicao || '',
    qty: num(q.quantidade) || 1,
    price: num(q.preco),
    cost: num(q.custo),
    margin: num(q.margem),
    marginMode: q.tipo_margem || 'margin',
    deposit: num(q.percentual_sinal),
    depositAmount: q.valor_entrada === null || q.valor_entrada === undefined ? null : num(q.valor_entrada),
    payment: q.pagamento || '',
    delivery: q.entrega || 'Loja',
    status: q.status || 'Aguardando aprovação',
    saleId: q.venda_id || '',
    orderId: q.controle_id || '',
    composition: (quoteItems.get(q.id) || []).map(i => ({
      id: String(i.id || randomUUID()),
      stockId: i.estoque_id || '',
      name: i.nome_insumo,
      qty: num(i.quantidade),
      unitCost: num(i.custo_unitario)
    }))
  }));

  const cfg = safeArray(data.configuracoes)[0] || {};
  return {
    clients: safeArray(data.clientes).map(c => ({
      id: String(c.id),
      name: c.nome,
      phone: c.telefone || '',
      birth: date(c.nascimento) || '',
      address: c.endereco || ''
    })),
    stock: safeArray(data.estoque).map(s => ({
      id: String(s.id),
      name: s.nome,
      unit: s.unidade || 'un',
      qty: num(s.quantidade),
      minimum: s.quantidade_minima === null || s.quantidade_minima === undefined ? null : num(s.quantidade_minima),
      unitCost: num(s.custo_unitario)
    })),
    purchases: safeArray(data.compras).map(p => ({
      id: String(p.id),
      date: date(p.data_compra) || '',
      supplier: p.fornecedor || '',
      total: num(p.total),
      items: (purchaseItems.get(p.id) || []).map(i => ({
        stockId: i.estoque_id || '',
        name: i.nome_insumo,
        qty: num(i.quantidade),
        unitCost: num(i.custo_unitario)
      }))
    })),
    expenses: safeArray(data.despesas).map(e => ({
      id: String(e.id),
      description: e.descricao,
      amount: num(e.valor),
      date: date(e.data_despesa) || ''
    })),
    quotes,
    orders,
    sales,
    models: safeArray(data.modelos).map(m => ({
      id: String(m.id),
      name: m.nome,
      composition: (modelItems.get(m.id) || []).map(i => ({
        id: String(i.id || randomUUID()),
        stockId: i.estoque_id || '',
        name: i.nome_insumo,
        qty: num(i.quantidade),
        unitCost: num(i.custo_unitario)
      }))
    })),
    settings: {
      business: cfg.negocio || 'Allegra gráfica & personalizados',
      phone: cfg.telefone || '',
      address: cfg.endereco || '',
      lowStock: num(cfg.estoque_baixo) || 5
    }
  };
}

async function readState(db = pool) {
  const entities = await readRelationalEntities(db);
  return buildStateFromEntities(entities);
}

export async function buildBackupPackage(db = pool) {
  const entities = await readRelationalEntities(db);
  const appState = buildStateFromEntities(entities);
  const entityCounts = Object.fromEntries(
    Object.entries(entities).map(([key, rows]) => [key, safeArray(rows).length])
  );
  const totalRecords = Object.values(entityCounts).reduce((sum, n) => sum + n, 0);
  const checksum = createHash('sha256').update(JSON.stringify(entities)).digest('hex');
  return {
    meta: {
      system: 'Allegra Gestão Pro ERP',
      format: 'allegra-entities-v2',
      version: '0.4.0',
      exportedAt: new Date().toISOString(),
      totalRecords,
      checksum,
      entityCounts
    },
    entities,
    appState
  };
}

async function saveBackupCopyOnServer(backup, filename = 'ultimo-backup-entidades.json') {
  try {
    const backupsDir = path.resolve(__dirname, '..', 'backups');
    await mkdir(backupsDir, { recursive: true });
    const targetPath = path.join(backupsDir, filename);
    await writeFile(targetPath, JSON.stringify(backup, null, 2), 'utf8');
    return targetPath;
  } catch (err) {
    console.warn('Não foi possível gravar cópia local do backup em disco:', err.message);
    return null;
  }
}

export function rowsToCsv(rows = []) {
  const list = safeArray(rows);
  if (!list.length) return '\uFEFF';
  const headers = Array.from(
    list.reduce((set, row) => {
      if (row && typeof row === 'object') Object.keys(row).forEach(k => set.add(k));
      return set;
    }, new Set())
  );
  const escapeCell = val => {
    if (val === null || val === undefined) return '';
    const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
    if (/[";\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  };
  const lines = [
    headers.map(escapeCell).join(';'),
    ...list.map(row => headers.map(h => escapeCell(row?.[h])).join(';'))
  ];
  return '\uFEFF' + lines.join('\r\n');
}

function crc32Buffer(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function createZipArchive(files = []) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(String(file.name), 'utf8');
    const dataBuf = Buffer.isBuffer(file.content)
      ? file.content
      : Buffer.from(String(file.content ?? ''), 'utf8');
    const crc = crc32Buffer(dataBuf);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(dataBuf.length, 18);
    localHeader.writeUInt32LE(dataBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, dataBuf);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(dataBuf.length, 20);
    centralHeader.writeUInt32LE(dataBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + dataBuf.length;
  }

  const centralSize = centralParts.reduce((sum, b) => sum + b.length, 0);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(files.length, 8);
  endRecord.writeUInt16LE(files.length, 10);
  endRecord.writeUInt32LE(centralSize, 12);
  endRecord.writeUInt32LE(offset, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, endRecord]);
}

function normalizeRestorePayload(raw = {}) {
  if (!raw || typeof raw !== 'object') throw new Error('Backup inválido.');

  // Individual single-entity export file: { meta: { entity }, records: [...] }
  if (raw.meta?.entity && Array.isArray(raw.records)) {
    const entity = String(raw.meta.entity).toLowerCase();
    const childEntities = new Set([
      'compra_itens',
      'venda_itens',
      'venda_item_insumos',
      'controle_producao_itens',
      'controle_item_insumos',
      'orcamento_insumos',
      'modelo_insumos'
    ]);
    if (childEntities.has(entity)) {
      return { mode: 'child', entity, records: raw.records };
    }
    const keyMap = {
      clientes: 'clients', clients: 'clients',
      estoque: 'stock', stock: 'stock',
      produtos: 'products', products: 'products',
      compras: 'purchases', purchases: 'purchases',
      despesas: 'expenses', expenses: 'expenses',
      orcamentos: 'quotes', quotes: 'quotes',
      controles_da_producao: 'orders', orders: 'orders',
      vendas: 'sales', sales: 'sales',
      modelos: 'models', models: 'models',
      configuracoes: 'settings', settings: 'settings'
    };
    const mappedKey = keyMap[entity];
    if (!mappedKey) throw new Error(`A entidade "${entity}" não foi reconhecida.`);
    if (mappedKey === 'settings') return { mode: 'partial', changes: { settings: raw.records[0] || {} } };
    return {
      mode: 'partial',
      changes: { [mappedKey]: { upsert: raw.records, delete: [] } }
    };
  }

  // Full entity-separated backup format: { entities: { clientes, estoque, ... }, appState: { ... } }
  if (raw.entities && typeof raw.entities === 'object') {
    const reconstructed = buildStateFromEntities(raw.entities);
    const merged = raw.appState && typeof raw.appState === 'object'
      ? {
          clients: reconstructed.clients.length ? reconstructed.clients : safeArray(raw.appState.clients),
          stock: reconstructed.stock.length ? reconstructed.stock : safeArray(raw.appState.stock),
          products: safeArray(raw.entities.produtos),
          purchases: reconstructed.purchases.length ? reconstructed.purchases : safeArray(raw.appState.purchases),
          expenses: reconstructed.expenses.length ? reconstructed.expenses : safeArray(raw.appState.expenses),
          quotes: reconstructed.quotes.length ? reconstructed.quotes : safeArray(raw.appState.quotes),
          orders: reconstructed.orders.length ? reconstructed.orders : safeArray(raw.appState.orders),
          sales: reconstructed.sales.length ? reconstructed.sales : safeArray(raw.appState.sales),
          models: reconstructed.models.length ? reconstructed.models : safeArray(raw.appState.models),
          settings: raw.entities.configuracoes?.length ? reconstructed.settings : (raw.appState.settings || reconstructed.settings)
        }
      : { ...reconstructed, products: safeArray(raw.entities.produtos) };
    return { mode: 'full', state: merged };
  }

  // Top-level Portuguese relational tables object: { clientes: [...], estoque: [...], ... }
  if (Array.isArray(raw.clientes) || Array.isArray(raw.estoque) || Array.isArray(raw.controles_da_producao)) {
    const reconstructed = buildStateFromEntities(raw);
    return {
      mode: 'full',
      state: { ...reconstructed, products: safeArray(raw.produtos) }
    };
  }

  // Legacy / appState format: { clients: [...], stock: [...], ... }
  if (Array.isArray(raw.clients) || Array.isArray(raw.stock) || Array.isArray(raw.orders) || Array.isArray(raw.sales)) {
    return { mode: 'full', state: raw };
  }

  throw new Error('Formato de arquivo de backup não reconhecido.');
}

async function restoreChildEntity(db, entity, records) {
  const rows = safeArray(records);
  if (entity === 'compra_itens') {
    for (const r of rows) {
      const compraId = await existingReference(db, 'compras', r.compra_id).catch(() => null)
        || (await db.query('SELECT id FROM compras WHERE id=$1', [String(r.compra_id || '')])).rows[0]?.id;
      if (!compraId) continue;
      const qty = posNum(r.quantidade ?? r.qty, 1, 3);
      const unitCost = nonNeg(r.custo_unitario ?? r.unitCost, 4);
      await db.query(
        `INSERT INTO compra_itens(compra_id, estoque_id, nome_insumo, quantidade, custo_unitario, subtotal)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [compraId, await existingReference(db, 'estoque', r.estoque_id ?? r.stockId), String(r.nome_insumo ?? r.name ?? ''), qty, unitCost, nonNeg(r.subtotal ?? qty * unitCost, 2)]
      );
    }
    return;
  }
  if (entity === 'venda_itens') {
    for (const r of rows) {
      const vendaId = await existingReference(db, 'vendas', r.venda_id);
      if (!vendaId || !r.id) continue;
      const itemName = String(r.nome_produto ?? r.name ?? 'Produto').trim() || 'Produto';
      const itemUnitPrice = nonNeg(r.preco_unitario ?? r.unitPrice, 2);
      const productId = await ensureProduct(db, itemName, itemUnitPrice);
      await db.query(
        `INSERT INTO venda_itens(id, venda_id, produto_id, nome_produto, quantidade, preco_unitario, recebido)
         VALUES($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT(id) DO UPDATE SET
           venda_id = EXCLUDED.venda_id,
           produto_id = EXCLUDED.produto_id,
           nome_produto = EXCLUDED.nome_produto,
           quantidade = EXCLUDED.quantidade,
           preco_unitario = EXCLUDED.preco_unitario,
           recebido = EXCLUDED.recebido`,
        [String(r.id), vendaId, productId, itemName, posNum(r.quantidade ?? r.qty, 1, 3), itemUnitPrice, nonNeg(r.recebido ?? r.paidAmount, 2)]
      );
    }
    return;
  }
  if (entity === 'controle_producao_itens') {
    for (const r of rows) {
      const controleId = await existingReference(db, 'controles_da_producao', r.controle_id);
      if (!controleId || !r.id) continue;
      const itemName = String(r.nome_produto ?? r.name ?? 'Produto').trim() || 'Produto';
      const itemUnitPrice = nonNeg(r.preco_unitario ?? r.unitPrice, 2);
      const productId = await ensureProduct(db, itemName, itemUnitPrice);
      await db.query(
        `INSERT INTO controle_producao_itens(id, controle_id, produto_id, nome_produto, quantidade, preco_unitario, recebido)
         VALUES($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT(id) DO UPDATE SET
           controle_id = EXCLUDED.controle_id,
           produto_id = EXCLUDED.produto_id,
           nome_produto = EXCLUDED.nome_produto,
           quantidade = EXCLUDED.quantidade,
           preco_unitario = EXCLUDED.preco_unitario,
           recebido = EXCLUDED.recebido`,
        [String(r.id), controleId, productId, itemName, posNum(r.quantidade ?? r.qty, 1, 3), itemUnitPrice, nonNeg(r.recebido ?? r.paidAmount, 2)]
      );
    }
    return;
  }
  if (entity === 'venda_item_insumos') {
    for (const r of rows) {
      const parentId = String(r.venda_item_id || '');
      if (!parentId) continue;
      const check = await db.query('SELECT id FROM venda_itens WHERE id=$1', [parentId]);
      if (!check.rowCount) continue;
      await insertMaterials(db, 'venda_item_insumos', 'venda_item_id', parentId, [r]);
    }
    return;
  }
  if (entity === 'controle_item_insumos') {
    for (const r of rows) {
      const parentId = String(r.controle_item_id || '');
      if (!parentId) continue;
      const check = await db.query('SELECT id FROM controle_producao_itens WHERE id=$1', [parentId]);
      if (!check.rowCount) continue;
      await insertMaterials(db, 'controle_item_insumos', 'controle_item_id', parentId, [r]);
    }
    return;
  }
  if (entity === 'orcamento_insumos') {
    for (const r of rows) {
      const quoteId = String(r.orcamento_id || '');
      if (!quoteId) continue;
      const check = await db.query('SELECT id FROM orcamentos WHERE id=$1', [quoteId]);
      if (!check.rowCount) continue;
      await db.query(
        `INSERT INTO orcamento_insumos(orcamento_id, estoque_id, nome_insumo, quantidade, custo_unitario)
         VALUES($1,$2,$3,$4,$5)`,
        [quoteId, await existingReference(db, 'estoque', r.estoque_id ?? r.stockId), String(r.nome_insumo ?? r.name ?? ''), nonNeg(r.quantidade ?? r.qty, 3), nonNeg(r.custo_unitario ?? r.unitCost, 4)]
      );
    }
    return;
  }
  if (entity === 'modelo_insumos') {
    for (const r of rows) {
      const modelId = String(r.modelo_id || '');
      if (!modelId) continue;
      const check = await db.query('SELECT id FROM modelos WHERE id=$1', [modelId]);
      if (!check.rowCount) continue;
      await db.query(
        `INSERT INTO modelo_insumos(modelo_id, estoque_id, nome_insumo, quantidade, custo_unitario)
         VALUES($1,$2,$3,$4,$5)`,
        [modelId, await existingReference(db, 'estoque', r.estoque_id ?? r.stockId), String(r.nome_insumo ?? r.name ?? ''), nonNeg(r.quantidade ?? r.qty, 3), nonNeg(r.custo_unitario ?? r.unitCost, 4)]
      );
    }
  }
}

export async function restoreBackupInTransaction(db, rawPayload, replaceAll = false) {
  const parsed = normalizeRestorePayload(rawPayload);
  if (parsed.mode === 'child') {
    await restoreChildEntity(db, parsed.entity, parsed.records);
    return;
  }
  if (parsed.mode === 'partial') {
    await upsertChanges(db, parsed.changes);
    return;
  }
  if (replaceAll) {
    await db.query(
      'TRUNCATE TABLE orcamento_insumos, orcamentos, modelo_insumos, modelos, despesas, compra_itens, compras, controle_item_insumos, controle_producao_itens, controles_da_producao, venda_item_insumos, venda_itens, vendas, estoque, clientes RESTART IDENTITY CASCADE'
    );
  }
  await upsertChanges(db, wholeStateChanges(parsed.state));
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const queryToken = typeof req.query?.token === 'string' ? req.query.token : '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : queryToken;
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  }
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde 15 minutos.' }
});

app.post('/api/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (username !== ADMIN_USER || typeof password !== 'string' || !(await bcrypt.compare(password, ADMIN_PASSWORD_HASH))) {
    return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
  }
  const token = jwt.sign({ sub: 'allegra-admin', role: 'admin' }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, expiresIn: 28800 });
});

app.get('/api/state', requireAuth, async (req, res) => {
  try {
    res.json({ payload: await readState() });
  } catch (error) {
    console.error('Falha ao consultar dados relacionais:', error);
    res.status(500).json({ error: 'Não foi possível consultar os dados.' });
  }
});

app.patch('/api/sync', requireAuth, async (req, res) => {
  const changes = req.body?.changes;
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    return res.status(400).json({ error: 'Formato de alterações inválido.' });
  }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await upsertChanges(db, changes);
    await db.query('COMMIT');
    res.json({ ok: true });
  } catch (error) {
    await db.query('ROLLBACK');
    console.error('Falha ao salvar alterações relacionais:', error);
    res.status(500).json({ error: 'Não foi possível salvar as alterações.' });
  } finally {
    db.release();
  }
});

// Endpoint dedicado para garantir persistência imediata do status/etapa ao mover pedidos
app.patch('/api/orders/:id/stage', requireAuth, async (req, res) => {
  const orderId = String(req.params.id || '').trim();
  if (!orderId) return res.status(400).json({ error: 'ID do pedido é obrigatório.' });
  const stage = normalizeStage(req.body?.stage ?? req.body?.etapa ?? req.body?.status);
  const orderPayload = req.body?.order;

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const updated = await db.query(
      `UPDATE controles_da_producao
       SET etapa = $1, atualizado_em = now()
       WHERE id = $2
       RETURNING id, etapa, atualizado_em`,
      [stage, orderId]
    );
    if (!updated.rowCount) {
      if (orderPayload && typeof orderPayload === 'object') {
        await upsertProduction(db, [{ ...orderPayload, id: orderId, stage }]);
      } else {
        await db.query('ROLLBACK');
        return res.status(404).json({ error: 'Pedido não encontrado no banco de dados.' });
      }
    }
    await db.query('COMMIT');
    res.json({ ok: true, id: orderId, stage });
  } catch (error) {
    await db.query('ROLLBACK');
    console.error(`Falha ao atualizar etapa do pedido ${orderId}:`, error);
    res.status(500).json({ error: 'Não foi possível persistir o status do pedido no banco.' });
  } finally {
    db.release();
  }
});

// Exportação completa separada por entidades (JSON)
app.get('/api/backup', requireAuth, async (req, res) => {
  const db = await pool.connect();
  try {
    await db.query('BEGIN READ ONLY');
    const backup = await buildBackupPackage(db);
    await db.query('COMMIT');
    await saveBackupCopyOnServer(backup, 'ultimo-backup-entidades.json');
    const stamp = todayISO();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="allegra-backup-entidades-${stamp}.json"`);
    res.send(JSON.stringify(backup, null, 2));
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Falha ao exportar backup por entidades:', error);
    res.status(500).json({ error: 'Não foi possível gerar o backup de entidades.' });
  } finally {
    db.release();
  }
});

// Exportação em pacote ZIP com arquivos individuais por entidade (JSON + CSV)
app.get('/api/backup/zip', requireAuth, async (req, res) => {
  const db = await pool.connect();
  try {
    await db.query('BEGIN READ ONLY');
    const backup = await buildBackupPackage(db);
    await db.query('COMMIT');
    await saveBackupCopyOnServer(backup, 'ultimo-backup-entidades.json');
    const stamp = todayISO();
    const files = [
      {
        name: 'backup-completo-entidades.json',
        content: JSON.stringify(backup, null, 2)
      }
    ];
    for (const [entityName, rows] of Object.entries(backup.entities)) {
      files.push({
        name: `json/${entityName}.json`,
        content: JSON.stringify(
          {
            meta: {
              system: backup.meta.system,
              entity: entityName,
              count: safeArray(rows).length,
              exportedAt: backup.meta.exportedAt
            },
            records: safeArray(rows)
          },
          null,
          2
        )
      });
      files.push({
        name: `csv/${entityName}.csv`,
        content: rowsToCsv(rows)
      });
    }
    const zipBuffer = createZipArchive(files);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="allegra-backup-entidades-${stamp}.zip"`);
    res.send(zipBuffer);
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Falha ao gerar pacote ZIP de entidades:', error);
    res.status(500).json({ error: 'Não foi possível gerar o pacote ZIP de entidades.' });
  } finally {
    db.release();
  }
});

// Exportação individual de uma entidade específica (JSON ou CSV)
app.get('/api/backup/entity/:entity', requireAuth, async (req, res) => {
  const requested = String(req.params.entity || '').trim().toLowerCase();
  const format = String(req.query.format || 'json').toLowerCase();
  const aliasMap = {
    clients: 'clientes', clientes: 'clientes',
    stock: 'estoque', estoque: 'estoque',
    products: 'produtos', produtos: 'produtos',
    purchases: 'compras', compras: 'compras',
    compra_itens: 'compra_itens',
    quotes: 'orcamentos', orcamentos: 'orcamentos',
    orcamento_insumos: 'orcamento_insumos',
    sales: 'vendas', vendas: 'vendas',
    venda_itens: 'venda_itens',
    venda_item_insumos: 'venda_item_insumos',
    orders: 'controles_da_producao', controles_da_producao: 'controles_da_producao',
    controle_producao_itens: 'controle_producao_itens',
    controle_item_insumos: 'controle_item_insumos',
    expenses: 'despesas', despesas: 'despesas',
    models: 'modelos', modelos: 'modelos',
    modelo_insumos: 'modelo_insumos',
    settings: 'configuracoes', configuracoes: 'configuracoes'
  };
  const entityName = aliasMap[requested];
  if (!entityName) {
    return res.status(400).json({ error: 'Entidade solicitada inválida.' });
  }

  try {
    const entities = await readRelationalEntities(pool);
    const rows = safeArray(entities[entityName]);
    const stamp = todayISO();
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="allegra-${entityName}-${stamp}.csv"`);
      return res.send(rowsToCsv(rows));
    }
    const payload = {
      meta: {
        system: 'Allegra Gestão Pro ERP',
        entity: entityName,
        count: rows.length,
        exportedAt: new Date().toISOString()
      },
      records: rows
    };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="allegra-${entityName}-${stamp}.json"`);
    res.send(JSON.stringify(payload, null, 2));
  } catch (error) {
    console.error(`Falha ao exportar entidade ${entityName}:`, error);
    res.status(500).json({ error: 'Não foi possível exportar a entidade selecionada.' });
  }
});

// Restauração transacional de backup (aceita formato por entidades, entidade única ou legado)
app.post('/api/backup/restore', requireAuth, async (req, res) => {
  const backupData = req.body?.backup ?? req.body;
  const replaceAll = Boolean(req.body?.replaceAll);
  const db = await pool.connect();
  try {
    // Cria snapshot automático de segurança em disco antes de aplicar a restauração
    const preRestorePackage = await buildBackupPackage(db);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    await saveBackupCopyOnServer(preRestorePackage, `pre-restore-${stamp}.json`);

    await db.query('BEGIN');
    await restoreBackupInTransaction(db, backupData, replaceAll);
    await db.query('COMMIT');
    const afterPackage = await buildBackupPackage(db);
    res.json({
      ok: true,
      payload: afterPackage.appState,
      entityCounts: afterPackage.meta.entityCounts
    });
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Falha ao restaurar backup no banco:', error);
    res.status(400).json({ error: error.message || 'Não foi possível restaurar o backup no banco.' });
  } finally {
    db.release();
  }
});

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, service: 'allegra-intranet', storage: 'relational', dbHost: dbConfig.host, dbPort: dbConfig.port });
  } catch (error) {
    res.status(503).json({ ok: false, error: error.message, dbHost: dbConfig.host, dbPort: dbConfig.port });
  }
});

const publicDir = path.resolve(__dirname, '..');
app.use(express.static(publicDir));
app.get('*', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

async function startServer() {
  try {
    await initializeDatabase();
    console.log(`Banco PostgreSQL conectado e validado em ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}.`);
  } catch (error) {
    console.error(`ATENÇÃO: Falha ao inicializar banco PostgreSQL em ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}:`, error.message);
    if (error?.code === '28000') {
      console.error(`DICA: Libere o IP desta máquina no arquivo pg_hba.conf do servidor PostgreSQL (${dbConfig.host}), ex.: host all postgres 192.168.1.0/24 scram-sha-256`);
    }
  }
  app.listen(PORT, HOST, () => {
    console.log(`Allegra Gestão Pro ativo na porta ${PORT} (rede local -> banco ${dbConfig.host}:${dbConfig.port}).`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await startServer();
}
