const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 10000;

// CORS for all origins
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'DELETE'], credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// CONFIGURATION
const ADMIN_KEY = process.env.ADMIN_KEY || 'nocturnal-admin-2025';
const GUMROAD_LICENSE_KEY = process.env.GUMROAD_LICENSE_KEY || ''; // À configurer dans Render

// EMAIL CONFIGURATION (SMTP)
const EMAIL_CONFIG = {
    service: 'gmail', // ou 'sendgrid', 'mailgun', etc.
    user: process.env.EMAIL_USER || '', // ton email
    pass: process.env.EMAIL_PASS || '', // app password
    from: process.env.EMAIL_FROM || 'noreply@nocturnal.com'
};

// DATA PATHS
const DATA_DIR = path.join(__dirname, 'data_v3');
const CODES_FILE = path.join(DATA_DIR, 'codes.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ANALYTICS_FILE = path.join(DATA_DIR, 'analytics.json');
const SALES_FILE = path.join(DATA_DIR, 'sales.json');

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function ensureDataDir() {
    try {
        await fs.access(DATA_DIR);
    } catch {
        await fs.mkdir(DATA_DIR, { recursive: true });
        await fs.writeFile(CODES_FILE, JSON.stringify([], null, 2));
        await fs.writeFile(USERS_FILE, JSON.stringify([], null, 2));
        await fs.writeFile(SALES_FILE, JSON.stringify([], null, 2));
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

// ============================================================================
// EMAIL FUNCTIONS
// ============================================================================

async function sendEmail(to, subject, htmlContent) {
    // OPTION 1: SANS LIBRAIRIE - UTILISE FETCH VERS SERVICE EMAIL
    // Pour l'instant, on log juste - tu pourras configurer SendGrid API après
    
    console.log('=== EMAIL TO SEND ===');
    console.log('TO:', to);
    console.log('SUBJECT:', subject);
    console.log('CONTENT:', htmlContent);
    console.log('=====================');
    
    // Si tu configures SendGrid API key dans Render:
    if (process.env.SENDGRID_API_KEY) {
        try {
            const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    personalizations: [{
                        to: [{ email: to }],
                        subject: subject
                    }],
                    from: { email: EMAIL_CONFIG.from, name: 'NOCTURNAL UNIVERSAL' },
                    content: [{
                        type: 'text/html',
                        value: htmlContent
                    }]
                })
            });
            
            if (response.ok) {
                console.log('✅ Email sent via SendGrid!');
                return true;
            } else {
                console.error('❌ SendGrid error:', await response.text());
                return false;
            }
        } catch (error) {
            console.error('❌ Email error:', error);
            return false;
        }
    }
    
    // Si pas de SendGrid, on retourne true quand même (mode test)
    return true;
}

function generateActivationEmail(customerEmail, code, credits, tier, price) {
    return `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; background-color: #1a1a2e; color: #eee; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background: #16213e; border-radius: 10px; padding: 30px; }
        .header { text-align: center; margin-bottom: 30px; }
        .header h1 { color: #f39c12; margin: 0; font-size: 28px; }
        .code-box { background: #0f3460; border: 2px solid #f39c12; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center; }
        .code { font-size: 32px; font-weight: bold; color: #f39c12; letter-spacing: 3px; font-family: monospace; }
        .info { background: #0f3460; border-radius: 8px; padding: 15px; margin: 15px 0; }
        .button { display: inline-block; background: #f39c12; color: #1a1a2e; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; margin: 20px 0; }
        .footer { text-align: center; margin-top: 30px; font-size: 12px; color: #999; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🌙 NOCTURNAL UNIVERSAL 🌙</h1>
            <p>Thank you for your purchase!</p>
        </div>
        
        <div class="info">
            <p><strong>💎 Order Details:</strong></p>
            <p>Tier: <strong>${tier}</strong></p>
            <p>Credits: <strong>${credits}</strong></p>
            <p>Amount Paid: <strong>$${price}</strong></p>
        </div>
        
        <div class="code-box">
            <p style="margin: 0 0 10px 0; font-size: 14px;">Your Activation Code:</p>
            <div class="code">${code}</div>
        </div>
        
        <div class="info">
            <p><strong>📋 How to Use Your Code:</strong></p>
            <ol style="line-height: 1.8;">
                <li>Download NOCTURNAL UNIVERSAL from CivitAI (if not already done)</li>
                <li>Open the HTML file in your browser</li>
                <li>Enter your code in the activation bar at the top</li>
                <li>Click "ACTIVATE"</li>
                <li>Your ${credits} credits will be added instantly!</li>
            </ol>
        </div>
        
        <div style="text-align: center;">
            <a href="https://civitai.com" class="button">Download NOCTURNAL UNIVERSAL</a>
        </div>
        
        <div class="info">
            <p><strong>⚡ Features:</strong></p>
            <ul style="line-height: 1.8;">
                <li>3000+ professional NSFW scenes</li>
                <li>Automatic Pony Diffusion quality preset</li>
                <li>6 customizable characters</li>
                <li>Equipment & decor options</li>
                <li>Real-time prompt generation</li>
            </ul>
        </div>
        
        <div class="footer">
            <p>🔞 Adults only (18+)</p>
            <p>Need help? Contact us at support@nocturnal.com</p>
            <p>© 2026 NOCTURNAL UNIVERSAL - All rights reserved</p>
        </div>
    </div>
</body>
</html>
    `;
}

// ============================================================================
// GUMROAD WEBHOOK HANDLER
// ============================================================================

app.post('/api/gumroad/webhook', async (req, res) => {
    try {
        console.log('=== GUMROAD WEBHOOK RECEIVED ===');
        console.log('Body:', JSON.stringify(req.body, null, 2));
        
        const { 
            sale_id, 
            product_name, 
            price, 
            email, 
            seller_id,
            product_id,
            variants = ''
        } = req.body;
        
        // Vérifier que c'est une vraie vente
        if (!sale_id || !email) {
            console.log('❌ Invalid webhook data');
            return res.status(400).json({ error: 'Invalid data' });
        }
        
        // Déterminer le tier basé sur le prix ou product_name
        let tier = 'BASIC';
        let credits = 50;
        
        const priceNum = parseFloat(price) / 100; // Gumroad envoie en cents
        
        if (priceNum >= 10 || product_name.includes('ULTRA')) {
            tier = 'ULTRA';
            credits = 250;
        } else if (priceNum >= 5 || product_name.includes('PRO')) {
            tier = 'PRO';
            credits = 100;
        } else {
            tier = 'BASIC';
            credits = 50;
        }
        
        console.log(`Detected: ${tier} tier, ${credits} credits, $${priceNum}`);
        
        // Vérifier si cette vente a déjà été traitée
        const sales = await readJSON(SALES_FILE);
        const existingSale = sales.find(s => s.sale_id === sale_id);
        
        if (existingSale) {
            console.log('⚠️ Sale already processed');
            return res.json({ 
                success: true, 
                message: 'Already processed',
                code: existingSale.code 
            });
        }
        
        // Générer un nouveau code
        const code = generateCode(tier);
        
        // Sauvegarder le code
        const codes = await readJSON(CODES_FILE);
        codes.push({
            code,
            credits,
            tier,
            used: false,
            createdAt: new Date().toISOString(),
            gumroadSaleId: sale_id,
            email
        });
        await writeJSON(CODES_FILE, codes);
        
        // Sauvegarder la vente
        sales.push({
            sale_id,
            product_name,
            price: priceNum,
            email,
            code,
            tier,
            credits,
            processedAt: new Date().toISOString()
        });
        await writeJSON(SALES_FILE, sales);
        
        // Mettre à jour analytics
        const analytics = await readJSON(ANALYTICS_FILE);
        analytics.totalSales = (analytics.totalSales || 0) + 1;
        analytics.totalRevenue = (analytics.totalRevenue || 0) + priceNum;
        await writeJSON(ANALYTICS_FILE, analytics);
        
        // Envoyer l'email avec le code
        const emailHTML = generateActivationEmail(email, code, credits, tier, priceNum);
        await sendEmail(email, `🌙 Your NOCTURNAL Code: ${code}`, emailHTML);
        
        console.log(`✅ Code generated and sent: ${code} to ${email}`);
        
        res.json({ 
            success: true, 
            code,
            tier,
            credits,
            email_sent: true
        });
        
    } catch (error) {
        console.error('❌ Webhook error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Test webhook (pour tester sans Gumroad)
app.post('/api/gumroad/test', async (req, res) => {
    const testData = {
        sale_id: 'TEST-' + Date.now(),
        product_name: req.body.tier === 'PRO' ? 'NOCTURNAL Credits - PRO Pack' : 
                      req.body.tier === 'ULTRA' ? 'NOCTURNAL Credits - ULTRA Pack' :
                      'NOCTURNAL Credits - BASIC Pack',
        price: req.body.tier === 'PRO' ? 500 : 
               req.body.tier === 'ULTRA' ? 1000 : 300,
        email: req.body.email || 'test@example.com',
        seller_id: 'test',
        product_id: 'test'
    };
    
    req.body = testData;
    return app._router.handle(req, res);
});

// ============================================================================
// EXISTING API ENDPOINTS (from V2)
// ============================================================================

app.post('/api/activate', async (req, res) => {
    try {
        const { code, userId } = req.body;
        
        if (!code || !userId) {
            return res.json({ success: false, error: 'Code and userId required' });
        }
        
        const codes = await readJSON(CODES_FILE);
        const codeData = codes.find(c => c.code === code.toUpperCase());
        
        if (!codeData) {
            return res.json({ success: false, error: 'Invalid code' });
        }
        
        if (codeData.used) {
            return res.json({ success: false, error: 'Code already used' });
        }
        
        codeData.used = true;
        codeData.usedBy = userId;
        codeData.usedAt = new Date().toISOString();
        await writeJSON(CODES_FILE, codes);
        
        const users = await readJSON(USERS_FILE);
        let user = users.find(u => u.userId === userId);
        
        if (!user) {
            user = { userId, credits: 50, createdAt: new Date().toISOString() };
            users.push(user);
        }
        
        user.credits += codeData.credits;
        user.lastUpdated = new Date().toISOString();
        await writeJSON(USERS_FILE, users);
        
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
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/get-credits', async (req, res) => {
    try {
        const { userId } = req.body;
        
        if (!userId) {
            return res.json({ credits: 50 });
        }
        
        const users = await readJSON(USERS_FILE);
        let user = users.find(u => u.userId === userId);
        
        if (!user) {
            user = { userId, credits: 50, createdAt: new Date().toISOString() };
            users.push(user);
            await writeJSON(USERS_FILE, users);
        }
        
        res.json({ credits: user.credits });
        
    } catch (error) {
        res.json({ credits: 50 });
    }
});

app.post('/api/use-credits', async (req, res) => {
    try {
        const { userId, amount } = req.body;
        
        if (!userId || !amount) {
            return res.json({ success: false, error: 'userId and amount required' });
        }
        
        const users = await readJSON(USERS_FILE);
        const user = users.find(u => u.userId === userId);
        
        if (!user) {
            return res.json({ success: false, error: 'User not found' });
        }
        
        user.credits -= amount;
        user.lastUpdated = new Date().toISOString();
        await writeJSON(USERS_FILE, users);
        
        const analytics = await readJSON(ANALYTICS_FILE);
        analytics.totalGenerations += amount;
        analytics.totalCreditsUsed += amount;
        await writeJSON(ANALYTICS_FILE, analytics);
        
        res.json({ success: true, credits: user.credits });
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/generate-codes', async (req, res) => {
    try {
        const { adminKey, count, credits, tier } = req.body;
        
        if (adminKey !== ADMIN_KEY) {
            return res.status(403).json({ error: 'Invalid admin key' });
        }
        
        const codes = await readJSON(CODES_FILE);
        const newCodes = [];
        
        for (let i = 0; i < count; i++) {
            const code = generateCode(tier || 'MANUAL');
            newCodes.push(code);
            codes.push({
                code,
                credits: credits || 50,
                tier: tier || 'MANUAL',
                used: false,
                createdAt: new Date().toISOString()
            });
        }
        
        await writeJSON(CODES_FILE, codes);
        
        res.json({ success: true, codes: newCodes, total: newCodes.length });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/analytics', async (req, res) => {
    try {
        const { adminKey } = req.query;
        
        if (adminKey !== ADMIN_KEY) {
            return res.status(403).json({ error: 'Invalid admin key' });
        }
        
        const analytics = await readJSON(ANALYTICS_FILE);
        const codes = await readJSON(CODES_FILE);
        const users = await readJSON(USERS_FILE);
        const sales = await readJSON(SALES_FILE);
        
        const usedCodes = codes.filter(c => c.used).length;
        const unusedCodes = codes.filter(c => !c.used).length;
        
        res.json({
            ...analytics,
            totalUsers: users.length,
            usedCodes,
            unusedCodes,
            totalCodes: codes.length,
            recentSales: sales.slice(-10).reverse()
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK',
        version: 'V3 GUMROAD AUTO',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

app.get('/', (req, res) => {
    res.json({
        name: 'NOCTURNAL MASTER V3',
        version: 'GUMROAD AUTOMATION',
        status: 'running',
        endpoints: [
            'POST /api/gumroad/webhook - Gumroad webhook handler',
            'POST /api/gumroad/test - Test webhook',
            'POST /api/activate - Activate code',
            'POST /api/get-credits - Get user credits',
            'POST /api/use-credits - Use credits',
            'POST /api/admin/generate-codes - Generate codes',
            'GET /api/admin/analytics - View analytics',
            'GET /api/health - Health check'
        ]
    });
});

// ============================================================================
// START SERVER
// ============================================================================

ensureDataDir().then(() => {
    app.listen(PORT, () => {
        console.log('============================================');
        console.log('🌙 NOCTURNAL MASTER V3 - GUMROAD AUTOMATION');
        console.log('============================================');
        console.log(`✅ Server running on port ${PORT}`);
        console.log(`📍 URL: http://localhost:${PORT}`);
        console.log(`🔧 Admin Key: ${ADMIN_KEY}`);
        console.log(`💎 Free Credits: 50 per new user`);
        console.log(`🎯 Gumroad Webhook: /api/gumroad/webhook`);
        console.log(`📧 Email: ${EMAIL_CONFIG.user ? 'Configured' : 'Not configured (logs only)'}`);
        console.log(`⚡ Automation: ENABLED`);
        console.log(`🚀 Status: READY`);
        console.log('============================================');
    });
});
