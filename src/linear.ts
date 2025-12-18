import { LinearClient, Issue, IssueLabel, WorkflowState as LinearWorkflowState } from '@linear/sdk';
import type { Config } from './config.js';
import type { GitHubIssue, GitHubComment, WorkflowState, AssociatedPR } from './types.js';
import { retry } from './retry.js';

export interface LinearIssueData {
  id: string;
  identifier: string;
  title: string;
  description?: string | undefined;
  githubIssueNumber?: number | undefined;
}

export class LinearService {
  private client: LinearClient;
  private config: Config;
  private syncLabelId?: string;
  private workflowStatesCache?: WorkflowState[];

  constructor(config: Config) {
    this.config = config;
    this.client = new LinearClient({
      apiKey: config.linear.apiKey,
    });
  }

  /**
   * Gets or creates the sync label in Linear
   */
  async getOrCreateSyncLabel(): Promise<string> {
    if (this.syncLabelId) {
      return this.syncLabelId;
    }

    const { teamId, syncLabel } = this.config.linear;

    // Try to find existing label
    const team = await retry(() => this.client.team(teamId));
    const labels = await retry(() => team.labels());

    const existingLabel = labels.nodes.find(
      (label: IssueLabel) => label.name === syncLabel
    );

    if (existingLabel) {
      this.syncLabelId = existingLabel.id;
      console.log(`Using existing sync label: "${syncLabel}" (${existingLabel.id})`);
      return existingLabel.id;
    }

    // Create new label
    const labelPayload = await retry(() =>
      this.client.createIssueLabel({
        name: syncLabel,
        teamId,
        color: '#5E6AD2', // Linear blue
      })
    );

    const newLabel = await labelPayload.issueLabel;
    if (!newLabel) {
      throw new Error(`Failed to create sync label: ${syncLabel}`);
    }

    this.syncLabelId = newLabel.id;
    console.log(`Created sync label: "${syncLabel}" (${newLabel.id})`);
    return newLabel.id;
  }

  /**
   * Fetches all issues with the sync label
   */
  async fetchSyncedIssues(): Promise<LinearIssueData[]> {
    const labelId = await this.getOrCreateSyncLabel();
    const { teamId } = this.config.linear;

    const issues = await retry(() =>
      this.client.issues({
        filter: {
          team: { id: { eq: teamId } },
          labels: { some: { id: { eq: labelId } } },
        },
      })
    );

    const syncedIssues: LinearIssueData[] = [];

    for (const issue of issues.nodes) {
      const description = issue.description ?? undefined;
      const githubIssueNumber = this.parseGitHubIssueNumber(description);
      syncedIssues.push({
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description,
        githubIssueNumber,
      });
    }

    return syncedIssues;
  }

  /**
   * Parses GitHub issue number from Linear issue description
   */
  parseGitHubIssueNumber(description: string | undefined): number | undefined {
    if (!description) return undefined;
    const match = description.match(/\*\*GitHub Issue:\*\*\s*#(\d+)/);
    return match && match[1] ? parseInt(match[1], 10) : undefined;
  }

  /**
   * Finds a Linear issue by GitHub issue number (idempotency check)
   */
  async findIssueByGitHubNumber(githubIssueNumber: number): Promise<LinearIssueData | undefined> {
    const syncedIssues = await this.fetchSyncedIssues();
    return syncedIssues.find(issue => issue.githubIssueNumber === githubIssueNumber);
  }

  /**
   * Creates a new issue in Linear with GitHub metadata
   * Implements idempotency: returns existing issue if already synced
   */
  async createIssue(githubIssue: GitHubIssue): Promise<LinearIssueData> {
    // Idempotency check: see if issue already exists
    const existing = await this.findIssueByGitHubNumber(githubIssue.number);
    if (existing) {
      console.log(`  Issue already exists: ${existing.identifier}`);
      return existing;
    }

    const labelId = await this.getOrCreateSyncLabel();
    const { teamId } = this.config.linear;

    const description = this.formatDescription(githubIssue);

    const issuePayload = await retry(() =>
      this.client.createIssue({
        teamId,
        title: githubIssue.title,
        description,
        labelIds: [labelId],
      })
    );

    const issue = await issuePayload.issue;
    if (!issue) {
      throw new Error(`Failed to create Linear issue for GitHub #${githubIssue.number}`);
    }

    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description ?? undefined,
      githubIssueNumber: githubIssue.number,
    };
  }

  /**
   * Formats issue description with GitHub metadata
   */
  private formatDescription(githubIssue: GitHubIssue): string {
    const body = githubIssue.body || '(No description)';
    const metadata = [
      '',
      '---',
      `**GitHub Issue:** #${githubIssue.number}`,
      `**GitHub URL:** ${githubIssue.html_url}`,
    ].join('\n');

    return body + metadata;
  }

  /**
   * Fetches all comments for a Linear issue
   */
  async fetchIssueComments(issueId: string): Promise<Array<{ id: string; body: string; githubCommentId?: number | undefined }>> {
    try {
      const issue = await retry(() => this.client.issue(issueId));
      const comments = await retry(() => issue.comments());

      return comments.nodes.map(comment => ({
        id: comment.id,
        body: comment.body || '',
        githubCommentId: this.parseGitHubCommentId(comment.body || ''),
      }));
    } catch (error) {
      console.error(`Failed to fetch comments for issue ${issueId}:`, error);
      return [];
    }
  }

  /**
   * Parses GitHub comment ID from Linear comment body
   */
  private parseGitHubCommentId(body: string): number | undefined {
    const match = body.match(/GitHub Comment ID:\s*(\d+)/);
    return match && match[1] ? parseInt(match[1], 10) : undefined;
  }

  /**
   * Creates a comment on a Linear issue
   */
  async createComment(issueId: string, githubComment: GitHubComment): Promise<void> {
    const body = this.formatComment(githubComment);

    try {
      await retry(() =>
        this.client.createComment({
          issueId,
          body,
        })
      );
      console.log(`  ✓ Added comment by @${githubComment.author}`);
    } catch (error) {
      console.error(`  ✗ Failed to create comment:`, error);
      throw error;
    }
  }

  /**
   * Formats a GitHub comment for Linear
   */
  private formatComment(comment: GitHubComment): string {
    const date = new Date(comment.created_at).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    return [
      `**@${comment.author}** (${date})`,
      '',
      comment.body,
      '',
      `[View on GitHub](${comment.html_url})`,
      '---',
      `GitHub Comment ID: ${comment.id}`,
    ].join('\n');
  }

  /**
   * Syncs comments for an issue (only creates new ones)
   */
  async syncComments(linearIssueId: string, githubComments: GitHubComment[]): Promise<number> {
    // Fetch existing Linear comments
    const linearComments = await this.fetchIssueComments(linearIssueId);
    const existingGitHubCommentIds = new Set(
      linearComments.map(c => c.githubCommentId).filter(id => id !== undefined)
    );

    // Find comments that haven't been synced yet
    const newComments = githubComments.filter(
      comment => !existingGitHubCommentIds.has(comment.id)
    );

    // Create new comments
    for (const comment of newComments) {
      await this.createComment(linearIssueId, comment);
    }

    return newComments.length;
  }

  /**
   * Fetches workflow states for the configured team
   * Results are cached for performance
   */
  async fetchWorkflowStates(): Promise<WorkflowState[]> {
    if (this.workflowStatesCache) {
      return this.workflowStatesCache;
    }

    const { teamId } = this.config.linear;

    try {
      const team = await retry(() => this.client.team(teamId));
      const states = await retry(() => team.states());

      this.workflowStatesCache = states.nodes.map(state => ({
        id: state.id,
        name: state.name,
        type: state.type as 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled',
      }));

      return this.workflowStatesCache;
    } catch (error) {
      console.error('Failed to fetch workflow states:', error);
      throw error;
    }
  }

  /**
   * Finds a workflow state by name (case-insensitive)
   */
  async findStateByName(stateName: string): Promise<string | undefined> {
    const states = await this.fetchWorkflowStates();
    const state = states.find(
      s => s.name.toLowerCase() === stateName.toLowerCase()
    );
    return state?.id;
  }

  /**
   * Updates a Linear issue's workflow state
   */
  async updateIssueState(issueId: string, stateId: string): Promise<void> {
    try {
      await retry(() =>
        this.client.updateIssue(issueId, {
          stateId,
        })
      );
    } catch (error) {
      console.error(`Failed to update issue state for ${issueId}:`, error);
      throw error;
    }
  }

  /**
   * Syncs issue state based on GitHub data
   * Returns true if state was changed
   */
  async syncIssueState(
    linearIssueId: string,
    githubIssue: GitHubIssue,
    associatedPRs: AssociatedPR[]
  ): Promise<boolean> {
    const { stateInReview, stateDone } = this.config.linear;

    // Determine target state based on GitHub data
    let targetStateName: string | null = null;

    // Priority 1: If issue is closed, move to Done
    if (githubIssue.state === 'closed') {
      targetStateName = stateDone;
    }
    // Priority 2: If issue has open non-draft PR, move to In Review
    else if (associatedPRs.some(pr => pr.state === 'open' && !pr.draft)) {
      targetStateName = stateInReview;
    }

    // If no state change needed, return early
    if (!targetStateName) {
      return false;
    }

    // Find the target state ID
    const targetStateId = await this.findStateByName(targetStateName);
    if (!targetStateId) {
      console.warn(`Warning: State "${targetStateName}" not found in Linear team`);
      return false;
    }

    // Fetch current issue to check if state change is needed
    try {
      const issue = await retry(() => this.client.issue(linearIssueId));
      const currentState = await issue.state;

      // If already in target state, no update needed
      if (currentState?.id === targetStateId) {
        return false;
      }

      // Update the state
      await this.updateIssueState(linearIssueId, targetStateId);
      return true;
    } catch (error) {
      console.error(`Failed to sync state for issue ${linearIssueId}:`, error);
      return false;
    }
  }
}
