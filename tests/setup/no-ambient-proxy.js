// The suite must not inherit the developer's proxy environment.
//
// proxyFetch resolves an outbound proxy from HTTP_PROXY / HTTPS_PROXY /
// ALL_PROXY when the request carries none (getEnvProxyUrl). That is correct in
// production, and fatal for a test that asserts fail-closed behaviour: with any
// of those set, a strictProxy request HAS a resolved proxy, so proxyAwareFetch
// goes through it instead of refusing. tests/unit/strict-proxy-enforcement and
// tests/unit/strict-pool-blocks-chat-request turned red for exactly that reason
// on any machine running kRouter's own proxy capture mode, which exports
// HTTPS_PROXY=http://127.0.0.1:20128 into the shell — nine and two failures
// that were the shell's state, not the code's.
//
// NO_PROXY is scrubbed with them: left behind alone it would exempt hosts from
// a proxy the test configured itself.
//
// A test that wants one of these sets it in its own body (see
// tests/unit/security-audit.test.js, which asserts applyOutboundProxy writes
// them) — the scrub runs before each test, never during one.
import { beforeEach } from "vitest";

const PROXY_ENV_VARS = [
  "HTTP_PROXY", "http_proxy",
  "HTTPS_PROXY", "https_proxy",
  "ALL_PROXY", "all_proxy",
  "NO_PROXY", "no_proxy",
];

function scrubProxyEnv() {
  for (const name of PROXY_ENV_VARS) delete process.env[name];
}

// Once at file load, so a module that reads the environment at import time (the
// test files import the code under test at top level) sees it already clean.
scrubProxyEnv();

beforeEach(scrubProxyEnv);
