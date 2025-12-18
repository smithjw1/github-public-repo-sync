import type { SyncData } from './types.js';

export class Logger {
  /**
   * Logs sync data in a readable format
   */
  logSyncData(syncData: SyncData[]): void {
    console.log('\n' + '='.repeat(80));
    console.log(`SYNC DATA - ${new Date().toISOString()}`);
    console.log('='.repeat(80));

    if (syncData.length === 0) {
      console.log('\nNo issues found matching the specified labels.');
      return;
    }

    console.log(`\nFound ${syncData.length} issue(s) to sync:\n`);

    syncData.forEach((data, index) => {
      const { issue, comments, associatedPRs } = data;

      console.log(`\n[${ index + 1}/${syncData.length}] Issue #${issue.number}: ${issue.title}`);
      console.log('-'.repeat(80));
      console.log(`ID: ${issue.id}`);
      console.log(`URL: ${issue.html_url}`);
      console.log(`Labels: ${issue.labels.join(', ')}`);
      console.log(`Created: ${new Date(issue.created_at).toLocaleString()}`);
      console.log(`Updated: ${new Date(issue.updated_at).toLocaleString()}`);

      console.log('\nDescription:');
      console.log(this.truncate(issue.body || '(No description)', 200));

      if (associatedPRs.length > 0) {
        console.log(`\nAssociated PRs (${associatedPRs.length}):`);
        associatedPRs.forEach(pr => {
          console.log(`  - PR #${pr.number}: ${pr.title}`);
          console.log(`    ${pr.html_url}`);
        });
      } else {
        console.log('\nAssociated PRs: None');
      }

      console.log(`\nComments (${comments.length}):`);
      if (comments.length > 0) {
        comments.slice(0, 3).forEach(comment => {
          console.log(`  - @${comment.author} (${new Date(comment.created_at).toLocaleString()}):`);
          console.log(`    ${this.truncate(comment.body, 100)}`);
        });
        if (comments.length > 3) {
          console.log(`  ... and ${comments.length - 3} more comment(s)`);
        }
      } else {
        console.log('  None');
      }

      console.log('\n' + '─'.repeat(80));
    });

    console.log('\n' + '='.repeat(80));
    console.log('END SYNC DATA');
    console.log('='.repeat(80) + '\n');
  }

  /**
   * Logs a summary of the sync
   */
  logSummary(syncData: SyncData[]): void {
    const withPRs = syncData.filter(d => d.associatedPRs.length > 0).length;
    const totalComments = syncData.reduce((sum, d) => sum + d.comments.length, 0);

    console.log('\nSUMMARY:');
    console.log(`  Total open issues: ${syncData.length}`);
    console.log(`  Issues with associated PRs: ${withPRs}`);
    console.log(`  Total comments: ${totalComments}`);
  }

  /**
   * Truncates text to a maximum length
   */
  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength) + '...';
  }
}
