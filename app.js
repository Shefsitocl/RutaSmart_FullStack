/**
 * app.js - Backend reescrito y mejorado para RutaSmart
 * - Express + MySQL pool (pool exportado desde ./db)
 * - Auth: admin (users table) y drivers (drivers table) con cookies HttpOnly
 * - CRUD drivers / workers (workers tiene driver_id + driver_name)
 * - Validaciones y manejo de errores centralizado
 *
 * Requisitos: Crear ./db que exporte un pool compatible con pool.execute(...)
 */

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const { body, param, validationResult } = require('express-validator');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('./db'); // debe exportar connection pool (mysql2/promise)
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 4000;
const BCRYPT_SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || '12', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
const COOKIE_SAMESITE = process.env.COOKIE_SAMESITE || 'Lax'; // 'Lax' es amigable para dev

/* ---------------- Middlewares base ---------------- */
const allowedOrigins = [
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl} - Origin: ${req.headers.origin || '-'}`);
  next();
});

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // tools like Postman
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

app.use(helmet());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

/* ---------------- Rate limiter ---------------- */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', apiLimiter);

/* ---------------- Helpers ---------------- */
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * authMiddleware: valida cookie 'session' (usuarios/admins)
 * añade req.user = { id, username, role_id, ... } si ok
 */
async function authMiddleware(req, res, next) {
  try {
    const token = req.cookies['session'];
    if (!token) return res.status(401).json({ error: 'Unauthenticated' });
    const data = jwt.verify(token, JWT_SECRET);
    const [rows] = await pool.execute('SELECT id, username, email, role_id, is_active FROM users WHERE id = ?', [data.id]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid session' });
    if (!rows[0].is_active) return res.status(403).json({ error: 'Account disabled' });
    req.user = rows[0];
    next();
  } catch (err) {
    console.warn('authMiddleware:', err && err.message);
    return res.status(401).json({ error: 'Unauthenticated' });
  }
}

/**
 * adminOnly: requiere authMiddleware previo y role_id === 1
 */
function adminOnly(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
  if (req.user.role_id !== 1) return res.status(403).json({ error: 'Admin required' });
  next();
}

/* ---------------- Auth (users - admins) ---------------- */
app.post('/api/auth/register', [
  body('username').isLength({ min: 3, max: 30 }).trim().matches(/^[A-Za-z0-9._-]+$/),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 10 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { username, email, password } = req.body;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [exists] = await conn.execute('SELECT id FROM users WHERE username = ? OR email = ? FOR UPDATE', [username, email]);
    if (exists.length) {
      await conn.rollback();
      return res.status(409).json({ error: 'Username or email already in use' });
    }
    const password_hash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    const [result] = await conn.execute(
      `INSERT INTO users (uuid, username, email, password_hash, role_id, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, NOW(), NOW())`,
      [uuidv4(), username, email, password_hash, 2]
    );
    await conn.execute('INSERT INTO audit_logs (user_id, action, ip, metadata, created_at) VALUES (?, ?, ?, ?, NOW())',
      [result.insertId, 'register', req.ip || null, JSON.stringify({ username, email })]);
    await conn.commit();
    res.status(201).json({ message: 'User created' });
  } catch (err) {
    await conn.rollback();
    console.error('register', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn.release();
  }
});

app.post('/api/auth/login', [
  body('identifier').isLength({ min: 1 }),
  body('password').isLength({ min: 1 })
], async (req, res) => {
  const { identifier, password } = req.body;
  try {
    const [rows] = await pool.execute(
      'SELECT id, username, email, password_hash, failed_attempts, lockout_until, is_active, role_id FROM users WHERE username = ? OR email = ?',
      [identifier, identifier]
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const user = rows[0];
    if (!user.is_active) return res.status(403).json({ error: 'Account disabled' });
    if (user.lockout_until && new Date(user.lockout_until) > new Date())
      return res.status(423).json({ error: 'Account temporarily locked' });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      const failed = (user.failed_attempts || 0) + 1;
      const updates = [];
      const params = [];
      if (failed >= 5) {
        updates.push('failed_attempts = ?', 'lockout_until = ?');
        params.push(failed, new Date(Date.now() + 15 * 60 * 1000));
      } else {
        updates.push('failed_attempts = ?');
        params.push(failed);
      }
      params.push(user.id);
      await pool.execute(`UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`, params);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // reset failed attempts and issue token
    await pool.execute('UPDATE users SET failed_attempts = 0, lockout_until = NULL, last_login = NOW() WHERE id = ?', [user.id]);
    const token = signToken({ id: user.id, username: user.username, role: user.role_id === 1 ? 'admin' : 'user' });
    res.cookie('session', token, {
      httpOnly: true,
      secure: COOKIE_SECURE,
      sameSite: COOKIE_SAMESITE,
      maxAge: 1000 * 60 * 60
    });
    await pool.execute('INSERT INTO audit_logs (user_id, action, ip, metadata, created_at) VALUES (?, ?, ?, ?, NOW())',
      [user.id, 'login', req.ip || null, JSON.stringify({ method: 'password' })]);
    res.json({ message: 'Logged in', role: user.role_id === 1 ? 'admin' : 'user' });
  } catch (err) {
    console.error('login', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/logout', authMiddleware, async (req, res) => {
  try {
    res.clearCookie('session', { httpOnly: true, secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE });
    await pool.execute('INSERT INTO audit_logs (user_id, action, ip, metadata, created_at) VALUES (?, ?, ?, ?, NOW())',
      [req.user.id, 'logout', req.ip || null, null]);
    res.json({ message: 'Logged out' });
  } catch (err) {
    console.error('logout', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ---------------- Driver auth (choferes) ---------------- */
app.post('/api/auth/driver-login', [
  body('username').isLength({ min: 1 }),
  body('password').isLength({ min: 1 })
], async (req, res) => {
  const { username, password } = req.body;
  try {
    const [rows] = await pool.execute('SELECT id, username, display_name, password_hash FROM drivers WHERE username = ?', [username]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const driver = rows[0];
    const match = await bcrypt.compare(password, driver.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken({ id: driver.id, username: driver.username, name: driver.display_name, type: 'driver' });
    res.cookie('driver_session', token, {
      httpOnly: true,
      secure: COOKIE_SECURE,
      sameSite: COOKIE_SAMESITE,
      maxAge: 1000 * 60 * 60
    });
    await pool.execute('INSERT INTO audit_logs (action, ip, metadata, created_at) VALUES (?, ?, ?, NOW())',
      ['driver_login', req.ip || null, JSON.stringify({ driverId: driver.id, username: driver.username })]);
    res.json({ message: 'Driver logged in', name: driver.display_name });
  } catch (err) {
    console.error('driver-login', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ---------------- Drivers (admin) ---------------- */
app.get('/api/drivers', authMiddleware, adminOnly, async (req, res) => {
  try {
    const [drivers] = await pool.execute('SELECT id, username, display_name, created_at FROM drivers ORDER BY display_name ASC');
    res.json(drivers);
  } catch (err) {
    console.error('get /api/drivers', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/drivers', [
  authMiddleware, adminOnly,
  body('username').isLength({ min: 3 }).trim(),
  body('display_name').isLength({ min: 3 }).trim(),
  body('password').isLength({ min: 8 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { username, display_name, password } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [exists] = await conn.execute('SELECT id FROM drivers WHERE username = ? FOR UPDATE', [username]);
    if (exists.length) {
      await conn.rollback();
      return res.status(409).json({ error: 'Driver username already exists' });
    }
    const password_hash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    const [result] = await conn.execute('INSERT INTO drivers (username, display_name, password_hash, created_at) VALUES (?, ?, ?, NOW())', [username, display_name, password_hash]);
    await conn.execute('INSERT INTO audit_logs (user_id, action, ip, metadata, created_at) VALUES (?, ?, ?, ?, NOW())', [req.user.id, 'create_driver', req.ip || null, JSON.stringify({ driverId: result.insertId, username })]);
    await conn.commit();
    res.status(201).json({ id: result.insertId, username, display_name });
  } catch (err) {
    await conn.rollback();
    console.error('post /api/drivers', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn.release();
  }
});

app.put('/api/drivers/:id', [
  authMiddleware, adminOnly,
  param('id').isInt(),
  body('display_name').optional().isLength({ min: 1 }).trim(),
  body('password').optional().isLength({ min: 8 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { id } = req.params;
  const { display_name, password } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const fields = [], params = [];
    if (display_name) { fields.push('display_name = ?'); params.push(display_name); }
    if (password) { const hash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS); fields.push('password_hash = ?'); params.push(hash); }
    if (!fields.length) return res.status(400).json({ error: 'Nada que actualizar' });
    params.push(id);
    await conn.execute(`UPDATE drivers SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ?`, params);
    await conn.commit();
    res.json({ message: 'Driver actualizado' });
  } catch (err) {
    await conn.rollback();
    console.error('put /api/drivers/:id', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    conn.release();
  }
});

app.delete('/api/drivers/:id', authMiddleware, adminOnly, [param('id').isInt()], async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await pool.execute('DELETE FROM drivers WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Driver not found' });
    res.status(204).end();
  } catch (err) {
    console.error('delete /api/drivers/:id', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ---------------- Workers (admin + driver endpoints) ---------------- */

/**
 * GET /api/workers
 * - Admin: devuelve todos los workers con driver_name (LEFT JOIN drivers)
 */
app.get('/api/workers', authMiddleware, adminOnly, async (req, res) => {
  try {
    const [workers] = await pool.execute(`
      SELECT w.id, w.name, w.address, w.lat, w.lng, w.driver_id, 
             COALESCE(d.display_name, w.driver_name) AS driver_name,
             w.phone, w.day, w.shift, w.notes, w.created_at, w.updated_at
      FROM workers w
      LEFT JOIN drivers d ON w.driver_id = d.id
      ORDER BY w.name ASC
    `);
    res.json(workers);
  } catch (err) {
    console.error('get /api/workers', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/workers
 * - Admin crea trabajador
 * - Acepta driver_id (int) y driver_name (string) opcional
 */
app.post('/api/workers', [
  authMiddleware, adminOnly,
  body('name').isLength({ min: 3 }).trim(),
  body('address').isLength({ min: 3 }).trim(),
  body('lat').optional({ nullable: true }).isFloat(),
  body('lng').optional({ nullable: true }).isFloat(),
  body('driver_id').optional({ nullable: true }).isInt(),
  body('driver_name').optional({ nullable: true }).isString().trim(),
  body('phone').optional({ nullable: true }).isString().trim(),
  body('day').optional({ nullable: true }).isString().trim(),
  body('shift').optional({ nullable: true }).isString().trim(),
  body('notes').optional({ nullable: true }).isString().trim()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const {
    name, address, lat = null, lng = null,
    driver_id = null, driver_name = null,
    phone = null, day = null, shift = null, notes = null
  } = req.body;

  try {
    const [result] = await pool.execute(
      `INSERT INTO workers (name, address, lat, lng, driver_id, driver_name, phone, day, shift, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [name, address, lat, lng, driver_id, driver_name, phone, day, shift, notes]
    );
    await pool.execute('INSERT INTO audit_logs (user_id, action, ip, metadata, created_at) VALUES (?, ?, ?, ?, NOW())',
      [req.user.id, 'create_worker', req.ip || null, JSON.stringify({ workerId: result.insertId, name })]);
    res.status(201).json({ id: result.insertId, ...req.body });
  } catch (err) {
    console.error('post /api/workers', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/workers/:id
 * - Actualización parcial: solo campos enviados en body serán actualizados.
 * - Permite actualizar driver_id y driver_name.
 */
app.patch('/api/workers/:id', [
  authMiddleware, adminOnly,
  param('id').isInt()
], async (req, res) => {
  const { id } = req.params;
  const allowedFields = ['name','address','lat','lng','driver_id','driver_name','phone','day','shift','notes'];
  const fields = [];
  const params = [];

  for (const f of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(req.body, f)) {
      fields.push(`${f} = ?`);
      params.push(req.body[f] === '' ? null : req.body[f]);
    }
  }

  if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

  fields.push('updated_at = NOW()');
  params.push(id);

  try {
    const query = `UPDATE workers SET ${fields.join(', ')} WHERE id = ?`;
    const [result] = await pool.execute(query, params);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Worker not found' });
    await pool.execute('INSERT INTO audit_logs (user_id, action, ip, metadata, created_at) VALUES (?, ?, ?, ?, NOW())',
      [req.user.id, 'update_worker', req.ip || null, JSON.stringify({ workerId: id, updatedFields: Object.keys(req.body) })]);
    res.json({ message: 'Worker updated' });
  } catch (err) {
    console.error('patch /api/workers/:id', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/workers/:id
 * - Eliminar trabajador (admin)
 */
app.delete('/api/workers/:id', authMiddleware, adminOnly, [param('id').isInt()], async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await pool.execute('DELETE FROM workers WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Worker not found' });
    await pool.execute('INSERT INTO audit_logs (user_id, action, ip, metadata, created_at) VALUES (?, ?, ?, ?, NOW())',
      [req.user.id, 'delete_worker', req.ip || null, JSON.stringify({ workerId: id })]);
    res.status(204).end();
  } catch (err) {
    console.error('delete /api/workers/:id', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/driver/workers
 * - Para chofer logueado (cookie driver_session) devuelve sus workers (driver_id = su id)
 */
app.get('/api/driver/workers', async (req, res) => {
  try {
    const token = req.cookies['driver_session'];
    if (!token) return res.status(401).json({ error: 'Unauthenticated' });
    const data = jwt.verify(token, JWT_SECRET);
    if (!data || data.type !== 'driver') return res.status(401).json({ error: 'Invalid driver session' });

    const [workers] = await pool.execute(
      `SELECT id, name, address, lat, lng, phone, day, shift, notes
       FROM workers WHERE driver_id = ? ORDER BY name ASC`,
      [data.id]
    );
    res.json(workers);
  } catch (err) {
    console.error('get /api/driver/workers', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ---------------- Health & error handler ---------------- */
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// Global error handler (catch-all)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err && err.stack ? err.stack : err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

/* ---------------- Start server ---------------- */
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
