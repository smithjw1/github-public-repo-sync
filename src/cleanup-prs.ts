/**
 * One-off script: finds synced Linear issues that originated from GitHub PRs
 * (not real issues) and deletes them.
 *
 * How it identifies PRs: the sync embeds a **GitHub URL:** in each issue
 * description. GitHub issues use /issues/N, PRs use /pull/N.
 *
 * Usage: npx tsx src/cleanup-prs.ts
 */
import { createInterface } from 'readline';
import { loadConfig } from './config.js';
import { LinearClient } from '@linear/sdk';
import { retry } from './retry.js';

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const config = loadConfig();
  const client = new LinearClient({ apiKey: config.linear.apiKey });
  const { teamId } = config.linear;

  // Paginate through all issues in the team — no label filter, so we catch
  // PRs regardless of whether the sync label was applied.
  const allIssues: Array<{ id: string; identifier: string; title: string; description: string | null }> = [];
  let hasNextPage = true;
  let cursor: string | undefined;

  while (hasNextPage) {
    const page = await retry(() =>
      client.issues({
        filter: {
          team: { id: { eq: teamId } },
        },
        first: 100,
        after: cursor,
      })
    );

    allIssues.push(...page.nodes.map(issue => ({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description ?? null,
    })));

    hasNextPage = page.pageInfo.hasNextPage;
    cursor = page.pageInfo.endCursor;
  }

  console.log(`Found ${allIssues.length} issue(s) in team. Scanning for PRs...\n`);

  const prs: Array<{ id: string; identifier: string; title: string; ghUrl: string }> = [];

  for (const issue of allIssues) {
    const description = issue.description || '';
    // URL may be plain or wrapped in a Markdown link: [url](<url>)
    const urlMatch = description.match(/\*\*GitHub URL:\*\*\s*\[?(https?:\/\/[^\s\]<>\n]+)/);
    if (urlMatch && urlMatch[1] && urlMatch[1].includes('/pull/')) {
      prs.push({
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        ghUrl: urlMatch[1],
      });
    }
  }

  if (prs.length === 0) {
    console.log('No PRs found. Nothing to delete.');
    return;
  }

  console.log(`Found ${prs.length} PR(s):\n`);
  for (const pr of prs) {
    console.log(`  ${pr.identifier}  ${pr.title}`);
    console.log(`            ${pr.ghUrl}`);
  }

  const answer = await prompt(`\nDelete all ${prs.length} PR issue(s)? (y/n) `);
  if (answer.toLowerCase() !== 'y') {
    console.log('Aborted.');
    return;
  }

  console.log(`\nDeleting...`);
  for (const pr of prs) {
    await retry(() => client.deleteIssue(pr.id));
    console.log(`  Deleted ${pr.identifier}`);
  }

  console.log(`\nDone. ${prs.length} PR issue(s) removed.`);
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
