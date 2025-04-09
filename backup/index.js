require('dotenv').config();
const { App } = require('@slack/bolt');
const fs = require('fs');
const csv = require('csv-parser');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
});

function searchCSV(nameToFind) {
  return new Promise((resolve, reject) => {
    const results = [];

    fs.createReadStream('network_activation.csv')
      .pipe(csv())
      .on('data', (row) => {
        if (row['Name'].toLowerCase() === nameToFind.toLowerCase()) {
          results.push(row);
        }
      })
      .on('end', () => {
        resolve(results);
      })
      .on('error', reject);
  });
}

app.command('/find_contact', async ({ command, ack, say }) => {
  await ack();
  const nameToSearch = command.text.trim();

  const matches = await searchCSV(nameToSearch);

  if (matches.length > 0) {
    const row = matches[0];
    await say(`👤 *${row['Name']}*
🔗 ${row['Connection']}
💼 ${row['💼 Current role']} @ ${row['Current Organization']}
🔍 <${row['LinkedIn']}|LinkedIn>
📨 Best Pursuit Contact: ${row['Best Pursuit Contact']}`);
  } else {
    await say(`❌ No contact found for "${nameToSearch}"`);
  }
});

(async () => {
  await app.start(3000);
  console.log('⚡️ Slack bot is running on http://localhost:3000');
})();
