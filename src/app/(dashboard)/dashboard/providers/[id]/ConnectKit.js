"use client";

// 0.5.85 — ConnectKit: per-auth-mode "how do I add a connection?" card.
//
// Replaces the empty-state block that used to branch with:
//   if (isOAuth) { ...OAuth button... }
//   else if (isCompatible) { ...Add API Key... }
//   else if (providerId === "iflow") { ...Cookie... }
//   else if (providerId === "codex") { ...Bulk Add... }
//   else { ...Add Connection... }
//
// Now: the manifest declares authModes; the parent renders a tab strip if
// there's more than one; each tab shows its own kit with UI tailored to the
// mental model of that auth flow.
//
// Kits do not implement the flows themselves — they invoke callbacks
// (onOAuth, onApiKey, onBulkImport, onCookie, onCompatible) which the parent
// page.js has already wired to the existing modals / OAuth callback runner.
// This keeps the change purely visual + structural, not behavioural.

import { useState } from "react";
import PropTypes from "prop-types";
import { Button } from "@/shared/components";

const MODE_META = {
  oauth:      { icon: "lock",            label: "Sign in with OAuth",  tabLabel: "OAuth" },
  apikey:     { icon: "key",             label: "Add API key",         tabLabel: "API key" },
  free:       { icon: "bolt",            label: "Connect for free",    tabLabel: "Free" },
  cookie:     { icon: "cookie",          label: "Paste session cookie", tabLabel: "Cookie" },
  compatible: { icon: "developer_board", label: "Configure endpoint",  tabLabel: "Compatible" },
};

// ─────────────────────────────────────────────────────────────────────────
// Per-mode kits — each is a single visually-distinct card.
// All reuse existing Tailwind tokens (bg-sidebar, border-border, text-text-*).
// ─────────────────────────────────────────────────────────────────────────

function KitFrame({ children, accentColor }) {
  return (
    <div
      className="rounded-xl border p-5 sm:p-6"
      style={{
        borderColor: accentColor ? `${accentColor}25` : undefined,
        background: accentColor ? `linear-gradient(160deg, ${accentColor}08, transparent 70%)` : undefined,
      }}
    >
      {children}
    </div>
  );
}

function OAuthKit({ capabilities: c, onOAuth, onBulkImport }) {
  return (
    <KitFrame accentColor={c.color}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">Sign in with {c.name}</h3>
          <p className="mt-0.5 text-sm text-text-muted">
            One click. We handle the OAuth callback and store your session locally.
            You can add multiple accounts.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 sm:flex-nowrap">
          {c.features.bulkImport && onBulkImport && (
            <Button size="md" icon="playlist_add" variant="secondary" onClick={onBulkImport}>
              Bulk import
            </Button>
          )}
          <Button size="md" icon="lock" onClick={onOAuth}>
            Sign in with {c.name}
          </Button>
        </div>
      </div>
    </KitFrame>
  );
}

function ApiKeyKit({ capabilities: c, onApiKey }) {
  return (
    <KitFrame accentColor={c.color}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold">Paste your {c.name} API key</h3>
          <p className="mt-0.5 text-sm text-text-muted">
            {c.links.apiKey ? (
              <>
                Grab a key from{" "}
                <a
                  href={c.links.apiKey}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary"
                >
                  {new URL(c.links.apiKey).hostname}
                </a>
                {" "}and paste it in.
              </>
            ) : (
              <>Paste your API key to connect.</>
            )}
            {" "}Stored locally, never sent anywhere except {c.name}.
          </p>
        </div>
        <Button size="md" icon="key" onClick={onApiKey}>
          Add API key
        </Button>
      </div>
    </KitFrame>
  );
}

function FreeKit({ capabilities: c, onFree }) {
  return (
    <KitFrame accentColor={c.color || "#10B981"}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-green-500">bolt</span>
            <h3 className="text-base font-semibold">{c.name} is free — one click to connect</h3>
          </div>
          <p className="text-sm text-text-muted">
            No key, no signup, no card. Just click connect and start using it.
          </p>
        </div>
        <Button size="md" icon="add" onClick={onFree}>
          Connect
        </Button>
      </div>
    </KitFrame>
  );
}

function CookieKit({ capabilities: c, onCookie }) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  return (
    <KitFrame accentColor={c.color || "#F59E0B"}>
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold">Advanced: connect with session cookie</h3>
            <p className="mt-0.5 text-sm text-text-muted">
              For power users. Extract the {c.name} cookie from your browser and paste it here.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-xs text-text-muted hover:text-primary"
          >
            {showAdvanced ? "hide" : "show"}
          </button>
        </div>
        {showAdvanced && (
          <div className="rounded-lg border border-border bg-bg/70 p-3">
            <ol className="mb-3 list-decimal space-y-1 pl-4 text-xs text-text-muted">
              <li>Open {c.name} in your browser and sign in.</li>
              <li>Open DevTools → Application → Cookies.</li>
              <li>Copy the session cookie value.</li>
              <li>Paste it in the modal.</li>
            </ol>
            <Button size="sm" icon="cookie" onClick={onCookie}>
              Paste cookie
            </Button>
          </div>
        )}
      </div>
    </KitFrame>
  );
}

function CompatibleKit({ capabilities: c, onCompatible }) {
  return (
    <KitFrame accentColor={c.color}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">Use as OpenAI-compatible endpoint</h3>
          <p className="mt-0.5 text-sm text-text-muted">
            Point at any OpenAI-shaped base URL (self-hosted, LiteLLM, custom proxy).
            Fetches the live model list after you connect.
          </p>
        </div>
        <Button size="md" icon="developer_board" onClick={onCompatible}>
          Configure endpoint
        </Button>
      </div>
    </KitFrame>
  );
}

const KITS = {
  oauth: OAuthKit,
  apikey: ApiKeyKit,
  free: FreeKit,
  cookie: CookieKit,
  compatible: CompatibleKit,
};

// ─────────────────────────────────────────────────────────────────────────
// Dispatcher — renders tab strip when multiple modes, then the active kit.
// ─────────────────────────────────────────────────────────────────────────

export default function ConnectKit({ capabilities, onOAuth, onApiKey, onFree, onCookie, onCompatible, onBulkImport }) {
  const modes = capabilities?.authModes || [];
  const [activeMode, setActiveMode] = useState(modes[0] || "apikey");

  if (!capabilities || modes.length === 0) return null;

  const ActiveKit = KITS[activeMode] || KITS.apikey;
  const showTabs = modes.length > 1;

  const handlers = { onOAuth, onApiKey, onFree, onCookie, onCompatible, onBulkImport };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {showTabs && (
        <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-sidebar/40 p-1">
          {modes.map((mode) => {
            const meta = MODE_META[mode] || { icon: "add", tabLabel: mode };
            const active = mode === activeMode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => setActiveMode(mode)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "bg-bg text-text-main shadow-sm"
                    : "text-text-muted hover:text-text-main"
                }`}
              >
                <span className="material-symbols-outlined text-sm">{meta.icon}</span>
                {meta.tabLabel}
              </button>
            );
          })}
        </div>
      )}
      <ActiveKit capabilities={capabilities} {...handlers} />
    </div>
  );
}

ConnectKit.propTypes = {
  capabilities: PropTypes.object,
  onOAuth: PropTypes.func,
  onApiKey: PropTypes.func,
  onFree: PropTypes.func,
  onCookie: PropTypes.func,
  onCompatible: PropTypes.func,
  onBulkImport: PropTypes.func,
};
