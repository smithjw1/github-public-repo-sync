import { loadConfig } from './config.js';
import { GitHubService } from './github.js';
import { LinearService } from './linear.js';
import { Logger } from './logger.js';
import { Mutex } from 'async-mutex';
import type { SyncData } from './types.js';

async function sync(): Promise<void> {
  try {
    const config = loadConfig();
    const githubService = new GitHubService(config);
    const linearService = new LinearService(config);
    const logger = new Logger();

    // Fetch issues with all required labels
    const issues = await githubService.fetchIssuesWithLabels();

    if (issues.length === 0) {
      console.log('\nNo GitHub issues found matching the specified labels.');
      return;
    }

    // Fetch complete sync data for each issue (use allSettled to continue even if some fail)
    console.log(`\nFetching details for ${issues.length} issue(s)...`);
    const syncDataResults = await Promise.allSettled(
      issues.map(issue => githubService.fetchIssueSyncData(issue))
    );

    const syncData = syncDataResults
      .filter((r): r is PromiseFulfilledResult<SyncData> => r.status === 'fulfilled')
      .map(r => r.value);

    const failedFetches = syncDataResults.filter(r => r.status === 'rejected');
    if (failedFetches.length > 0) {
      console.warn(`Warning: Failed to fetch details for ${failedFetches.length} issue(s)`);
    }

    // Fetch existing Linear issues
    console.log('\nFetching existing Linear issues...');
    const linearIssues = await linearService.fetchSyncedIssues();
    const existingGitHubNumbers = new Set(
      linearIssues.map(issue => issue.githubIssueNumber).filter(num => num !== undefined)
    );

    console.log(`Found ${linearIssues.length} existing synced issue(s) in Linear`);

    // Determine which issues need to be created
    const issuesToCreate = syncData.filter(
      data => !existingGitHubNumbers.has(data.issue.number)
    );

    console.log(`\n${issuesToCreate.length} new issue(s) to sync to Linear`);

    // Create new issues in Linear and sync comments (with parallel batching)
    const BATCH_SIZE = 5; // Process 5 issues at a time to avoid overwhelming APIs
    let createdCount = 0;

    for (let i = 0; i < issuesToCreate.length; i += BATCH_SIZE) {
      const batch = issuesToCreate.slice(i, i + BATCH_SIZE);
      console.log(`\nProcessing batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} issue(s))...`);

      // Process batch in parallel using Promise.allSettled
      const results = await Promise.allSettled(
        batch.map(async (data) => {
          let linearIssue: any = null;

          try {
            console.log(`  Creating Linear issue for GitHub #${data.issue.number}: ${data.issue.title}`);
            linearIssue = await linearService.createIssue(data.issue);
            console.log(`  ✓ Created: ${linearIssue.identifier}`);

            // Sync all comments for new issue
            if (data.comments.length > 0) {
              console.log(`    Syncing ${data.comments.length} comment(s)...`);
              const syncedCount = await linearService.syncComments(linearIssue.id, data.comments);
              console.log(`    ✓ Synced ${syncedCount} comment(s)`);
            }

            return { success: true, issue: linearIssue };
          } catch (error) {
            // Transaction compensation: if comment syncing failed after issue creation
            if (linearIssue) {
              console.error(`  ✗ Failed to sync comments for ${linearIssue.identifier}:`, error);
              console.error(`    Issue was created but comments failed. Manual review may be needed.`);
            } else {
              console.error(`  ✗ Failed to create issue for GitHub #${data.issue.number}:`, error);
            }
            return { success: false, error };
          }
        })
      );

      // Count successful creations
      createdCount += results.filter(
        (r) => r.status === 'fulfilled' && r.value.success
      ).length;
    }

    // Sync comments for existing issues
    const existingIssuesToUpdate = syncData.filter(
      data => existingGitHubNumbers.has(data.issue.number)
    );

    if (existingIssuesToUpdate.length > 0) {
      console.log(`\nChecking ${existingIssuesToUpdate.length} existing issue(s) for new comments...`);

      for (const data of existingIssuesToUpdate) {
        // Find the Linear issue
        const linearIssue = linearIssues.find(
          li => li.githubIssueNumber === data.issue.number
        );

        if (linearIssue && data.comments.length > 0) {
          const syncedCount = await linearService.syncComments(linearIssue.id, data.comments);
          if (syncedCount > 0) {
            console.log(`  ✓ ${linearIssue.identifier}: Added ${syncedCount} new comment(s)`);
          }
        }
      }
    }

    // Sync states for all issues (new and existing)
    console.log(`\nSyncing states for ${syncData.length} issue(s)...`);
    let stateChangedCount = 0;

    for (const data of syncData) {
      // Find the Linear issue
      const linearIssue = linearIssues.find(
        li => li.githubIssueNumber === data.issue.number
      );

      if (linearIssue) {
        const stateChanged = await linearService.syncIssueState(
          linearIssue.id,
          data.issue,
          data.associatedPRs
        );

        if (stateChanged) {
          stateChangedCount++;
          const stateName = data.issue.state === 'closed'
            ? config.linear.stateDone
            : (data.associatedPRs.some(pr => pr.state === 'open' && !pr.draft)
                ? config.linear.stateInReview
                : 'unknown');
          console.log(`  ✓ ${linearIssue.identifier}: Updated state to "${stateName}"`);
        }
      }
    }

    // Log the results
    logger.logSyncData(syncData);
    logger.logSummary(syncData);

    console.log(`\nSync complete: ${createdCount} issue(s) created, ${stateChangedCount} state(s) updated`);
  } catch (error) {
    console.error('Error during sync:', error);
    throw error;
  }
}

async function startPolling(): Promise<void> {
  const config = loadConfig();
  const intervalMs = config.polling.intervalMinutes * 60 * 1000;
  const syncMutex = new Mutex();

  console.log('Starting GitHub -> Linear Sync');
  console.log('='.repeat(80));
  console.log(`Repository: ${config.github.owner}/${config.github.repo}`);
  console.log(`Labels (AND): ${config.github.labels.join(', ')}`);
  console.log(`Linear Team: ${config.linear.teamId}`);
  console.log(`Sync Label: ${config.linear.syncLabel}`);
  console.log(`Poll interval: ${config.polling.intervalMinutes} minute(s)`);
  console.log('='.repeat(80));

  // Run immediately on start
  await sync();

  // Then poll at configured interval
  const interval = setInterval(async () => {
    // Try to acquire lock, skip if previous sync is still running
    if (syncMutex.isLocked()) {
      console.log('\nSkipping sync - previous sync still in progress');
      return;
    }

    const release = await syncMutex.acquire();
    try {
      await sync();
    } catch (error) {
      console.error('Error during sync:', error);
    } finally {
      release();
    }
  }, intervalMs);

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\nShutting down gracefully...');
    clearInterval(interval);
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n\nShutting down gracefully...');
    clearInterval(interval);
    process.exit(0);
  });
}

// Start the application
startPolling().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
