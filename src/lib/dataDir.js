import fs from "node:fs";
import path from "path";
import os from "os";

const APP_NAME = "krouter";
const LEGACY_APP_NAME = "9router";

function appNameDir(name) {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), name);
  }
  return path.join(os.homedir(), `.${name}`);
}

// Warn once per process when both ~/.krouter and ~/.9router co-exist after
// migration. This happens if the user runs a pre-rename build mid-session,
// then upgrades — the auto-migration only fires when target is absent, so
// two parallel data dirs persist forever with no signal. Don't auto-delete
// (user data); just surface the situation so they can manually reconcile.
let legacyCoexistWarned = false;
function warnLegacyCoexistence(target, legacy) {
  if (legacyCoexistWarned) return;
  legacyCoexistWarned = true;
  console.warn(
    `[dataDir] Legacy ${legacy} still exists alongside ${target}. ` +
    `New writes go to ${target}; the legacy directory is not read. ` +
    `If you have unmerged settings in ${legacy}, back it up and merge manually, ` +
    `then remove it: rm -rf ${legacy}`
  );
}

function defaultDir() {
  const target = appNameDir(APP_NAME);
  const legacy = appNameDir(LEGACY_APP_NAME);
  // One-time auto-migration of legacy ~/.9router → ~/.krouter. Idempotent.
  try {
    if (!fs.existsSync(target) && fs.existsSync(legacy)) {
      fs.renameSync(legacy, target);
      console.log(`[dataDir] Migrated data dir: ${legacy} → ${target}`);
    } else if (fs.existsSync(target) && fs.existsSync(legacy)) {
      // Both exist — auto-migration won't fire. Surface this so user can decide.
      warnLegacyCoexistence(target, legacy);
    }
  } catch (e) {
    console.warn(`[dataDir] Auto-migration of ${legacy} → ${target} failed (${e.code || e.message}); continuing with ${target}`);
  }
  return target;
}

export function getDataDir() {
  const configured = process.env.DATA_DIR;
  if (!configured) return defaultDir();

  // On Windows, ignore Unix-style absolute paths (e.g. /var/lib/...) that come
  // from a Linux-targeted .env or Docker config — they are not valid here.
  if (process.platform === "win32" && /^\//.test(configured)) {
    console.warn(`[DATA_DIR] '${configured}' is a Unix path on Windows → fallback to default`);
    return defaultDir();
  }

  try {
    fs.mkdirSync(configured, { recursive: true });
    return configured;
  } catch (e) {
    if (e?.code === "EACCES" || e?.code === "EPERM") {
      console.warn(`[DATA_DIR] '${configured}' not writable → fallback ~/.${APP_NAME}`);
      return defaultDir();
    }
    throw e;
  }
}

export const DATA_DIR = getDataDir();
