const crypto = require('crypto');

const PIXEL_ID     = 'DA835D3C77UES9745010';
const ACCESS_TOKEN = 'dee6c87ca5dad685e70bdc84a02544acf47df5ae';
const PAGE_URL     = 'https://direitodobrasileiro.com';

function sha256(value) {
  if (!value || typeof value !== 'string') return undefined;
  return crypto.createHash('sha256').update(value.toLowerCase().trim()).digest('hex');
}

function formatBrazilPhone(raw) {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) return '+' + digits;
  return '+55' + digits;
}

function parseCookie(cookieStr, name) {
  if (!cookieStr) return '';
  const match = cookieStr.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : '';
}

async function sendCapiEvent(eventName, { email, phone, doc, amount, txId, ttclid, ttp, ip, userAgent }) {
  const eventTime = Math.floor(Date.now() / 1000);
  const user = {};

  if (email)     user.email        = sha256(email);
  if (phone)     user.phone_number = sha256(formatBrazilPhone(phone));
  if (doc)       user.external_id  = sha256(doc.replace(/\D/g, ''));
  if (ttclid)    user.ttclid       = ttclid;
  if (ttp)       user.ttp          = ttp;
  if (ip)        user.ip           = String(ip).split(',')[0].trim();
  if (userAgent) user.user_agent   = userAgent;

  const eventData = {
    event:      eventName,
    event_time: eventTime,
    event_id:   `rb_${eventName.toLowerCase()}_${String(txId)}`,
    user,
    page: { url: PAGE_URL }
  };

  if (eventName === 'CompletePayment' && amount) {
    eventData.properties = {
      value:        parseFloat(amount) || 0,
      currency:     'BRL',
      content_type: 'product',
      contents: [{
        content_id:   'taxa-confirmacao-rb',
        content_name: 'Taxa de Libera\u00e7\u00e3o do Valor - Recupera Brasil',
        quantity:     1,
        price:        parseFloat(amount) || 0
      }]
    };
  }

  const payload = {
    event_source:    'web',
    event_source_id: PIXEL_ID,
    data: [eventData]
  };

  try {
    const response = await fetch('https://business-api.tiktok.com/open_api/v1.3/event/track/', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'Access-Token': ACCESS_TOKEN
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    console.log(`[TikTok CAPI] ${eventName} | tx: ${txId} | code: ${data.code} | msg: ${data.message}`);
    return data;
  } catch (err) {
    console.error(`[TikTok CAPI] Error on ${eventName}:`, err.message);
    return null;
  }
}

async function sendPurchaseEvent(params) {
  return sendCapiEvent('CompletePayment', params);
}

async function sendInitiateCheckoutEvent(params) {
  return sendCapiEvent('InitiateCheckout', params);
}

async function sendViewContentEvent(params) {
  return sendCapiEvent('ViewContent', params);
}

module.exports = { sendPurchaseEvent, sendInitiateCheckoutEvent, sendViewContentEvent, parseCookie };
