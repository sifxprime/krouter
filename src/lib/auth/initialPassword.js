// INITIAL_PASSWORD values that kRouter's docs -- and upstream 9router's, which
// users migrate from -- have shown as examples. Set verbatim they are as public
// as the default "123456", so they get the default's rule: no remote login until
// a real password is stored. scripts/reset-password.js keeps a copy of this list
// (it runs outside the app); tests/unit/reset-password-script.test.js checks they match.
export const PLACEHOLDER_INITIAL_PASSWORDS = Object.freeze([
  "123456",
  "change-me",
  "your-first-login-password",
  "...",
  "your-password",
  "your-secure-password",
  "votre-mot-de-passe",
  "tu-contraseña",
]);
const PLACEHOLDERS = new Set(PLACEHOLDER_INITIAL_PASSWORDS);

export function isPlaceholderInitialPassword(value) {
  return typeof value === "string" && PLACEHOLDERS.has(value.trim().normalize("NFC").toLowerCase());
}
