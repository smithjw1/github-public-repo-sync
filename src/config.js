"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = loadConfig;
var dotenv = require("dotenv");
var fs = require("fs");
var path = require("path");
dotenv.config();
function getRequiredEnv(key) {
    var value = process.env[key];
    if (!value) {
        throw new Error("Missing required environment variable: ".concat(key));
    }
    return value;
}
function validateGitHubToken(token) {
    // GitHub tokens start with ghp_ (classic) or github_pat_ (fine-grained)
    if (!token.startsWith('ghp_') && !token.startsWith('github_pat_')) {
        throw new Error('GITHUB_TOKEN appears invalid. Please use a valid GitHub Personal Access Token from https://github.com/settings/tokens');
    }
}
function validateLinearTeamId(teamId) {
    // UUID v4 format validation
    var uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(teamId)) {
        throw new Error('LINEAR_TEAM_ID must be a valid UUID (e.g., a1b2c3d4-e5f6-...)\nFind it via Linear API: { teams { nodes { id name } } }');
    }
}
function validatePollInterval(intervalString, fieldName) {
    var interval = parseInt(intervalString, 10);
    if (isNaN(interval) || interval <= 0) {
        throw new Error("".concat(fieldName, " must be a positive number"));
    }
    return interval;
}
function validatePollIntervals(minInterval, maxInterval) {
    if (minInterval > maxInterval) {
        throw new Error('POLL_MIN_INTERVAL_MINUTES must be less than or equal to POLL_MAX_INTERVAL_MINUTES');
    }
}
function validateGitIgnore() {
    var gitignorePath = path.join(process.cwd(), '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
        console.warn('WARNING: .gitignore file not found! Environment variables may be committed to git.');
        return;
    }
    var gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
    if (!gitignoreContent.includes('.env')) {
        console.warn('WARNING: .gitignore does not contain .env! Secrets may be committed to git.');
    }
}
function loadConfig() {
    // Validate .gitignore exists and contains .env
    validateGitIgnore();
    var labelsString = getRequiredEnv('GITHUB_LABELS');
    var labels = labelsString
        .split(',')
        .map(function (label) { return label.trim(); })
        .filter(function (label) { return label.length > 0; });
    if (labels.length === 0) {
        throw new Error('GITHUB_LABELS must contain at least one label');
    }
    var githubToken = getRequiredEnv('GITHUB_TOKEN');
    validateGitHubToken(githubToken);
    var linearTeamId = getRequiredEnv('LINEAR_TEAM_ID');
    validateLinearTeamId(linearTeamId);
    var minInterval = validatePollInterval(getRequiredEnv('POLL_MIN_INTERVAL_MINUTES'), 'POLL_MIN_INTERVAL_MINUTES');
    var maxInterval = validatePollInterval(getRequiredEnv('POLL_MAX_INTERVAL_MINUTES'), 'POLL_MAX_INTERVAL_MINUTES');
    validatePollIntervals(minInterval, maxInterval);
    return {
        github: {
            owner: getRequiredEnv('GITHUB_REPO_OWNER'),
            repo: getRequiredEnv('GITHUB_REPO_NAME'),
            token: githubToken,
            labels: labels,
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
