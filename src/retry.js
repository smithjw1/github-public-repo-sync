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
exports.retry = retry;
/**
 * Default retry configuration
 */
var DEFAULT_OPTIONS = {
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
};
/**
 * Checks if an error is retryable (transient errors)
 */
function isRetryableError(error) {
    // Network errors
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
        return true;
    }
    // HTTP status codes that are retryable
    if (error.status) {
        var status_1 = error.status;
        // 429 Too Many Requests, 403 Forbidden (rate limit), 500-599 Server Errors
        if (status_1 === 429 || status_1 === 403 || (status_1 >= 500 && status_1 < 600)) {
            return true;
        }
    }
    // GitHub/Linear API specific errors
    if (error.message) {
        var msg = error.message.toLowerCase();
        if (msg.includes('rate limit') ||
            msg.includes('timeout') ||
            msg.includes('temporarily unavailable') ||
            msg.includes('service unavailable')) {
            return true;
        }
    }
    return false;
}
/**
 * Extracts Retry-After value from error response
 * Returns delay in milliseconds, or null if not found
 */
function getRetryAfterMs(error) {
    var _a, _b, _c, _d, _e, _f;
    // Check for Retry-After header in various possible locations
    var retryAfter = ((_b = (_a = error.response) === null || _a === void 0 ? void 0 : _a.headers) === null || _b === void 0 ? void 0 : _b['retry-after']) ||
        ((_c = error.headers) === null || _c === void 0 ? void 0 : _c['retry-after']) ||
        ((_e = (_d = error.response) === null || _d === void 0 ? void 0 : _d.headers) === null || _e === void 0 ? void 0 : _e['Retry-After']) ||
        ((_f = error.headers) === null || _f === void 0 ? void 0 : _f['Retry-After']);
    if (!retryAfter) {
        return null;
    }
    // Retry-After can be either a number (seconds) or an HTTP date
    var parsed = parseInt(retryAfter, 10);
    if (!isNaN(parsed)) {
        return parsed * 1000; // Convert seconds to milliseconds
    }
    // Try parsing as date
    var retryDate = new Date(retryAfter);
    if (!isNaN(retryDate.getTime())) {
        return Math.max(0, retryDate.getTime() - Date.now());
    }
    return null;
}
/**
 * Delays execution for the specified milliseconds
 */
function delay(ms) {
    return new Promise(function (resolve) { return setTimeout(resolve, ms); });
}
/**
 * Retries an async operation with exponential backoff
 */
function retry(operation_1) {
    return __awaiter(this, arguments, void 0, function (operation, options) {
        var config, lastError, attempt, error_1, retryAfterMs, delayMs, errorMessage;
        if (options === void 0) { options = {}; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    config = __assign(__assign({}, DEFAULT_OPTIONS), options);
                    attempt = 1;
                    _a.label = 1;
                case 1:
                    if (!(attempt <= config.maxAttempts)) return [3 /*break*/, 7];
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 4, , 6]);
                    return [4 /*yield*/, operation()];
                case 3: return [2 /*return*/, _a.sent()];
                case 4:
                    error_1 = _a.sent();
                    lastError = error_1;
                    // Don't retry if it's not a retryable error
                    if (!isRetryableError(error_1)) {
                        throw error_1;
                    }
                    // Don't retry if this was the last attempt
                    if (attempt === config.maxAttempts) {
                        throw error_1;
                    }
                    retryAfterMs = getRetryAfterMs(error_1);
                    delayMs = void 0;
                    if (retryAfterMs !== null) {
                        // Respect Retry-After header, but cap at maxDelayMs
                        delayMs = Math.min(retryAfterMs, config.maxDelayMs);
                        console.warn("Rate limited (attempt ".concat(attempt, "/").concat(config.maxAttempts, "). Waiting ").concat(delayMs, "ms as requested by server..."));
                    }
                    else {
                        // Use exponential backoff
                        delayMs = Math.min(config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt - 1), config.maxDelayMs);
                        errorMessage = error_1 instanceof Error ? error_1.message : String(error_1);
                        console.warn("API call failed (attempt ".concat(attempt, "/").concat(config.maxAttempts, "), retrying in ").concat(delayMs, "ms..."), errorMessage);
                    }
                    return [4 /*yield*/, delay(delayMs)];
                case 5:
                    _a.sent();
                    return [3 /*break*/, 6];
                case 6:
                    attempt++;
                    return [3 /*break*/, 1];
                case 7: 
                // This should never be reached, but TypeScript needs it
                throw lastError;
            }
        });
    });
}
