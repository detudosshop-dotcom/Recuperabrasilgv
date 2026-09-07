const https = require('https');
const url = require('url');

/**
 * SpeedPag API Client
 * Documentação: https://app.speedpag.com.br/docs/intro/first-steps
 * Base URL: https://api.speedpag.com.br/v1
 */

const SPEEDPAG_DEFAULT_URL = 'https://api.speedpag.com.br/v1';

function getAuthHeader(publicKey, secretKey) {
  const token = Buffer.from(`${publicKey || ''}:${secretKey || ''}`).toString('base64');
  return `Basic ${token}`;
}

/**
 * Cria uma transação PIX na SpeedPag
 * @param {Object} params
 * @param {number} params.amountInCents - Valor em centavos (ex: 2992 para R$ 29,92)
 * @param {string} params.title - Descrição do produto
 * @param {Object} params.customer - Dados do cliente { name, email, phone, cpf }
 * @param {string} [params.postbackUrl] - URL para receber webhooks
 * @param {string} [params.externalRef] - Identificador único de referência
 * @param {string} [params.metadata] - Metadados adicionais
 * @param {Object} config - Configurações SpeedPag { public_key, secret_key, api_url }
 */
function createPixTransaction(params, config) {
  return new Promise((resolve, reject) => {
    const baseUrl = (config && config.api_url) || SPEEDPAG_DEFAULT_URL;
    const publicKey = (config && config.public_key) || '';
    const secretKey = (config && config.secret_key) || '';

    if (!publicKey || !secretKey || publicKey === 'SUA_PUBLIC_KEY_AQUI' || secretKey === 'SUA_SECRET_KEY_AQUI') {
      return resolve({
        success: false,
        waiting_keys: true,
        message: 'Chaves da SpeedPag não configuradas (defina public_key e secret_key no config.json).'
      });
    }

    const cleanCpf = (params.customer?.cpf || '').replace(/\D/g, '') || '00000000000';
    const cleanPhone = (params.customer?.phone || '11999999999').replace(/\D/g, '') || '11999999999';
    const amount = parseInt(params.amountInCents, 10) || 2992;

    const payload = {
      paymentMethod: 'pix',
      amount: amount,
      items: [
        {
          title: params.title || 'Taxa de Liberação do Valor',
          unitPrice: amount,
          quantity: 1,
          tangible: false,
          externalRef: params.externalRef || `ITEM_${Date.now()}`
        }
      ],
      customer: {
        name: (params.customer?.name || 'Cliente').trim().substring(0, 50),
        email: (params.customer?.email || 'cliente@email.com').trim().substring(0, 50),
        phone: cleanPhone,
        document: {
          type: 'cpf',
          number: cleanCpf
        }
      }
    };

    if (params.postbackUrl) {
      payload.postbackUrl = params.postbackUrl;
    }
    if (params.externalRef) {
      payload.externalRef = params.externalRef;
    }
    if (params.metadata) {
      payload.metadata = typeof params.metadata === 'string' ? params.metadata : JSON.stringify(params.metadata);
    }

    const postData = JSON.stringify(payload);
    const parsed = url.parse(`${baseUrl}/transactions`);

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': getAuthHeader(publicKey, secretKey),
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 15000
    };

    console.log('[SpeedPag] Criando transação PIX:', {
      endpoint: `${baseUrl}/transactions`,
      amount: amount,
      customer: payload.customer.name,
      cpf: payload.customer.document.number
    });

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let parsedRes;
        try {
          parsedRes = JSON.parse(body);
        } catch (e) {
          parsedRes = { raw: body };
        }

        console.log(`[SpeedPag] Status HTTP: ${res.statusCode}`);

        if (res.statusCode >= 200 && res.statusCode < 300) {
          const qrcode = parsedRes.pix?.qrcode || parsedRes.pix?.qrCode || parsedRes.qrcode || '';
          const qrCodeImage = parsedRes.pix?.qrcodeBase64 || parsedRes.qrcodeBase64 || (qrcode ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(qrcode)}` : '');

          resolve({
            success: true,
            statusCode: res.statusCode,
            transaction_id: parsedRes.id ? String(parsedRes.id) : null,
            status: (parsedRes.status || 'waiting_payment').toLowerCase(),
            amount: parsedRes.amount ? parsedRes.amount / 100 : amount / 100,
            qr_code_text: qrcode,
            qr_code_image: qrCodeImage,
            data: parsedRes
          });
        } else {
          console.error('[SpeedPag] Erro na criação:', parsedRes);
          resolve({
            success: false,
            statusCode: res.statusCode,
            error: parsedRes.message || parsedRes.error || body || 'Falha ao criar cobrança na SpeedPag',
            data: parsedRes
          });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout na conexão com SpeedPag API'));
    });

    req.on('error', (err) => {
      console.error('[SpeedPag] Erro de rede:', err.message);
      reject(err);
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Consulta o status de uma transação na SpeedPag
 * @param {string|number} transactionId
 * @param {Object} config - { public_key, secret_key, api_url }
 */
function getTransaction(transactionId, config) {
  return new Promise((resolve, reject) => {
    const baseUrl = (config && config.api_url) || SPEEDPAG_DEFAULT_URL;
    const publicKey = (config && config.public_key) || '';
    const secretKey = (config && config.secret_key) || '';

    if (!publicKey || !secretKey || publicKey === 'SUA_PUBLIC_KEY_AQUI' || secretKey === 'SUA_SECRET_KEY_AQUI') {
      return resolve({
        success: false,
        waiting_keys: true,
        message: 'Chaves da SpeedPag não configuradas.'
      });
    }

    const cleanId = String(transactionId).replace(/[^0-9a-zA-Z_-]/g, '');
    const parsed = url.parse(`${baseUrl}/transactions/${cleanId}`);

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.path,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': getAuthHeader(publicKey, secretKey)
      },
      timeout: 10000
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          const rawStatus = (data.status || '').toLowerCase();
          resolve({
            success: res.statusCode === 200,
            statusCode: res.statusCode,
            id: data.id,
            status: rawStatus,
            isPaid: rawStatus === 'approved' || rawStatus === 'paid',
            data: data
          });
        } catch (e) {
          resolve({
            success: false,
            statusCode: res.statusCode,
            raw: body
          });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout ao consultar status na SpeedPag'));
    });

    req.on('error', reject);
    req.end();
  });
}

module.exports = {
  createPixTransaction,
  getTransaction,
  getAuthHeader,
  SPEEDPAG_DEFAULT_URL
};
