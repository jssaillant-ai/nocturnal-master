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
// EMAIL LOGGING (SendGrid integration possible via env var)
// ============================================================================

async function sendEmail(to, subject, htmlContent) {
    console.log('=== EMAIL TO SEND ===');
    console.log('TO:', to);
    console.log('SUBJECT:', subject);
    console.log('CODE:', htmlContent.match(/[A-Z]+-[A-Z0-9]{8}/)?.[0] || 'N/A');
    console.log('=====================');
    
    // Si SendGrid configurÃ©, utiliser API
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
                    from: { email: process.env.EMAIL_FROM || 'noreply@nocturnal.com', name: 'NOCTURNAL UNIVERSAL' },
                    content: [{
                        type: 'text/html',
                        value: htmlContent
                    }]
                })
            });
            
            if (response.ok) {
                console.log('âœ… Email sent via SendGrid!');
                return true;
            } else {
                console.error('âŒ SendGrid error:', await response.text());
                return false;
            }
        } catch (error) {
            console.error('âŒ Email error:', error);
            return false;
        }
    }
    
    return true; // Mode test - just log
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
        .footer { text-align: center; margin-top: 30px; font-size: 12px; color: #999; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>ðŸŒ™ NOCTURNAL UNIVERSAL ðŸŒ™</h1>
            <p>Thank you for your purchase!</p>
        </div>
        
        <div class="info">
            <p><strong>ðŸ’Ž Order Details:</strong></p>
            <p>Tier: <strong>${tier}</strong></p>
            <p>Credits: <strong>${credits}</strong></p>
            <p>Amount Paid: <strong>$${price}</strong></p>
        </div>
        
        <div class="code-box">
            <p style="margin: 0 0 10px 0; font-size: 14px;">Your Activation Code:</p>
            <div class="code">${code}</div>
        </div>
        
        <div class="info">
            <p><strong>ðŸ“‹ How to Use:</strong></p>
            <ol>
                <li>Download NOCTURNAL UNIVERSAL from CivitAI</li>
                <li>Open the HTML file</li>
                <li>Enter your code</li>
                <li>Click "ACTIVATE"</li>
                <li>Generate amazing prompts!</li>
            </ol>
        </div>
        
        <div class="footer">
            <p>ðŸ”ž Adults only (18+)</p>
            <p>Â© 2026 NOCTURNAL UNIVERSAL</p>
        </div>
    </div>
</body>
</html>
    `;
}

// ============================================================================
// WEBHOOK PROCESSING FUNCTION (extracted to avoid recursion)
// ============================================================================

async function processGumroadWebhook(webhookData) {
    const { 
        sale_id, 
        product_name, 
        price, 
        email
    } = webhookData;
    
    // VÃ©rifier donnÃ©es valides
    if (!sale_id || !email) {
        throw new Error('Invalid webhook data');
    }
    
    // DÃ©terminer tier
    let tier = 'DECOUVERTE';
    let credits = 200;
    
    const priceCents = price ?? webhookData.price_cents ?? webhookData.price_in_cents;
    const priceNum = priceCents ? (parseFloat(priceCents) / 100) : 0;
    const pName = (product_name || '').toUpperCase();
    
    // Correspondance exacte avec les 4 tiers Gumroad
    if (priceNum >= 25 || pName.includes('ULTRA') || pName.includes('3200')) {
        tier = 'ULTRA';
        credits = 3200;
    } else if (priceNum >= 12 || pName.includes('PRO') || pName.includes('1400')) {
        tier = 'PRO';
        credits = 1400;
    } else if (priceNum >= 6 || pName.includes('POPULAR') || pName.includes('650')) {
        tier = 'POPULAR';
        credits = 650;
    } else {
        tier = 'DECOUVERTE';
        credits = 200;
    }
    
    console.log(`Detected: ${tier} tier, ${credits} credits, $${priceNum}`);
    
    // VÃ©rifier si dÃ©jÃ  traitÃ©
    const sales = await readJSON(SALES_FILE);
    const existingSale = sales.find(s => s.sale_id === sale_id);
    
    if (existingSale) {
        console.log('âš ï¸ Sale already processed');
        return { 
            success: true, 
            message: 'Already processed',
            code: existingSale.code,
            alreadyProcessed: true
        };
    }
    
    // GÃ©nÃ©rer code
    const code = generateCode(tier);
    
    // Sauvegarder code
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
    
    // Sauvegarder vente
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
    
    // Analytics
    const analytics = await readJSON(ANALYTICS_FILE);
    analytics.totalSales = (analytics.totalSales || 0) + 1;
    analytics.totalRevenue = (analytics.totalRevenue || 0) + priceNum;
    await writeJSON(ANALYTICS_FILE, analytics);
    
    // Envoyer email
    const emailHTML = generateActivationEmail(email, code, credits, tier, priceNum);
    await sendEmail(email, `ðŸŒ™ Your NOCTURNAL Code: ${code}`, emailHTML);
    
    console.log(`âœ… Code generated and sent: ${code} to ${email}`);
    
    return { 
        success: true, 
        code,
        tier,
        credits,
        email_sent: true
    };
}

// ============================================================================
// GUMROAD WEBHOOK ENDPOINTS
// ============================================================================

app.post('/api/gumroad/webhook', async (req, res) => {
    // Gumroad Ping test support
    if (req.body && (req.body.ping === 'true' || req.body.ping === true)) {
        console.log('✅ Gumroad Ping received');
        return res.json({ success: true, message: 'Ping OK' });
    }
    try {
        console.log('=== GUMROAD WEBHOOK RECEIVED ===');
        console.log('Body:', JSON.stringify(req.body, null, 2));
        
        const result = await processGumroadWebhook(req.body);
        res.json(result);
        
    } catch (error) {
        console.error('âŒ Webhook error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Test webhook - SIMPLIFIÃ‰ SANS RECURSION
app.post('/api/gumroad/test', async (req, res) => {
    try {
        const testData = {
            sale_id: 'TEST-' + Date.now(),
            product_name: req.body.tier === 'PRO' ? 'NOCTURNAL Credits - PRO Pack' : 
                          req.body.tier === 'ULTRA' ? 'NOCTURNAL Credits - ULTRA Pack' :
                          'NOCTURNAL Credits - BASIC Pack',
            price: req.body.tier === 'ULTRA' ? 3000 : 
                   req.body.tier === 'PRO' ? 1500 : 
                   req.body.tier === 'POPULAR' ? 800 : 300,
            email: req.body.email || 'test@example.com',
            seller_id: 'test',
            product_id: 'test'
        };
        
        const result = await processGumroadWebhook(testData);
        res.json(result);
        
    } catch (error) {
        console.error('âŒ Test error:', error);
        res.status(500).json({ error: error.message });
    }
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
            user = { userId, credits: 15, createdAt: new Date().toISOString() };
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
            return res.json({ credits: 15 });
        }
        
        const users = await readJSON(USERS_FILE);
        let user = users.find(u => u.userId === userId);
        
        if (!user) {
            user = { userId, credits: 15, createdAt: new Date().toISOString() };
            users.push(user);
            await writeJSON(USERS_FILE, users);
        }
        
        res.json({ credits: user.credits });
        
    } catch (error) {
        res.json({ credits: 15 });
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
        version: 'V3 FIXED',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

app.get('/', (req, res) => {
    res.json({
        name: 'NOCTURNAL MASTER V3',
        version: 'FIXED - NO RECURSION',
        status: 'running',
        endpoints: [
            'POST /api/gumroad/webhook - Gumroad webhook',
            'POST /api/gumroad/test - Test webhook',
            'POST /api/activate - Activate code',
            'POST /api/get-credits - Get credits',
            'POST /api/use-credits - Use credits',
            'POST /api/admin/generate-codes - Generate codes',
            'GET /api/admin/analytics - Analytics',
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
        console.log('ðŸŒ™ NOCTURNAL MASTER V3 FIXED');
        console.log('============================================');
        console.log(`âœ… Server running on port ${PORT}`);
        console.log(`ðŸ”§ Admin Key: ${ADMIN_KEY}`);
        console.log(`ðŸ’Ž Free Credits: 50 per new user`);
        console.log(`ðŸŽ¯ Gumroad Webhook: /api/gumroad/webhook`);
        console.log(`ðŸ“§ Email: ${process.env.SENDGRID_API_KEY ? 'Configured' : 'Logs only'}`);
        console.log(`âš¡ Status: READY - NO RECURSION BUG`);
        console.log('============================================');
    });
});





