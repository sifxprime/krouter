import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "@/lib/dataDir";
import { getSettings } from "@/lib/localDb";

const DEFAULT_PASSWORD = "123456";

// JWT_SECRET signs dashboard sessions verbatim. kRouter's docs -- and upstream
// 9router's, which users migrate from -- have shown the placeholders below, and an
// old build hard-coded one as its fallback; anyone who pasted one had a key the
// internet knows, so a stranger could mint a valid session. Such a value, or any
// value under 32 characters, is ignored in favour of the generated secret.
const MIN_JWT_SECRET_LENGTH = 32;
const PLACEHOLDER_JWT_SECRETS = new Set([
  "...",
  "generate-a-long-random-string",
  "change-me-to-a-long-random-secret",
  "your-secure-secret-change-this-to-random-string",
  "your-secure-secret-change-this",
  "9router-default-secret-change-me",
  "votre-secret-sécurisé-changez-le",
  "tu-secreto-seguro-cámbialo",
  "your-secure-secret",
  "your-secret",
  "generated-secret-here",
]);

function jwtSecretProblem(value) {
  const v = value.trim().normalize("NFC");
  if (PLACEHOLDER_JWT_SECRETS.has(v.toLowerCase())) return "a documentation placeholder";
  if (v.length < MIN_JWT_SECRET_LENGTH) return `shorter than ${MIN_JWT_SECRET_LENGTH} characters`;
  return null;
}

function loadJwtSecret() {
  const configured = process.env.JWT_SECRET;
  const problem = configured ? jwtSecretProblem(configured) : null;
  if (configured && !problem) return configured;
  const file = path.join(DATA_DIR, "jwt-secret");
  const warnIgnored = (outcome) => {
    // Middleware and route bundles each load this module; say it once per process.
    if (!configured || globalThis.__krouterJwtSecretWarned) return;
    globalThis.__krouterJwtSecretWarned = true;
    console.warn(
      `[auth] Ignoring JWT_SECRET: it is ${problem}, so anyone could forge dashboard sessions. ${outcome} ` +
        "Sessions are no longer shared with other instances using that JWT_SECRET; to share them, set the same long random value on each (openssl rand -hex 32)."
    );
  };
  try {
    const saved = fs.readFileSync(file, "utf8").trim();
    warnIgnored(`Using the secret saved in ${file}.`);
    return saved;
  } catch {}
  warnIgnored(`Generated a new secret in ${file}; existing sessions must log in again.`);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const generated = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(file, generated, { mode: 0o600 });
  return generated;
}

const SECRET = new TextEncoder().encode(loadJwtSecret());

export function shouldUseSecureCookie(request) {
  const forceSecureCookie = process.env.AUTH_COOKIE_SECURE === "true";
  const forwardedProto = request?.headers?.get?.("x-forwarded-proto");
  const isHttpsRequest = forwardedProto === "https";
  return forceSecureCookie || isHttpsRequest;
}

export async function createDashboardAuthToken(claims = {}) {
  return new SignJWT({ authenticated: true, ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(SECRET);
}

export async function verifyDashboardAuthToken(token) {
  if (!token) return false;
  try {
    await jwtVerify(token, SECRET);
    return true;
  } catch {
    return false;
  }
}

export async function getDashboardAuthSession(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload;
  } catch {
    return null;
  }
}

export async function setDashboardAuthCookie(cookieStore, request, claims = {}) {
  const token = await createDashboardAuthToken(claims);
  cookieStore.set("auth_token", token, {
    httpOnly: true,
    secure: shouldUseSecureCookie(request),
    sameSite: "lax",
    path: "/",
  });
}

export function clearDashboardAuthCookie(cookieStore) {
  cookieStore.delete("auth_token");
}

// Verify the current dashboard password (re-auth for sensitive actions).
export async function verifyDashboardPassword(password) {
  if (typeof password !== "string" || !password) return false;
  const settings = await getSettings();
  const storedHash = settings?.password;
  if (storedHash) return bcrypt.compare(password, storedHash);
  const initialPassword = process.env.INITIAL_PASSWORD || DEFAULT_PASSWORD;
  return password === initialPassword;
}
