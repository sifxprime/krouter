// antigravityIdentity (0.5.29) — port of OmniRoute's antigravityIdentity.
//
// Stable per-account identity values so each Antigravity account looks
// internally consistent across requests (same session id, same UA family),
// while DIFFERENT accounts present distinct fingerprints to Google.
//
// Why this matters: Google's anti-abuse system links accounts that share
// session ids or rotate UA strings randomly. Deriving a stable session id
// from the account's email/connectionId makes one account look like one
// persistent human user, and different accounts look like distinct ones.

import crypto from "node:crypto";

const FNV_OFFSET_I64 = -3750763034362895579n;
const FNV_PRIME_I64 = 1099511628211n;
const PROCESS_SESSION_ID = crypto.randomUUID();

function toNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function getProviderDataString(credentials, key) {
  const data = credentials?.providerSpecificData;
  return data && typeof data === "object" ? toNonEmptyString(data[key]) : null;
}

// Pick the most stable key we can find for this account.
// Email is most stable (survives oauth refresh). Falls back to connectionId.
export function getAntigravityAccountKey(credentials) {
  return (
    toNonEmptyString(credentials?.email) ||
    getProviderDataString(credentials, "email") ||
    getProviderDataString(credentials, "accountId") ||
    toNonEmptyString(credentials?.connectionId) ||
    null
  );
}

// Enterprise accounts (Google Workspace) get a different UA family.
// Gmail/googlemail.com domains are consumer; everything else is enterprise.
export function isAntigravityEnterpriseAccount(credentials) {
  const email =
    toNonEmptyString(credentials?.email) ||
    getProviderDataString(credentials, "email") ||
    "";
  return !!email && !/@(?:gmail|googlemail)\.com$/i.test(email);
}

// Pick the upstream user-agent envelope based on account type.
// "antigravity" for consumer accounts, "jetski" for enterprise.
export function getAntigravityEnvelopeUserAgent(credentials) {
  return isAntigravityEnterpriseAccount(credentials) ? "jetski" : "antigravity";
}

// One unique request id per call. Format mirrors Antigravity's native client.
export function generateAntigravityRequestId() {
  return `agent/${Date.now()}/${crypto.randomBytes(4).toString("hex")}`;
}

// Random session id when we can't derive a stable one. 18-digit signed int
// matching the Antigravity native format ("-1234567890123456789").
export function generateAntigravitySessionId() {
  const max = 18446744073709551615n; // 2^64 - 1
  const target = 9_000_000_000_000_000_000n;
  const limit = max - (max % target);
  let value;
  do {
    value = crypto.randomBytes(8).readBigUInt64BE();
  } while (value >= limit);
  return `-${(value % target).toString()}`;
}

// Derive a stable session id from the account key using FNV-1a-64.
// Same email → same session id across the process lifetime.
// Different emails → different session ids.
export function deriveAntigravitySessionId(accountKey) {
  const key = toNonEmptyString(accountKey);
  if (!key) return null;
  let hash = FNV_OFFSET_I64;
  for (const byte of Buffer.from(key, "utf8")) {
    hash = BigInt.asIntN(64, hash ^ BigInt(byte));
    hash = BigInt.asIntN(64, hash * FNV_PRIME_I64);
  }
  return hash.toString();
}

// Resolve the session id: prefer derived (stable), fall back to provided
// fallback, last resort generate a fresh random one.
export function getAntigravitySessionId(credentials, fallback) {
  return (
    deriveAntigravitySessionId(getAntigravityAccountKey(credentials)) ||
    toNonEmptyString(fallback) ||
    generateAntigravitySessionId()
  );
}

// Single VS Code session id for the entire krouter process. Mirrors how
// the real Antigravity extension uses one VS Code instance id.
export function getAntigravityVscodeSessionId() {
  return PROCESS_SESSION_ID;
}
