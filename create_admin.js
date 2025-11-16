require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('./db');

const BCRYPT_SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || '12', 10);

async function createAdmin(){
  const username = process.env.ADMIN_USERNAME || 'admin';
  const email = process.env.ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.ADMIN_PASSWORD || 'admin1234';
  const conn = await pool.getConnection();
  try {
    const [exists] = await conn.execute('SELECT id FROM users WHERE username = ?', [username]);
    if(exists.length){
      console.log('Admin already exists. Skipping.');
      return process.exit(0);
    }
    const hash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    const { v4: uuidv4 } = require('uuid');
    const [r] = await conn.execute('INSERT INTO users (uuid, username, email, password_hash, role_id, is_active, created_at) VALUES (?, ?, ?, ?, 1, 1, NOW())', [uuidv4(), username, email, hash]);
    console.log('Admin created with id', r.insertId, 'username', username, 'password (plaintext):', password);
    console.log('IMPORTANT: change the password immediately in production.');
    process.exit(0);
  } catch(err){ console.error(err); process.exit(1); } finally { conn.release(); }
}

createAdmin();
