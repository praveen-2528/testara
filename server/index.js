import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { nanoid } from 'nanoid';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Tunnel } from 'cloudflared';
import os from 'os';
import db from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'testara_secret_key_change_in_production';

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
});

// ─── In-Memory Room Store ────────────────────────────────────────────
const rooms = new Map();

const generateRoomCode = () => nanoid(6).toUpperCase();

const ROOM_TTL = 3 * 60 * 60 * 1000; // 3 hours

// Auto-cleanup stale rooms
setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
        if (now - room.lastActivity > ROOM_TTL) {
            io.to(code).emit('roomClosed', { reason: 'Room expired due to inactivity.' });
            rooms.delete(code);
            console.log(`[Cleanup] Room ${code} deleted (inactive)`);
        }
    }
}, 60 * 1000);

// ─── Auth Middleware ─────────────────────────────────────────────────
const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }
    try {
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.userId;
        req.userName = decoded.name;
        next();
    } catch {
        return res.status(401).json({ error: 'Invalid token' });
    }
};

// ─── Tunnel State ────────────────────────────────────────────────────
let tunnelProcess = null;
let tunnelUrl = null;
let shortUrl = null;

// Helper: shorten URL (try multiple free services, no API key needed)
async function shortenUrl(longUrl) {
    if (!longUrl) return null;
    // Try TinyURL
    try {
        const resp = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(longUrl)}`);
        if (resp.ok) {
            const shortened = (await resp.text()).trim();
            if (shortened.startsWith('http')) {
                console.log('[Shorten] TinyURL success:', shortened);
                return shortened;
            }
        }
    } catch (e) {
        console.log('[Shorten] TinyURL failed:', e.message);
    }
    // Try is.gd
    try {
        const resp = await fetch(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(longUrl)}`);
        if (resp.ok) {
            const shortened = (await resp.text()).trim();
            if (shortened.startsWith('http')) {
                console.log('[Shorten] is.gd success:', shortened);
                return shortened;
            }
        }
    } catch (e) {
        console.log('[Shorten] is.gd failed:', e.message);
    }
    console.log('[Shorten] All shorteners failed, using full URL');
    return longUrl; // fallback to full URL
}

// ─── REST Endpoints ──────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', rooms: rooms.size });
});

// ── Network Info: Return LAN IP addresses for sharing ───────────────
app.get('/api/network-info', (_req, res) => {
    const interfaces = os.networkInterfaces();
    const addresses = [];
    for (const [name, nets] of Object.entries(interfaces)) {
        for (const net of nets) {
            if (net.family === 'IPv4' && !net.internal) {
                addresses.push({ name, address: net.address });
            }
        }
    }
    res.json({ addresses });
});

// ── Tunnel: Start (Cloudflare Quick Tunnel — no password!) ──────────
app.post('/api/tunnel/start', async (_req, res) => {
    if (tunnelProcess && tunnelUrl) {
        return res.json({ success: true, url: tunnelUrl, shortUrl });
    }
    // Clean up stale process if URL was lost
    if (tunnelProcess && !tunnelUrl) {
        try { tunnelProcess.stop(); } catch { }
        tunnelProcess = null;
    }
    try {
        console.log('[Tunnel] Starting Cloudflare tunnel...');

        // Point tunnel to Vite dev server (5173) which serves frontend + proxies API/socket to Express
        const VITE_PORT = 5173;
        const t = Tunnel.quick(`http://localhost:${VITE_PORT}`);

        // Wait for the URL event from cloudflared
        const cfUrl = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Tunnel URL timed out after 30 seconds.'));
            }, 30000);

            t.once('url', (url) => {
                clearTimeout(timeout);
                console.log(`[Tunnel] Got URL: ${url}`);
                resolve(url);
            });

            t.once('error', (err) => {
                clearTimeout(timeout);
                reject(err);
            });

            t.once('exit', (code) => {
                clearTimeout(timeout);
                reject(new Error(`Tunnel process exited with code ${code}`));
            });
        });

        tunnelUrl = cfUrl;
        tunnelProcess = t;

        console.log(`[Tunnel] Online at ${tunnelUrl}`);

        // Shorten the invite URL
        shortUrl = await shortenUrl(tunnelUrl);
        console.log(`[Tunnel] Short URL: ${shortUrl}`);

        // Monitor for tunnel close
        t.on('exit', () => {
            tunnelProcess = null;
            tunnelUrl = null;
            shortUrl = null;
            console.log('[Tunnel] Closed.');
        });

        res.json({ success: true, url: tunnelUrl, shortUrl });
    } catch (err) {
        console.error('[Tunnel] Failed to start:', err.message);
        // Clean up on failure
        if (tunnelProcess && !tunnelUrl) {
            try { tunnelProcess.stop(); } catch { }
            tunnelProcess = null;
        }
        res.status(500).json({ success: false, error: 'Failed to create tunnel: ' + err.message });
    }
});

// ── Tunnel: Status ──────────────────────────────────────────────────
app.get('/api/tunnel/status', (_req, res) => {
    const active = !!(tunnelProcess && tunnelUrl);
    res.json({ active, url: tunnelUrl, shortUrl });
});

// ── Tunnel: Stop ────────────────────────────────────────────────────
app.post('/api/tunnel/stop', (_req, res) => {
    if (tunnelProcess) {
        try { tunnelProcess.stop(); } catch { }
        tunnelProcess = null;
        tunnelUrl = null;
        shortUrl = null;
    }
    res.json({ success: true });
});


// ── Auth: Register ───────────────────────────────────────────────────
app.post('/api/auth/register', (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ error: 'Name, email, and password are required.' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) {
        return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)').run(name.trim(), email.toLowerCase().trim(), hash);

    const token = jwt.sign({ userId: result.lastInsertRowid, name: name.trim() }, JWT_SECRET, { expiresIn: '30d' });

    res.status(201).json({
        token,
        user: { id: result.lastInsertRowid, name: name.trim(), email: email.toLowerCase().trim() },
    });
});

// ── Auth: Login ──────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (!user) {
        return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (!bcrypt.compareSync(password, user.password_hash)) {
        return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = jwt.sign({ userId: user.id, name: user.name }, JWT_SECRET, { expiresIn: '30d' });

    res.json({
        token,
        user: { id: user.id, name: user.name, email: user.email },
    });
});

// ── Auth: Get Current User ──────────────────────────────────────────
app.get('/api/auth/me', verifyToken, (req, res) => {
    const user = db.prepare('SELECT id, name, email, created_at FROM users WHERE id = ?').get(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ user });
});

// ── History: Save Test Result ────────────────────────────────────────
app.post('/api/history', verifyToken, (req, res) => {
    const { examType, testFormat, score, total, correct, incorrect, unattempted, totalMarks, maxMarks, percentage, totalTime, markingScheme, topicBreakdown, isMultiplayer } = req.body;

    const stmt = db.prepare(`
        INSERT INTO test_history (user_id, exam_type, test_format, score, total, correct, incorrect, unattempted, total_marks, max_marks, percentage, total_time, marking_scheme, topic_breakdown, is_multiplayer)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
        req.userId, examType, testFormat,
        score || 0, total || 0, correct || 0, incorrect || 0, unattempted || 0,
        totalMarks || 0, maxMarks || 0, percentage || 0, totalTime || 0,
        markingScheme ? JSON.stringify(markingScheme) : null,
        topicBreakdown ? JSON.stringify(topicBreakdown) : null,
        isMultiplayer ? 1 : 0
    );

    res.status(201).json({ id: result.lastInsertRowid });
});

// ── History: Get User's History ──────────────────────────────────────
app.get('/api/history', verifyToken, (req, res) => {
    const rows = db.prepare('SELECT * FROM test_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(req.userId);

    const history = rows.map(r => ({
        id: r.id,
        examType: r.exam_type,
        testFormat: r.test_format,
        score: r.score,
        total: r.total,
        correct: r.correct,
        incorrect: r.incorrect,
        unattempted: r.unattempted,
        totalMarks: r.total_marks,
        maxMarks: r.max_marks,
        percentage: r.percentage,
        totalTime: r.total_time,
        markingScheme: r.marking_scheme ? JSON.parse(r.marking_scheme) : null,
        topicBreakdown: r.topic_breakdown ? JSON.parse(r.topic_breakdown) : null,
        isMultiplayer: !!r.is_multiplayer,
        date: r.created_at,
    }));

    res.json({ history });
});

// ── History: Clear ───────────────────────────────────────────────────
app.delete('/api/history', verifyToken, (req, res) => {
    db.prepare('DELETE FROM test_history WHERE user_id = ?').run(req.userId);
    res.json({ success: true });
});

// ── Auth: Change Password ───────────────────────────────────────────
app.put('/api/auth/password', verifyToken, (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both current and new password required.' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });

    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.userId);
    if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
        return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    const hash = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.userId);
    res.json({ success: true });
});

// ── Global Leaderboard ──────────────────────────────────────────────
app.get('/api/leaderboard', (req, res) => {
    const rows = db.prepare(`
        SELECT u.id, u.name,
            COUNT(h.id) as tests_taken,
            ROUND(AVG(h.percentage), 1) as avg_score,
            ROUND(MAX(h.percentage), 1) as best_score,
            SUM(h.total_time) as total_time
        FROM users u
        JOIN test_history h ON h.user_id = u.id
        GROUP BY u.id
        HAVING tests_taken >= 1
        ORDER BY avg_score DESC
        LIMIT 20
    `).all();

    res.json({ leaderboard: rows });
});

// ── Friends: Send Request ───────────────────────────────────────────
app.post('/api/friends/request', verifyToken, (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required.' });

    const friend = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email.toLowerCase().trim(), req.userId);
    if (!friend) return res.status(404).json({ error: 'User not found.' });

    // Check if already friends or pending
    const existing = db.prepare('SELECT id, status FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').get(req.userId, friend.id, friend.id, req.userId);
    if (existing) {
        if (existing.status === 'accepted') return res.status(409).json({ error: 'Already friends.' });
        return res.status(409).json({ error: 'Friend request already pending.' });
    }

    db.prepare('INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, ?)').run(req.userId, friend.id, 'pending');
    res.status(201).json({ success: true });
});

// ── Friends: Accept Request ─────────────────────────────────────────
app.post('/api/friends/accept/:id', verifyToken, (req, res) => {
    const fr = db.prepare('SELECT * FROM friends WHERE id = ? AND friend_id = ? AND status = ?').get(req.params.id, req.userId, 'pending');
    if (!fr) return res.status(404).json({ error: 'Friend request not found.' });

    db.prepare('UPDATE friends SET status = ? WHERE id = ?').run('accepted', fr.id);
    res.json({ success: true });
});

// ── Friends: Remove ─────────────────────────────────────────────────
app.delete('/api/friends/:id', verifyToken, (req, res) => {
    const result = db.prepare('DELETE FROM friends WHERE id = ? AND (user_id = ? OR friend_id = ?)').run(req.params.id, req.userId, req.userId);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found.' });
    res.json({ success: true });
});

// ── Friends: List ───────────────────────────────────────────────────
app.get('/api/friends', verifyToken, (req, res) => {
    // Friends where I am user_id or friend_id and status is accepted
    const accepted = db.prepare(`
        SELECT f.id as friendshipId, f.created_at,
            CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END as friendUserId,
            CASE WHEN f.user_id = ? THEN u2.name ELSE u1.name END as friendName,
            CASE WHEN f.user_id = ? THEN u2.email ELSE u1.email END as friendEmail
        FROM friends f
        JOIN users u1 ON f.user_id = u1.id
        JOIN users u2 ON f.friend_id = u2.id
        WHERE (f.user_id = ? OR f.friend_id = ?) AND f.status = 'accepted'
    `).all(req.userId, req.userId, req.userId, req.userId, req.userId);

    // Pending requests TO me
    const pending = db.prepare(`
        SELECT f.id as friendshipId, f.created_at, u.name as fromName, u.email as fromEmail, u.id as fromId
        FROM friends f
        JOIN users u ON f.user_id = u.id
        WHERE f.friend_id = ? AND f.status = 'pending'
    `).all(req.userId);

    // Requests I sent (pending)
    const sent = db.prepare(`
        SELECT f.id as friendshipId, f.created_at, u.name as toName, u.email as toEmail
        FROM friends f
        JOIN users u ON f.friend_id = u.id
        WHERE f.user_id = ? AND f.status = 'pending'
    `).all(req.userId);

    res.json({ friends: accepted, pending, sent });
});

// ── Friends: Get Friend Stats ───────────────────────────────────────
app.get('/api/friends/:userId/stats', verifyToken, (req, res) => {
    const targetId = parseInt(req.params.userId);
    // Verify friendship
    const friendship = db.prepare(
        'SELECT id FROM friends WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)) AND status = ?'
    ).get(req.userId, targetId, targetId, req.userId, 'accepted');
    if (!friendship) return res.status(403).json({ error: 'Not friends with this user.' });

    const user = db.prepare('SELECT id, name, email, created_at FROM users WHERE id = ?').get(targetId);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const stats = db.prepare(`
        SELECT COUNT(*) as testsTaken,
            ROUND(AVG(percentage), 1) as avgScore,
            ROUND(MAX(percentage), 1) as bestScore,
            SUM(total_time) as totalTime,
            SUM(correct) as totalCorrect,
            SUM(incorrect) as totalIncorrect
        FROM test_history WHERE user_id = ?
    `).get(targetId);

    const recentTests = db.prepare(`
        SELECT exam_type, score, total, percentage, total_time, created_at, is_multiplayer
        FROM test_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 10
    `).all(targetId);

    res.json({ user, stats, recentTests });
});

// ── Questions: List (with filters) ──────────────────────────────────
app.get('/api/questions', verifyToken, (req, res) => {
    const { subject, search, difficulty, topic, page = 1 } = req.query;
    const limit = 50;
    const offset = (parseInt(page) - 1) * limit;

    let where = 'WHERE user_id = ?';
    const params = [req.userId];

    if (subject) { where += ' AND subject = ?'; params.push(subject); }
    if (difficulty) { where += ' AND difficulty = ?'; params.push(difficulty); }
    if (topic) { where += ' AND topic = ?'; params.push(topic); }
    if (search) { where += ' AND question_text LIKE ?'; params.push(`%${search}%`); }

    const total = db.prepare(`SELECT COUNT(*) as count FROM questions ${where}`).get(...params).count;
    const rows = db.prepare(`SELECT * FROM questions ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);

    const questions = rows.map(r => ({
        id: r.id,
        text: r.question_text,
        options: JSON.parse(r.options),
        correctAnswer: r.correct_answer,
        explanation: r.explanation,
        subject: r.subject,
        topic: r.topic || '',
        subtopic: r.subtopic,
        difficulty: r.difficulty,
        questionType: r.question_type || 'MCQ',
        examType: r.exam_type,
    }));

    const subjects = db.prepare('SELECT DISTINCT subject FROM questions WHERE user_id = ? ORDER BY subject').all(req.userId).map(r => r.subject);
    const topics = db.prepare('SELECT DISTINCT topic FROM questions WHERE user_id = ? AND topic != "" ORDER BY topic').all(req.userId).map(r => r.topic);

    res.json({ questions, total, subjects, topics, page: parseInt(page), pages: Math.ceil(total / limit) });
});

// ── Questions: Add Single ───────────────────────────────────────────
app.post('/api/questions', verifyToken, (req, res) => {
    const { text, options, correctAnswer, explanation, subject, topic, subtopic, difficulty, questionType, examType } = req.body;

    if (!text || !options || correctAnswer === undefined) {
        return res.status(400).json({ error: 'Question text, options, and correct answer are required.' });
    }

    const result = db.prepare(`
        INSERT INTO questions (user_id, question_text, options, correct_answer, explanation, subject, topic, subtopic, difficulty, question_type, exam_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.userId, text, JSON.stringify(options), correctAnswer, explanation || '', subject || 'General', topic || '', subtopic || '', difficulty || 'medium', questionType || 'MCQ', examType || 'ssc');

    res.status(201).json({ id: result.lastInsertRowid });
});

// ── Questions: Bulk Import ──────────────────────────────────────────
app.post('/api/questions/bulk', verifyToken, (req, res) => {
    const { questions } = req.body;
    if (!Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ error: 'Provide an array of questions.' });
    }

    const stmt = db.prepare(`
        INSERT INTO questions (user_id, question_text, options, correct_answer, explanation, subject, topic, subtopic, difficulty, question_type, exam_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((items) => {
        let count = 0;
        for (const q of items) {
            let text = q.text || q.question || '';
            let options = q.options;
            let correctAnswer = q.correctAnswer;
            let explanation = q.explanation || '';

            if (options && !Array.isArray(options)) {
                const keys = Object.keys(options).sort();
                const optArr = keys.map(k => options[k]);
                correctAnswer = keys.indexOf(q.correct_option);
                options = optArr;
            }

            if (!text || !options || correctAnswer === undefined) continue;

            stmt.run(
                req.userId, text, JSON.stringify(options), correctAnswer,
                explanation, q.subject || q.subtopic || 'General', q.topic || '', q.subtopic || '', q.difficulty || 'medium', q.questionType || q.question_type || 'MCQ', q.examType || q.exam_type || 'ssc'
            );
            count++;
        }
        return count;
    });

    const imported = insertMany(questions);
    res.status(201).json({ imported });
});

// ── Questions: Update ───────────────────────────────────────────────
app.put('/api/questions/:id', verifyToken, (req, res) => {
    const { text, options, correctAnswer, explanation, subject, topic, subtopic, difficulty, questionType } = req.body;
    const q = db.prepare('SELECT id FROM questions WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
    if (!q) return res.status(404).json({ error: 'Question not found.' });

    db.prepare(`
        UPDATE questions SET question_text=?, options=?, correct_answer=?, explanation=?, subject=?, topic=?, subtopic=?, difficulty=?, question_type=?
        WHERE id=? AND user_id=?
    `).run(text, JSON.stringify(options), correctAnswer, explanation || '', subject || 'General', topic || '', subtopic || '', difficulty || 'medium', questionType || 'MCQ', req.params.id, req.userId);

    res.json({ success: true });
});

// ── Questions: Delete ───────────────────────────────────────────────
app.delete('/api/questions/:id', verifyToken, (req, res) => {
    const result = db.prepare('DELETE FROM questions WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
    if (result.changes === 0) return res.status(404).json({ error: 'Question not found.' });
    res.json({ success: true });
});

// ── Questions: Generate Test ────────────────────────────────────────
app.post('/api/questions/generate', verifyToken, (req, res) => {
    const { subject, count = 25 } = req.body;
    let where = 'WHERE user_id = ?';
    const params = [req.userId];

    if (subject && subject !== 'all') { where += ' AND subject = ?'; params.push(subject); }

    const rows = db.prepare(`SELECT * FROM questions ${where} ORDER BY RANDOM() LIMIT ?`).all(...params, parseInt(count));

    if (rows.length === 0) {
        return res.status(404).json({ error: 'No questions found. Import some questions first.' });
    }

    const questions = rows.map(r => ({
        id: r.id,
        text: r.question_text,
        options: JSON.parse(r.options),
        correctAnswer: r.correct_answer,
        explanation: r.explanation,
        subject: r.subject,
        topic: r.topic || '',
        subtopic: r.subtopic,
        difficulty: r.difficulty,
        questionType: r.question_type || 'MCQ',
    }));

    res.json({ questions });
});

// ── Questions: Generate for Room (with exam_type filter) ────────────
app.post('/api/questions/generate-for-room', verifyToken, (req, res) => {
    const { examType, subject, topic, count = 25 } = req.body;
    let where = 'WHERE user_id = ?';
    const params = [req.userId];

    if (examType && examType !== 'all') { where += ' AND exam_type = ?'; params.push(examType); }
    if (subject && subject !== 'all') { where += ' AND subject = ?'; params.push(subject); }
    if (topic && topic !== 'all') { where += ' AND topic = ?'; params.push(topic); }

    const rows = db.prepare(`SELECT * FROM questions ${where} ORDER BY RANDOM() LIMIT ?`).all(...params, parseInt(count));

    if (rows.length === 0) {
        return res.status(404).json({ error: 'No questions found for this selection. Import some questions first.' });
    }

    const questions = rows.map(r => ({
        id: r.id,
        text: r.question_text,
        options: JSON.parse(r.options),
        correctAnswer: r.correct_answer,
        explanation: r.explanation,
        subject: r.subject,
        topic: r.topic || '',
        subtopic: r.subtopic,
        difficulty: r.difficulty,
        questionType: r.question_type || 'MCQ',
    }));

    res.json({ questions, total: questions.length });
});

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';

app.post('/api/ai/generate', verifyToken, async (req, res) => {
    const { subject, topic, count = 10, difficulty = 'medium', examType = 'ssc_cgl_tier1', optionsCount = 4 } = req.body;

    if (!subject) return res.status(400).json({ error: 'Subject is required.' });
    if (!DEEPSEEK_API_KEY) return res.status(500).json({ error: 'DeepSeek API key not configured. Set DEEPSEEK_API_KEY environment variable.' });

    const safeCount = Math.min(Math.max(parseInt(count) || 10, 1), 50);
    const optionLetters = Array.from({ length: optionsCount }, (_, i) => String.fromCharCode(65 + i));

    const prompt = `Generate exactly ${safeCount} multiple-choice questions for a competitive exam.

Requirements:
- Subject: ${subject}
${topic ? `- Topic: ${topic}` : ''}
- Difficulty: ${difficulty}
- Each question must have exactly ${optionsCount} options (${optionLetters.join(', ')})
- Return ONLY a valid JSON array, no markdown, no explanation
- Each object must have these exact keys:
  {
    "question": "the question text",
    "options": { ${optionLetters.map(l => `"${l}": "option text"`).join(', ')} },
    "correct_option": "${optionLetters[0]}",
    "explanation": "why this is correct",
    "subject": "${subject}",
    "topic": "${topic || subject}",
    "subtopic": "specific subtopic",
    "difficulty": "${difficulty}",
    "question_type": "MCQ"
  }

Return ONLY the JSON array. No other text.`;

    try {
        const response = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.7,
                max_tokens: 8000,
            }),
        });

        if (!response.ok) {
            const errData = await response.text();
            console.error('DeepSeek API error:', errData);
            return res.status(502).json({ error: 'DeepSeek API returned an error. Check your API key.' });
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';

        // Parse JSON from the response (handle markdown code blocks)
        let jsonStr = content.trim();
        if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        }

        const generated = JSON.parse(jsonStr);

        if (!Array.isArray(generated)) {
            return res.status(500).json({ error: 'AI returned invalid format. Please try again.' });
        }

        // Normalize to Testara format
        const questions = generated.map((q, i) => {
            const opts = q.options;
            let optionsArray, correctAnswer;
            if (Array.isArray(opts)) {
                optionsArray = opts;
                correctAnswer = typeof q.correct_option === 'number' ? q.correct_option : 0;
            } else {
                const keys = Object.keys(opts).sort();
                optionsArray = keys.map(k => opts[k]);
                correctAnswer = keys.indexOf(q.correct_option);
                if (correctAnswer < 0) correctAnswer = 0;
            }
            return {
                text: q.question || q.text || `Question ${i + 1}`,
                options: optionsArray,
                correctAnswer,
                explanation: q.explanation || '',
                subject: q.subject || subject,
                topic: q.topic || topic || '',
                subtopic: q.subtopic || '',
                difficulty: q.difficulty || difficulty,
                questionType: q.question_type || 'MCQ',
                examType: examType,
            };
        });

        res.json({ questions, raw_count: generated.length });
    } catch (err) {
        console.error('AI generation error:', err);
        res.status(500).json({ error: `AI generation failed: ${err.message}` });
    }
});

// ── Mocks: Save Full Mock Test ──────────────────────────────────────────────
app.post('/api/mocks', verifyToken, (req, res) => {
    const { examTemplateId, name, questions } = req.body;
    if (!examTemplateId || !name || !Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ error: 'Missing required fields or valid questions.' });
    }

    try {
        const insertMock = db.prepare('INSERT INTO mock_tests (user_id, exam_template_id, name) VALUES (?, ?, ?)');
        const insertQuestion = db.prepare(`
            INSERT INTO questions (user_id, mock_test_id, question_text, options, correct_answer, explanation, subject, subtopic, difficulty, exam_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        db.transaction(() => {
            const mockRes = insertMock.run(req.userId, examTemplateId, name);
            const mockId = mockRes.lastInsertRowid;

            for (const q of questions) {
                insertQuestion.run(
                    req.userId, mockId, q.text, JSON.stringify(q.options), q.correctAnswer,
                    q.explanation || '', q.subject || 'General', q.subtopic || '',
                    q.difficulty || 'medium', examTemplateId
                );
            }
        })();

        res.json({ success: true, message: `Mock test saved with ${questions.length} questions.` });
    } catch (err) {
        console.error('Error saving mock test:', err);
        res.status(500).json({ error: 'Database error saving mock test.' });
    }
});

// ── Mocks: List Saved Mocks ─────────────────────────────────────────────────
app.get('/api/mocks', verifyToken, (req, res) => {
    const rows = db.prepare(`
        SELECT m.*, COUNT(q.id) as question_count 
        FROM mock_tests m 
        LEFT JOIN questions q ON m.id = q.mock_test_id 
        WHERE m.user_id = ? 
        GROUP BY m.id 
        ORDER BY m.created_at DESC
    `).all(req.userId);
    res.json({ mocks: rows });
});

// ── Mocks: Get Mock Test Questions for Starting ──────────────────────────────
app.get('/api/mocks/:id/start', verifyToken, (req, res) => {
    const mockId = req.params.id;
    // Verify ownership
    const mock = db.prepare('SELECT * FROM mock_tests WHERE id = ? AND user_id = ?').get(mockId, req.userId);
    if (!mock) return res.status(404).json({ error: 'Mock test not found.' });

    const rows = db.prepare('SELECT * FROM questions WHERE mock_test_id = ? AND user_id = ?').all(mockId, req.userId);

    const questions = rows.map(r => ({
        id: r.id,
        text: r.question_text,
        options: JSON.parse(r.options),
        correctAnswer: r.correct_answer,
        explanation: r.explanation,
        subject: r.subject,
        subtopic: r.subtopic,
        difficulty: r.difficulty,
        examType: r.exam_type,
    }));

    res.json({ mock, questions });
});

// ─── Socket.IO Events ───────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log(`[Socket] Connected: ${socket.id}`);

    // ── Create Room ──────────────────────────────────────────────────
    socket.on('createRoom', ({ hostName, examType, testFormat, questions, roomMode }, callback) => {
        const code = generateRoomCode();

        const room = {
            code,
            hostId: socket.id,
            hostName,
            examType,
            testFormat,
            questions,
            roomMode,  // 'friendly' or 'exam'
            participants: [{ id: socket.id, name: hostName, isHost: true }],
            started: false,
            results: [],
            currentQuestionIndex: 0,
            // Friendly mode: track who answered for current question
            currentAnswers: {}, // { socketId: optionIndex }
            lastActivity: Date.now(),
        };

        rooms.set(code, room);
        socket.join(code);
        socket.roomCode = code;

        console.log(`[Room] Created: ${code} by ${hostName} (${roomMode} mode)`);
        callback({ success: true, code, room: sanitizeRoom(room) });
    });

    // ── Join Room ────────────────────────────────────────────────────
    socket.on('joinRoom', ({ code, playerName }, callback) => {
        const room = rooms.get(code);

        if (!room) {
            return callback({ success: false, error: 'Room not found. Check the code and try again.' });
        }
        if (room.started) {
            return callback({ success: false, error: 'This test has already started.' });
        }
        if (room.participants.length >= 20) {
            return callback({ success: false, error: 'Room is full (max 20 participants).' });
        }

        const participant = { id: socket.id, name: playerName, isHost: false };
        room.participants.push(participant);
        room.lastActivity = Date.now();

        socket.join(code);
        socket.roomCode = code;

        io.to(code).emit('participantJoined', {
            participant,
            participants: room.participants.map(p => ({ name: p.name, isHost: p.isHost })),
        });

        console.log(`[Room] ${playerName} joined ${code}`);
        callback({
            success: true,
            room: sanitizeRoom(room),
        });
    });

    // ── Start Room (Host Only) ───────────────────────────────────────
    socket.on('startRoom', ({ code }, callback) => {
        const room = rooms.get(code);
        if (!room) return callback({ success: false, error: 'Room not found.' });
        if (room.hostId !== socket.id) return callback({ success: false, error: 'Only the host can start the test.' });
        if (room.participants.length < 1) return callback({ success: false, error: 'Need at least 1 participant.' });

        room.started = true;
        room.currentQuestionIndex = 0;
        room.currentAnswers = {};
        room.lastActivity = Date.now();

        // Shuffle questions (Fisher-Yates) once for all participants
        const shuffled = [...room.questions];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        room.questions = shuffled;

        io.to(code).emit('testStarted', {
            questions: shuffled,
            examType: room.examType,
            testFormat: room.testFormat,
            roomMode: room.roomMode,
        });

        console.log(`[Room] ${code} test started! (${room.roomMode} mode)`);
        callback({ success: true });
    });

    // ── Friendly Mode: Player answers current question ───────────────
    socket.on('friendlyAnswer', ({ code, questionIndex, optionIndex }, callback) => {
        const room = rooms.get(code);
        if (!room || room.roomMode !== 'friendly') return callback?.({ success: false });
        if (questionIndex !== room.currentQuestionIndex) return callback?.({ success: false });

        room.currentAnswers[socket.id] = optionIndex;
        room.lastActivity = Date.now();

        const playerName = room.participants.find(p => p.id === socket.id)?.name || 'Unknown';

        // Broadcast how many have answered (not WHAT they answered)
        const answeredCount = Object.keys(room.currentAnswers).length;
        const totalParticipants = room.participants.length;

        io.to(code).emit('friendlyAnswerStatus', {
            answeredCount,
            totalParticipants,
            answeredPlayers: Object.keys(room.currentAnswers).map(sid => {
                return room.participants.find(p => p.id === sid)?.name || 'Unknown';
            }),
        });

        console.log(`[Friendly] ${playerName} answered Q${questionIndex + 1} in ${code} (${answeredCount}/${totalParticipants})`);

        // If everyone answered, reveal the correct answer + what each player picked
        if (answeredCount >= totalParticipants) {
            const correctAnswer = room.questions[questionIndex].correctAnswer;
            const playerChoices = {};
            for (const [sid, choice] of Object.entries(room.currentAnswers)) {
                const name = room.participants.find(p => p.id === sid)?.name || 'Unknown';
                playerChoices[name] = {
                    choice,
                    isCorrect: choice === correctAnswer,
                };
            }

            io.to(code).emit('friendlyReveal', {
                questionIndex,
                correctAnswer,
                playerChoices,
            });

            console.log(`[Friendly] All answered Q${questionIndex + 1} in ${code} — revealing!`);
        }

        callback?.({ success: true });
    });

    // ── Friendly Mode: Host moves to next question ───────────────────
    socket.on('friendlyNext', ({ code }, callback) => {
        const room = rooms.get(code);
        if (!room || room.roomMode !== 'friendly') return callback?.({ success: false });
        if (room.hostId !== socket.id) return callback?.({ success: false, error: 'Only host can advance.' });

        room.currentQuestionIndex += 1;
        room.currentAnswers = {};
        room.lastActivity = Date.now();

        io.to(code).emit('friendlyNextQuestion', {
            questionIndex: room.currentQuestionIndex,
        });

        console.log(`[Friendly] Moving to Q${room.currentQuestionIndex + 1} in ${code}`);
        callback?.({ success: true });
    });

    // ── Friendly Mode: Host finishes exam for all ────────────────────
    socket.on('friendlyFinish', ({ code }, callback) => {
        const room = rooms.get(code);
        if (!room || room.roomMode !== 'friendly') return callback?.({ success: false });
        if (room.hostId !== socket.id) return callback?.({ success: false, error: 'Only host can finish.' });

        room.lastActivity = Date.now();
        io.to(code).emit('friendlyForceSubmit');
        console.log(`[Friendly] Host force-finished exam in ${code}`);
        callback?.({ success: true });
    });

    // ── Chat (Friendly Mode) ──────────────────────────────────────────
    socket.on('chatSend', ({ code, text }) => {
        const room = rooms.get(code);
        if (!room) return;

        const sender = room.participants.find(p => p.id === socket.id)?.name || 'Unknown';
        const msg = { sender, text: text.slice(0, 200), timestamp: Date.now() };

        io.to(code).emit('chatMessage', msg);
    });

    // ── Submit Results ───────────────────────────────────────────────
    socket.on('submitResults', ({ code, playerName, answers, timeSpent, score, total, correct, incorrect }, callback) => {
        const room = rooms.get(code);
        if (!room) return callback?.({ success: false, error: 'Room not found.' });

        room.results = room.results.filter(r => r.playerId !== socket.id);

        const totalTime = timeSpent.reduce((sum, t) => sum + (t || 0), 0);

        room.results.push({
            playerId: socket.id,
            playerName,
            score,
            total,
            correct,
            incorrect,
            totalTime,
            answers,
            timeSpent,
            submittedAt: Date.now(),
        });

        room.lastActivity = Date.now();

        room.results.sort((a, b) => b.score - a.score || a.totalTime - b.totalTime);

        io.to(code).emit('leaderboardUpdate', {
            results: room.results,
            totalParticipants: room.participants.length,
            allSubmitted: room.results.length === room.participants.length,
        });

        console.log(`[Room] ${playerName} submitted results in ${code} (${room.results.length}/${room.participants.length})`);
        callback?.({ success: true, rank: room.results.findIndex(r => r.playerId === socket.id) + 1 });
    });

    // ── Get Leaderboard ──────────────────────────────────────────────
    socket.on('getLeaderboard', ({ code }, callback) => {
        const room = rooms.get(code);
        if (!room) return callback({ success: false, error: 'Room not found.' });

        callback({
            success: true,
            results: room.results,
            totalParticipants: room.participants.length,
            allSubmitted: room.results.length === room.participants.length,
        });
    });

    // ── Disconnect ───────────────────────────────────────────────────
    socket.on('disconnect', () => {
        const code = socket.roomCode;
        if (!code) return;

        const room = rooms.get(code);
        if (!room) return;

        room.participants = room.participants.filter(p => p.id !== socket.id);
        room.lastActivity = Date.now();

        io.to(code).emit('participantLeft', {
            participants: room.participants.map(p => ({ name: p.name, isHost: p.isHost })),
        });

        // Re-check if all remaining participants answered in friendly mode
        if (room.roomMode === 'friendly' && room.started) {
            delete room.currentAnswers[socket.id];
            const answeredCount = Object.keys(room.currentAnswers).length;
            if (room.participants.length > 0 && answeredCount >= room.participants.length) {
                const qi = room.currentQuestionIndex;
                const correctAnswer = room.questions[qi].correctAnswer;
                const playerChoices = {};
                for (const [sid, choice] of Object.entries(room.currentAnswers)) {
                    const name = room.participants.find(p => p.id === sid)?.name || 'Unknown';
                    playerChoices[name] = { choice, isCorrect: choice === correctAnswer };
                }
                io.to(code).emit('friendlyReveal', { questionIndex: qi, correctAnswer, playerChoices });
            }
        }

        if (room.hostId === socket.id && !room.started) {
            io.to(code).emit('roomClosed', { reason: 'Host left the room.' });
            rooms.delete(code);
            console.log(`[Room] ${code} closed (host left)`);
        }

        // Clean up voice peers on disconnect
        if (room.voicePeers) {
            const voicePeer = room.voicePeers.find(p => p.id === socket.id);
            if (voicePeer) {
                room.voicePeers = room.voicePeers.filter(p => p.id !== socket.id);
                socket.to(code).emit('voiceLeave', { peerId: socket.id, peerName: voicePeer.name });
            }
        }

        console.log(`[Socket] Disconnected: ${socket.id}`);
    });

    // ── Writing Pad: Real-time stroke relay ─────────────────────────
    socket.on('padDraw', ({ code, questionIndex, stroke }) => {
        if (!code) return;
        socket.to(code).emit('padDraw', { questionIndex, stroke });
    });

    socket.on('padClear', ({ code, questionIndex, playerId }) => {
        if (!code) return;
        socket.to(code).emit('padClear', { questionIndex, playerId });
    });

    socket.on('padUndo', ({ code, questionIndex, playerId }) => {
        if (!code) return;
        socket.to(code).emit('padUndo', { questionIndex, playerId });
    });

    socket.on('padPrivacy', ({ code, shared }) => {
        if (!code) return;
        socket.to(code).emit('padPrivacy', { shared });
    });

    // ── Voice Chat: WebRTC Signaling ────────────────────────────────
    socket.on('voiceJoin', ({ code, peerName }) => {
        if (!code) return;
        const room = rooms.get(code);
        if (!room) return;

        // Track voice participants
        if (!room.voicePeers) room.voicePeers = [];
        room.voicePeers = room.voicePeers.filter(p => p.id !== socket.id);
        room.voicePeers.push({ id: socket.id, name: peerName });

        // Tell existing voice peers about new joiner
        socket.to(code).emit('voiceJoin', { peerId: socket.id, peerName });

        // Send current voice peer list to the joiner
        socket.emit('voicePeers', {
            peers: room.voicePeers.filter(p => p.id !== socket.id),
        });
    });

    socket.on('voiceOffer', ({ code, targetId, offer }) => {
        if (!code || !targetId) return;
        const room = rooms.get(code);
        const peerName = room?.voicePeers?.find(p => p.id === socket.id)?.name || 'Unknown';
        io.to(targetId).emit('voiceOffer', { fromId: socket.id, fromName: peerName, offer });
    });

    socket.on('voiceAnswer', ({ code, targetId, answer }) => {
        if (!code || !targetId) return;
        io.to(targetId).emit('voiceAnswer', { fromId: socket.id, answer });
    });

    socket.on('voiceIceCandidate', ({ code, targetId, candidate }) => {
        if (!code || !targetId) return;
        io.to(targetId).emit('voiceIceCandidate', { fromId: socket.id, candidate });
    });

    socket.on('voiceLeave', ({ code, peerName }) => {
        if (!code) return;
        const room = rooms.get(code);
        if (room && room.voicePeers) {
            room.voicePeers = room.voicePeers.filter(p => p.id !== socket.id);
        }
        socket.to(code).emit('voiceLeave', { peerId: socket.id, peerName });
    });
});

// ─── Helpers ─────────────────────────────────────────────────────────
function sanitizeRoom(room) {
    return {
        code: room.code,
        hostName: room.hostName,
        examType: room.examType,
        testFormat: room.testFormat,
        roomMode: room.roomMode,
        participants: room.participants.map(p => ({ name: p.name, isHost: p.isHost })),
        started: room.started,
    };
}

// ─── Start Server ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  🚀 Testara server running on http://localhost:${PORT}\n`);
});
