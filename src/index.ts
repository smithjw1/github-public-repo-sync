import { execSync } from 'child_process';
import { loadConfig } from './config.js';
import { GitHubService } from './github.js';
import { LinearService } from './linear.js';
import { Logger } from './logger.js';
import { Mutex } from 'async-mutex';
import type { SyncData } from './types.js';
import { createLinearIssueFromGitHub, syncCommentsToLinear, updateLinearIssueStatus } from './sync-operations.js';
import type { LinearIssueData } from './linear.js';

interface SyncResult {
  newIssuesFound: boolean;
}

async function sync(): Promise<SyncResult> {
  try {
    const config = loadConfig();
    const githubService = new GitHubService(config);
    const linearService = new LinearService(config);

    console.log('Starting sync with dictionary-based approach...');
    console.log('='.repeat(80));

    // Step 1: Fetch all Linear issues with sync label (build dictionary)
    console.log('\nStep 1: Fetching Linear issues with sync label...');
    const linearIssues = await linearService.fetchSyncedIssues();

    // Build dictionary: GitHub issue number -> Linear issue data
    const dictionary = new Map<number, LinearIssueData>();
    for (const issue of linearIssues) {
      if (issue.githubIssueNumber !== undefined) {
        dictionary.set(issue.githubIssueNumber, issue);
      }
    }

    console.log(`Found ${linearIssues.length} Linear issue(s) with sync label`);
    console.log(`Dictionary contains ${dictionary.size} issue(s) with GitHub numbers`);

    // Step 2: Fetch all OPEN GitHub issues with configured labels
    console.log('\nStep 2: Fetching open GitHub issues...');
    const openGitHubIssues = await githubService.fetchIssuesWithLabels();

    console.log(`Found ${openGitHubIssues.length} open GitHub issue(s) matching labels`);

    // Step 3: Create Linear issues for GitHub issues not in dictionary
    const newGitHubIssues = openGitHubIssues.filter(
      issue => !dictionary.has(issue.number)
    );

    console.log(`\nStep 3: Creating ${newGitHubIssues.length} new Linear issue(s)...`);
    let createdCount = 0;

    if (newGitHubIssues.length > 0) {
      const BATCH_SIZE = 5;
      for (let i = 0; i < newGitHubIssues.length; i += BATCH_SIZE) {
        const batch = newGitHubIssues.slice(i, i + BATCH_SIZE);
        console.log(`\nProcessing batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} issue(s))...`);

        const results = await Promise.allSettled(
          batch.map(issue => createLinearIssueFromGitHub(config, issue.number))
        );

        for (const result of results) {
          if (result.status === 'fulfilled' && result.value.success && result.value.linearIssue) {
            // Add to dictionary for step 4
            dictionary.set(result.value.linearIssue.githubIssueNumber!, result.value.linearIssue);
            createdCount++;
          }
        }
      }
    }

    // Step 4: Update all Linear issues in dictionary
    console.log(`\nStep 4: Updating ${dictionary.size} Linear issue(s)...`);
    let commentsAddedCount = 0;
    let stateChangedCount = 0;

    // Process in batches for performance
    const BATCH_SIZE = 5;
    const dictionaryEntries = Array.from(dictionary.entries());

    for (let i = 0; i < dictionaryEntries.length; i += BATCH_SIZE) {
      const batch = dictionaryEntries.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(async ([githubNumber, linearIssue]) => {
          console.log(`  Processing ${linearIssue.identifier} (GitHub #${githubNumber})...`);

          // Sync comments
          const commentResult = await syncCommentsToLinear(config, linearIssue.id, githubNumber);
          if (commentResult.success && commentResult.addedCount > 0) {
            console.log(`    ✓ Added ${commentResult.addedCount} new comment(s)`);
          }

          // Update status
          const statusResult = await updateLinearIssueStatus(config, linearIssue.id, githubNumber);
          if (statusResult.success && statusResult.stateChanged) {
            console.log(`    ✓ Updated state to "${statusResult.newState}"`);
          }

          return {
            commentsAdded: commentResult.addedCount,
            stateChanged: statusResult.stateChanged,
          };
        })
      );

      // Count results
      for (const result of results) {
        if (result.status === 'fulfilled') {
          commentsAddedCount += result.value.commentsAdded;
          if (result.value.stateChanged) {
            stateChangedCount++;
          }
        }
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('Sync complete:');
    console.log(`  - ${createdCount} new issue(s) created`);
    console.log(`  - ${commentsAddedCount} comment(s) added`);
    console.log(`  - ${stateChangedCount} state(s) updated`);
    console.log('='.repeat(80));

    return { newIssuesFound: createdCount > 0 };
  } catch (error) {
    console.error('Error during sync:', error);
    throw error;
  }
}

async function startPolling(): Promise<void> {
  const config = loadConfig();
  const syncMutex = new Mutex();

  // Backoff state
  let currentIntervalMinutes = config.polling.minIntervalMinutes;
  let consecutiveEmptySyncs = 0;
  let timeoutHandle: NodeJS.Timeout | null = null;
  let isShuttingDown = false;

  console.log('Starting GitHub -> Linear Sync');
  console.log('='.repeat(80));
  console.log(`Repository: ${config.github.owner}/${config.github.repo}`);
  console.log(`Labels (AND): ${config.github.labels.join(', ')}`);
  console.log(`Linear Team: ${config.linear.teamId}`);
  console.log(`Sync Label: ${config.linear.syncLabel}`);
  console.log(`Poll interval: ${config.polling.minIntervalMinutes}-${config.polling.maxIntervalMinutes} minute(s) (with backoff)`);
  console.log('='.repeat(80));

  const scheduleNextSync = () => {
    if (isShuttingDown) return;

    const intervalMs = currentIntervalMinutes * 60 * 1000;
    console.log(`\nNext sync scheduled in ${currentIntervalMinutes} minute(s)...`);

    timeoutHandle = setTimeout(async () => {
      // Try to acquire lock, skip if previous sync is still running
      if (syncMutex.isLocked()) {
        console.log('\nSkipping sync - previous sync still in progress');
        scheduleNextSync();
        return;
      }

      const release = await syncMutex.acquire();
      try {
        const result = await sync();

        if (result.newIssuesFound) {
          // Reset backoff when new issues are found
          consecutiveEmptySyncs = 0;
          currentIntervalMinutes = config.polling.minIntervalMinutes;
          console.log(`New issues found - reset poll interval to ${currentIntervalMinutes} minute(s)`);
        } else {
          // Increment empty sync counter and apply backoff
          consecutiveEmptySyncs++;

          if (consecutiveEmptySyncs >= 2) {
            // Double the interval (exponential backoff), but cap at max
            const newInterval = Math.min(
              currentIntervalMinutes * 2,
              config.polling.maxIntervalMinutes
            );

            if (newInterval !== currentIntervalMinutes) {
              currentIntervalMinutes = newInterval;
              console.log(`No new issues for ${consecutiveEmptySyncs} consecutive syncs - increasing interval to ${currentIntervalMinutes} minute(s)`);
            }
          }
        }
      } catch (error) {
        console.error('Error during sync:', error);
      } finally {
        release();
        scheduleNextSync();
      }
    }, intervalMs);
  };

  // Run immediately on start
  try {
    const result = await sync();
    if (!result.newIssuesFound) {
      consecutiveEmptySyncs = 1;
    }
  } catch (error) {
    console.error('Error during initial sync:', error);
  }

  // Schedule the next sync
  scheduleNextSync();

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n\nShutting down gracefully...');
    isShuttingDown = true;
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/**
 * Parses a Linear issue URL and extracts the identifier.
 * Supports: https://linear.app/{org}/issue/{IDENTIFIER}/{slug}
 */
function parseLinearUrl(url: string): string {
  const match = url.match(/linear\.app\/[^/]+\/issue\/([A-Z]+-\d+)/);
  if (!match || !match[1]) {
    throw new Error(`Could not parse Linear issue identifier from URL: ${url}`);
  }
  return match[1];
}

/**
 * Creates a GitHub issue from a Linear issue, then stamps the Linear
 * issue with the GitHub back-link so the sync loop doesn't duplicate it.
 */
async function createFromLinear(linearUrl: string): Promise<void> {
  const config = loadConfig();
  const githubService = new GitHubService(config);
  const linearService = new LinearService(config);

  // Parse identifier from URL
  const identifier = parseLinearUrl(linearUrl);
  console.log(`Parsed Linear identifier: ${identifier}`);

  // Fetch the Linear issue
  console.log(`Fetching Linear issue ${identifier}...`);
  const linearIssue = await linearService.fetchIssueByIdentifier(identifier);
  if (!linearIssue) {
    throw new Error(`Linear issue ${identifier} not found`);
  }
  console.log(`Found: ${linearIssue.title}`);

  // Format GitHub issue body: Linear description + metadata footer
  const body = [
    linearIssue.description || '(No description)',
    '',
    '---',
    `**Linear Issue:** ${identifier}`,
    `**Linear URL:** ${linearUrl}`,
  ].join('\n');

  // Create GitHub issue with the configured labels so the poll picks it up
  console.log(`Creating GitHub issue in ${config.github.owner}/${config.github.repo} with labels: ${config.github.labels.join(', ')}...`);
  const ghIssue = await githubService.createIssue({
    title: linearIssue.title,
    body,
    labels: config.github.labels,
  });
  console.log(`Created GitHub issue #${ghIssue.number}: ${ghIssue.html_url}`);

  // Stamp the Linear issue with GitHub metadata so the sync loop
  // recognizes it as already synced and skips duplicate creation.
  const updatedDescription = [
    linearIssue.description || '',
    '',
    '---',
    `**GitHub Issue:** #${ghIssue.number}`,
    `**GitHub URL:** ${ghIssue.html_url}`,
  ].join('\n');

  console.log(`Updating Linear issue ${identifier} with GitHub link...`);
  await linearService.updateIssueDescription(linearIssue.id, updatedDescription);
  console.log(`Done. ${identifier} <-> GitHub #${ghIssue.number}`);

  // Open the new issue in the browser
  try {
    execSync(`open ${ghIssue.html_url}`);
  } catch {
    // Non-fatal: skip if open isn't available
  }
}

// Entry point: `create <linear-url>` or default polling mode
const args = process.argv.slice(2);
if (args[0] === 'create' && args[1]) {
  createFromLinear(args[1]).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
} else {
  startPolling().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
