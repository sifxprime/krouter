function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

// Canonical kRouter proxy env vars. Two roles:
//   KROUTER_PROXY_MANAGED  marker so kRouter only clears env it wrote itself
//   KROUTER_PROXY_URL      mirror of HTTP_PROXY/HTTPS_PROXY/ALL_PROXY value
//   KROUTER_NO_PROXY       mirror of NO_PROXY value

// Security: URL scheme allowlist + control-char guard on outbound proxy value.
// Ported from upstream d8c2298d — blocks command-injection attempts via
// PROXY env-var expansion in downstream shells + rejects unsupported schemes
// that would silently fall back to unproxied traffic.
const ALLOWED_PROXY_SCHEMES = ["http:", "https:", "socks5:", "socks4:", "socks5h:", "socks4a:"];

function validateProxyUrl(url) {
  if (!url) return null;
  if (/[\n\r`$]/.test(url)) return null;
  try {
    const parsed = new URL(url);
    if (!ALLOWED_PROXY_SCHEMES.includes(parsed.protocol)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function applyOutboundProxyEnv(
  { outboundProxyEnabled, outboundProxyUrl, outboundNoProxy } = {}
) {
  if (typeof process === "undefined" || !process.env) return;
  const enabled = Boolean(outboundProxyEnabled);
  const proxyUrl = normalizeString(outboundProxyUrl);
  const noProxy = normalizeString(outboundNoProxy);

  // Disabled: only clear env we previously managed.
  if (!enabled) {
    if (process.env.KROUTER_PROXY_MANAGED === "1") {
      delete process.env.HTTP_PROXY;
      delete process.env.HTTPS_PROXY;
      delete process.env.ALL_PROXY;
      delete process.env.NO_PROXY;
      delete process.env.KROUTER_PROXY_MANAGED;
      delete process.env.KROUTER_PROXY_URL;
      delete process.env.KROUTER_NO_PROXY;
    }
    return;
  }

  // Enabled: write values if provided, clear stale managed entries otherwise.
  const wasManaged = process.env.KROUTER_PROXY_MANAGED === "1";
  let managed = false;

  if (wasManaged) {
    if (!proxyUrl) {
      delete process.env.HTTP_PROXY;
      delete process.env.HTTPS_PROXY;
      delete process.env.ALL_PROXY;
      delete process.env.KROUTER_PROXY_URL;
    }
    if (!noProxy) {
      delete process.env.NO_PROXY;
      delete process.env.KROUTER_NO_PROXY;
    }
  }

  if (proxyUrl) {
    // 0.5.95 — validate scheme + reject control-char injection before writing to env
    const validated = validateProxyUrl(proxyUrl);
    if (validated) {
      process.env.HTTP_PROXY = validated;
      process.env.HTTPS_PROXY = validated;
      process.env.ALL_PROXY = validated;
      process.env.KROUTER_PROXY_URL = validated;
      managed = true;
    }
  }

  if (noProxy) {
    process.env.NO_PROXY = noProxy;
    process.env.KROUTER_NO_PROXY = noProxy;
    managed = true;
  }

  if (managed) {
    process.env.KROUTER_PROXY_MANAGED = "1";
  } else if (wasManaged) {
    delete process.env.KROUTER_PROXY_MANAGED;
  }
}
