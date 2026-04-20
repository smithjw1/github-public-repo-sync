/**
 * Standalone sync operations designed to be exposed as HTTP endpoints.
 * Each function is stateless, idempotent, and handles a single responsibility.
 */

import type { Config } from './config.js';
import { GitHubService } from './github.js';
import { LinearService } from './linear.js';
import type { LinearIssueData } from './linear.js';
import type { AssociatedPR } from './types.js';

export interface CreateIssueResult {
  success: boolean;
  linearIssue?: LinearIssueData;
  skipped?: boolean;
  reason?: string;
  error?: string;
}

export interface SyncCommentsResult {
  success: boolean;
  addedCount: number;
  errors?: string[];
}

export interface UpdateStatusResult {
  success: boolean;
  stateChanged: boolean;
  newState?: string;
  error?: string;
}

/**
 * Creates a Linear issue from a GitHub issue number.
 * Performs duplicate detection before creating.
 *
 * @param config - Application configuration
 * @param githubIssueNumber - GitHub issue number to sync
 * @returns Result indicating success, created issue, or skip reason
 */
export async function createLinearIssueFromGitHub(
  config: Config,
  githubIssueNumber: number
): Promise<CreateIssueResult> {
  const githubService = new GitHubService(config);
  const linearService = new LinearService(config);

  try {
    // Fetch the GitHub issue
    console.log(`  Fetching GitHub issue #${githubIssueNumber}...`);
    const githubIssue = await githubService.fetchIssueByNumber(githubIssueNumber);

    if (!githubIssue) {
      return {
        success: false,
        skipped: true,
        reason: `GitHub issue #${githubIssueNumber} not found or is a PR`,
      };
    }

    // Check if issue is open (we only sync open issues)
    if (githubIssue.state === 'closed') {
      return {
        success: false,
        skipped: true,
        reason: `GitHub issue #${githubIssueNumber} is closed`,
      };
    }

    // Create the Linear issue (includes duplicate detection)
    console.log(`  Creating Linear issue for GitHub #${githubIssueNumber}: ${githubIssue.title}`);
    const linearIssue = await linearService.createIssue(githubIssue);

    if (!linearIssue) {
      return {
        success: false,
        skipped: true,
        reason: 'Duplicate detected (by title, GitHub number, or canceled issue)',
      };
    }

    console.log(`  ✓ Created: ${linearIssue.identifier}`);
    return {
      success: true,
      linearIssue,
    };
  } catch (error) {
    console.error(`  ✗ Failed to create Linear issue for GitHub #${githubIssueNumber}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Syncs comments from a GitHub issue to a Linear issue.
 * Only creates new comments that haven't been synced yet (idempotent).
 *
 * @param config - Application configuration
 * @param linearIssueId - Linear issue ID to add comments to
 * @param githubIssueNumber - GitHub issue number to fetch comments from
 * @returns Result indicating success and number of comments added
 */
export async function syncCommentsToLinear(
  config: Config,
  linearIssueId: string,
  githubIssueNumber: number
): Promise<SyncCommentsResult> {
  const githubService = new GitHubService(config);
  const linearService = new LinearService(config);

  try {
    // Fetch GitHub comments
    const githubComments = await githubService.fetchComments(githubIssueNumber);

    if (githubComments.length === 0) {
      return {
        success: true,
        addedCount: 0,
      };
    }

    // Sync comments (linearService handles duplicate detection)
    const addedCount = await linearService.syncComments(linearIssueId, githubComments);

    return {
      success: true,
      addedCount,
    };
  } catch (error) {
    console.error(`  ✗ Failed to sync comments for Linear issue ${linearIssueId}:`, error);
    return {
      success: false,
      addedCount: 0,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

/**
 * Updates a Linear issue's status based on GitHub issue state and PRs.
 * - Closed GitHub issue → Done in Linear
 * - Open GitHub issue with open PR → In Review in Linear
 * - Otherwise → No change
 *
 * @param config - Application configuration
 * @param linearIssueId - Linear issue ID to update
 * @param githubIssueNumber - GitHub issue number to check status
 * @returns Result indicating if state was changed
 */
export async function updateLinearIssueStatus(
  config: Config,
  linearIssueId: string,
  githubIssueNumber: number
): Promise<UpdateStatusResult> {
  const githubService = new GitHubService(config);
  const linearService = new LinearService(config);

  try {
    // Fetch the GitHub issue to get current state
    const githubIssue = await githubService.fetchIssueByNumber(githubIssueNumber);

    if (!githubIssue) {
      return {
        success: false,
        stateChanged: false,
        error: `GitHub issue #${githubIssueNumber} not found`,
      };
    }

    // Fetch associated PRs
    let associatedPRs: AssociatedPR[] = [];
    try {
      associatedPRs = await githubService.findAssociatedPRs(githubIssueNumber);
    } catch (error) {
      console.warn(`  Warning: Could not fetch PRs for GitHub #${githubIssueNumber}`);
      associatedPRs = [];
    }

    // Sync the state
    const stateChanged = await linearService.syncIssueState(
      linearIssueId,
      githubIssue,
      associatedPRs
    );

    if (stateChanged) {
      const stateName = githubIssue.state === 'closed'
        ? config.linear.stateDone
        : (associatedPRs.some(pr => pr.state === 'open' && !pr.draft)
            ? config.linear.stateInReview
            : 'unchanged');

      return {
        success: true,
        stateChanged: true,
        newState: stateName,
      };
    }

    return {
      success: true,
      stateChanged: false,
    };
  } catch (error) {
    console.error(`  ✗ Failed to update status for Linear issue ${linearIssueId}:`, error);
    return {
      success: false,
      stateChanged: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
