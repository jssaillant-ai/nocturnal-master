const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());

// DATA PATHS
const DATA_DIR = path.join(__dirname, 'data_v2');
const CODES_FILE = path.join(DATA_DIR, 'codes.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ANALYTICS_FILE = path.join(DATA_DIR, 'analytics.json');

// ENSURE DATA DIRECTORY
async function ensureDataDir() {
    try {
        await fs.access(DATA_DIR);
    } catch {
        await fs.mkdir(DATA_DIR, { recursive: true });
        await fs.writeFile(CODES_FILE, JSON.stringify([], null, 2));
        await fs.writeFile(USERS_FILE, JSON.stringify([], null, 2));
        await fs.writeFile(ANALYTICS_FILE, JSON.stringify({
            totalActivations: 0,
            totalCreditsDistributed: 0,
            totalGenerations: 0,
            totalCreditsUsed: 0
        }, null, 2));
    }
}

// READ JSON FILE
async function readJSON(filepath) {
    try {
        const data = await fs.readFile(filepath, 'utf8');
        return JSON.parse(data);
    } catch {
        return filepath === CODES_FILE ? [] : filepath === USERS_FILE ? [] : {};
    }
}

// WRITE JSON FILE
async function writeJSON(filepath, data) {
    await fs.writeFile(filepath, JSON.stringify(data, null, 2));
}

// ACTIVATE CODE
app.post('/api/activate', async (req, res) => {
    try {
        const { code, userId } = req.body;
        
        if (!code || !userId) {
            return res.status(400).json({ error: 'Code and userId required' });
        }
        
        const codes = await readJSON(CODES_FILE);
        const users = await readJSON(USERS_FILE);
        const analytics = await readJSON(ANALYTICS_FILE);
        
        // Find code
        const codeEntry = codes.find(c => c.code === code.toUpperCase());
        
        if (!codeEntry) {
            return res.status(404).json({ error: 'Invalid code' });
        }
        
        if (codeEntry.used) {
            return res.status(400).json({ error: 'Code already used' });
        }
        
        // Mark as used
        codeEntry.used = true;
        codeEntry.usedBy = userId;
        codeEntry.usedAt = new Date().toISOString();
        
        // Update or create user
        let user = users.find(u => u.userId === userId);
        if (!user) {
            user = {
                userId,
                credits: 0,
                totalCreditsReceived: 0,
                activatedCodes: [],
                createdAt: new Date().toISOString()
            };
            users.push(user);
        }
        
        user.credits += codeEntry.credits;
        user.totalCreditsReceived += codeEntry.credits;
        user.activatedCodes.push({
            code: code.toUpperCase(),
            credits: codeEntry.credits,
            activatedAt: new Date().toISOString()
        });
        
        // Update analytics
        analytics.totalActivations = (analytics.totalActivations || 0) + 1;
        analytics.totalCreditsDistributed = (analytics.totalCreditsDistributed || 0) + codeEntry.credits;
        
        // Save all
        await writeJSON(CODES_FILE, codes);
        await writeJSON(USERS_FILE, users);
        await writeJSON(ANALYTICS_FILE, analytics);
        
        res.json({
            success: true,
            credits: user.credits,
            addedCredits: codeEntry.credits
        });
        
    } catch (error) {
        console.error('Activation error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// CHECK CODE (without activating)
app.post('/api/check-code', async (req, res) => {
    try {
        const { code } = req.body;
        
        if (!code) {
            return res.status(400).json({ error: 'Code required' });
        }
        
        const codes = await readJSON(CODES_FILE);
        const codeEntry = codes.find(c => c.code === code.toUpperCase());
        
        if (!codeEntry) {
            return res.status(404).json({ valid: false, error: 'Invalid code' });
        }
        
        if (codeEntry.used) {
            return res.status(400).json({ valid: false, error: 'Code already used' });
        }
        
        res.json({
            valid: true,
            credits: codeEntry.credits,
            tier: codeEntry.tier
        });
        
    } catch (error) {
        console.error('Check code error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET USER CREDITS
app.post('/api/get-credits', async (req, res) => {
    try {
        const { userId } = req.body;
        
        if (!userId) {
            return res.status(400).json({ error: 'userId required' });
        }
        
        const users = await readJSON(USERS_FILE);
        const user = users.find(u => u.userId === userId);
        
        if (!user) {
            return res.json({ credits: 50 }); // Free credits
        }
        
        res.json({ credits: user.credits });
        
    } catch (error) {
        console.error('Get credits error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// USE CREDITS
app.post('/api/use-credits', async (req, res) => {
    try {
        const { userId, amount } = req.body;
        
        if (!userId || !amount) {
            return res.status(400).json({ error: 'userId and amount required' });
        }
        
        const users = await readJSON(USERS_FILE);
        const analytics = await readJSON(ANALYTICS_FILE);
        const user = users.find(u => u.userId === userId);
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        if (user.credits < amount) {
            return res.status(400).json({ error: 'Not enough credits' });
        }
        
        user.credits -= amount;
        
        // Update analytics
        analytics.totalGenerations = (analytics.totalGenerations || 0) + amount;
        analytics.totalCreditsUsed = (analytics.totalCreditsUsed || 0) + amount;
        
        await writeJSON(USERS_FILE, users);
        await writeJSON(ANALYTICS_FILE, analytics);
        
        res.json({ success: true, credits: user.credits });
        
    } catch (error) {
        console.error('Use credits error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ADMIN: GENERATE CODES
app.post('/api/admin/generate-codes', async (req, res) => {
    try {
        const { adminKey, count, credits, tier } = req.body;
        
        if (adminKey !== process.env.ADMIN_KEY && adminKey !== 'nocturnal-admin-2025') {
            return res.status(403).json({ error: 'Invalid admin key' });
        }
        
        const codes = await readJSON(CODES_FILE);
        const newCodes = [];
        
        for (let i = 0; i < count; i++) {
            const code = `${tier || 'BASIC'}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
            newCodes.push({
                code,
                credits: credits || 50,
                tier: tier || 'BASIC',
                used: false,
                createdAt: new Date().toISOString()
            });
        }
        
        codes.push(...newCodes);
        await writeJSON(CODES_FILE, codes);
        
        res.json({ success: true, codes: newCodes.map(c => c.code) });
        
    } catch (error) {
        console.error('Generate codes error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ADMIN: GET ANALYTICS
app.get('/api/admin/analytics', async (req, res) => {
    try {
        const { adminKey } = req.query;
        
        if (adminKey !== process.env.ADMIN_KEY && adminKey !== 'nocturnal-admin-2025') {
            return res.status(403).json({ error: 'Invalid admin key' });
        }
        
        const analytics = await readJSON(ANALYTICS_FILE);
        const codes = await readJSON(CODES_FILE);
        const users = await readJSON(USERS_FILE);
        
        res.json({
            ...analytics,
            totalCodes: codes.length,
            usedCodes: codes.filter(c => c.used).length,
            unusedCodes: codes.filter(c => !c.used).length,
            totalUsers: users.length
        });
        
    } catch (error) {
        console.error('Analytics error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// HEALTH CHECK
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// START SERVER
ensureDataDir().then(() => {
    app.listen(PORT, () => {
        console.log(`🌙 NOCTURNAL MASTER V2 running on port ${PORT}`);
    });
});
