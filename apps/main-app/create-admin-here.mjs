#!/usr/bin/env node
import crypto from 'crypto';
import { promisify } from 'util';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

const scrypt = promisify(crypto.scrypt);

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derivedKey = await scrypt(password, salt, 64);
  return `${salt.toString('hex')}:${derivedKey.toString('hex')}`;
}

async function createAdmin() {
  const db = new Database('./var/chat.db');
  
  // Delete existing admin
  db.prepare('DELETE FROM users WHERE username = ?').run('etdofresh');
  
  // Create new admin with password: admin123
  const password = 'admin123';
  const hash = await hashPassword(password);
  const id = randomUUID();
  
  db.prepare(`
    INSERT INTO users (id, username, password_hash, is_admin, created_at, updated_at)
    VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))
  `).run(id, 'etdofresh', hash);
  
  console.log('✅ Admin user created in apps/main-app/var/chat.db!');
  console.log('Username: etdofresh');
  console.log('Password: admin123');
  console.log('');
  console.log('Refresh your browser and login with these credentials.');
  
  db.close();
}

createAdmin().catch(console.error);
