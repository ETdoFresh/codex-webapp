const Database = require('better-sqlite3');

// Get configuration from database
const db = new Database('/Users/etgarcia/temp/codex-webapp/apps/main-app/var/chat.db');

const configRow = db.prepare('SELECT * FROM deploy_configs WHERE id = ?').get('default');
const config = JSON.parse(configRow.config_json);

// Decrypt API key
const apiKey = Buffer.from(configRow.api_key_cipher, 'base64').toString('utf8');

const domainId = 'wkXcuqzxEWYg_erEWg2bY';
const sessionId = '3dbb084b-ab96-46df-b90d-f1b130b245c7';

console.log('Updating domain:', domainId);

// Update domain to enable stripPath
const updateConfig = {
  domainId: domainId,
  host: 'codex-webapp.etdofresh.com',
  path: `/${sessionId}`,
  port: 3000,
  https: true,
  certificateType: 'letsencrypt',
  stripPath: true
};

console.log('\nUpdate configuration:');
console.log(JSON.stringify(updateConfig, null, 2));

const url = `${config.baseUrl}/domain.update`;

fetch(url, {
  method: 'POST',
  headers: {
    'accept': 'application/json',
    'content-type': 'application/json',
    'x-api-key': apiKey
  },
  body: JSON.stringify(updateConfig)
})
.then(async response => {
  console.log('\nResponse status:', response.status);
  const text = await response.text();

  if (response.ok) {
    console.log('\n✅ Domain updated successfully!');
    try {
      const json = JSON.parse(text);
      console.log(JSON.stringify(json, null, 2));
    } catch (e) {
      console.log(text);
    }
  } else {
    console.log('\n❌ Error updating domain:');
    console.log(text);
  }
})
.catch(error => {
  console.error('Error:', error);
});
