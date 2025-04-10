// ARCHIVED: Slackbot Paginated Version (April 10, 2025)
// This version includes pagination buttons and blocks for interactive navigation
// Use this as a fallback template for paginated Slackbot logic

const PAGE_SIZE = 5;

function paginateResults(matches, offset = 0, term = '') {
  const page = matches.slice(offset, offset + PAGE_SIZE);
  const hasNext = offset + PAGE_SIZE < matches.length;
  const hasPrev = offset > 0;

  const blocks = page.map(conn => ([
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

  const navButtons = [];
  if (hasPrev) {
    navButtons.push({
      type: "button",
      text: { type: "plain_text", text: "Previous" },
      action_id: "prev_page",
      value: JSON.stringify({ offset: offset - PAGE_SIZE, term })
    });
  }
  if (hasNext) {
    navButtons.push({
      type: "button",
      text: { type: "plain_text", text: "Next" },
      action_id: "next_page",
      value: JSON.stringify({ offset: offset + PAGE_SIZE, term })
    });
  }

  if (navButtons.length > 0) {
    blocks.push({ type: "actions", elements: navButtons });
  }

  return blocks;
}
