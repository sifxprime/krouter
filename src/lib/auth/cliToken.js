import { timingSafeEqual } from "node:crypto";
import { getConsistentMachineId } from "@/shared/utils/machineId";

// The kRouter CLI proves it runs on this machine with a token derived from the
// machine id and a random secret in DATA_DIR (see getConsistentMachineId). Every
// check of it lives here: /api/settings/database once accepted any value at all.
export const CLI_TOKEN_HEADER = "x-9r-cli-token";
const CLI_TOKEN_SALT = "9r-cli-auth";

// Constant-time string compare. Length mismatch returns false without leaking
// per-byte info — we still run a same-length comparison against a dummy to
// keep the wall-clock timing identical to the equal-length path.
function safeEqString(a, b) {
  const ab = Buffer.from(typeof a === "string" ? a : "", "utf8");
  const bb = Buffer.from(typeof b === "string" ? b : "", "utf8");
  if (ab.length !== bb.length) {
    try { timingSafeEqual(ab, Buffer.alloc(ab.length)); } catch { /* ignore */ }
    return false;
  }
  return timingSafeEqual(ab, bb);
}

let cachedCliToken = null;
async function getCliToken() {
  if (!cachedCliToken) cachedCliToken = await getConsistentMachineId(CLI_TOKEN_SALT);
  return cachedCliToken;
}

export async function hasValidCliToken(request) {
  const token = request.headers.get(CLI_TOKEN_HEADER);
  if (!token) return false;
  return safeEqString(token, await getCliToken());
}
