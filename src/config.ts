import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

export interface Config {
  github: {
    owner: string;
    repo: string;
    token: string;
    labels: string[];
  };
  linear: {
    apiKey: string;
    teamId: string;
    syncLabel: string;
    stateInReview: string;
    stateDone: string;
  };
  polling: {
    minIntervalMinutes: number;
    maxIntervalMinutes: number;
  };
}

function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function validateGitHubToken(token: string): void {
  // GitHub tokens start with ghp_ (classic) or github_pat_ (fine-grained)
  if (!token.startsWith('ghp_') && !token.startsWith('github_pat_')) {
    throw new Error('GITHUB_TOKEN appears invalid. Please use a valid GitHub Personal Access Token from https://github.com/settings/tokens');
  }
}

function validateLinearTeamId(teamId: string): void {
  // UUID v4 format validation
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(teamId)) {
    throw new Error('LINEAR_TEAM_ID must be a valid UUID (e.g., a1b2c3d4-e5f6-...)\nFind it via Linear API: { teams { nodes { id name } } }');
  }
}

function validatePollInterval(intervalString: string, fieldName: string): number {
  const interval = parseInt(intervalString, 10);
  if (isNaN(interval) || interval <= 0) {
    throw new Error(`${fieldName} must be a positive number`);
  }
  return interval;
}

function validatePollIntervals(minInterval: number, maxInterval: number): void {
  if (minInterval > maxInterval) {
    throw new Error('POLL_MIN_INTERVAL_MINUTES must be less than or equal to POLL_MAX_INTERVAL_MINUTES');
  }
}

function validateGitIgnore(): void {
  const gitignorePath = path.join(process.cwd(), '.gitignore');

  if (!fs.existsSync(gitignorePath)) {
    console.warn('WARNING: .gitignore file not found! Environment variables may be committed to git.');
    return;
  }

  const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');

  if (!gitignoreContent.includes('.env')) {
    console.warn('WARNING: .gitignore does not contain .env! Secrets may be committed to git.');
  }
}

export function loadConfig(): Config {
  // Validate .gitignore exists and contains .env
  validateGitIgnore();

  const labelsString = getRequiredEnv('GITHUB_LABELS');
  const labels = labelsString
    .split(',')
    .map(label => label.trim())
    .filter(label => label.length > 0);

  if (labels.length === 0) {
    throw new Error('GITHUB_LABELS must contain at least one label');
  }

  const githubToken = getRequiredEnv('GITHUB_TOKEN');
  validateGitHubToken(githubToken);

  const linearTeamId = getRequiredEnv('LINEAR_TEAM_ID');
  validateLinearTeamId(linearTeamId);

  const minInterval = validatePollInterval(getRequiredEnv('POLL_MIN_INTERVAL_MINUTES'), 'POLL_MIN_INTERVAL_MINUTES');
  const maxInterval = validatePollInterval(getRequiredEnv('POLL_MAX_INTERVAL_MINUTES'), 'POLL_MAX_INTERVAL_MINUTES');
  validatePollIntervals(minInterval, maxInterval);

  return {
    github: {
      owner: getRequiredEnv('GITHUB_REPO_OWNER'),
      repo: getRequiredEnv('GITHUB_REPO_NAME'),
      token: githubToken,
      labels,
    },
    linear: {
      apiKey: getRequiredEnv('LINEAR_API_KEY'),
      teamId: linearTeamId,
      syncLabel: process.env.LINEAR_SYNC_LABEL || 'github-sync',
      stateInReview: process.env.LINEAR_STATE_IN_REVIEW || 'In Review',
      stateDone: process.env.LINEAR_STATE_DONE || 'Done',
    },
    polling: {
      minIntervalMinutes: minInterval,
      maxIntervalMinutes: maxInterval,
    },
  };
}
