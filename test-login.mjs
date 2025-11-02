#!/usr/bin/env node
import crypto from 'crypto';
import { promisify } from 'util';
import Database from 'better-sqlite3';

const scrypt = promisify(crypto.scrypt);

async function verifyPassword(password, storedHash) {
  const [saltHex, keyHex] = storedHash.split(':');
  if (!saltHex || !keyHex) {
    return false;
  }

  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(keyHex, 'hex');
  const derived = await scrypt(password, salt, expected.length);

  return crypto.timingSafeEqual(derived, expected);
}

async function testLogin() {
  const db = new Database('./var/chat.db');
  
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get('etdofresh');
  
  if (!user) {
    console.log('❌ User not found!');
    return;
  }
  
  console.log('✅ User found:', user.username);
  console.log('User ID:', user.id);
  console.log('Is Admin:', user.is_admin);
  console.log('Password hash:', user.password_hash);
  console.log('');
  
  // Test password
  const password = 'admin123';
  const isValid = await verifyPassword(password, user.password_hash);
  
  console.log(`Testing password: "${password}"`);
  console.log(isValid ? '✅ Password is correct!' : '❌ Password is incorrect!');
  
  db.close();
}

testLogin().catch(console.error);
