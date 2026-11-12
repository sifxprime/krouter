"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import Icon from "@/shared/components/icons/Icon";

/**
 * The commands that point a client at this router.
 *
 * The page gave you a URL and left you to work out what to do with it. These
 * are the three shapes that actually exist: Anthropic-style env vars, the
 * OpenAI-compatible pair, and a request you can paste to prove the thing
 * answers.
 *
 * Tools that kRouter captures rather than configures — Kiro, Antigravity,
 * Claude Desktop — are deliberately not tabs here. They do not take a base
 * URL; they are intercepted. Printing an `export` line for them would be a
 * command that looks right and does nothing, so they get a link to the page
 * that actually sets them up.
 */

const TOOLS = [
  { id: "claude", label: "Claude Code", baseVar: "ANTHROPIC_BASE_URL", keyVar: "ANTHROPIC_AUTH_TOKEN" },
  { id: "openai", label: "OpenAI-compatible", baseVar: "OPENAI_BASE_URL", keyVar: "OPENAI_API_KEY" },
  { id: "curl", label: "cURL" },
];

const KEY_PLACEHOLDER = "<your-krouter-key>";

function buildSnippet(tool, baseUrl, requireApiKey) {
  if (tool.id === "curl") {
    const auth = requireApiKey ? `\n  -H "Authorization: Bearer ${KEY_PLACEHOLDER}" \\` : "";
    return [
      `curl ${baseUrl}/chat/completions \\`,
      `  -H "Content-Type: application/json" \\${auth}`,
      `  -d '{"model":"claude-sonnet-5","messages":[{"role":"user","content":"ping"}]}'`,
    ].join("\n");
  }
  const lines = [`export ${tool.baseVar}=${baseUrl}`];
  if (requireApiKey) lines.push(`export ${tool.keyVar}=${KEY_PLACEHOLDER}`);
  return lines.join("\n");
}

export default function QuickConnect({ baseUrl, requireApiKey }) {
  const [activeId, setActiveId] = useState(TOOLS[0].id);
  const [copied, setCopied] = useState(false);

  const tool = TOOLS.find((t) => t.id === activeId) || TOOLS[0];
  const snippet = buildSnippet(tool, baseUrl, requireApiKey);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // A denied clipboard is not worth an error state: the snippet is on
      // screen and selectable, which is the fallback either way.
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[12px] text-text-muted">Quick connect</span>
        {/* Tabs, so the keyboard reaches them and the current one is announced. */}
        <div role="tablist" aria-label="Connection snippet" className="flex flex-wrap gap-2">
          {TOOLS.map((t) => {
            const on = t.id === activeId;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setActiveId(t.id)}
                className={
                  on
                    ? "h-8 rounded-lg bg-primary px-3 text-[12.5px] font-semibold text-white"
                    : "h-8 rounded-lg border border-border bg-surface-2 px-3 text-[12.5px] text-text-muted transition-colors hover:border-brand-500/40 hover:text-text-main"
                }
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative">
        <pre className="overflow-x-auto rounded-[10px] border border-border-subtle bg-bg-alt px-4 py-3.5 font-mono text-[12.5px] leading-[1.75] text-text-main">
          {snippet}
        </pre>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Snippet copied" : "Copy snippet"}
          className="absolute right-2.5 top-2.5 grid size-8 place-items-center rounded-[7px] border border-border bg-surface text-text-muted transition-colors hover:border-brand-500/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          <Icon name={copied ? "check" : "content_copy"} size={15} className={copied ? "text-success" : ""} />
        </button>
      </div>

      <p className="text-[12px] leading-5 text-text-muted">
        {requireApiKey ? (
          <>
            Replace <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[11.5px]">{KEY_PLACEHOLDER}</code>{" "}
            with a key from API Keys below.
          </>
        ) : (
          <>This router is not requiring a key, so no token is needed.</>
        )}{" "}
        Kiro, Antigravity and Claude Desktop do not take a base URL —{" "}
        <Link href="/dashboard/mitm" className="text-primary underline-offset-2 hover:underline">
          kRouter captures those
        </Link>
        .
      </p>
    </div>
  );
}

QuickConnect.propTypes = {
  baseUrl: PropTypes.string.isRequired,
  requireApiKey: PropTypes.bool,
};
