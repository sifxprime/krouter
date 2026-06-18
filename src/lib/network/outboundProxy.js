function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

// Env-var aliases — KROUTER_* is the canonical name post-rebrand. NINE_ROUTER_*
// is kept for backward compatibility with users who set those vars before the
// rebrand. Dual-read on every check; dual-clear on disable; dual-write so an
// older managed env stays consistent.
//
// Reads: prefer KROUTER_* when both are set. NINE_ROUTER_* triggers a one-shot
// deprecation warning per process. Writes: both names get the same value so an
// external consumer (an existing shell hook, an IDE that reads NINE_ROUTER_*)
// keeps working.
let nineRouterWarned = false;
function warnLegacyNineRouterEnv(varName) {
  if (nineRouterWarned) return;
  nineRouterWarned = true;
  console.warn(
    `[outboundProxy] ${varName} is deprecated — set ${varName.replace("NINE_ROUTER_", "KROUTER_")} instead. ` +
    `Both names are honored for now; NINE_ROUTER_* will be removed in a future release.`
  );
}

function readDual(canonical, legacy) {
  const c = process.env[canonical];
  if (c !== undefined) return c;
  const l = process.env[legacy];
  if (l !== undefined) warnLegacyNineRouterEnv(legacy);
  return l;
}

function setDual(canonical, legacy, value) {
  process.env[canonical] = value;
  process.env[legacy] = value;
}

function deleteDual(canonical, legacy) {
  delete process.env[canonical];
  delete process.env[legacy];
}

export function applyOutboundProxyEnv(
  { outboundProxyEnabled, outboundProxyUrl, outboundNoProxy } = {}
) {
  if (typeof process === "undefined" || !process.env) return;
  const enabled = Boolean(outboundProxyEnabled);
  const proxyUrl = normalizeString(outboundProxyUrl);
  const noProxy = normalizeString(outboundNoProxy);

  // If disabled, only clear env vars we previously managed.
  if (!enabled) {
    if (readDual("KROUTER_PROXY_MANAGED", "NINE_ROUTER_PROXY_MANAGED") === "1") {
      delete process.env.HTTP_PROXY;
      delete process.env.HTTPS_PROXY;
      delete process.env.ALL_PROXY;
      delete process.env.NO_PROXY;
      deleteDual("KROUTER_PROXY_MANAGED", "NINE_ROUTER_PROXY_MANAGED");
      deleteDual("KROUTER_PROXY_URL", "NINE_ROUTER_PROXY_URL");
      deleteDual("KROUTER_NO_PROXY", "NINE_ROUTER_NO_PROXY");
    }
    return;
  }

  // When enabled:
  // - If values are provided, write them and mark as managed
  // - If values are empty, do not touch externally-provided env,
  //   but do clear values we previously managed.
  const wasManaged = readDual("KROUTER_PROXY_MANAGED", "NINE_ROUTER_PROXY_MANAGED") === "1";
  let managed = false;

  if (wasManaged) {
    if (!proxyUrl) {
      delete process.env.HTTP_PROXY;
      delete process.env.HTTPS_PROXY;
      delete process.env.ALL_PROXY;
      deleteDual("KROUTER_PROXY_URL", "NINE_ROUTER_PROXY_URL");
    }
    if (!noProxy) {
      delete process.env.NO_PROXY;
      deleteDual("KROUTER_NO_PROXY", "NINE_ROUTER_NO_PROXY");
    }
  }

  if (proxyUrl) {
    process.env.HTTP_PROXY = proxyUrl;
    process.env.HTTPS_PROXY = proxyUrl;
    process.env.ALL_PROXY = proxyUrl;
    setDual("KROUTER_PROXY_URL", "NINE_ROUTER_PROXY_URL", proxyUrl);
    managed = true;
  }

  if (noProxy) {
    process.env.NO_PROXY = noProxy;
    setDual("KROUTER_NO_PROXY", "NINE_ROUTER_NO_PROXY", noProxy);
    managed = true;
  }

  if (managed) {
    setDual("KROUTER_PROXY_MANAGED", "NINE_ROUTER_PROXY_MANAGED", "1");
  } else if (wasManaged) {
    // If we previously managed env but now cleared everything, drop the marker.
    deleteDual("KROUTER_PROXY_MANAGED", "NINE_ROUTER_PROXY_MANAGED");
  }
}
