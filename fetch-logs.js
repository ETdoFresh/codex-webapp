const Database = require('better-sqlite3');
const crypto = require('crypto');

// Initialize database
const db = new Database('/Users/etgarcia/temp/codex-webapp/apps/main-app/codex-webapp.db');

// Get deploy config
const configRow = db.prepare('SELECT * FROM deploy_config WHERE id = ?').get('default');
if (!configRow) {
  console.error('No deploy config found');
  process.exit(1);
}

const config = JSON.parse(configRow.config);

// Decrypt API key
const algorithm = 'aes-256-gcm';
const encryptionKey = process.env.ENCRYPTION_KEY || 'codex-webapp-default-encryption-key-32';
const key = Buffer.from(encryptionKey.padEnd(32, '0').slice(0, 32), 'utf8');

let apiKey;
if (configRow.api_key_iv && configRow.api_key_tag) {
  const iv = Buffer.from(configRow.api_key_iv, 'base64');
  const tag = Buffer.from(configRow.api_key_tag, 'base64');
  const encryptedData = Buffer.from(configRow.api_key_cipher, 'base64');

  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encryptedData, undefined, 'utf8');
  decrypted += decipher.final('utf8');
  apiKey = decrypted;
} else {
  apiKey = Buffer.from(configRow.api_key_cipher, 'base64').toString('utf8');
}

// Get session service
const sessionId = '7d257403-a6fe-4c4c-a544-2d374379e6da';
const serviceRow = db.prepare('SELECT * FROM session_services WHERE session_id = ?').get(sessionId);

if (!serviceRow) {
  console.error('Session service not found');
  process.exit(1);
}

console.log('Session service:', {
  sessionId: serviceRow.session_id,
  dokployAppId: serviceRow.dokploy_app_id,
  status: serviceRow.status,
  errorMessage: serviceRow.error_message
});

if (!serviceRow.dokploy_app_id) {
  console.error('No Dokploy application ID found for this session');
  process.exit(1);
}

// Fetch logs from Dokploy
const baseUrl = config.baseUrl;
const applicationId = serviceRow.dokploy_app_id;
const url = `${baseUrl}/deployment.logs?deploymentId=${applicationId}`;

console.log('\nFetching logs from:', url);
console.log('Using auth method:', config.authMethod);

const headers = {
  'accept': 'application/json'
};

if (config.authMethod === 'authorization') {
  headers['Authorization'] = `Bearer ${apiKey}`;
} else {
  headers['x-api-key'] = apiKey;
}

fetch(url, { headers })
  .then(async response => {
    console.log('Response status:', response.status);
    const text = await response.text();
    console.log('\nResponse body:');
    console.log(text);

    if (response.ok) {
      try {
        const json = JSON.parse(text);
        console.log('\nParsed logs:');
        console.log(JSON.stringify(json, null, 2));
      } catch (e) {
        console.log('Response is not JSON');
      }
    }
  })
  .catch(error => {
    console.error('Error fetching logs:', error);
  });
