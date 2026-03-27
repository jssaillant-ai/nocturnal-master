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
const ADMIN_KEY      = process.env.ADMIN_KEY      || 'imageine';
const SENDGRID_KEY   = process.env.SENDGRID_API_KEY || '';
const EMAIL_FROM     = process.env.EMAIL_FROM     || '';
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || EMAIL_FROM;

// Interac e-Transfer
const INTERAC_EMAIL    = process.env.INTERAC_EMAIL    || '';   // ex: teckseb@hotmail.com
const INTERAC_PASSWORD = process.env.INTERAC_PASSWORD || '';   // mot de passe sécurité optionnel

// Prix CAD (modifiables via Render env vars)
const PRICE_STD = parseFloat(process.env.PRICE_STD || '4.99');
const PRICE_PRO = parseFloat(process.env.PRICE_PRO || '9.99');

// ============================================================
// DATA
// ============================================================
const DATA_DIR    = path.join(__dirname, 'data');
const CODES_FILE  = path.join(DATA_DIR, 'codes.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const LOGS_FILE   = path.join(DATA_DIR, 'logs.json');

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

function getTierData(tier) {
    return tier === 'pro'
        ? { label: '🚀 PRO',      price: PRICE_PRO, desc: '60 générations/jour' }
        : { label: '⭐ STANDARD', price: PRICE_STD, desc: '25 générations/jour' };
}

// ============================================================
// SENDGRID EMAIL
// ============================================================
async function sendEmail(to, subject, html) {
    if (!SENDGRID_KEY) {
        console.log(`📧 [NO SENDGRID] To: ${to} | Subject: ${subject}`);
        return false;
    }
    try {
        const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${SENDGRID_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                personalizations: [{ to: [{ email: to }] }],
                from: { email: EMAIL_FROM, name: 'NOCTURNAL PLEASURE' },
                subject,
                content: [{ type: 'text/html', value: html }]
            })
        });
        if (res.ok) { console.log(`✅ Email → ${to}`); return true; }
        console.error(`❌ SendGrid ${res.status}:`, await res.text());
        return false;
    } catch(e) { console.error('❌ Email error:', e.message); return false; }
}

// ============================================================
// EMAIL TEMPLATES
// ============================================================

// 1. Confirmation de commande → client (instructions paiement)
function emailOrderConfirm(name, email, tier, orderId) {
    const t = getTierData(tier);
    const pw = INTERAC_PASSWORD
        ? `<p style="margin:6px 0;">Mot de passe sécurité : <strong style="color:#ffd700;">${INTERAC_PASSWORD}</strong></p>`
        : '';
    return `<!DOCTYPE html><html><body style="background:#07090f;color:#e0e0e0;font-family:Arial,sans-serif;padding:30px;">
<div style="max-width:520px;margin:0 auto;background:#121620;border-radius:16px;padding:30px;border:1px solid rgba(255,215,0,0.3);">
  <h1 style="color:#ffd700;text-align:center;margin:0 0 4px;">🌙 NOCTURNAL PLEASURE</h1>
  <p style="text-align:center;color:#aaa;margin:0 0 22px;font-size:0.9em;">Commande reçue — Merci ${name} !</p>

  <div style="background:#1a1f2e;border-radius:10px;padding:14px;margin-bottom:16px;">
    <p style="margin:0 0 6px;color:#888;font-size:12px;">Commande #${orderId}</p>
    <p style="margin:0;font-size:15px;">${t.label} — <strong style="color:#ffd700;">$${t.price} CAD</strong> (${t.desc})</p>
  </div>

  <div style="background:#0a0c12;border:2px solid #ffd700;border-radius:12px;padding:20px;margin-bottom:16px;">
    <p style="margin:0 0 10px;font-weight:bold;color:#ffd700;">💳 Envoyer le virement Interac à :</p>
    <p style="margin:0 0 6px;font-size:18px;font-weight:bold;">${INTERAC_EMAIL}</p>
    ${pw}
    <p style="margin:10px 0 4px;">Montant : <strong style="color:#ffd700;">$${t.price} CAD</strong></p>
    <p style="margin:0;">Message du virement : <strong style="color:#ffd700;">${orderId}</strong></p>
  </div>

  <div style="background:#1a1f2e;border-radius:8px;padding:14px;font-size:13px;color:#aaa;">
    <p style="margin:0;">✅ Une fois le paiement confirmé, votre code d'activation sera envoyé à <strong>${email}</strong> sous quelques heures.</p>
  </div>
  <p style="text-align:center;font-size:11px;color:#555;margin-top:18px;">Support : ${INTERAC_EMAIL} — 18+ uniquement</p>
</div></body></html>`;
}

// 2. Code d'activation → client (après approbation)
function emailActivationCode(email, code, tier) {
    const t = getTierData(tier);
    return `<!DOCTYPE html><html><body style="background:#07090f;color:#e0e0e0;font-family:Arial,sans-serif;padding:30px;">
<div style="max-width:500px;margin:0 auto;background:#121620;border-radius:16px;padding:30px;border:1px solid rgba(255,215,0,0.3);">
  <h1 style="color:#ffd700;text-align:center;margin:0 0 6px;">🌙 NOCTURNAL PLEASURE</h1>
  <p style="text-align:center;color:#aaa;margin:0 0 20px;font-size:0.9em;">Paiement confirmé — voici votre code !</p>
  <div style="background:#0a0c12;border:2px solid #ffd700;border-radius:12px;padding:20px;margin:0 0 16px;text-align:center;">
    <p style="margin:0 0 6px;color:#888;font-size:12px;">Votre code d'activation :</p>
    <div style="font-size:28px;font-weight:900;color:#ffd700;letter-spacing:3px;font-family:monospace;">${code}</div>
    <p style="margin:8px 0 0;color:#aaa;font-size:12px;">${t.label} — ${t.desc}</p>
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
  <p style="text-align:center;font-size:11px;color:#555;margin-top:16px;">Support : ${INTERAC_EMAIL || EMAIL_FROM} — 18+ uniquement</p>
</div></body></html>`;
}

// 3. Notification admin → toi (nouvelle commande à vérifier)
function emailAdminNotif(order) {
    const t = getTierData(order.tier);
    return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#07090f;color:#e0e0e0;padding:30px;">
<div style="max-width:500px;margin:0 auto;background:#121620;border-radius:12px;padding:25px;border:1px solid #ffd700;">
  <h2 style="color:#ffd700;margin:0 0 16px;">🔔 Nouvelle commande Interac</h2>
  <table style="width:100%;border-collapse:collapse;font-size:14px;">
    <tr><td style="color:#888;padding:5px 0;">Commande</td><td style="color:#ffd700;font-weight:bold;">${order.orderId}</td></tr>
    <tr><td style="color:#888;padding:5px 0;">Nom</td><td>${order.name}</td></tr>
    <tr><td style="color:#888;padding:5px 0;">Email</td><td>${order.email}</td></tr>
    <tr><td style="color:#888;padding:5px 0;">Tier</td><td>${t.label} — $${t.price} CAD</td></tr>
    <tr><td style="color:#888;padding:5px 0;">Confirmation #</td><td style="color:#ffd700;font-weight:bold;">${order.confirmation}</td></tr>
    <tr><td style="color:#888;padding:5px 0;">Reçu le</td><td>${new Date(order.createdAt).toLocaleString('fr-CA')}</td></tr>
  </table>
  <hr style="border-color:rgba(255,215,0,0.2);margin:18px 0;">
  <p style="color:#aaa;font-size:13px;margin:0 0 8px;">Approuver via API :</p>
  <code style="background:#0a0c12;padding:10px;display:block;border-radius:6px;font-size:12px;word-break:break-all;color:#ffd700;">
    POST /api/admin/approve<br>
    { "adminKey": "${ADMIN_KEY}", "orderId": "${order.orderId}" }
  </code>
</div></body></html>`;
}

// ============================================================
// ROUTES — INTERAC
// ============================================================

// Client soumet sa commande
app.post('/api/interac/order', async (req, res) => {
    try {
        const { name, email, tier, confirmation } = req.body;

        if (!name || !email || !tier || !confirmation)
            return res.json({ success: false, error: 'Champs requis : name, email, tier, confirmation' });
        if (!email.includes('@'))
            return res.json({ success: false, error: 'Email invalide' });
        if (!['standard','pro'].includes(tier))
            return res.json({ success: false, error: 'Tier invalide : standard ou pro' });

        const orderId = 'INT-' + Date.now() + '-' + Math.random().toString(36).substr(2,4).toUpperCase();
        const t       = getTierData(tier);

        const order = {
            orderId,
            name,
            email,
            tier,
            price:       t.price,
            confirmation,
            status:      'PENDING',
            code:        null,
            createdAt:   new Date().toISOString(),
            processedAt: null
        };

        const orders = await readJSON(ORDERS_FILE);
        orders.push(order);
        await writeJSON(ORDERS_FILE, orders);

        // Email client
        await sendEmail(
            email,
            `🌙 NOCTURNAL — Commande reçue #${orderId}`,
            emailOrderConfirm(name, email, tier, orderId)
        );

        // Notif admin
        if (ADMIN_EMAIL) {
            await sendEmail(
                ADMIN_EMAIL,
                `🔔 Nouvelle commande Interac : ${orderId} — $${t.price} CAD`,
                emailAdminNotif(order)
            );
        }

        await log('interac_order', { orderId, email, tier, price: t.price });
        res.json({ success: true, orderId, message: 'Commande reçue. Vérifiez vos emails pour les instructions.' });

    } catch(e) {
        console.error('/api/interac/order:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Retourner les tiers et l'email Interac (public — pour affichage dans le HTML)
app.get('/api/interac/info', (req, res) => {
    res.json({
        interacEmail: INTERAC_EMAIL,
        interacPassword: INTERAC_PASSWORD ? true : false,  // boolean seulement, pas le mot de passe
        tiers: {
            standard: { price: PRICE_STD, desc: '25 générations/jour', code_prefix: 'NP-' },
            pro:      { price: PRICE_PRO, desc: '60 générations/jour', code_prefix: 'NP-PRO-' }
        }
    });
});

// ============================================================
// ROUTES — ADMIN
// ============================================================

// Lister les commandes
app.get('/api/admin/orders', async (req, res) => {
    try {
        if (req.query.adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Forbidden' });
        const orders  = await readJSON(ORDERS_FILE);
        const status  = req.query.status;
        const filtered = status ? orders.filter(o => o.status === status) : orders;
        res.json({
            total:    filtered.length,
            pending:  orders.filter(o => o.status === 'PENDING').length,
            approved: orders.filter(o => o.status === 'APPROVED').length,
            orders:   filtered.slice().reverse()
        });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Approuver une commande → génère code + envoie email
app.post('/api/admin/approve', async (req, res) => {
    try {
        if (req.body.adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Forbidden' });

        const { orderId } = req.body;
        const orders = await readJSON(ORDERS_FILE);
        const order  = orders.find(o => o.orderId === orderId);

        if (!order)                        return res.status(404).json({ error: 'Commande introuvable' });
        if (order.status !== 'PENDING')    return res.status(400).json({ error: 'Commande déjà ' + order.status });

        const code = generateCode(order.tier);

        // Sauvegarder code
        const codes = await readJSON(CODES_FILE);
        codes.push({
            code,
            tier:      order.tier,
            used:      false,
            email:     order.email,
            orderId:   order.orderId,
            createdAt: new Date().toISOString()
        });
        await writeJSON(CODES_FILE, codes);

        // Mettre à jour commande
        order.status      = 'APPROVED';
        order.code        = code;
        order.processedAt = new Date().toISOString();
        await writeJSON(ORDERS_FILE, orders);

        // Email au client
        const emailSent = await sendEmail(
            order.email,
            `🌙 NOCTURNAL — Votre code d'activation : ${code}`,
            emailActivationCode(order.email, code, order.tier)
        );

        await log('approve_ok', { orderId, code, email: order.email, emailSent });
        res.json({ success: true, orderId, code, email: order.email, emailSent });

    } catch(e) {
        console.error('/api/admin/approve:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// Rejeter une commande
app.post('/api/admin/reject', async (req, res) => {
    try {
        if (req.body.adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Forbidden' });

        const { orderId, note } = req.body;
        const orders = await readJSON(ORDERS_FILE);
        const order  = orders.find(o => o.orderId === orderId);

        if (!order)                     return res.status(404).json({ error: 'Commande introuvable' });
        if (order.status !== 'PENDING') return res.status(400).json({ error: 'Commande déjà ' + order.status });

        order.status      = 'REJECTED';
        order.note        = note || 'Paiement non confirmé';
        order.processedAt = new Date().toISOString();
        await writeJSON(ORDERS_FILE, orders);

        await sendEmail(order.email,
            `🌙 NOCTURNAL — Mise à jour commande #${orderId}`,
            `<div style="font-family:Arial;background:#07090f;color:#e0e0e0;padding:30px;">
             <div style="max-width:480px;margin:0 auto;background:#121620;border-radius:12px;padding:25px;">
             <h2 style="color:#ffd700;">Commande #${orderId}</h2>
             <p>Nous n'avons pas pu confirmer votre virement Interac.</p>
             ${note ? `<p>Raison : ${note}</p>` : ''}
             <p>Si vous pensez qu'il s'agit d'une erreur, répondez à cet email.</p>
             </div></div>`
        );

        await log('reject', { orderId, note });
        res.json({ success: true, orderId, status: 'REJECTED' });

    } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// ROUTES — EXISTANTES (inchangées)
// ============================================================

// Valider et consommer un code
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

// Stats admin
app.get('/api/admin/analytics', async (req, res) => {
    try {
        if (req.query.adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Forbidden' });
        const codes  = await readJSON(CODES_FILE);
        const orders = await readJSON(ORDERS_FILE);
        const revenue = orders
            .filter(o => o.status === 'APPROVED')
            .reduce((s,o) => s + (o.price||0), 0);
        res.json({
            totalCodes:   codes.length,
            usedCodes:    codes.filter(c=>c.used).length,
            unusedCodes:  codes.filter(c=>!c.used).length,
            proCodes:     codes.filter(c=>c.tier==='pro').length,
            stdCodes:     codes.filter(c=>c.tier==='standard').length,
            totalOrders:  orders.length,
            pendingOrders:orders.filter(o=>o.status==='PENDING').length,
            totalRevenue: revenue.toFixed(2),
            recentOrders: orders.slice(-20).reverse()
        });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Générer codes manuels
app.post('/api/admin/generate', async (req, res) => {
    try {
        if (req.body.adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Forbidden' });
        const n      = Math.min(parseInt(req.body.count)||1, 50);
        const tier   = req.body.tier === 'pro' ? 'pro' : 'standard';
        const codes  = await readJSON(CODES_FILE);
        const newCodes = [];
        for (let i=0; i<n; i++) {
            const code = generateCode(tier);
            codes.push({ code, tier, used: false, createdAt: new Date().toISOString() });
            newCodes.push(code);
        }
        await writeJSON(CODES_FILE, codes);
        res.json({ success: true, codes: newCodes });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Santé
app.get('/api/health', (req, res) => {
    res.json({
        status:  'OK',
        version: 'V7 — Interac e-Transfer',
        interac: INTERAC_EMAIL ? `✅ ${INTERAC_EMAIL}` : '⚠️ INTERAC_EMAIL manquant',
        email:   SENDGRID_KEY  ? 'SendGrid ✅'         : '⚠️ No email',
        uptime:  process.uptime()
    });
});

app.get('/', (req, res) => {
    res.json({
        name: 'NOCTURNAL SERVER V7 — Interac e-Transfer',
        endpoints: [
            'POST /api/interac/order    — Soumettre une commande (name, email, tier, confirmation)',
            'GET  /api/interac/info     — Email Interac + tiers (public)',
            'POST /api/activate         — Valider un code',
            'GET  /api/health           — Santé serveur',
            'GET  /api/admin/orders     — Lister commandes (adminKey)',
            'POST /api/admin/approve    — Approuver + envoyer code (adminKey, orderId)',
            'POST /api/admin/reject     — Rejeter commande (adminKey, orderId)',
            'GET  /api/admin/analytics  — Stats (adminKey)',
            'POST /api/admin/generate   — Générer codes manuels (adminKey)',
        ]
    });
});

ensureDataDir().then(() => {
    app.listen(PORT, () => {
        console.log('==============================================');
        console.log('🌙 NOCTURNAL SERVER V7 — Interac e-Transfer');
        console.log('==============================================');
        console.log(`✅ Port    : ${PORT}`);
        console.log(`💳 Interac : ${INTERAC_EMAIL || '⚠️ INTERAC_EMAIL manquant'}`);
        console.log(`📧 Email   : ${SENDGRID_KEY ? 'SendGrid ✅' : '⚠️ pas de SendGrid'}`);
        console.log(`🔑 Admin   : ADMIN_KEY configuré`);
        console.log(`💰 Prix    : STD $${PRICE_STD} | PRO $${PRICE_PRO} CAD`);
        console.log('==============================================');
    });
});
