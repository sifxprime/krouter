"use client";

// 0.5.85 — Manifest-driven provider hero.
// Replaces the ad-hoc header block. Bento-editorial feel:
//  · brand-color accent (soft-tinted rounded panel)
//  · dominant provider name + tier chip + link chips
//  · optional deprecation/warning banner
//
// All content comes from getProviderCapabilities(id) — no hardcoded providerId
// checks, no provider-shaped fields sprinkled through props.

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import PropTypes from "prop-types";
import { Badge } from "@/shared/components";

const TIER_META = {
  free:      { label: "Free",        variant: "success", accent: "green"   },
  freetier:  { label: "Free tier",   variant: "success", accent: "emerald" },
  oauth:     { label: "OAuth",       variant: "primary", accent: "primary" },
  paid:      { label: "API key",     variant: "default", accent: "neutral" },
  webcookie: { label: "Cookie",      variant: "warning", accent: "amber"   },
};

export default function ProviderHero({ capabilities, connectionCount = 0, headerIconPath }) {
  const [imgError, setImgError] = useState(false);
  const c = capabilities;
  if (!c) return null;

  const tier = TIER_META[c.tier] || TIER_META.paid;
  const accentBg = c.color ? `${c.color}10` : "rgba(148,163,184,0.08)";
  const accentRing = c.color ? `${c.color}30` : "rgba(148,163,184,0.20)";

  // Link chips — only render what actually exists in the manifest.
  const chips = [];
  if (c.links.apiKey) chips.push({ href: c.links.apiKey, icon: "key", label: "Get API key" });
  if (c.links.signup && !c.links.apiKey) chips.push({ href: c.links.signup, icon: "person_add", label: "Sign up" });
  if (c.links.homepage) chips.push({ href: c.links.homepage, icon: "language", label: "Homepage" });
  if (c.links.docs) chips.push({ href: c.links.docs, icon: "menu_book", label: "Docs" });
  if (c.links.pricing) chips.push({ href: c.links.pricing, icon: "sell", label: "Pricing" });

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Link
        href="/dashboard/providers"
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-primary transition-colors"
      >
        <span className="material-symbols-outlined text-lg">arrow_back</span>
        Back to Providers
      </Link>

      {/* Hero card */}
      <div
        className="relative overflow-hidden rounded-2xl border p-5 sm:p-7"
        style={{
          borderColor: accentRing,
          background: `linear-gradient(140deg, ${accentBg} 0%, transparent 55%)`,
        }}
      >
        <div className="flex min-w-0 flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div
              className="flex size-14 shrink-0 items-center justify-center rounded-xl shadow-sm"
              style={{ backgroundColor: c.color ? `${c.color}20` : "rgba(148,163,184,0.15)" }}
            >
              {imgError || !headerIconPath ? (
                <span
                  className="text-base font-bold"
                  style={{ color: c.color || "inherit" }}
                >
                  {c.textIcon || c.id.slice(0, 2).toUpperCase()}
                </span>
              ) : (
                <Image
                  src={headerIconPath}
                  alt={c.name}
                  width={56}
                  height={56}
                  className="max-h-14 max-w-14 rounded-xl object-contain"
                  sizes="56px"
                  onError={() => setImgError(true)}
                />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">
                  {c.name}
                </h1>
                <Badge variant={tier.variant} size="sm">{tier.label}</Badge>
                {c.deprecated && <Badge variant="warning" size="sm">deprecated</Badge>}
              </div>
              <p className="mt-1 text-sm text-text-muted">
                {connectionCount} connection{connectionCount === 1 ? "" : "s"}
                {c.serviceKinds.length > 1 && (
                  <> · {c.serviceKinds.join(" · ")}</>
                )}
              </p>
            </div>
          </div>

          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5 sm:justify-end">
              {chips.map((chip) => (
                <a
                  key={chip.label}
                  href={chip.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-bg/60 px-2.5 py-1 text-xs text-text-main hover:border-primary hover:text-primary transition-colors backdrop-blur"
                >
                  <span className="material-symbols-outlined text-sm">{chip.icon}</span>
                  {chip.label}
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Notice / marketing blurb — only if present */}
        {c.notices.body && !c.deprecated && (
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-text-muted">
            {c.notices.body}
          </p>
        )}
      </div>

      {/* Deprecation banner — always separate, always visible */}
      {c.deprecated && c.notices.warning && (
        <div className="flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2">
          <span className="material-symbols-outlined mt-0.5 shrink-0 text-[16px] text-yellow-500">
            warning
          </span>
          <p className="text-xs leading-relaxed text-red-600 dark:text-yellow-400">
            {c.notices.warning}
          </p>
        </div>
      )}
    </div>
  );
}

ProviderHero.propTypes = {
  capabilities: PropTypes.object,
  connectionCount: PropTypes.number,
  headerIconPath: PropTypes.string,
};
