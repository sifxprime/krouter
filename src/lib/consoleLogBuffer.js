import { EventEmitter } from "events";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config.js";

const consoleLevels = ["log", "info", "warn", "error", "debug"];

if (!global._consoleLogBufferState) {
  global._consoleLogBufferState = {
    logs: [],
    patched: false,
    originals: {},
    emitter: new EventEmitter(),
  };
  global._consoleLogBufferState.emitter.setMaxListeners(50);
}

const state = global._consoleLogBufferState;

// Ensure emitter exists (handles hot reload with stale global)
if (!state.emitter) {
  state.emitter = new EventEmitter();
  state.emitter.setMaxListeners(50);
}

function toLogLine(level, args) {
  return args.map(formatArg).join(" ");
}

// Strip ANSI escape codes so terminal colors don't bleed into UI
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(str) {
  return str.replace(ANSI_RE, "");
}

function formatArg(arg) {
  if (typeof arg === "string") return stripAnsi(arg);
  if (arg instanceof Error) return stripAnsi(arg.stack || arg.message || String(arg));
  try {
    return stripAnsi(JSON.stringify(arg));
  } catch {
    return stripAnsi(String(arg));
  }
}

// 0.5.32 — suppress Next.js HTTP access-log noise from the dashboard buffer.
//
// Next.js prints a `GET /path STATUS in Xms (next.js: ...)` line for every
// request. Most of those are the dashboard polling itself (api/settings every
// few seconds, api/version, api/auth/status, manifest.webmanifest, the SSE
// stream that delivers these very logs back to the UI, ...). At ~1-2 req/sec
// the buffer's maxLines cap evicts genuinely useful chat / auth / error
// traces before the user can read them.
//
// What this DOES filter (all "200 in ...ms" framework-emitted access lines):
//   GET /api/(version|settings|auth/status|keys|models/alias|providers
//             |mitm/cert|cli-tools/.*|translator/.*|usage/.*|notifications|me)
//   GET /manifest.webmanifest
//   GET /favicon.*
//   GET /dashboard/.* page-load lines
//
// What this PRESERVES (still captured):
//   - All [LEVEL] tagged lines: [AUTH], [ROUTING], [SESSION], [CACHE],
//     [PENDING], [REQUEST], [MITM], [ERROR], [WARN], [PASSTHROUGH], etc.
//   - Non-GET requests: POST /v1/chat/completions, /v1/messages, etc.
//   - HTTP 4xx / 5xx responses (signal for debugging)
//   - Next.js startup banner (one-time, useful)
//   - All Node-process console output (real chat handler logs)
const ACCESS_LOG_NOISE_RE = new RegExp([
  // " GET /path 2xx|3xx in Xms (next.js: ...)" pattern from Next.js dev server
  "^ ",                                              // Next.js prefixes a space
  "(GET|HEAD) ",                                     // poll methods only — POST etc preserved
  "/(api/(",
    "version",
    "|settings(/[\\w-]+)?",
    "|auth/status",
    "|keys",
    "|models/alias",
    "|providers",
    "|mitm/cert",
    "|cli-tools/[\\w-]+",
    "|translator/[\\w-]+(?:/stream)?",
    "|usage(/[\\w-]+)*",
    "|notifications",
    "|me",
  ")",
  "|manifest\\.webmanifest",
  "|favicon\\.[\\w]+",
  "|dashboard(/[\\w-]+)*",
  ")",
  " [23]\\d{2} in ",                                 // 2xx/3xx only; keep 4xx/5xx for debugging
].join(""));

function isAccessLogNoise(line) {
  // Defensive — only match the framework's specific access-log shape.
  if (typeof line !== "string" || line.length < 12) return false;
  if (line.startsWith("[")) return false; // [TIMESTAMP] or [LEVEL] lines never start with " GET "
  return ACCESS_LOG_NOISE_RE.test(line);
}

function appendLine(line) {
  if (isAccessLogNoise(line)) return; // drop dashboard polling noise
  state.logs.push(line);
  const maxLines = CONSOLE_LOG_CONFIG.maxLines;
  if (state.logs.length > maxLines) {
    state.logs = state.logs.slice(-maxLines);
  }
  state.emitter.emit("line", line);
}

// Exported so tests / dashboard "verbose mode" can flip if ever needed.
export { isAccessLogNoise };

export function initConsoleLogCapture() {
  if (state.patched) return;

  for (const level of consoleLevels) {
    state.originals[level] = console[level];
    console[level] = (...args) => {
      appendLine(toLogLine(level, args));
      state.originals[level](...args);
    };
  }

  state.patched = true;
}

export function getConsoleLogs() {
  return state.logs;
}

export function clearConsoleLogs() {
  state.logs = [];
  state.emitter.emit("clear");
}

export function getConsoleEmitter() {
  return state.emitter;
}
