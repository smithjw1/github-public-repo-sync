"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * One-off script: finds and removes duplicate Linear issues from triage.
 *
 * A triage issue is considered a duplicate if:
 * 1. It has the same GitHub issue number as a synced issue (with gh-rtc-sync label)
 * 2. It is in "Canceled" state AND has the same GitHub issue number as ANY other issue
 *
 * Usage: npx tsx src/cleanup-duplicates.ts
 */
var readline_1 = require("readline");
var config_js_1 = require("./config.js");
var sdk_1 = require("@linear/sdk");
var retry_js_1 = require("./retry.js");
function prompt(question) {
    var rl = (0, readline_1.createInterface)({ input: process.stdin, output: process.stdout });
    return new Promise(function (resolve) {
        rl.question(question, function (answer) {
            rl.close();
            resolve(answer);
        });
    });
}
/**
 * Parses GitHub issue number from Linear issue description
 */
function parseGitHubIssueNumber(description) {
    if (!description)
        return undefined;
    var match = description.match(/\*\*GitHub (?:Issue|URL):\*\*\s*(?:#(\d+)|https?:\/\/[^\s]+\/issues\/(\d+))/);
    var issueNum = (match === null || match === void 0 ? void 0 : match[1]) || (match === null || match === void 0 ? void 0 : match[2]);
    return issueNum ? parseInt(issueNum, 10) : undefined;
}
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var config, client, _a, teamId, syncLabel, labelResult, syncLabelObj, allIssues, hasNextPage, cursor, page, _i, _b, issue, state, labels, isSynced, syncedIssues, triageIssues, githubNumberToSyncedIssue, _c, syncedIssues_1, issue, githubNumberToAllIssues, _d, allIssues_1, issue, existing, toDelete, _loop_1, _e, triageIssues_1, triageIssue, _f, toDelete_1, _g, issue, reason, duplicateOf, answer, deletedCount, _loop_2, _h, toDelete_2, issue;
        var _j, _k;
        return __generator(this, function (_l) {
            switch (_l.label) {
                case 0:
                    config = (0, config_js_1.loadConfig)();
                    client = new sdk_1.LinearClient({ apiKey: config.linear.apiKey });
                    _a = config.linear, teamId = _a.teamId, syncLabel = _a.syncLabel;
                    console.log('GitHub to Linear Duplicate Cleanup');
                    console.log('='.repeat(80));
                    console.log("Team ID: ".concat(teamId));
                    console.log("Sync Label: ".concat(syncLabel));
                    console.log('='.repeat(80));
                    // Step 1: Fetch the sync label ID
                    console.log('\nFetching sync label...');
                    return [4 /*yield*/, (0, retry_js_1.retry)(function () {
                            return client.issueLabels({
                                filter: {
                                    team: { id: { eq: teamId } },
                                    name: { eq: syncLabel },
                                },
                            });
                        })];
                case 1:
                    labelResult = _l.sent();
                    syncLabelObj = labelResult.nodes[0];
                    if (!syncLabelObj) {
                        console.log("No issues found with sync label \"".concat(syncLabel, "\". Nothing to clean up."));
                        return [2 /*return*/];
                    }
                    console.log("Found sync label: ".concat(syncLabelObj.name, " (").concat(syncLabelObj.id, ")"));
                    // Step 2: Fetch all issues in the team (both synced and non-synced)
                    console.log('\nFetching all issues in team...');
                    allIssues = [];
                    hasNextPage = true;
                    _l.label = 2;
                case 2:
                    if (!hasNextPage) return [3 /*break*/, 9];
                    return [4 /*yield*/, (0, retry_js_1.retry)(function () {
                            return client.issues(__assign({ filter: {
                                    team: { id: { eq: teamId } },
                                }, first: 100 }, (cursor ? { after: cursor } : {})));
                        })];
                case 3:
                    page = _l.sent();
                    _i = 0, _b = page.nodes;
                    _l.label = 4;
                case 4:
                    if (!(_i < _b.length)) return [3 /*break*/, 8];
                    issue = _b[_i];
                    return [4 /*yield*/, issue.state];
                case 5:
                    state = _l.sent();
                    return [4 /*yield*/, issue.labels()];
                case 6:
                    labels = _l.sent();
                    isSynced = labels.nodes.some(function (label) { return label.id === syncLabelObj.id; });
                    allIssues.push({
                        id: issue.id,
                        identifier: issue.identifier,
                        title: issue.title,
                        description: (_j = issue.description) !== null && _j !== void 0 ? _j : null,
                        githubIssueNumber: parseGitHubIssueNumber((_k = issue.description) !== null && _k !== void 0 ? _k : null),
                        isSynced: isSynced,
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
                    _l.label = 7;
                case 7:
                    _i++;
                    return [3 /*break*/, 4];
                case 8:
                    hasNextPage = page.pageInfo.hasNextPage;
                    cursor = page.pageInfo.endCursor;
                    return [3 /*break*/, 2];
                case 9:
                    console.log("Found ".concat(allIssues.length, " total issue(s) in team"));
                    syncedIssues = allIssues.filter(function (issue) { return issue.isSynced; });
                    triageIssues = allIssues.filter(function (issue) { return !issue.isSynced; });
                    console.log("  - ".concat(syncedIssues.length, " synced issue(s) (with \"").concat(syncLabel, "\" label)"));
                    console.log("  - ".concat(triageIssues.length, " triage issue(s) (without sync label)"));
                    githubNumberToSyncedIssue = new Map();
                    for (_c = 0, syncedIssues_1 = syncedIssues; _c < syncedIssues_1.length; _c++) {
                        issue = syncedIssues_1[_c];
                        if (issue.githubIssueNumber !== undefined) {
                            githubNumberToSyncedIssue.set(issue.githubIssueNumber, issue);
                        }
                    }
                    githubNumberToAllIssues = new Map();
                    for (_d = 0, allIssues_1 = allIssues; _d < allIssues_1.length; _d++) {
                        issue = allIssues_1[_d];
                        if (issue.githubIssueNumber !== undefined) {
                            existing = githubNumberToAllIssues.get(issue.githubIssueNumber) || [];
                            existing.push(issue);
                            githubNumberToAllIssues.set(issue.githubIssueNumber, existing);
                        }
                    }
                    toDelete = [];
                    _loop_1 = function (triageIssue) {
                        // Check if it has a GitHub issue number
                        if (triageIssue.githubIssueNumber === undefined) {
                            return "continue";
                        }
                        // Case 1: Triage issue duplicates a synced issue
                        var syncedDuplicate = githubNumberToSyncedIssue.get(triageIssue.githubIssueNumber);
                        if (syncedDuplicate) {
                            toDelete.push({
                                issue: triageIssue,
                                reason: 'Duplicates synced issue',
                                duplicateOf: syncedDuplicate.identifier,
                            });
                            return "continue";
                        }
                        // Case 2: Triage issue is canceled AND has duplicates (any state)
                        if (triageIssue.state.type === 'canceled') {
                            var allWithSameGH = githubNumberToAllIssues.get(triageIssue.githubIssueNumber) || [];
                            var otherIssues = allWithSameGH.filter(function (i) { return i.id !== triageIssue.id; });
                            if (otherIssues.length > 0) {
                                toDelete.push({
                                    issue: triageIssue,
                                    reason: 'Canceled issue with duplicates',
                                    duplicateOf: otherIssues.map(function (i) { return i.identifier; }).join(', '),
                                });
                            }
                        }
                    };
                    for (_e = 0, triageIssues_1 = triageIssues; _e < triageIssues_1.length; _e++) {
                        triageIssue = triageIssues_1[_e];
                        _loop_1(triageIssue);
                    }
                    // Step 5: Display results and confirm
                    if (toDelete.length === 0) {
                        console.log('\n✓ No duplicates found. Nothing to delete.');
                        return [2 /*return*/];
                    }
                    console.log("\n\u26A0\uFE0F  Found ".concat(toDelete.length, " duplicate issue(s) to delete:\n"));
                    for (_f = 0, toDelete_1 = toDelete; _f < toDelete_1.length; _f++) {
                        _g = toDelete_1[_f], issue = _g.issue, reason = _g.reason, duplicateOf = _g.duplicateOf;
                        console.log("  ".concat(issue.identifier, " - ").concat(issue.title));
                        console.log("    GitHub Issue: #".concat(issue.githubIssueNumber));
                        console.log("    State: ".concat(issue.state.name));
                        console.log("    Reason: ".concat(reason, " (").concat(duplicateOf, ")"));
                        console.log();
                    }
                    return [4 /*yield*/, prompt("Delete all ".concat(toDelete.length, " duplicate issue(s)? (y/n) "))];
                case 10:
                    answer = _l.sent();
                    if (answer.toLowerCase() !== 'y') {
                        console.log('Aborted.');
                        return [2 /*return*/];
                    }
                    // Step 6: Delete the duplicates
                    console.log('\nDeleting duplicates...');
                    deletedCount = 0;
                    _loop_2 = function (issue) {
                        var error_1;
                        return __generator(this, function (_m) {
                            switch (_m.label) {
                                case 0:
                                    _m.trys.push([0, 2, , 3]);
                                    return [4 /*yield*/, (0, retry_js_1.retry)(function () { return client.deleteIssue(issue.id); })];
                                case 1:
                                    _m.sent();
                                    console.log("  \u2713 Deleted ".concat(issue.identifier));
                                    deletedCount++;
                                    return [3 /*break*/, 3];
                                case 2:
                                    error_1 = _m.sent();
                                    console.error("  \u2717 Failed to delete ".concat(issue.identifier, ":"), error_1);
                                    return [3 /*break*/, 3];
                                case 3: return [2 /*return*/];
                            }
                        });
                    };
                    _h = 0, toDelete_2 = toDelete;
                    _l.label = 11;
                case 11:
                    if (!(_h < toDelete_2.length)) return [3 /*break*/, 14];
                    issue = toDelete_2[_h].issue;
                    return [5 /*yield**/, _loop_2(issue)];
                case 12:
                    _l.sent();
                    _l.label = 13;
                case 13:
                    _h++;
                    return [3 /*break*/, 11];
                case 14:
                    console.log("\n\u2713 Done. ".concat(deletedCount, "/").concat(toDelete.length, " duplicate issue(s) removed."));
                    return [2 /*return*/];
            }
        });
    });
}
main().catch(function (error) {
    console.error('Error:', error);
    process.exit(1);
});
