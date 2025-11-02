#!/usr/bin/env node
import crypto from 'crypto';
import { promisify } from 'util';
import Database from 'better-sqlite3';

const scrypt = promisify(crypto.scrypt);

async function verifyPassword(password, storedHash) {
  console.log('Testing password:', password);
  console.log('Stored hash:', storedHash);
  console.log('');
  
  const [saltHex, keyHex] = storedHash.split(':');
  if (!saltHex || !keyHex) {
    console.log('❌ Invalid hash format');
    return false;
  }

  console.log('Salt (hex):', saltHex, `(${saltHex.length} chars, ${saltHex.length/2} bytes)`);
  console.log('Key (hex):', keyHex, `(${keyHex.length} chars, ${keyHex.length/2} bytes)`);
  console.log('');

  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(keyHex, 'hex');
  
  console.log('Expected key length:', expected.length, 'bytes');
  
  let derived;
  try {
    derived = await scrypt(password, salt, expected.length);
    console.log('Derived key length:', derived.length, 'bytes');
  } catch (error) {
    console.log('❌ Scrypt error:', error.message);
    return false;
  }

  if (derived.length !== expected.length) {
    console.log('❌ Length mismatch');
    return false;
  }

  const match = crypto.timingSafeEqual(derived, expected);
  console.log('');
  console.log(match ? '✅ Password matches!' : '❌ Password does not match');
  
  return match;
}

const db = new Database('./var/chat.db');
const user = db.prepare('SELECT * FROM users WHERE username = ?').get('etdofresh');
db.close();

if (!user) {
  console.log('❌ User not found');
  process.exit(1);
}

await verifyPassword('admin123', user.password_hash);
