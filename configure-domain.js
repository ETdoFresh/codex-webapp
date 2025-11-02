const Database = require('better-sqlite3');

// Get configuration from database
const db = new Database('/Users/etgarcia/temp/codex-webapp/apps/main-app/var/chat.db');

const configRow = db.prepare('SELECT * FROM deploy_configs WHERE id = ?').get('default');
const config = JSON.parse(configRow.config_json);

// Decrypt API key (old encryption without IV/tag)
const apiKey = Buffer.from(configRow.api_key_cipher, 'base64').toString('utf8');

// Get the latest session container
const sessionId = '3dbb084b-ab96-46df-b90d-f1b130b245c7';
const container = db.prepare('SELECT * FROM session_containers WHERE session_id = ?').get(sessionId);

if (!container) {
  console.error('Session container not found');
  process.exit(1);
}

const applicationId = container.dokploy_app_id;

console.log('Configuring domain for application:', applicationId);
console.log('Session ID:', sessionId);

// Configure domain with Let's Encrypt
const domainConfig = {
  host: 'codex-webapp.etdofresh.com',
  path: `/${sessionId}`,
  port: 3000,
  https: true,
  certificateType: 'letsencrypt',
  applicationId: applicationId,
  domainType: 'application'
};

console.log('\nDomain configuration:');
console.log(JSON.stringify(domainConfig, null, 2));

const url = `${config.baseUrl}/domain.create`;

fetch(url, {
  method: 'POST',
  headers: {
    'accept': 'application/json',
    'content-type': 'application/json',
    'x-api-key': apiKey
  },
  body: JSON.stringify(domainConfig)
})
.then(async response => {
  console.log('\nResponse status:', response.status);
  const text = await response.text();

  if (response.ok) {
    console.log('\n✅ Domain configured successfully!');
    try {
      const json = JSON.parse(text);
      console.log(JSON.stringify(json, null, 2));
    } catch (e) {
      console.log(text);
    }
  } else {
    console.log('\n❌ Error configuring domain:');
    console.log(text);
  }
})
.catch(error => {
  console.error('Error:', error);
});
