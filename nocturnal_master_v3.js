const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const querystring = require('querystring');

const app = express();
const PORT = process.env.PORT || 10000;

// CORS
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'DELETE'], credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ============================================================================
// CONFIGURATION
// ============================================================================

const ADMIN_KEY       = process.env.ADMIN_KEY        || 'nocturnal-admin-2025';
const PAYPAL_EMAIL    = process.env.PAYPAL_EMAIL      || 'teckseb@hotmail.com';
const PAYPAL_MODE     = process.env.PAYPAL_MODE       || 'live'; // 'sandbox' ou 'live'
const FREE_CREDITS    = 15; // crédits offerts aux nouveaux utilisateurs

// Tiers PayPal — alignés avec les prix HTML ($4.99 / $9.99 / $24.99)
const PAYPAL_TIERS = [
    { name: 'DECOUVERTE', minPrice: 4.00,  maxPrice: 5.99,  credits: 200  },
    { name: 'POPULAR',    minPrice: 6.00,  maxPrice: 11.99, credits: 650  },
    { name: 'PRO',        minPrice: 9.00,  maxPrice: 24.99, credits: 1400 },
    { name: 'ULTRA',      minPrice: 25.00, maxPrice: 9999,  credits: 3200 },
];

// DATA PATHS
const DATA_DIR        = path.join(__dirname, 'data_v3');
const CODES_FILE      = path.join(DATA_DIR, 'codes.json');
const USERS_FILE      = path.join(DATA_DIR, 'users.json');
const ANALYTICS_FILE  = path.join(DATA_DIR, 'analytics.json');
const SALES_FILE      = path.join(DATA_DIR, 'sales.json');

// ============================================================================
// HELPERS
// ============================================================================

async function ensureDataDir() {
    try {
        await fs.access(DATA_DIR);
    } catch {
        await fs.mkdir(DATA_DIR, { recursive: true });
        await fs.writeFile(CODES_FILE,     JSON.stringify([], null, 2));
        await fs.writeFile(USERS_FILE,     JSON.stringify([], null, 2));
        await fs.writeFile(SALES_FILE,     JSON.stringify([], null, 2));
        await fs.writeFile(ANALYTICS_FILE, JSON.stringify({
            totalActivations: 0,
            totalCreditsDistributed: 0,
            totalGenerations: 0,
            totalCreditsUsed: 0,
            totalSales: 0,
            totalRevenue: 0
        }, null, 2));
    }
}

async function readJSON(filepath) {
    try {
        const data = await fs.readFile(filepath, 'utf8');
        return JSON.parse(data);
    } catch {
        return filepath === CODES_FILE ? [] :
               filepath === USERS_FILE ? [] :
               filepath === SALES_FILE ? [] : {};
    }
}

async function writeJSON(filepath, data) {
    await fs.writeFile(filepath, JSON.stringify(data, null, 2));
}

function generateCode(tier) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `${tier}-${code}`;
}

function detectTierFromPrice(amountPaid) {
    const price = parseFloat(amountPaid) || 0;
    for (const tier of PAYPAL_TIERS) {
        if (price >= tier.minPrice && price <= tier.maxPrice) {
            return tier;
        }
    }
    return PAYPAL_TIERS[0]; // fallback DECOUVERTE
}

// ============================================================================
// EMAIL (SendGrid)
// ============================================================================

async function sendEmail(to, subject, htmlContent) {
    console.log('=== EMAIL ===', 'TO:', to, '| SUBJECT:', subject);

    if (process.env.SENDGRID_API_KEY) {
        try {
            const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    personalizations: [{ to: [{ email: to }], subject }],
                    from: {
                        email: process.env.EMAIL_FROM || 'noreply@nocturnal-pleasure.com',
                        name: 'NOCTURNAL PLEASURE'
                    },
                    content: [{ type: 'text/html', value: htmlContent }]
                })
            });
            if (response.ok) {
                console.log('Email sent via SendGrid!');
                return true;
            } else {
                console.error('SendGrid error:', await response.text());
                return false;
            }
        } catch (err) {
            console.error('Email error:', err);
            return false;
        }
    }
    return true; // mode log uniquement
}

function buildActivationEmail(email, code, credits, tier, price) {
    return `<!DOCTYPE html>
<html>
<head>
<style>
  body{font-family:Arial,sans-serif;background:#1a1a2e;color:#eee;padding:20px}
  .wrap{max-width:600px;margin:0 auto;background:#16213e;border-radius:10px;padding:30px}
  h1{color:#ffd700;text-align:center;margin:0 0 20px}
  .box{background:#0f3460;border:2px solid #ffd700;border-radius:8px;padding:20px;margin:20px 0;text-align:center}
  .code{font-size:32px;font-weight:bold;color:#ffd700;letter-spacing:4px;font-family:monospace}
  .info{background:#0f3460;border-radius:8px;padding:15px;margin:15px 0}
  .footer{text-align:center;margin-top:30px;font-size:12px;color:#999}
</style>
</head>
<body>
<div class="wrap">
  <h1>🌙 NOCTURNAL PLEASURE</h1>
  <p style="text-align:center">Thank you for your purchase!</p>
  <div class="info">
    <p><strong>Order Details:</strong></p>
    <p>Tier: <strong>${tier}</strong></p>
    <p>Credits: <strong>${credits}</strong></p>
    <p>Amount Paid: <strong>$${price}</strong></p>
  </div>
  <div class="box">
    <p style="margin:0 0 10px;font-size:14px">Your Activation Code:</p>
    <div class="code">${code}</div>
  </div>
  <div class="info">
    <p><strong>How to Use:</strong></p>
    <ol>
      <li>Open NOCTURNAL PLEASURE HTML file</li>
      <li>Click the activation button</li>
      <li>Enter your code: <strong>${code}</strong></li>
      <li>Click ACTIVATE — your ${credits} credits are added!</li>
    </ol>
  </div>
  <div class="footer">
    <p>Adults only (18+) &nbsp;|&nbsp; Support: ${PAYPAL_EMAIL}</p>
    <p>© 2026 NOCTURNAL PLEASURE</p>
  </div>
</div>
</body>
</html>`;
}

// ============================================================================
// PAYPAL IPN VERIFICATION
// ============================================================================

async function verifyPayPalIPN(rawBody) {
    const verifyUrl = PAYPAL_MODE === 'sandbox'
        ? 'https://ipnpb.sandbox.paypal.com/cgi-bin/webscr'
        : 'https://ipnpb.paypal.com/cgi-bin/webscr';

    const verifyBody = 'cmd=_notify-validate&' + rawBody;

    try {
        const response = await fetch(verifyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: verifyBody
        });
        const text = await response.text();
        console.log('PayPal IPN verification:', text);
        return text === 'VERIFIED';
    } catch (err) {
        console.error('PayPal IPN verify error:', err);
        return false;
    }
}

async function processPayPalIPN(ipnData) {
    const {
        txn_id,
        payment_status,
        receiver_email,
        payer_email,
        mc_gross,
        mc_currency,
        item_name
    } = ipnData;

    // Vérifications de sécurité
    if (payment_status !== 'Completed') {
        console.log('IPN ignored — status:', payment_status);
        return { success: false, message: 'Payment not completed' };
    }

    if (receiver_email && receiver_email.toLowerCase() !== PAYPAL_EMAIL.toLowerCase()) {
        console.error('IPN receiver mismatch:', receiver_email, '!=', PAYPAL_EMAIL);
        return { success: false, message: 'Receiver mismatch' };
    }

    if (mc_currency !== 'USD') {
        console.warn('IPN currency:', mc_currency, '— expected USD');
    }

    // Vérifier si déjà traité
    const sales = await readJSON(SALES_FILE);
    if (sales.find(s => s.sale_id === txn_id)) {
        console.log('IPN already processed:', txn_id);
        const existing = sales.find(s => s.sale_id === txn_id);
        return { success: true, message: 'Already processed', code: existing.code, alreadyProcessed: true };
    }

    // Détecter tier selon montant payé
    const tierData = detectTierFromPrice(mc_gross);
    const { name: tier, credits } = tierData;
    const priceNum = parseFloat(mc_gross) || 0;

    console.log(`PayPal IPN: ${tier} | ${credits} credits | $${priceNum} | ${payer_email}`);

    // Générer code
    const code = generateCode(tier);

    // Sauvegarder code
    const codes = await readJSON(CODES_FILE);
    codes.push({
        code,
        credits,
        tier,
        used: false,
        createdAt: new Date().toISOString(),
        paypalTxnId: txn_id,
        email: payer_email
    });
    await writeJSON(CODES_FILE, codes);

    // Sauvegarder vente
    sales.push({
        sale_id: txn_id,
        product_name: item_name || 'NOCTURNAL PLEASURE',
        price: priceNum,
        email: payer_email,
        code,
        tier,
        credits,
        processedAt: new Date().toISOString()
    });
    await writeJSON(SALES_FILE, sales);

    // Analytics
    const analytics = await readJSON(ANALYTICS_FILE);
    analytics.totalSales     = (analytics.totalSales     || 0) + 1;
    analytics.totalRevenue   = (analytics.totalRevenue   || 0) + priceNum;
    await writeJSON(ANALYTICS_FILE, analytics);

    // Envoyer email
    const emailHTML = buildActivationEmail(payer_email, code, credits, tier, priceNum);
    await sendEmail(payer_email, `🌙 Your NOCTURNAL PLEASURE Code: ${code}`, emailHTML);

    console.log(`Code sent: ${code} → ${payer_email}`);

    return { success: true, code, tier, credits, email_sent: true };
}

// ============================================================================
// PAYPAL IPN ENDPOINT
// ============================================================================

// Middleware pour capturer le raw body (requis pour IPN verify)
app.use('/api/paypal/ipn', express.raw({ type: '*/*' }), async (req, res) => {
    // Répondre 200 immédiatement (exigé par PayPal)
    res.sendStatus(200);

    try {
        const rawBody = req.body.toString('utf8');
        console.log('=== PAYPAL IPN RECEIVED ===');

        const ipnData = querystring.parse(rawBody);

        // Vérification IPN auprès de PayPal
        const isVerified = await verifyPayPalIPN(rawBody);

        if (!isVerified) {
            console.error('IPN INVALID — rejected');
            return;
        }

        console.log('IPN VERIFIED — processing...');
        const result = await processPayPalIPN(ipnData);
        console.log('IPN result:', result);

    } catch (err) {
        console.error('IPN processing error:', err);
    }
});

// Endpoint test PayPal (sans vérification IPN)
app.post('/api/paypal/test', async (req, res) => {
    try {
        const tier  = req.body.tier  || 'POPULAR';
        const email = req.body.email || 'test@example.com';

        const tierData  = PAYPAL_TIERS.find(t => t.name === tier) || PAYPAL_TIERS[1];
        const testData = {
            txn_id:           'TEST-' + Date.now(),
            payment_status:   'Completed',
            receiver_email:   PAYPAL_EMAIL,
            payer_email:      email,
            mc_gross:         String(tierData.minPrice + 0.99),
            mc_currency:      'USD',
            item_name:        'NOCTURNAL PLEASURE - ' + tier
        };

        const result = await processPayPalIPN(testData);
        res.json(result);

    } catch (err) {
        console.error('Test error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================================
// ACTIVATION CODE
// ============================================================================

app.post('/api/activate', async (req, res) => {
    try {
        const { code, userId } = req.body;

        if (!code || !userId) {
            return res.json({ success: false, error: 'Code and userId required' });
        }

        const codes    = await readJSON(CODES_FILE);
        const codeData = codes.find(c => c.code === code.toUpperCase().trim());

        if (!codeData) {
            return res.json({ success: false, error: 'Invalid code' });
        }

        if (codeData.used) {
            return res.json({ success: false, error: 'Code already used' });
        }

        // Marquer code utilisé
        codeData.used    = true;
        codeData.usedBy  = userId;
        codeData.usedAt  = new Date().toISOString();
        await writeJSON(CODES_FILE, codes);

        // Créditer l'utilisateur
        const users = await readJSON(USERS_FILE);
        let user    = users.find(u => u.userId === userId);

        if (!user) {
            user = { userId, credits: FREE_CREDITS, tier: 'FREE', createdAt: new Date().toISOString() };
            users.push(user);
        }

        user.credits     += codeData.credits;
        user.tier         = codeData.tier;
        user.lastUpdated  = new Date().toISOString();
        await writeJSON(USERS_FILE, users);

        // Analytics
        const analytics = await readJSON(ANALYTICS_FILE);
        analytics.totalActivations++;
        analytics.totalCreditsDistributed += codeData.credits;
        await writeJSON(ANALYTICS_FILE, analytics);

        res.json({
            success: true,
            credits: user.credits,
            addedCredits: codeData.credits,
            tier: codeData.tier
        });

    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// CRÉDITS
// ============================================================================

app.post('/api/get-credits', async (req, res) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.json({ credits: FREE_CREDITS });
        }

        const users = await readJSON(USERS_FILE);
        let user    = users.find(u => u.userId === userId);

        if (!user) {
            user = { userId, credits: FREE_CREDITS, tier: 'FREE', createdAt: new Date().toISOString() };
            users.push(user);
            await writeJSON(USERS_FILE, users);
        }

        res.json({ credits: user.credits, tier: user.tier || 'FREE' });

    } catch (err) {
        res.json({ credits: FREE_CREDITS });
    }
});

app.post('/api/use-credits', async (req, res) => {
    try {
        const { userId, amount } = req.body;

        if (!userId || !amount) {
            return res.json({ success: false, error: 'userId and amount required' });
        }

        const users = await readJSON(USERS_FILE);
        const user  = users.find(u => u.userId === userId);

        if (!user) {
            return res.json({ success: false, error: 'User not found' });
        }

        if (user.credits < amount) {
            return res.json({ success: false, error: 'Insufficient credits', credits: user.credits });
        }

        user.credits    -= amount;
        user.lastUpdated = new Date().toISOString();
        await writeJSON(USERS_FILE, users);

        const analytics = await readJSON(ANALYTICS_FILE);
        analytics.totalGenerations = (analytics.totalGenerations || 0) + amount;
        analytics.totalCreditsUsed = (analytics.totalCreditsUsed || 0) + amount;
        await writeJSON(ANALYTICS_FILE, analytics);

        res.json({ success: true, credits: user.credits });

    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// ADMIN
// ============================================================================

app.post('/api/admin/generate-codes', async (req, res) => {
    try {
        const { adminKey, count, credits, tier } = req.body;

        if (adminKey !== ADMIN_KEY) {
            return res.status(403).json({ error: 'Invalid admin key' });
        }

        const codes    = await readJSON(CODES_FILE);
        const newCodes = [];

        for (let i = 0; i < Math.min(count, 100); i++) {
            const code = generateCode(tier || 'MANUAL');
            newCodes.push(code);
            codes.push({
                code,
                credits: credits || 200,
                tier:    tier    || 'MANUAL',
                used:    false,
                createdAt: new Date().toISOString()
            });
        }

        await writeJSON(CODES_FILE, codes);
        res.json({ success: true, codes: newCodes, total: newCodes.length });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/analytics', async (req, res) => {
    try {
        const { adminKey } = req.query;

        if (adminKey !== ADMIN_KEY) {
            return res.status(403).json({ error: 'Invalid admin key' });
        }

        const [analytics, codes, users, sales] = await Promise.all([
            readJSON(ANALYTICS_FILE),
            readJSON(CODES_FILE),
            readJSON(USERS_FILE),
            readJSON(SALES_FILE)
        ]);

        res.json({
            ...analytics,
            totalUsers:   users.length,
            usedCodes:    codes.filter(c => c.used).length,
            unusedCodes:  codes.filter(c => !c.used).length,
            totalCodes:   codes.length,
            recentSales:  sales.slice(-10).reverse()
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================================
// HEALTH + ROOT
// ============================================================================

app.get('/api/health', (req, res) => {
    res.json({
        status:    'OK',
        version:   'V4 — PayPal IPN',
        timestamp: new Date().toISOString(),
        uptime:    process.uptime(),
        paypal:    { email: PAYPAL_EMAIL, mode: PAYPAL_MODE }
    });
});

app.get('/', (req, res) => {
    res.json({
        name:    'NOCTURNAL PLEASURE — Master Server V4',
        version: 'PayPal IPN',
        status:  'running',
        tiers:   PAYPAL_TIERS.map(t => ({ name: t.name, credits: t.credits, price: `$${t.minPrice}–$${t.maxPrice}` })),
        endpoints: [
            'POST /api/paypal/ipn        — PayPal IPN webhook (auto)',
            'POST /api/paypal/test       — Test IPN sans vérification',
            'POST /api/activate          — Activer un code',
            'POST /api/get-credits       — Obtenir crédits utilisateur',
            'POST /api/use-credits       — Consommer crédits',
            'POST /api/admin/generate-codes — Générer codes manuels',
            'GET  /api/admin/analytics   — Dashboard analytics',
            'GET  /api/health            — Health check'
        ]
    });
});

// ============================================================================
// START
// ============================================================================

ensureDataDir().then(() => {
    app.listen(PORT, () => {
        console.log('============================================');
        console.log('🌙 NOCTURNAL PLEASURE — MASTER V4');
        console.log('============================================');
        console.log(`✅ Port: ${PORT}`);
        console.log(`💳 PayPal: ${PAYPAL_EMAIL} (${PAYPAL_MODE})`);
        console.log(`🔑 Admin Key: ${ADMIN_KEY}`);
        console.log(`🎁 Free Credits: ${FREE_CREDITS}`);
        console.log(`📧 SendGrid: ${process.env.SENDGRID_API_KEY ? 'Configured' : 'Log only'}`);
        console.log('Tiers:');
        PAYPAL_TIERS.forEach(t => console.log(`  ${t.name}: ${t.credits} credits ($${t.minPrice}–$${t.maxPrice})`));
        console.log('============================================');
    });
});
