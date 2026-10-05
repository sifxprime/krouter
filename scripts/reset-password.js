#!/usr/bin/env node
// Resets the dashboard password from the machine kRouter runs on -- including
// inside its Docker container, where the kRouter CLI is not installed:
//
//   docker exec krouter node scripts/reset-password.js
//
// It does what the CLI's "Reset Password to Default" does: POST the local-only
// /api/auth/reset-password route, which clears the stored password. That route
// also requires the CLI token, derived here exactly as getConsistentMachineId()
// in src/shared/utils/machineId.js does, from two files in the data directory
// (tests/unit/reset-password-script.test.js keeps the two in step). Afterwards
// the password is the INITIAL_PASSWORD kRouter was started with, else 123456,
// which is accepted only from the machine kRouter runs on.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const CLI_TOKEN_HEADER = "x-9r-cli-token";
const CLI_AUTH_SALT = "9r-cli-auth";

// Mirrors src/lib/dataDir.js: DATA_DIR if set (a Unix path is ignored on
// Windows), else ~/.krouter, or %APPDATA%\krouter on Windows.
function dataDir(env = process.env) {
  const configured = env.DATA_DIR;
  if (configured && !(process.platform === "win32" && configured.startsWith("/"))) return configured;
  if (process.platform === "win32") {
    return path.join(env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "krouter");
  }
  return path.join(os.homedir(), ".krouter");
}

function cliToken(dir) {
  const read = (file) => fs.readFileSync(path.join(dir, file), "utf8").trim();
  return crypto
    .createHash("sha256")
    .update(read("machine-id") + CLI_AUTH_SALT + read(path.join("auth", "cli-secret")))
    .digest("hex")
    .substring(0, 16);
}

// Mirrors src/lib/auth/initialPassword.js (checked by the unit test): values
// as public as 123456, which the login route treats exactly like it.
const PLACEHOLDER_INITIAL_PASSWORDS = Object.freeze([
  "123456",
  "change-me",
  "your-first-login-password",
  "...",
  "your-password",
  "your-secure-password",
  "votre-mot-de-passe",
  "tu-contraseña",
]);

function isPlaceholderInitialPassword(value) {
  return PLACEHOLDER_INITIAL_PASSWORDS.includes(String(value).trim().normalize("NFC").toLowerCase());
}

function inContainer() {
  return fs.existsSync("/.dockerenv") || fs.existsSync("/run/.containerenv");
}

// Where the server listens. Inside the container, docker exec inherits the
// server's own environment, so PORT and HOSTNAME are trustworthy. On a host they
// are just whatever the caller's shell holds -- and the CLI token must not go to
// some other program on that port -- so there only --port/--host count.
function target(argv = process.argv.slice(2), env = process.env, containerized = inContainer()) {
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const port = flag("--port") || (containerized && env.PORT) || "20128";
  let host = flag("--host") || (containerized && env.HOSTNAME) || "127.0.0.1";
  if (host === "0.0.0.0" || host === "::") host = "127.0.0.1";
  if (host.includes(":") && !host.startsWith("[")) host = `[${host}]`;
  return `http://${host}:${port}/api/auth/reset-password`;
}

function post(url, token) {
  return fetch(url, { method: "POST", headers: { [CLI_TOKEN_HEADER]: token } });
}

// null when the files do not exist yet: the server writes machine-id and
// auth/cli-secret lazily, the first time it checks a CLI token.
function readToken(dir) {
  try {
    return cliToken(dir);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    console.error(`Cannot read kRouter's CLI secret in ${dir} (${e.code || e.message}). Run this as the user kRouter runs as, or as root.`);
    process.exit(1);
  }
}

async function postOrExit(url, token) {
  try {
    return await post(url, token);
  } catch (e) {
    console.error(`kRouter is not answering on ${url} (${e.cause?.code || e.message}). Is it running? Pass --port/--host if it listens elsewhere.`);
    process.exit(1);
  }
}

function nextSteps(env = process.env, containerized = inContainer()) {
  const initial = env.INITIAL_PASSWORD;
  if (initial && !isPlaceholderInitialPassword(initial)) {
    return "Log in with the INITIAL_PASSWORD kRouter was started with, then set your own under Settings → Security.";
  }
  if (containerized) {
    return (
      "This container has no usable INITIAL_PASSWORD, and the default 123456 is refused for your browser " +
      "(it is never local to the container). Recreate the container with one -- your data is kept: " +
      "docker rm -f <container>, then the two docker run lines from the README."
    );
  }
  return "Log in with 123456 from this machine (it is refused from anywhere else), then set your own under Settings → Security.";
}

async function main() {
  const dir = dataDir();
  const url = target();
  let token = readToken(dir);
  if (!token) {
    // On an instance that has never seen a CLI request, one check makes the
    // server create the secret; it answers 403 to this probe by design.
    await postOrExit(url, "probe");
    token = readToken(dir);
  }
  if (!token) {
    console.error(`kRouter's CLI secret is not in ${dir}. Run this where kRouter runs; set DATA_DIR if it uses a custom data directory.`);
    process.exit(1);
  }
  const res = await postOrExit(url, token);
  if (!res.ok) {
    console.error(`Reset refused: HTTP ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  console.log(`Password reset. ${nextSteps()}`);
  console.log("If the login page still says to wait, that lockout ends on its own; restarting kRouter clears it at once.");
}

if (require.main === module) main();

module.exports = { dataDir, cliToken, target, nextSteps, PLACEHOLDER_INITIAL_PASSWORDS, CLI_TOKEN_HEADER, CLI_AUTH_SALT };
