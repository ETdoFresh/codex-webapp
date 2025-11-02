const crypto = require('crypto');

// Hardcoded from database
const config = {
  baseUrl: 'https://dokploy.etdofresh.com/api',
  authMethod: 'x-api-key',
  projectId: 'ljDYxJYxLBwCR5xCR11Zk',
  environmentId: 'AfeqAojxc2cXpXGP6I0pD',
  githubId: 'g8I6enn2VAyh4gd51tB6o'
};

const encryptedKey = 'U2xLbVJRVW52Z0JES0loZHlDTHpKb0dJY0dkUkxuQXJFd1dRSmNkcW5JYXNpZkt0eXBrSkRkd21teFRSZWJ2ZA==';

// Decrypt API key (old encryption without IV/tag)
const apiKey = Buffer.from(encryptedKey, 'base64').toString('utf8');

// Application ID for the new deployment
const applicationId = 'K_SZV_2FpaeyNYkZnxPDz';

const url = `${config.baseUrl}/deployment.logs?applicationId=${applicationId}`;

console.log('Fetching deployment logs for application:', applicationId);
console.log('URL:', url);
console.log('');

const headers = {
  'accept': 'application/json',
  'x-api-key': apiKey
};

fetch(url, { headers })
  .then(async response => {
    console.log('Response status:', response.status);
    const text = await response.text();

    if (response.ok) {
      console.log('\n=== DEPLOYMENT LOGS ===\n');
      console.log(text);
    } else {
      console.log('\nError response:');
      console.log(text);
    }
  })
  .catch(error => {
    console.error('Error fetching logs:', error);
  });
