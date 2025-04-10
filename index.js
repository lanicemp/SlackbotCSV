require('dotenv').config();

const http = require('http');
const fs = require('fs');
const csv = require('csv-parser');
const querystring = require('querystring');
const { WebClient } = require('@slack/web-api');
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

let networkData = [];

function loadNetworkData() {
  return new Promise((resolve, reject) => {
    networkData = [];
    fs.createReadStream('network_connections.csv')
      .pipe(csv())
      .on('data', (row) => networkData.push(row))
      .on('end', () => {
        console.log('✅ Network data loaded.');
        resolve(networkData);
      })
      .on('error', (error) => {
        console.error('❌ Error loading CSV:', error);
        reject(error);
      });
  });
}

function normalizeText(text = '') {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function findConnections(searchTerm) {
  const normalizedSearch = normalizeText(searchTerm);

  if (searchTerm.includes(":")) {
    const extract = (label) => {
      const match = searchTerm.match(new RegExp(`${label}:\\s*([^,]+)`, 'i'));
      return match ? normalizeText(match[1]) : null;
    };

    const criteria = {
      company: extract("company"),
      title: extract("title"),
      staff: extract("staff"),
      industry: extract("industry"),
    };

    return networkData.filter((entry) => {
      const company = normalizeText(entry['Current Organization']);
      const title = normalizeText(entry['💼 Current role']);
      const staff = normalizeText(entry['Best Pursuit Contact']);
      const combined = `${company} ${title}`;

      return (!criteria.company || company.includes(criteria.company)) &&
             (!criteria.title || title.includes(criteria.title)) &&
             (!criteria.staff || staff.includes(criteria.staff)) &&
             (!criteria.industry || combined.includes(criteria.industry));
    });
  }

  return networkData.filter(entry => {
    const org = normalizeText(entry['Current Organization']);
    const role = normalizeText(entry['💼 Current role']);
    return org.includes(normalizedSearch) || role.includes(normalizedSearch);
  });
}

function generateEmail(staff, connection, company, student) {
  return `Subject: Request for Introduction to ${connection} at ${company}

Hi ${staff},

I hope this email finds you well. My name is ${student}, and I'm a current student at Pursuit.

I noticed that you're connected with ${connection} at ${company} on LinkedIn. I'm very interested in exploring opportunities there, and I was wondering if you might be willing to introduce me to them.

I've been focusing on [briefly mention your relevant skills/projects], and I believe that ${company}'s work in [mention something specific about the company] aligns well with my career goals.

If you're open to making this introduction, I'd be happy to provide you with more information about my background and interests that you could include in your email.

Thank you for considering my request, and I look forward to hearing from you.

Best regards,
${student}`;
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/' || req.url === '') {
    const preview = networkData.length > 0
      ? {
          totalRecords: networkData.length,
          firstFewRecords: networkData.slice(0, 3),
          columns: Object.keys(networkData[0] || {})
        }
      : 'No data loaded';

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`Network Activation Slackbot is running!\n\nDebug:\n${JSON.stringify(preview, null, 2)}`);
    return;
  }

  if (req.url.startsWith('/slack/oauth_redirect') && req.method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const code = url.searchParams.get('code');
    if (!code) {
      res.writeHead(400);
      res.end('Missing code');
      return;
    }

    const fetch = require('node-fetch');
    try {
      const response = await fetch('https://slack.com/api/oauth.v2.access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: process.env.SLACK_CLIENT_ID,
          client_secret: process.env.SLACK_CLIENT_SECRET,
          redirect_uri: process.env.SLACK_REDIRECT_URI
        })
      });

      const result = await response.json();
      res.writeHead(result.ok ? 200 : 500, { 'Content-Type': 'text/html' });
      res.end(`<h1>${result.ok ? 'Slack App installed!' : `OAuth Error: ${result.error}`}</h1>`);
    } catch (err) {
      console.error('OAuth error:', err);
      res.writeHead(500);
      res.end('Internal Server Error');
    }
    return;
  }

  if (req.url === '/slack/events' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk.toString()));
    req.on('end', async () => {
      try {
        const parsedBody = querystring.parse(body);
        const payload = parsedBody.payload ? JSON.parse(parsedBody.payload) : null;

        // Slash command
        if (parsedBody.command === '/network') {
          const searchTerm = parsedBody.text;
          const userId = parsedBody.user_id;
          const channelId = parsedBody.channel_id;

          if (!searchTerm) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              text: 'Please provide a search term like `/network Google` or `/network staff: Jane Smith`.'
            }));
            return;
          }

          const connections = findConnections(searchTerm);
          if (connections.length === 0) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              text: `No matches found for "${searchTerm}".`,
              response_type: 'ephemeral'
            }));
            return;
          }

          const blocks = connections.map(conn => ([
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*<${conn.LinkedIn}|${conn.Name}>* (${conn['💼 Current role']}) at *${conn['Current Organization']}*\nContact: ${conn['Best Pursuit Contact']}`
              }
            },
            {
              type: "actions",
              elements: [{
                type: "button",
                text: { type: "plain_text", text: "Request Intro Email" },
                action_id: "generate_email",
                value: JSON.stringify({
                  staff: conn['Best Pursuit Contact'],
                  connection: conn.Name,
                  company: conn['Current Organization']
                })
              }]
            }
          ])).flat();

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            text: `*Connections found matching "${searchTerm}":*`,
            blocks,
            response_type: "ephemeral"
          }));
          return;
        }

        // Block button click
        if (payload?.type === 'block_actions' && payload.actions?.[0]?.action_id === 'generate_email') {
          const value = JSON.parse(payload.actions[0].value);

          await slackClient.views.open({
            trigger_id: payload.trigger_id,
            view: {
              type: "modal",
              callback_id: "email_modal",
              title: { type: "plain_text", text: "Generate Email" },
              blocks: [
                {
                  type: "section",
                  text: { type: "mrkdwn", text: `You're requesting an intro to *${value.connection}* at *${value.company}* via *${value.staff}*.` }
                },
                {
                  type: "input",
                  block_id: "student_name",
                  label: { type: "plain_text", text: "Your Name" },
                  element: {
                    type: "plain_text_input",
                    action_id: "name_input"
                  }
                }
              ],
              private_metadata: JSON.stringify(value),
              submit: { type: "plain_text", text: "Generate Email" }
            }
          });

          res.writeHead(200);
          res.end();
          return;
        }

        // Modal submission
        if (payload?.type === 'view_submission' && payload.view?.callback_id === 'email_modal') {
          const metadata = JSON.parse(payload.view.private_metadata);
          const studentName = payload.view.state.values.student_name.name_input.value;
          const emailText = generateEmail(metadata.staff, metadata.connection, metadata.company, studentName);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ response_action: 'clear' }));

          // Respond via chat to the user
          await slackClient.chat.postMessage({
            channel: payload.user.id,
            text: "Here's your generated email template:",
            blocks: [
              {
                type: "section",
                text: { type: "mrkdwn", text: "*Here's your generated email template:*" }
              },
              {
                type: "section",
                text: { type: "mrkdwn", text: "```" + emailText + "```" }
              },
              {
                type: "context",
                elements: [
                  {
                    type: "mrkdwn",
                    text: `*Reminder:* This message has not been sent. You can copy and paste it.`
                  }
                ]
              }
            ]
          });

          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ text: "Unrecognized interaction." }));
      } catch (err) {
        console.error("❌ Event error:", err);
        res.writeHead(500);
        res.end("Internal Server Error");
      }
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

(async () => {
  try {
    await loadNetworkData();
    const port = process.env.PORT || 3001;
    server.listen(port, () => {
      console.log(`🚀 Server running at http://localhost:${port}`);
    });
  } catch (error) {
    console.error("❌ Failed to start:", error);
  }
})();
