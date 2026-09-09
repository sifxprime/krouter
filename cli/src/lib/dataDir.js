"use strict";

/**
 * Where the CLI keeps its data. One definition for the whole published package.
 *
 * This exists because there were three hand-synced copies of this logic, each
 * carrying a "kept in sync with..." comment, and one of them had drifted:
 * cli.js resolved `~/.krouter` unconditionally and ignored DATA_DIR entirely.
 * That is a documented setting (README: "DATA_DIR | ~/.krouter | Data directory
 * (SQLite, certs, cache)") and ARCHITECTURE.md promises db.json lives at
 * `${DATA_DIR}/db.json`, so anyone who set it -- Docker users, mainly -- got a
 * split brain: auth and machine-id read from DATA_DIR, while db.json, the
 * tunnel directory and the mitm pidfile read from the home directory.
 *
 * The worst of it was silent. cli.js disables MITM in DATA_DIR/db.json to break
 * a crash loop; looking in the wrong place made existsSync false, the
 * best-effort catch swallowed it, and the server kept crash-looping with the
 * safety valve doing nothing.
 *
 * Mirrors the app's own src/lib/dataDir.js. It cannot import it: that module is
 * ESM and lives outside this package's `files`, so the published CLI has no
 * access to it. Keep the two in step.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const APP_NAME = "krouter";

/** The platform default, used when DATA_DIR is unset or unusable. */
function appDir() {
  if (process.platform === "win32") {
    // Falling back to "" here would yield a *relative* path, which is how the
    // previous cli.js copy could end up writing into the current directory.
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
      APP_NAME
    );
  }
  return path.join(os.homedir(), `.${APP_NAME}`);
}

/**
 * Resolve the data directory, honouring DATA_DIR.
 *
 * Creating the directory is deliberate and matches the app: callers immediately
 * join subpaths onto the result, so a configured-but-absent directory would
 * otherwise fail at the first write rather than here.
 */
function getDataDir() {
  const configured = process.env.DATA_DIR;
  if (!configured) return appDir();

  // A Unix path on Windows almost always means a Linux-targeted .env or Docker
  // config leaked into a Windows run. Honouring it would write somewhere the
  // user never intended.
  if (process.platform === "win32" && /^\//.test(configured)) {
    console.warn(`[DATA_DIR] '${configured}' is a Unix path on Windows - falling back to the default`);
    return appDir();
  }

  try {
    fs.mkdirSync(configured, { recursive: true });
    return configured;
  } catch (e) {
    if (e && (e.code === "EACCES" || e.code === "EPERM")) {
      console.warn(`[DATA_DIR] '${configured}' is not writable - falling back to ~/.${APP_NAME}`);
      return appDir();
    }
    throw e;
  }
}

module.exports = { getDataDir, appDir, APP_NAME };
