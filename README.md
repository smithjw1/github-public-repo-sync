# GitHub to Linear Sync

A Node.js application that syncs issues from the WordPress Gutenberg repository to Linear.

## Current Status: Step 3 - Comment Syncing

Syncs open GitHub issues from WordPress/gutenberg to Linear with automated tracking and continuous comment synchronization.

### Features Implemented
- Fetches **open issues only** from WordPress/gutenberg with configurable labels (AND logic)
- Creates issues in Linear with GitHub metadata embedded in description
- **Syncs comments continuously**:
  - All comments copied when creating new issues
  - New comments automatically synced to existing issues on each poll
  - Preserves author info and links back to GitHub
- Tracks synced issues using a configurable Linear label
- Prevents duplicate syncing by checking existing Linear issues and comments
- Retrieves issue details including:
  - Title, description
  - All comments with authors, timestamps, and GitHub links
  - Associated PRs (using GitHub's Timeline API)
- Polls GitHub at configurable intervals for continuous sync

## GitHub Token Setup

You need a GitHub Personal Access Token to use this app. **Fine-grained tokens are recommended** for better security.

### Creating a Fine-Grained Token (Recommended)

1. Go to [GitHub Settings > Personal Access Tokens > Fine-grained tokens](https://github.com/settings/personal-access-tokens/new)

2. Configure the token:
   - **Token name**: `gutenberg-linear-sync` (or any descriptive name)
   - **Expiration**: Choose based on your needs (or "No expiration" for automation)
   - **Repository access**: Select **"Public Repositories (read-only)"**
     - Note: You can't select specific repos like WordPress/gutenberg unless you're a collaborator
     - Choosing "Public Repositories (read-only)" gives read access to all public repos, which is safe

3. **Permissions**: Leave all permissions unselected (or use defaults)
   - For public repos, read-only access is automatically granted
   - No additional permissions needed

4. Click "Generate token" and copy the token immediately

5. Add it to your `.env` file as `GITHUB_TOKEN`

### Why You Need a Token

- **Rate limits**: Without a token, GitHub limits you to 60 requests/hour. With a token, you get 5,000 requests/hour.
- **No write access needed**: The token only needs read permissions since we're querying public data from WordPress/gutenberg.
- **You don't need repo admin access**: Anyone can create a personal token with read-only access to public repositories.

### Alternative: Classic Token

If you prefer, you can use a classic token:
- Go to [GitHub Settings > Personal Access Tokens (classic)](https://github.com/settings/tokens)
- Select **no scopes** (or just `public_repo` for clarity)
- Classic tokens have broader access, so fine-grained tokens are more secure

## Linear API Setup

You need a Linear API key to sync issues to your Linear workspace.

### Creating a Linear API Key

1. Go to [Linear Settings > API](https://linear.app/settings/api)

2. Click "Create new key" or "Personal API keys"

3. Give it a descriptive name like `gutenberg-sync`

4. Copy the API key immediately (it won't be shown again)

5. Find your **Team ID** (UUID format):
Locate the IDs of teams, issues and other entities directly within Linear itself from the command menu: Cmd/Ctrl+K and "Copy model UUID". This will show results based on the page you're currently viewing within Linear.

6. Add both to your `.env` file

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create tokens (see "GitHub Token Setup" and "Linear API Setup" above)

3. Create `.env` file from template:
```bash
cp .env.example .env
```

4. Configure `.env`:
```env
# GitHub
GITHUB_REPO_OWNER=WordPress
GITHUB_REPO_NAME=gutenberg
GITHUB_TOKEN=github_pat_xxxxx
GITHUB_LABELS=[Feature] Real-time Collaboration

# Linear
LINEAR_API_KEY=lin_api_xxxxx
LINEAR_TEAM_ID=a1b2c3d4-e5f6-...  # UUID, not team name
LINEAR_SYNC_LABEL=github-sync

# Polling
POLL_INTERVAL_MINUTES=5
```

## Usage

Run in development mode:

```bash
npm run dev
```

Build and run in production:

```bash
npm run build
npm start
```

The sync will:
- Run immediately on startup
- Poll GitHub at the configured interval
- Create new Linear issues for unsynced GitHub issues
- Sync comments continuously

## How It Works

### Issue Tracking

The app uses a **label-based tracking system** to identify synced issues:

1. All synced issues get a configurable label (default: `github-sync`)
2. GitHub issue metadata is embedded in the Linear issue description:
   ```
   [Original issue description]

   ---
   **GitHub Issue:** #12345
   **GitHub URL:** https://github.com/WordPress/gutenberg/issues/12345
   ```
3. Before creating an issue, the app queries Linear for existing issues with the sync label
4. Parses descriptions to extract GitHub issue numbers
5. Only creates issues that don't already exist

### Comment Syncing

Comments are tracked using embedded metadata similar to issues:

1. **Format in Linear:**
   ```markdown
   **@username** (Jan 15, 2024 10:30 AM)

   [comment body]

   [View on GitHub](https://github.com/WordPress/gutenberg/issues/12345#issuecomment-67890)
   ---
   GitHub Comment ID: 67890
   ```

2. **Continuous sync:**
   - On each poll, the app checks for new comments on all synced issues
   - Parses existing Linear comments to extract GitHub comment IDs
   - Only creates comments that don't already exist
   - Preserves original author and timestamp information

3. **Benefits:**
   - Direct links back to GitHub for replies
   - No duplicate comments
   - Full comment history preserved

## Next Steps

- **Step 4**: Handle status changes (Triage → In Review → Done)

## Label Logic

Issues must have **ALL** specified labels to be synced (AND logic).

Example: If `GITHUB_LABELS=sync-to-linear,bug`, only issues with both labels will be synced.
