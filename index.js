require('dotenv').config();

const http = require('http');
const fs = require('fs');
const csv = require('csv-parser');
const querystring = require('querystring');
const { WebClient } = require('@slack/web-api');
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

let networkData = [];

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
        const payload = parsedBody.payload ? JSON.parse(parsedBody.payload) : null;

        if (parsedBody.command === '/network') {
          const term = parsedBody.text;
          const responseUrl = parsedBody.response_url;
        
          // 1. Immediate response to Slack (within 3 seconds)
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            response_type: 'ephemeral',
            text: `🔍 Searching for matches for: "${term}"...`
          }));
        
          // 2. Continue async processing after response
          const matches = findConnections(term);
        
          const payload = matches.length === 0
            ? {
                response_type: 'ephemeral',
                text: `❌ No matches found for "${term}". Try another search.`
              }
            : {
                response_type: 'ephemeral',
                text: `✅ Found ${matches.length} match(es) for "${term}":`,
                blocks: matches.map(conn => ([
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
                ])).flat()
              };
        
          // 3. Send full result asynchronously to response_url
          const fetch = require('node-fetch');
          try {
            await fetch(responseUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
          } catch (err) {
            console.error('❌ Error sending response_url:', err);
          }
        
          return;
        }
        

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
                  element: { type: "plain_text_input", action_id: "name_input" }
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

        if (payload?.type === 'view_submission' && payload.view?.callback_id === 'email_modal') {
          const meta = JSON.parse(payload.view.private_metadata);
          const student = payload.view.state.values.student_name.name_input.value;
          const message = generateEmail(meta.staff, meta.connection, meta.company, student);

          try {
            await slackClient.chat.postMessage({
              channel: payload.user.id,
              text: "Here's your generated email template:",
              blocks: [
                { type: "section", text: { type: "mrkdwn", text: "*Here's your generated email template:*" } },
                { type: "section", text: { type: "mrkdwn", text: "```" + message + "```" } },
                { type: "context", elements: [ { type: "mrkdwn", text: `*Reminder:* This message is for your review. It has not been sent.` } ] }
              ]
            });
          } catch (dmErr) {
            console.error('❌ Failed to post DM:', dmErr);
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ response_action: 'clear' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ text: "Unknown or unsupported request." }));
      } catch (err) {
        console.error('❌ Error:', err);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ text: "Something went wrong processing your request." }));
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