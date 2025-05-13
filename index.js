require('dotenv').config();

const http = require('http');
const fs = require('fs');
const csv = require('csv-parser');
const querystring = require('querystring');
const { WebClient } = require('@slack/web-api');
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

let networkData = [];

const doNotContactCompanies = [
  "Ballistic Ventures", "Blackstone Cedar", "Citizens", "Citi", "David Energy",
  "Dwolla", "Foursquare", "iCapital", "Macquarie", "Moody's", "Peloton",
  "Poll Everywhere", "Quizlet", "Red Canary", "Ribbon", "SeatGeek", "Sift",
  "Skillshare", "Spring Health", "The Knot Worldwide (TKWW)", "Thirty Madison",
  "Thumbtack", "Uber", "Macquarie Asset Management"
].map(name => name.toLowerCase());



function normalizeText(text = '') {
  return text.toLowerCase().replace(/[^\w\s]/gi, '').replace(/\s+/g, ' ').trim();
}

function loadNetworkData() {
  return new Promise((resolve, reject) => {
    networkData = [];
    fs.createReadStream('network_connections.csv')
      .pipe(csv())
      .on('data', row => networkData.push(row))
      .on('end', () => {
        console.log('✅ Network data loaded.');
        resolve(networkData);
      })
      .on('error', reject);
  });
}

function findConnections(searchTerm) {
  const normalizedTerm = normalizeText(searchTerm);

  if (searchTerm.includes(':')) {
    const match = (label) => {
      const value = (searchTerm.match(new RegExp(`${label}:\\s*([^,]+)`, 'i')) || [])[1];
      return normalizeText(value);
    };

    const criteria = {
      company: match('company'),
      title: match('title'),
      staff: match('staff'),
      industry: match('industry')
    };

    return networkData.filter(entry => {
      const org = normalizeText(entry['Current Organization'] || '');
      const role = normalizeText(entry['💼 Current role'] || '');
      const staff = normalizeText(entry['Best Pursuit Contact'] || '');
      const combo = `${org} ${role}`;

      return (!criteria.company || org.includes(criteria.company)) &&
             (!criteria.title || role.includes(criteria.title)) &&
             (!criteria.staff || staff.includes(criteria.staff)) &&
             (!criteria.industry || combo.includes(criteria.industry));
    });
  }

  return networkData.filter(entry => {
    return normalizeText(entry['Current Organization'] || '').includes(normalizedTerm) ||
           normalizeText(entry['💼 Current role'] || '').includes(normalizedTerm);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/' || req.url === '') {
    const preview = networkData.length > 0 ? {
      totalRecords: networkData.length,
      firstFewRecords: networkData.slice(0, 3),
      columns: Object.keys(networkData[0] || {})
    } : 'No data loaded';

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`Network Activation Slackbot is running!\n\nDebug:\n${JSON.stringify(preview, null, 2)}`);
    return;
  }

  if (req.url === '/slack/events' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', async () => {
      try {
        const parsedBody = querystring.parse(body);

        if (parsedBody.command === '/network') {
          const term = parsedBody.text;
          const responseUrl = parsedBody.response_url;

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            response_type: 'ephemeral',
            text: `🔍 Searching for: "${term}"...`
          }));

          const matches = findConnections(term);

          const formattedText = matches.length === 0
  ? `❌ No matches found for "${term}".`
  : `*Connections found matching "${term}":*\n\n` +
    matches.map(conn => {
      const company = conn['Current Organization'] || '';
      const isPartner = doNotContactCompanies.includes(company.toLowerCase());
      const partnerNote = isPartner ? ' *_(Pursuit Partner – Reach out to Tim Asprec)_*' : '';
      return `• <${conn.LinkedIn}|${conn.Name}> (${conn['💼 Current role']}) at ${company}${partnerNote} - Contact: ${conn['Best Pursuit Contact']}`;
    }).join('\n');

          const fetch = require('node-fetch');
          await fetch(responseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              response_type: 'ephemeral',
              text: formattedText
            })
          });
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ text: 'Unknown request.' }));
      } catch (err) {
        console.error('❌ Error:', err);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ text: 'Something went wrong.' }));
      }
    });
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

(async () => {
  try {
    await loadNetworkData();
    const port = process.env.PORT || 3001;
    server.listen(port, () => {
      console.log(`🚀 Server running at http://localhost:${port}`);
    });
  } catch (e) {
    console.error('❌ Failed to start:', e);
  }
})();
