// 0.5.85 — Provider Capability Manifest
//
// Single source of truth for what a provider CAN DO in the UI.
// Reads the 5 existing category maps (OAUTH_PROVIDERS, APIKEY_PROVIDERS,
// FREE_PROVIDERS, FREE_TIER_PROVIDERS, WEB_COOKIE_PROVIDERS) and exposes
// a unified, opinionated shape so the [id]/page.js shell doesn't need
// to know or branch on which map a provider lives in.
//
// The 5 legacy maps are kept intact — every existing consumer still works.
// New UI code imports getProviderCapabilities(id) instead.

import {
  OAUTH_PROVIDERS,
  APIKEY_PROVIDERS,
  FREE_PROVIDERS,
  FREE_TIER_PROVIDERS,
  WEB_COOKIE_PROVIDERS,
  isOpenAICompatibleProvider,
  isAnthropicCompatibleProvider,
} from "./providers.js";

/**
 * @typedef {"free" | "oauth" | "apikey" | "cookie" | "compatible"} AuthMode
 * @typedef {"free" | "freetier" | "oauth" | "paid" | "webcookie"} ProviderTier
 *
 * @typedef {Object} ProviderCapabilities
 * @property {string} id
 * @property {string} name
 * @property {string} [icon]              Material symbol name
 * @property {string} [image]             Path to provider logo
 * @property {string} [textIcon]          Fallback text badge (e.g. "OR")
 * @property {string} [color]             Brand color hex
 * @property {ProviderTier} tier          Which "family" this provider belongs to
 * @property {AuthMode[]} authModes       Ordered list of ways to connect (primary first)
 * @property {Object} links               URLs the hero / kits render
 * @property {string} [links.homepage]    Provider marketing site
 * @property {string} [links.docs]        API docs
 * @property {string} [links.apiKey]      Where to get an API key
 * @property {string} [links.signup]      Sign-up landing page
 * @property {string} [links.pricing]     Pricing page
 * @property {Object} features            Manifest-driven feature toggles
 * @property {boolean} features.autoPing  Show the auto-ping toggle
 * @property {boolean} features.bulkImport Show the bulk-import (Codex-style) modal
 * @property {boolean} features.compatibleModels Show the "compatible models" panel (OpenAI/Anthropic-shaped upstream)
 * @property {boolean} features.customModels     Show the "add custom model" flow
 * @property {boolean} features.passthroughModels Provider streams its live catalog
 * @property {boolean} features.hasRegions       Provider needs a region picker
 * @property {boolean} features.hasProviderSpecificData  Needs advanced provider-config panel
 * @property {string[]} serviceKinds      Kinds this provider serves (llm, image, tts, ...)
 * @property {Object} [thinking]          Thinking-mode config if any
 * @property {Object} notices             Text blurbs surfaced by the kits
 * @property {string} [notices.body]      Free-form marketing / usage note
 * @property {string} [notices.warning]   Warning / risk notice
 * @property {boolean} deprecated
 * @property {string[]} [regions]         Region picker options (e.g. Xiaomi Token Plan)
 * @property {string} [defaultRegion]
 * @property {boolean} [noAuth]           Provider needs no credential (opencode-free)
 */

// Which auth mode does a raw category-map entry map to?
function _deriveAuthMode(map, def) {
  if (map === FREE_PROVIDERS && def?.noAuth) return "free";
  if (map === FREE_PROVIDERS) return "oauth";  // legacy free-tier OAuth (kiro, qoder, gemini-cli)
  if (map === OAUTH_PROVIDERS) return "oauth";
  if (map === WEB_COOKIE_PROVIDERS) return "cookie";
  if (map === APIKEY_PROVIDERS && def?.noAuth) return "free";
  if (map === APIKEY_PROVIDERS) return "apikey";
  if (map === FREE_TIER_PROVIDERS) return "apikey"; // free-tier still needs a key
  return "apikey";
}

function _deriveTier(map, def) {
  if (map === FREE_PROVIDERS) return "free";
  if (map === FREE_TIER_PROVIDERS) return "freetier";
  if (map === OAUTH_PROVIDERS) return "oauth";
  if (map === WEB_COOKIE_PROVIDERS) return "webcookie";
  if (def?.noAuth) return "free";
  return "paid";
}

// Which map (of the 5) contains this id?
function _findMap(id) {
  if (OAUTH_PROVIDERS[id]) return OAUTH_PROVIDERS;
  if (APIKEY_PROVIDERS[id]) return APIKEY_PROVIDERS;
  if (FREE_PROVIDERS[id]) return FREE_PROVIDERS;
  if (FREE_TIER_PROVIDERS[id]) return FREE_TIER_PROVIDERS;
  if (WEB_COOKIE_PROVIDERS[id]) return WEB_COOKIE_PROVIDERS;
  return null;
}

/**
 * Return the capability manifest for a provider id.
 * Returns null if the id is unknown.
 * @param {string} id
 * @returns {ProviderCapabilities | null}
 */
export function getProviderCapabilities(id) {
  const map = _findMap(id);
  if (!map) return null;
  const def = map[id];

  // Primary auth mode from category map; secondary modes from explicit def.authModes.
  const primary = _deriveAuthMode(map, def);
  const secondary = Array.isArray(def.authModes) ? def.authModes.filter(m => m !== primary) : [];
  const authModes = [primary, ...secondary];

  // OpenAI/Anthropic-compatible providers get the "compatible" kit as a secondary mode.
  const isCompatible = isOpenAICompatibleProvider(id) || isAnthropicCompatibleProvider(id);
  if (isCompatible && !authModes.includes("compatible")) {
    authModes.push("compatible");
  }

  const notice = def.notice || {};

  return {
    id,
    name: def.name || id,
    icon: def.icon,
    image: def.image,
    textIcon: def.textIcon,
    color: def.color,
    tier: _deriveTier(map, def),
    authModes,
    links: {
      homepage: def.website,
      apiKey: notice.apiKeyUrl,
      signup: notice.signupUrl,
      pricing: def.searchViaChat?.pricingUrl,
      docs: def.docsUrl,
    },
    features: {
      // Manifest-driven feature toggles (replace hardcoded providerId === "..." branches)
      autoPing: id === "claude" && primary === "oauth",  // will move to def.features.autoPing over time
      bulkImport: id === "codex",                        // will move to def.features.bulkImport
      compatibleModels: isCompatible,
      customModels: !def.passthroughModels,
      passthroughModels: !!def.passthroughModels,
      hasRegions: Array.isArray(def.regions) && def.regions.length > 0,
      hasProviderSpecificData: !!def.hasProviderSpecificData,
    },
    serviceKinds: def.serviceKinds || ["llm"],
    thinking: def.thinkingConfig || null,
    notices: {
      body: notice.text,
      warning: def.deprecationNotice,
    },
    deprecated: !!def.deprecated,
    regions: def.regions,
    defaultRegion: def.defaultRegion,
    noAuth: !!def.noAuth,
    // Raw provider def kept for advanced consumers (e.g. modal fields).
    _raw: def,
  };
}

/**
 * List all providers as capability manifests (order not guaranteed).
 * @returns {ProviderCapabilities[]}
 */
export function listProviderCapabilities() {
  const ids = new Set([
    ...Object.keys(OAUTH_PROVIDERS),
    ...Object.keys(APIKEY_PROVIDERS),
    ...Object.keys(FREE_PROVIDERS),
    ...Object.keys(FREE_TIER_PROVIDERS),
    ...Object.keys(WEB_COOKIE_PROVIDERS),
  ]);
  return Array.from(ids).map(getProviderCapabilities).filter(Boolean);
}
