/**
 * One-off script: finds and removes duplicate Linear issues from triage.
 *
 * A triage issue is considered a duplicate if:
 * 1. It has the same GitHub issue number as a synced issue (with gh-rtc-sync label)
 * 2. It is in "Canceled" state AND has the same GitHub issue number as ANY other issue
 *
 * Usage: npx tsx src/cleanup-duplicates.ts
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

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  githubIssueNumber: number | undefined;
  isSynced: boolean;
  state: {
    id: string;
    name: string;
    type: string;
  };
}

/**
 * Parses GitHub issue number from Linear issue description
 */
function parseGitHubIssueNumber(description: string | null): number | undefined {
  if (!description) return undefined;
  const match = description.match(/\*\*GitHub (?:Issue|URL):\*\*\s*(?:#(\d+)|https?:\/\/[^\s]+\/issues\/(\d+))/);
  const issueNum = match?.[1] || match?.[2];
  return issueNum ? parseInt(issueNum, 10) : undefined;
}

async function main() {
  const config = loadConfig();
  const client = new LinearClient({ apiKey: config.linear.apiKey });
  const { teamId, syncLabel } = config.linear;

  console.log('GitHub to Linear Duplicate Cleanup');
  console.log('='.repeat(80));
  console.log(`Team ID: ${teamId}`);
  console.log(`Sync Label: ${syncLabel}`);
  console.log('='.repeat(80));

  // Step 1: Fetch the sync label ID
  console.log('\nFetching sync label...');
  const labelResult = await retry(() =>
    client.issueLabels({
      filter: {
        team: { id: { eq: teamId } },
        name: { eq: syncLabel },
      },
    })
  );
  const syncLabelObj = labelResult.nodes[0];

  if (!syncLabelObj) {
    console.log(`No issues found with sync label "${syncLabel}". Nothing to clean up.`);
    return;
  }

  console.log(`Found sync label: ${syncLabelObj.name} (${syncLabelObj.id})`);

  // Step 2: Fetch all issues in the team (both synced and non-synced)
  console.log('\nFetching all issues in team...');
  const allIssues: LinearIssue[] = [];
  let hasNextPage = true;
  let cursor: string | undefined;
  let pageCount = 0;

  while (hasNextPage) {
    pageCount++;
    console.log(`  Fetching page ${pageCount}...`);

    const page = await retry(() =>
      client.issues({
        filter: {
          team: { id: { eq: teamId } },
        },
        first: 100,
        ...(cursor ? { after: cursor } : {}),
      })
    );

    console.log(`  Processing ${page.nodes.length} issue(s) from page ${pageCount}...`);

    let processedInPage = 0;
    for (const issue of page.nodes) {
      processedInPage++;
      if (processedInPage % 20 === 0 || processedInPage === page.nodes.length) {
        console.log(`    Processed ${processedInPage}/${page.nodes.length} issues in this page...`);
      }

      const state = await issue.state;
      const labels = await issue.labels();
      const isSynced = labels.nodes.some(label => label.id === syncLabelObj.id);

      allIssues.push({
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description ?? null,
        githubIssueNumber: parseGitHubIssueNumber(issue.description ?? null),
        isSynced,
        state: state ? {
          id: state.id,
          name: state.name,
          type: state.type,
        } : {
          id: '',
          name: 'unknown',
          type: 'unstarted',
        },
      });
    }

    hasNextPage = page.pageInfo.hasNextPage;
    cursor = page.pageInfo.endCursor;
    console.log(`  Total fetched so far: ${allIssues.length} issue(s)`);
  }

  console.log(`\nFound ${allIssues.length} total issue(s) in team`);

  // Separate synced and non-synced issues
  const syncedIssues = allIssues.filter(issue => issue.isSynced);
  const triageIssues = allIssues.filter(issue => !issue.isSynced);

  console.log(`  - ${syncedIssues.length} synced issue(s) (with "${syncLabel}" label)`);
  console.log(`  - ${triageIssues.length} triage issue(s) (without sync label)`);

  // Step 3: Build a map of GitHub issue numbers to synced issues
  const githubNumberToSyncedIssue = new Map<number, LinearIssue>();
  for (const issue of syncedIssues) {
    if (issue.githubIssueNumber !== undefined) {
      githubNumberToSyncedIssue.set(issue.githubIssueNumber, issue);
    }
  }

  // Build a map of all GitHub issue numbers (for canceled duplicate check)
  const githubNumberToAllIssues = new Map<number, LinearIssue[]>();
  for (const issue of allIssues) {
    if (issue.githubIssueNumber !== undefined) {
      const existing = githubNumberToAllIssues.get(issue.githubIssueNumber) || [];
      existing.push(issue);
      githubNumberToAllIssues.set(issue.githubIssueNumber, existing);
    }
  }

  // Step 4: Find duplicates to delete
  const toDelete: Array<{
    issue: LinearIssue;
    reason: string;
    duplicateOf: string;
  }> = [];

  for (const triageIssue of triageIssues) {
    // Check if it has a GitHub issue number
    if (triageIssue.githubIssueNumber === undefined) {
      continue;
    }

    // Case 1: Triage issue duplicates a synced issue
    const syncedDuplicate = githubNumberToSyncedIssue.get(triageIssue.githubIssueNumber);
    if (syncedDuplicate) {
      toDelete.push({
        issue: triageIssue,
        reason: 'Duplicates synced issue',
        duplicateOf: syncedDuplicate.identifier,
      });
      continue;
    }

    // Case 2: Triage issue is canceled AND has duplicates (any state)
    if (triageIssue.state.type === 'canceled') {
      const allWithSameGH = githubNumberToAllIssues.get(triageIssue.githubIssueNumber) || [];
      const otherIssues = allWithSameGH.filter(i => i.id !== triageIssue.id);

      if (otherIssues.length > 0) {
        toDelete.push({
          issue: triageIssue,
          reason: 'Canceled issue with duplicates',
          duplicateOf: otherIssues.map(i => i.identifier).join(', '),
        });
      }
    }
  }

  // Step 5: Display results and confirm
  if (toDelete.length === 0) {
    console.log('\n✓ No duplicates found. Nothing to delete.');
    return;
  }

  console.log(`\n⚠️  Found ${toDelete.length} duplicate issue(s) to delete:\n`);
  for (const { issue, reason, duplicateOf } of toDelete) {
    console.log(`  ${issue.identifier} - ${issue.title}`);
    console.log(`    GitHub Issue: #${issue.githubIssueNumber}`);
    console.log(`    State: ${issue.state.name}`);
    console.log(`    Reason: ${reason} (${duplicateOf})`);
    console.log();
  }

  const answer = await prompt(`Delete all ${toDelete.length} duplicate issue(s)? (y/n) `);
  if (answer.toLowerCase() !== 'y') {
    console.log('Aborted.');
    return;
  }

  // Step 6: Delete the duplicates
  console.log('\nDeleting duplicates...');
  let deletedCount = 0;

  for (const { issue } of toDelete) {
    try {
      await retry(() => client.deleteIssue(issue.id));
      console.log(`  ✓ Deleted ${issue.identifier}`);
      deletedCount++;
    } catch (error) {
      console.error(`  ✗ Failed to delete ${issue.identifier}:`, error);
    }
  }

  console.log(`\n✓ Done. ${deletedCount}/${toDelete.length} duplicate issue(s) removed.`);
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
