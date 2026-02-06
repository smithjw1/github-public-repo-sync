import { Octokit } from '@octokit/rest';
import type { Config } from './config.js';
import type { GitHubIssue, GitHubComment, AssociatedPR, SyncData } from './types.js';
import { retry } from './retry.js';

export class GitHubService {
  private octokit: Octokit;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    this.octokit = new Octokit({
      auth: config.github.token,
    });
  }

  /**
   * Fetches all issues from the repository that have ALL the specified labels (AND logic)
   */
  async fetchIssuesWithLabels(): Promise<GitHubIssue[]> {
    const { owner, repo, labels } = this.config.github;

    console.log(`Fetching issues from ${owner}/${repo} with labels: ${labels.join(', ')}...`);

    // GitHub API doesn't support AND logic for labels, so we fetch with first label
    // and filter client-side for issues that have ALL labels
    // Use paginate to get ALL issues (not just first 100)
    const allIssues = await retry(() =>
      this.octokit.paginate(this.octokit.issues.listForRepo, {
        owner,
        repo,
        state: 'open',
        labels: labels[0], // Start with first label to reduce initial results
        per_page: 100,
      })
    );

    // Filter to only include real issues (not PRs) that have ALL required labels.
    // GitHub's issues endpoint returns PRs too; they are the only items with pull_request set.
    const filteredIssues = allIssues.filter(issue => {
      if (issue.pull_request) return false;
      const issueLabels = issue.labels.map(label =>
        typeof label === 'string' ? label : label.name || ''
      );
      return labels.every(requiredLabel => issueLabels.includes(requiredLabel));
    });

    // Map to our interface
    return filteredIssues.map(issue => ({
      id: issue.id,
      number: issue.number,
      title: issue.title,
      body: issue.body ?? null,
      state: issue.state as 'open' | 'closed',
      labels: issue.labels.map(label => typeof label === 'string' ? label : label.name || ''),
      created_at: issue.created_at,
      updated_at: issue.updated_at,
      html_url: issue.html_url,
    }));
  }

  /**
   * Fetches all comments for a specific issue
   */
  async fetchComments(issueNumber: number): Promise<GitHubComment[]> {
    const { owner, repo } = this.config.github;

    // Use paginate to get ALL comments (not just first 100)
    const allComments = await retry(() =>
      this.octokit.paginate(this.octokit.issues.listComments, {
        owner,
        repo,
        issue_number: issueNumber,
        per_page: 100,
      })
    );

    return allComments.map(comment => ({
      id: comment.id,
      author: comment.user?.login || 'unknown',
      body: comment.body || '',
      created_at: comment.created_at,
      updated_at: comment.updated_at,
      html_url: comment.html_url || `https://github.com/${owner}/${repo}/issues/${issueNumber}#issuecomment-${comment.id}`,
    }));
  }

  /**
   * Finds PRs associated with an issue using GitHub's timeline API
   * This uses GitHub's native linking detection (more reliable than parsing)
   */
  async findAssociatedPRs(issueNumber: number): Promise<AssociatedPR[]> {
    const { owner, repo } = this.config.github;

    try {
      // Use timeline API to get cross-reference events
      // Use paginate to get ALL timeline events (not just first 100)
      const allEvents = await retry(() =>
        this.octokit.paginate(this.octokit.issues.listEventsForTimeline, {
          owner,
          repo,
          issue_number: issueNumber,
          per_page: 100,
        })
      );

      const associatedPRs: AssociatedPR[] = [];
      const seenPRs = new Set<number>();

      for (const event of allEvents) {
        // Look for cross-referenced events from PRs
        // Type guard to check if event has source property
        if (
          event.event === 'cross-referenced' &&
          'source' in event &&
          event.source &&
          typeof event.source === 'object' &&
          'issue' in event.source &&
          event.source.issue &&
          typeof event.source.issue === 'object' &&
          'pull_request' in event.source.issue
        ) {
          const pr = event.source.issue as any;
          if (pr.number && !seenPRs.has(pr.number)) {
            seenPRs.add(pr.number);

            // Fetch full PR details to get state, merged status, and draft status
            try {
              const prDetails = await retry(() =>
                this.octokit.pulls.get({
                  owner,
                  repo,
                  pull_number: pr.number,
                })
              );

              associatedPRs.push({
                number: prDetails.data.number,
                title: prDetails.data.title,
                html_url: prDetails.data.html_url,
                state: prDetails.data.state as 'open' | 'closed',
                merged: prDetails.data.merged ?? false,
                draft: prDetails.data.draft ?? false,
              });
            } catch (prError) {
              console.warn(`Warning: Could not fetch details for PR #${pr.number}:`, prError);
              // Fallback to basic info without state details
              associatedPRs.push({
                number: pr.number,
                title: pr.title || '',
                html_url: pr.html_url || '',
                state: 'open',
                merged: false,
                draft: false,
              });
            }
          }
        }
      }

      return associatedPRs;
    } catch (error) {
      console.warn(`Warning: Could not fetch timeline for issue #${issueNumber}:`, error);
      return [];
    }
  }

  /**
   * Fetches complete sync data for an issue
   */
  async fetchIssueSyncData(issue: GitHubIssue): Promise<SyncData> {
    const [comments, associatedPRs] = await Promise.all([
      this.fetchComments(issue.number),
      this.findAssociatedPRs(issue.number),
    ]);

    return {
      issue,
      comments,
      associatedPRs,
    };
  }

  /**
   * Creates a new issue in the configured GitHub repository
   */
  async createIssue({ title, body, labels }: { title: string; body: string; labels: string[] }): Promise<GitHubIssue> {
    const { owner, repo } = this.config.github;

    const response = await retry(() =>
      this.octokit.issues.create({
        owner,
        repo,
        title,
        body,
        labels,
      })
    );

    const issue = response.data;
    return {
      id: issue.id,
      number: issue.number,
      title: issue.title,
      body: issue.body ?? null,
      state: issue.state as 'open' | 'closed',
      labels: issue.labels.map(label => typeof label === 'string' ? label : label.name || ''),
      created_at: issue.created_at,
      updated_at: issue.updated_at,
      html_url: issue.html_url,
    };
  }
}
