require('dotenv').config();

const http = require('http');
const fs = require('fs');
const csv = require('csv-parser');
const querystring = require('querystring');

// Store for our network data
let networkData = [];

// Load network data from CSV
function loadNetworkData() {
  networkData = [];
  return new Promise((resolve, reject) => {
    fs.createReadStream('network_connections.csv')
    .pipe(csv())
      .on('data', (row) => {
        networkData.push(row);
      })
      .on('end', () => {
        console.log('Network data loaded successfully');
        console.log('First few rows:', networkData.slice(0, 3));
        console.log('Column names:', Object.keys(networkData[0] || {}));
        console.log('Total records loaded:', networkData.length);
        resolve(networkData);
      })
      .on('error', (error) => {
        console.error('Error loading network data:', error);
        reject(error);
      });
  });
}

// Find connections based on multiple criteria
function findConnections(searchTerm) {
  // Parse search criteria from the search term
  let searchCriteria = {};
  
  // Check for formatted search with multiple criteria
  if (searchTerm.includes(":")) {
    // Look for company: pattern
    const companyMatch = searchTerm.match(/company:\s*([^,]+)/i);
    if (companyMatch) {
      searchCriteria.company = companyMatch[1].trim().toLowerCase();
    }
    
    // Look for title: pattern
    const titleMatch = searchTerm.match(/title:\s*([^,]+)/i);
    if (titleMatch) {
      searchCriteria.title = titleMatch[1].trim().toLowerCase();
    }
    
    // Look for staff: pattern
    const staffMatch = searchTerm.match(/staff:\s*([^,]+)/i);
    if (staffMatch) {
      searchCriteria.staff = staffMatch[1].trim().toLowerCase();
    }
    
    // Look for industry: pattern
    const industryMatch = searchTerm.match(/industry:\s*([^,]+)/i);
    if (industryMatch) {
      searchCriteria.industry = industryMatch[1].trim().toLowerCase();
    }
    
    // Filter based on all provided criteria
    return networkData.filter(entry => {
      let matches = true;
      
      if (searchCriteria.company) {
        matches = matches && entry['Current Organization'] && 
                  entry['Current Organization'].toLowerCase().includes(searchCriteria.company);
      }
      
      if (searchCriteria.title) {
        matches = matches && entry['💼 Current role'] && 
                  entry['💼 Current role'].toLowerCase().includes(searchCriteria.title);
      }
      
      if (searchCriteria.staff) {
        matches = matches && entry['Best Pursuit Contact'] && 
                  entry['Best Pursuit Contact'].toLowerCase().includes(searchCriteria.staff);
      }
      
      if (searchCriteria.industry) {
        // Since we don't have a dedicated industry field, infer from company and role
        const companyAndRole = (entry['Current Organization'] || '') + ' ' + (entry['💼 Current role'] || '');
        matches = matches && companyAndRole.toLowerCase().includes(searchCriteria.industry);
      }
      
      return matches;
    });
  }
  
  // Check if it's a staff-only search
  if (searchTerm.toLowerCase().startsWith("staff:")) {
    const staffName = searchTerm.substring(6).trim().toLowerCase();
    return networkData.filter(entry => 
      entry['Best Pursuit Contact'] && entry['Best Pursuit Contact'].toLowerCase().includes(staffName)
    );
  }
  
  // Check if it's an industry-only search
  if (searchTerm.toLowerCase().startsWith("industry:")) {
    const industry = searchTerm.substring(9).trim().toLowerCase();
    return networkData.filter(entry => {
      // Since we don't have a dedicated industry field, infer from company and role
      const companyAndRole = (entry['Current Organization'] || '') + ' ' + (entry['💼 Current role'] || '');
      return companyAndRole.toLowerCase().includes(industry);
    });
  }
  
  // Regular single term search (as before)
  const searchTermLower = searchTerm.toLowerCase();
  return networkData.filter(entry => 
    (entry['Current Organization'] && entry['Current Organization'].toLowerCase().includes(searchTermLower)) ||
    (entry['💼 Current role'] && entry['💼 Current role'].toLowerCase().includes(searchTermLower))
  );
}

// Generate an email template for introduction request
function generateEmail(staffMember, connection, company, studentName) {
  return `Subject: Request for Introduction to ${connection} at ${company}

Hi ${staffMember},

I hope this email finds you well. My name is ${studentName}, and I'm a current student at Pursuit.

I noticed that you're connected with ${connection} at ${company} on LinkedIn. I'm very interested in exploring opportunities there, and I was wondering if you might be willing to introduce me to them.

I've been focusing on [briefly mention your relevant skills/projects], and I believe that ${company}'s work in [mention something specific about the company] aligns well with my career goals.

If you're open to making this introduction, I'd be happy to provide you with more information about my background and interests that you could include in your email.

Thank you for considering my request, and I look forward to hearing from you.

Best regards,
${studentName}`;
}

// Create an HTTP server
const server = http.createServer(async (req, res) => {
  console.log(`Received ${req.method} request to ${req.url}`);

  // Handle requests to the root URL
  if (req.url === '/' || req.url === '') {
    // Send debug info about the loaded data
    const dataPreview = networkData.length > 0 
      ? {
          totalRecords: networkData.length,
          firstFewRecords: networkData.slice(0, 3),
          columns: Object.keys(networkData[0] || {})
        }
      : 'No data loaded';
      
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end(`Network Activation Slackbot is running!\n\nDebug data:\n${JSON.stringify(dataPreview, null, 2)}`);
    return;
  }
  if (req.url.startsWith('/slack/oauth_redirect') && req.method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const code = url.searchParams.get('code');
  
    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
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
      console.log('OAuth response:', result);
  
      if (result.ok) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Slack App installed successfully!</h1>');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`<h1>OAuth Error: ${result.error}</h1>`);
      }
    } catch (err) {
      console.error('OAuth Error:', err);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal server error');
    }
  
    return;
  }
  
  // Handle Slack slash command
  if (req.url === '/slack/events' && req.method === 'POST') {
    console.log('✅ Slack POST request received at /slack/events');
    let body = '';
    
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', async () => {
      console.log('Received Slack event');
      
      try {
        const parsedBody = querystring.parse(body);
        console.log('Parsed request:', parsedBody);
        
        // Check if this is a slash command
        if (parsedBody.command === '/network') {
          const searchTerm = parsedBody.text;
          
          if (!searchTerm) {
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({
              text: 'Please provide a search term. You can search by:\n• Company name: `/network Google`\n• Job title: `/network Software Engineer`\n• Staff member: `/network staff: Jane Smith`\n• Industry: `/network industry: Finance`\n• Multiple filters: `/network company: Google, title: Engineer, staff: Jane, industry: Tech`'
            }));
            return;
          }
          
          const connections = findConnections(searchTerm);
          
          // For testing, simplify the response
          if (connections.length === 0) {
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({
              text: `No connections found matching "${searchTerm}". Please try another search term.`,
              response_type: "in_channel"
            }));
            return;
          }
          
          // Simple text response for now
          const connectionsList = connections.map(conn => 
           `• ${conn.Name} (${conn['💼 Current role']}) at ${conn['Current Organization']} - Contact: ${conn['Best Pursuit Contact']} - <${conn.LinkedIn}|LinkedIn>`
          ).join('\n');
                   
          
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({
            text: `*Connections found matching "${searchTerm}":*\n\n${connectionsList}`,
            response_type: "in_channel",
            mrkdwn: true
          }));
        }
        // Check if this is an interactive action (button click)
        else if (parsedBody.payload) {
          const payload = JSON.parse(parsedBody.payload);
          
          if (payload.type === 'block_actions' && 
              payload.actions && 
              payload.actions[0].action_id === 'generate_email') {
            
            const value = JSON.parse(payload.actions[0].value);
            
            // Send a modal to get the student's name
            const modal = {
              trigger_id: payload.trigger_id,
              view: {
                type: "modal",
                callback_id: "email_modal",
                title: {
                  type: "plain_text",
                  text: "Generate Introduction Email"
                },
                blocks: [
                  {
                    type: "section",
                    text: {
                      type: "mrkdwn",
                      text: `You're requesting an introduction to *${value.connection}* at *${value.company}* via *${value.staff}*.`
                    }
                  },
                  {
                    type: "input",
                    block_id: "student_name",
                    label: {
                      type: "plain_text",
                      text: "Your Name"
                    },
                    element: {
                      type: "plain_text_input",
                      action_id: "name_input"
                    }
                  }
                ],
                private_metadata: JSON.stringify(value),
                submit: {
                  type: "plain_text",
                  text: "Generate Email"
                }
              }
            };

            // Respond with acknowledgment
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify(modal));
          }
          // Handle modal submission
          else if (payload.type === 'view_submission' && 
                   payload.view.callback_id === 'email_modal') {
            
            const metadata = JSON.parse(payload.view.private_metadata);
            const studentName = payload.view.state.values.student_name.name_input.value;
            
            const emailText = generateEmail(
              metadata.staff,
              metadata.connection,
              metadata.company,
              studentName
            );
            
            // Send message with the email template
            const message = {
              channel: payload.user.id,
              text: "Here's your generated email template:",
              blocks: [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: "Here's your generated email template:"
                  }
                },
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: "```\n" + emailText + "\n```"
                  }
                },
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: `Please email this to: ${metadata.staff}`
                  }
                }
              ]
            };
            
            // Respond with acknowledgment
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify(message));
          }
          else {
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({
              text: "Unrecognized action"
            }));
          }
        }
        else {
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({
            text: "I received your request, but I'm not sure what to do with it."
          }));
        }
      } catch (error) {
        console.error('Error processing request:', error);
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({
          text: "Sorry, there was an error processing your request."
        }));
      }
    });
  } else {
    res.writeHead(404, {'Content-Type': 'text/plain'});
    res.end('Not found');
  }
});

// Start the server after loading network data
(async () => {
  try {
    await loadNetworkData();
    console.log("ENV Loaded:");
    console.log("SLACK_BOT_TOKEN:", !!process.env.SLACK_BOT_TOKEN); // should be true
    console.log("SLACK_SIGNING_SECRET:", !!process.env.SLACK_SIGNING_SECRET);

    server.listen(process.env.PORT || 3001, () => {
      console.log(`Network Activation Slackbot is running on http://localhost:${process.env.PORT || 3001}`);
      console.log('For Slack, use: https://your-ngrok-url/slack/events');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
  }
})();