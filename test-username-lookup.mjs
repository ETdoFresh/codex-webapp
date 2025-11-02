#!/usr/bin/env node
import Database from 'better-sqlite3';

function sanitizeUsername(input) {
  return input.trim().toLowerCase();
}

const db = new Database('./var/chat.db');

const testCases = ['etdofresh', 'ETDOFRESH', 'Etdofresh', 'etDoFresh'];

console.log('Testing username lookups:\n');

for (const username of testCases) {
  const sanitized = sanitizeUsername(username);
  console.log(`Input: "${username}" → Sanitized: "${sanitized}"`);
  
  const user = db.prepare('SELECT username FROM users WHERE username = ?').get(sanitized);
  console.log(user ? `  ✅ Found: ${user.username}` : '  ❌ Not found');
  console.log('');
}

// Show actual usernames in DB
console.log('Actual usernames in database:');
const users = db.prepare('SELECT username FROM users').all();
users.forEach(u => console.log(`  - "${u.username}"`));

db.close();
