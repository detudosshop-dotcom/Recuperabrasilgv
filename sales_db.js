/**
 * sales_db.js — Banco de dados de vendas aprovadas (Recupera Brasil)
 * Persiste em sales.json, thread-safe via write-on-change.
 * Registra toda venda aprovada e o resultado do envio ao TikTok CAPI.
 */

const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'sales.json');

// ─── Helpers internos ────────────────────────────────────────────────────────

function _read() {
  try {
    if (fs.existsSync(DB_PATH)) {
      return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('[SalesDB] Erro ao ler sales.json:', e.message);
  }
  return { sales: [] };
}

function _write(db) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
  } catch (e) {
    console.error('[SalesDB] Erro ao salvar sales.json:', e.message);
  }
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Registra ou atualiza uma venda aprovada no banco.
 * @param {string} txId            — ID da transação FlevoPay
 * @param {object} saleData        — { email, phone, doc, amount, ip, userAgent, ttclid, source }
 * @param {string} [capiStatus]    — 'pending' | 'sent' | 'error'
 * @param {object} [capiResponse]  — resposta bruta do TikTok CAPI
 */
function saveSale(txId, saleData, capiStatus = 'pending', capiResponse = null) {
  const db   = _read();
  const idx  = db.sales.findIndex(s => s.txId === txId);
  const now  = new Date().toISOString();

  const record = {
    txId,
    createdAt:    idx === -1 ? now : db.sales[idx].createdAt,
    updatedAt:    now,
    email:        saleData.email        || '',
    phone:        saleData.phone        || '',
    doc:          saleData.doc          || '',
    amount:       saleData.amount       || 0,
    ip:           saleData.ip           || '',
    userAgent:    saleData.userAgent    || '',
    ttclid:       saleData.ttclid       || '',
    source:       saleData.source       || 'unknown',   // 'polling' | 'webhook'
    capiStatus,                                          // 'pending' | 'sent' | 'error'
    capiResponse,
    manualRetries: idx === -1 ? 0 : (db.sales[idx].manualRetries || 0)
  };

  if (idx === -1) {
    db.sales.push(record);
    console.log(`[SalesDB] ✅ Nova venda registrada: ${txId} | R$ ${saleData.amount} | capi: ${capiStatus}`);
  } else {
    db.sales[idx] = record;
    console.log(`[SalesDB] 🔄 Venda atualizada: ${txId} | capi: ${capiStatus}`);
  }

  _write(db);
  return record;
}

/**
 * Atualiza apenas o status/resposta CAPI de uma venda já existente.
 */
function updateCapiStatus(txId, capiStatus, capiResponse = null) {
  const db  = _read();
  const idx = db.sales.findIndex(s => s.txId === txId);
  if (idx === -1) {
    console.warn(`[SalesDB] updateCapiStatus: txId ${txId} não encontrado`);
    return null;
  }
  db.sales[idx].capiStatus   = capiStatus;
  db.sales[idx].capiResponse = capiResponse;
  db.sales[idx].updatedAt    = new Date().toISOString();
  if (capiStatus === 'sent') {
    db.sales[idx].manualRetries = (db.sales[idx].manualRetries || 0) + 1;
  }
  _write(db);
  console.log(`[SalesDB] CAPI status → ${capiStatus} | tx: ${txId}`);
  return db.sales[idx];
}

/** Retorna todas as vendas (mais recentes primeiro) */
function getAllSales() {
  const db = _read();
  return [...db.sales].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/** Retorna vendas com CAPI não confirmado (pending ou error) */
function getPendingSales() {
  return getAllSales().filter(s => s.capiStatus !== 'sent');
}

/** Retorna uma venda pelo txId */
function getSale(txId) {
  const db = _read();
  return db.sales.find(s => s.txId === txId) || null;
}

/** Stats rápidos */
function getStats() {
  const all  = getAllSales();
  const sent = all.filter(s => s.capiStatus === 'sent').length;
  const pend = all.filter(s => s.capiStatus === 'pending').length;
  const err  = all.filter(s => s.capiStatus === 'error').length;
  const totalRevenue = all.reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0);
  return {
    total: all.length,
    capiSent: sent,
    capiPending: pend,
    capiError: err,
    totalRevenue: totalRevenue.toFixed(2)
  };
}

module.exports = { saveSale, updateCapiStatus, getAllSales, getPendingSales, getSale, getStats };
