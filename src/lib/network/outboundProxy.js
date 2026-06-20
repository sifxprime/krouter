function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

// Canonical kRouter proxy env vars. Two roles:
//   KROUTER_PROXY_MANAGED  marker so kRouter only clears env it wrote itself
//   KROUTER_PROXY_URL      mirror of HTTP_PROXY/HTTPS_PROXY/ALL_PROXY value
//   KROUTER_NO_PROXY       mirror of NO_PROXY value
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
    process.env.HTTP_PROXY = proxyUrl;
    process.env.HTTPS_PROXY = proxyUrl;
    process.env.ALL_PROXY = proxyUrl;
    process.env.KROUTER_PROXY_URL = proxyUrl;
    managed = true;
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
