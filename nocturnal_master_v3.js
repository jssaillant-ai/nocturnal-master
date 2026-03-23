const express = require('express');
const cors    = require('cors');
const fs      = require('fs').promises;
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 10000;

app.use(cors({ origin: '*', methods: ['GET','POST'] }));
app.use(express.json({ limit: '10mb' }));

// ============================================================
// CONFIG — Variables Render.com
// ============================================================
const ADMIN_KEY        = process.env.ADMIN_KEY        || 'imageine';
const PAYPAL_EMAIL     = process.env.PAYPAL_EMAIL     || 'teckseb@hotmail.com';
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';   // App PayPal Business
const PAYPAL_SECRET    = process.env.PAYPAL_SECRET    || '';   // App PayPal Business
const PAYPAL_MODE      = process.env.PAYPAL_MODE      || 'live'; // 'live' ou 'sandbox'
const SENDGRID_KEY     = process.env.SENDGRID_API_KEY || '';
const EMAIL_FROM       = process.env.EMAIL_FROM       || PAYPAL_EMAIL;
const PRICE_STD        = parseFloat(process.env.PRICE_STD || '4.99');
const PRICE_PRO        = parseFloat(process.env.PRICE_PRO || '9.99');

const PAYPAL_API = PAYPAL_MODE === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';

// ============================================================
// DATA
// ============================================================
const DATA_DIR   = path.join(__dirname, 'data');
const CODES_FILE = path.join(DATA_DIR, 'codes.json');
const ORDERS_FILE= path.join(DATA_DIR, 'orders.json');
const LOGS_FILE  = path.join(DATA_DIR, 'logs.json');

async function ensureDataDir() {
    try { await fs.access(DATA_DIR); }
    catch {
        await fs.mkdir(DATA_DIR, { recursive: true });
        for (const f of [CODES_FILE, ORDERS_FILE, LOGS_FILE])
            await fs.writeFile(f, '[]');
    }
}

async function readJSON(f) {
    try { return JSON.parse(await fs.readFile(f, 'utf8')); }
    catch { return []; }
}

async function writeJSON(f, d) {
    await fs.writeFile(f, JSON.stringify(d, null, 2));
}

async function log(action, data) {
    try {
        const logs = await readJSON(LOGS_FILE);
        logs.push({ action, data, at: new Date().toISOString() });
        if (logs.length > 2000) logs.splice(0, logs.length - 2000);
        await writeJSON(LOGS_FILE, logs);
    } catch(e) {}
}

// ============================================================
// HELPERS
// ============================================================
function generateCode(tier) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const part  = n => Array.from({length:n}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
    return tier === 'pro' ? `NP-PRO-${part(4)}-${part(4)}` : `NP-${part(4)}-${part(4)}`;
}

function detectTier(amount) {
    const a = parseFloat(amount) || 0;
    if (a >= PRICE_PRO  - 0.50) return 'pro';
    if (a >= PRICE_STD  - 0.50) return 'standard';
    return null;
}

// ============================================================
// PAYPAL API — Access Token
// ============================================================
let _ppToken = null, _ppTokenExpiry = 0;

async function getPayPalToken() {
    if (_ppToken && Date.now() < _ppTokenExpiry) return _ppToken;
    if (!PAYPAL_CLIENT_ID || !PAYPAL_SECRET) return null;

    const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
            'Authorization': 'Basic ' + Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
    });
    const data = await res.json();
    _ppToken       = data.access_token;
    _ppTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return _ppToken;
}

// Créer un Order PayPal (étape 1 du SDK)
async function createPayPalOrder(tier) {
    const token = await getPayPalToken();
    if (!token) throw new Error('PayPal non configuré — PAYPAL_CLIENT_ID/SECRET manquants');

    const amount = tier === 'pro' ? PRICE_PRO : PRICE_STD;
    const res = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            intent: 'CAPTURE',
            purchase_units: [{
                amount: { currency_code: 'USD', value: amount.toFixed(2) },
                description: `NOCTURNAL PLEASURE — ${tier === 'pro' ? 'PRO 60/jour' : 'STANDARD 25/jour'}`
            }]
        })
    });
    return await res.json();
}

// Capturer le paiement (étape 2 — après approbation client)
async function capturePayPalOrder(orderId) {
    const token = await getPayPalToken();
    if (!token) throw new Error('PayPal non configuré');

    const res = await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderId}/capture`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    return await res.json();
}

// ============================================================
// SENDGRID EMAIL
// ============================================================
async function sendCodeByEmail(email, code, tier) {
    if (!SENDGRID_KEY) { console.log(`📧 [NO SENDGRID] Code ${code} → ${email}`); return false; }

    const tierLabel = tier === 'pro' ? '🚀 PRO — 60 générations/jour' : '⭐ STANDARD — 25 générations/jour';
    const html = `<!DOCTYPE html><html><body style="background:#07090f;color:#e0e0e0;font-family:Arial,sans-serif;padding:30px;">
<div style="max-width:500px;margin:0 auto;background:#121620;border-radius:16px;padding:30px;border:1px solid rgba(255,215,0,0.3);">
  <h1 style="color:#ffd700;text-align:center;margin:0 0 6px">🌙 NOCTURNAL PLEASURE</h1>
  <p style="text-align:center;color:#aaa;margin:0 0 20px;font-size:0.9em;">Merci pour votre achat !</p>
  <div style="background:#0a0c12;border:2px solid #ffd700;border-radius:12px;padding:20px;margin:0 0 16px;text-align:center;">
    <p style="margin:0 0 6px;color:#888;font-size:12px;">Votre code d'activation :</p>
    <div style="font-size:26px;font-weight:900;color:#ffd700;letter-spacing:3px;font-family:monospace;">${code}</div>
    <p style="margin:8px 0 0;color:#aaa;font-size:12px;">${tierLabel}</p>
  </div>
  <div style="background:#1a1f2e;border-radius:8px;padding:14px;font-size:13px;color:#aaa;">
    <p style="margin:0 0 6px;font-weight:bold;color:#e0e0e0;">Comment activer :</p>
    <ol style="margin:0;padding-left:18px;line-height:1.9;">
      <li>Ouvrez NOCTURNAL PLEASURE</li>
      <li>Cliquez <strong style="color:#ffd700;">Obtenir accès</strong></li>
      <li>Entrez le code ci-dessus</li>
      <li>Cliquez <strong style="color:#ffd700;">ACTIVER</strong></li>
    </ol>
  </div>
  <p style="text-align:center;font-size:11px;color:#555;margin-top:16px;">Support : ${PAYPAL_EMAIL} — 18+ uniquement</p>
</div></body></html>`;

    try {
        const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${SENDGRID_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                personalizations: [{ to: [{ email }] }],
                from: { email: EMAIL_FROM, name: 'NOCTURNAL PLEASURE' },
                subject: `🌙 Votre code NOCTURNAL : ${code}`,
                content: [{ type: 'text/html', value: html }]
            })
        });
        if (res.ok) { console.log(`✅ Email → ${email}`); return true; }
        const err = await res.text();
        console.error(`❌ SendGrid ${res.status}:`, err);
        return false;
    } catch(e) { console.error('❌ Email error:', e.message); return false; }
}

// ============================================================
// ROUTES
// ============================================================

app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK', version: 'V6',
        paypal: PAYPAL_CLIENT_ID ? `${PAYPAL_MODE} ✅` : '⚠️ PAYPAL_CLIENT_ID manquant',
        email:  SENDGRID_KEY     ? 'SendGrid ✅'       : '⚠️ No email',
        uptime: process.uptime()
    });
});

// ── ÉTAPE 1 : Créer l'ordre PayPal ─────────────────────────
// HTML → serveur : { tier, email }
// Serveur → PayPal API → retourne { id } pour le SDK JS
app.post('/api/paypal/create-order', async (req, res) => {
    try {
        const { tier, email } = req.body;
        if (!email || !email.includes('@'))
            return res.json({ success: false, error: 'Email invalide' });

        localStorage_pending = email; // simple log
        const order = await createPayPalOrder(tier || 'standard');
        await log('paypal_create', { tier, email, orderId: order.id });
        res.json({ id: order.id });

    } catch(e) {
        console.error('/api/paypal/create-order:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ── ÉTAPE 2 : Capturer + générer code ──────────────────────
// HTML → serveur : { orderId, email, tier }
// Serveur capture PayPal → génère code → email → retourne code
app.post('/api/paypal/capture-order', async (req, res) => {
    try {
        const { orderId, email, tier } = req.body;
        if (!orderId || !email)
            return res.json({ success: false, error: 'Données manquantes' });

        // Vérifier doublon
        const orders = await readJSON(ORDERS_FILE);
        const existing = orders.find(o => o.paypalOrderId === orderId);
        if (existing) {
            await log('capture_duplicate', { orderId, email });
            return res.json({ success: true, code: existing.code, tier: existing.tier, alreadyIssued: true });
        }

        // Capturer le paiement PayPal
        const capture = await capturePayPalOrder(orderId);
        if (capture.status !== 'COMPLETED') {
            await log('capture_fail', { orderId, status: capture.status });
            return res.json({ success: false, error: 'Paiement non complété: ' + capture.status });
        }

        // Détecter le tier depuis le montant capturé
        const capturedAmount = parseFloat(
            capture.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value || 0
        );
        const finalTier = tier || detectTier(capturedAmount) || 'standard';

        // Générer le code
        const code = generateCode(finalTier);

        // Sauvegarder code
        const codes = await readJSON(CODES_FILE);
        codes.push({ code, tier: finalTier, used: false, email, paypalOrderId: orderId, createdAt: new Date().toISOString() });
        await writeJSON(CODES_FILE, codes);

        // Sauvegarder commande
        const order = { paypalOrderId: orderId, email, tier: finalTier, amount: capturedAmount, code, createdAt: new Date().toISOString() };
        orders.push(order);
        await writeJSON(ORDERS_FILE, orders);

        // Envoyer email
        const emailSent = await sendCodeByEmail(email, code, finalTier);

        await log('capture_ok', { orderId, email, code, tier: finalTier, emailSent });
        res.json({ success: true, code, tier: finalTier, emailSent });

    } catch(e) {
        console.error('/api/paypal/capture-order:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ── ACTIVATION ─────────────────────────────────────────────
app.post('/api/activate', async (req, res) => {
    try {
        const { code, userId } = req.body;
        if (!code) return res.json({ success: false, error: 'Code requis' });

        const codeUpper = code.toUpperCase().trim();
        const codes     = await readJSON(CODES_FILE);
        const entry     = codes.find(c => c.code === codeUpper);

        if (!entry) {
            await log('activate_fail', { code: codeUpper, reason: 'not_found' });
            return res.json({ success: false, error: 'Invalid code' });
        }
        if (entry.used) {
            await log('activate_fail', { code: codeUpper, reason: 'already_used' });
            return res.json({ success: false, error: 'Code already used' });
        }

        entry.used   = true;
        entry.usedBy = userId || 'unknown';
        entry.usedAt = new Date().toISOString();
        await writeJSON(CODES_FILE, codes);

        const tier = codeUpper.startsWith('NP-PRO-') ? 'pro' : 'standard';
        await log('activate_ok', { code: codeUpper, tier, userId });
        res.json({ success: true, tier });

    } catch(e) { res.status(500).json({ success: false, error: 'Server error' }); }
});

// ── ADMIN ──────────────────────────────────────────────────
app.get('/api/admin/analytics', async (req, res) => {
    try {
        if (req.query.adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Forbidden' });
        const codes  = await readJSON(CODES_FILE);
        const orders = await readJSON(ORDERS_FILE);
        const revenue = orders.reduce((s,o) => s + (o.amount||0), 0);
        res.json({
            totalCodes: codes.length,
            usedCodes:  codes.filter(c=>c.used).length,
            unusedCodes:codes.filter(c=>!c.used).length,
            proCodes:   codes.filter(c=>c.tier==='pro').length,
            stdCodes:   codes.filter(c=>c.tier==='standard').length,
            totalOrders: orders.length, totalRevenue: revenue.toFixed(2),
            recentOrders: orders.slice(-20).reverse()
        });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/generate', async (req, res) => {
    try {
        if (req.body.adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Forbidden' });
        const n = Math.min(parseInt(req.body.count)||1, 50);
        const codes = await readJSON(CODES_FILE);
        const newCodes = [];
        for (let i=0; i<n; i++) {
            const code = generateCode(req.body.tier==='pro' ? 'pro' : 'standard');
            codes.push({ code, tier: req.body.tier||'standard', used: false, createdAt: new Date().toISOString() });
            newCodes.push(code);
        }
        await writeJSON(CODES_FILE, codes);
        res.json({ success: true, codes: newCodes });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Exposer le Client ID PayPal au HTML (public, sans secret)
app.get('/api/paypal/client-id', (req, res) => {
    res.json({ clientId: PAYPAL_CLIENT_ID, mode: PAYPAL_MODE });
});

app.get('/', (req, res) => {
    res.json({
        name: 'NOCTURNAL SERVER V6 — PayPal SDK auto',
        flow: 'PayPal SDK → create-order → approve → capture-order → code + email',
        endpoints: [
            'POST /api/paypal/create-order  — Crée l\'ordre PayPal',
            'POST /api/paypal/capture-order — Capture + génère code + email',
            'GET  /api/paypal/client-id     — Client ID public pour SDK',
            'POST /api/activate             — Valide et consomme un code',
            'GET  /api/health               — Santé serveur',
            'GET  /api/admin/analytics      — Stats (admin)',
            'POST /api/admin/generate       — Générer codes manuels (admin)',
        ]
    });
});

ensureDataDir().then(() => {
    app.listen(PORT, () => {
        console.log('==============================================');
        console.log('🌙 NOCTURNAL SERVER V6 — PayPal SDK');
        console.log('==============================================');
        console.log(`✅ Port: ${PORT} | Mode: ${PAYPAL_MODE}`);
        console.log(`💳 PayPal API: ${PAYPAL_CLIENT_ID ? '✅ configuré' : '⚠️ MANQUE PAYPAL_CLIENT_ID'}`);
        console.log(`📧 SendGrid:   ${SENDGRID_KEY ? '✅ configuré' : '⚠️ pas d\'email'}`);
        console.log(`💰 Prix: STD $${PRICE_STD} | PRO $${PRICE_PRO}`);
        console.log('==============================================');
    });
});
