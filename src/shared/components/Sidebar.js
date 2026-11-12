"use client";

import { useState, useEffect, useCallback, useSyncExternalStore } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/shared/utils/cn";
import { APP_CONFIG, UPDATER_CONFIG } from "@/shared/constants/config";
import { MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { useCaptureStatus, describeCapture } from "@/shared/hooks/useCaptureStatus";
import { Icon } from "./icons";
import { NAV_SECTIONS, isNavItemActive } from "./nav/navSections";
import * as collapseStore from "./nav/collapseStore";
import Button from "./Button";
import { ConfirmModal } from "./Modal";
import SupportMenu from "./SupportMenu";

const VISIBLE_MEDIA_KINDS = ["embedding", "image", "video", "tts", "stt"];
// Combined entry: webSearch + webFetch share one page at /dashboard/media-providers/web
const COMBINED_WEB_ITEM = { id: "web", label: "Web Fetch & Search", icon: "travel_explore", href: "/dashboard/media-providers/web" };

/** One nav row, in both the full and the rail form. */
function NavRow({ href, icon, label, active, collapsed, badge, onClick }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      // The accessible name has to survive the rail, where the text is gone.
      // `title` also gives the native tooltip, which a hover-only CSS tooltip
      // would not give a keyboard user.
      title={collapsed ? label : undefined}
      className={cn(
        "group relative flex items-center rounded-lg transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
        collapsed ? "justify-center p-2 mx-auto size-9" : "gap-3 px-3 py-1.5",
        // The label stays at full text weight when active and only the icon
        // takes the brand colour. Tinting the whole row made the current page
        // the *least* legible label in the nav — brand orange on a brand tint
        // is lower contrast than plain text on the sidebar.
        active
          ? "bg-primary/10 text-text-main"
          : "text-text-muted hover:bg-surface-2 hover:text-text-main",
      )}
    >
      {/* The marker is what answers "where am I" once the labels are gone, so
          it is drawn in both forms rather than only the expanded one. */}
      {active ? (
        <span aria-hidden="true" className="absolute -left-2 top-1.5 bottom-1.5 w-[2.5px] rounded-r bg-primary" />
      ) : null}
      <Icon name={icon} size={18} className={cn("shrink-0", active ? "text-primary" : "group-hover:text-primary transition-colors")} />
      {collapsed ? null : <span className="text-[13px] font-medium truncate">{label}</span>}
      {badge && !collapsed ? <span className="ml-auto">{badge}</span> : null}
      {badge && collapsed ? (
        <span aria-hidden="true" className="absolute top-1 right-1 size-[7px] rounded-full bg-green-500 ring-2 ring-sidebar" />
      ) : null}
    </Link>
  );
}

NavRow.propTypes = {
  href: PropTypes.string.isRequired,
  icon: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  active: PropTypes.bool,
  collapsed: PropTypes.bool,
  badge: PropTypes.node,
  onClick: PropTypes.func,
};

export default function Sidebar({ onClose }) {
  const pathname = usePathname();
  const [mediaOpen, setMediaOpen] = useState(false);
  const collapsed = useSyncExternalStore(
    collapseStore.subscribe,
    collapseStore.getSnapshot,
    collapseStore.getServerSnapshot,
  );
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [shutdownCountdown, setShutdownCountdown] = useState(0);
  const [enableTranslator, setEnableTranslator] = useState(false);
  const { copied, copy } = useCopyToClipboard(2000);
  const capture = useCaptureStatus();
  const captureWords = describeCapture(capture);

  const INSTALL_CMD = UPDATER_CONFIG.installCmdLatest;

  // The drawer is the mobile presentation and has no room for a rail, so a
  // remembered collapse must not follow it there.
  const isDrawer = Boolean(onClose);
  const railed = collapsed && !isDrawer;

  const toggleCollapsed = useCallback(() => {
    collapseStore.setCollapsed(!collapseStore.getSnapshot());
  }, []);

  useEffect(() => {
    fetch("/api/settings")
      .then(res => res.json())
      .then(data => { if (data.enableTranslator) setEnableTranslator(true); })
      .catch(() => {});
  }, []);

  // Lazy check for new npm version on mount
  useEffect(() => {
    fetch("/api/version")
      .then(res => res.json())
      .then(data => { if (data.hasUpdate) setUpdateInfo(data); })
      .catch(() => {});
  }, []);

  // Open manual update panel (no countdown yet — user must click Copy to trigger shutdown)
  const handleUpdate = () => {
    setShowUpdateModal(false);
    setIsUpdating(true);
  };

  // Triggered by Copy button inside ManualUpdatePanel: copy + countdown + shutdown
  const handleCopyAndShutdown = async () => {
    try { await navigator.clipboard.writeText(INSTALL_CMD); } catch { /* clipboard blocked */ }
    copy(INSTALL_CMD);
    let remaining = UPDATER_CONFIG.shutdownCountdownSec;
    setShutdownCountdown(remaining);
    const timer = setInterval(() => {
      remaining -= 1;
      setShutdownCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
        fetch("/api/version/shutdown", { method: "POST" }).catch(() => {});
        setIsDisconnected(true);
      }
    }, 1000);
  };

  const handleCancelUpdate = () => {
    setIsUpdating(false);
    setShutdownCountdown(0);
  };

  const visible = (item) => !item.requires || (item.requires === "enableTranslator" && enableTranslator);

  return (
    <>
      <aside
        className={cn(
          "flex flex-col border-r border-border-subtle bg-vibrancy backdrop-blur-xl min-h-full",
          "transition-[width] duration-200 ease-out",
          railed ? "w-[68px]" : "w-[252px]",
        )}
      >
        {/* Traffic lights */}
        <div className={cn("flex items-center gap-2 pt-5 pb-2", railed ? "px-5" : "px-6")}>
          <div className="w-3 h-3 rounded-full bg-[#FF5F56]" />
          {railed ? null : <div className="w-3 h-3 rounded-full bg-[#FFBD2E]" />}
          {railed ? null : <div className="w-3 h-3 rounded-full bg-[#27C93F]" />}
        </div>

        {/* Logo — echo chevron on the brand tile + Space Grotesk wordmark */}
        <div className={cn("py-3 flex flex-col gap-2", railed ? "px-4" : "px-6")}>
          <Link href="/dashboard" className="flex items-center gap-3 group" title={railed ? APP_CONFIG.name : undefined}>
            {/* The mark is drawn bare, not set on a filled tile. On a tile the
                chevron has to be white to survive the brand fill, which costs
                the brand colour exactly where the brand is being stated, and
                the tile's silhouette — a rounded square — is what the eye
                actually reads at this size, not the chevron inside it.
                Geometry is the echo chevron: one stroke and one at 0.35 behind
                it on the same slope. */}
            <svg viewBox="0 0 400 400" className="size-[30px] shrink-0 transition-transform group-hover:translate-x-[1px]" aria-hidden="true">
              <g fill="none" stroke="var(--color-brand-500)" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="97.8,118 170,200 97.8,282" strokeWidth="24" strokeOpacity="0.35" />
                <polyline points="174,100 262,200 174,300" strokeWidth="54" />
              </g>
            </svg>
            {railed ? null : (
              <div className="flex flex-col leading-none min-w-0">
                {/* No `uppercase` here: the brand is "kRouter", and forcing caps rendered
                    it "KROUTER" in the sidebar while the login screen showed it correctly. */}
                <h1
                  className="text-[19px] font-bold text-text-main"
                  style={{ fontFamily: "var(--font-display)", letterSpacing: "-0.025em" }}
                >
                  {/* Split so the leading letter carries the brand colour. The
                      name is one word to a reader either way, so it is not
                      announced as two. */}
                  <span className="text-primary">{APP_CONFIG.name.slice(0, 1)}</span>
                  {APP_CONFIG.name.slice(1)}
                </h1>
                <span className="text-[10.5px] text-text-muted mt-[2px] font-medium tabular-nums">v{APP_CONFIG.version}</span>
              </div>
            )}
          </Link>

          {updateInfo && !railed && (
            <div className="flex flex-col gap-1.5 rounded p-1 -m-1">
              <span className="text-xs font-semibold text-green-600 dark:text-amber-500">
                ↑ New version available: v{updateInfo.latestVersion}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowUpdateModal(true)}
                  className="px-2 py-1 rounded bg-green-600 hover:bg-green-700 dark:bg-amber-500 dark:hover:bg-amber-600 text-white text-[11px] font-semibold transition-colors cursor-pointer"
                >
                  Update now
                </button>
                <button
                  onClick={() => copy(INSTALL_CMD)}
                  title="Copy install command"
                  className="flex-1 text-left hover:opacity-80 transition-opacity cursor-pointer min-w-0"
                >
                  <code className="block text-[10px] text-green-600/80 dark:text-amber-400/70 font-mono truncate">
                    {copied ? "✓ copied!" : INSTALL_CMD}
                  </code>
                </button>
              </div>
            </div>
          )}
          {updateInfo && railed && (
            <button
              onClick={() => setShowUpdateModal(true)}
              title={`Update available: v${updateInfo.latestVersion}`}
              className="mx-auto flex size-7 items-center justify-center rounded-lg bg-green-600/15 text-green-600 dark:bg-amber-500/15 dark:text-amber-500"
            >
              <Icon name="south_east" size={15} />
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className={cn("flex-1 overflow-y-auto custom-scrollbar py-2", railed ? "px-3" : "px-4")} aria-label="Dashboard">
          {NAV_SECTIONS.map((section, sectionIndex) => {
            const items = section.items.filter(visible);
            if (!items.length) return null;
            return (
              <div key={section.id} className={sectionIndex === 0 ? "" : "mt-4"}>
                {railed ? (
                  sectionIndex === 0 ? null : (
                    <div className="mx-auto my-2 h-px w-7 bg-border-subtle" aria-hidden="true" />
                  )
                ) : (
                  <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted">
                    {section.label}
                  </p>
                )}

                <div className="space-y-0.5">
                  {items.map((item) => {
                    if (item.accordion) {
                      const mediaActive = pathname.startsWith("/dashboard/media-providers");
                      return (
                        <div key={item.id}>
                          <button
                            onClick={() => (railed ? toggleCollapsed() : setMediaOpen((v) => !v))}
                            title={railed ? item.label : undefined}
                            aria-expanded={railed ? undefined : mediaOpen}
                            className={cn(
                              "group relative flex w-full items-center rounded-lg transition-colors",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                              railed ? "justify-center p-2 mx-auto size-9" : "gap-3 px-3 py-1.5",
                              mediaActive
                                ? "bg-primary/10 text-primary"
                                : "text-text-muted hover:bg-surface-2 hover:text-text-main",
                            )}
                          >
                            {mediaActive ? (
                              <span aria-hidden="true" className="absolute -left-2 top-1.5 bottom-1.5 w-[2.5px] rounded-r bg-primary" />
                            ) : null}
                            <Icon name={item.icon} size={18} className="shrink-0" />
                            {railed ? null : (
                              <>
                                <span className="flex-1 text-left text-[13px] font-medium">{item.label}</span>
                                <Icon
                                  name="expand_more"
                                  size={14}
                                  className={cn("transition-transform duration-200", mediaOpen ? "rotate-180" : "")}
                                />
                              </>
                            )}
                          </button>
                          {mediaOpen && !railed && (
                            <div className="pl-5 mt-0.5 space-y-0.5">
                              {MEDIA_PROVIDER_KINDS.filter((k) => VISIBLE_MEDIA_KINDS.includes(k.id)).map((kind) => (
                                <NavRow
                                  key={kind.id}
                                  href={`/dashboard/media-providers/${kind.id}`}
                                  icon={kind.icon}
                                  label={kind.label}
                                  active={pathname.startsWith(`/dashboard/media-providers/${kind.id}`)}
                                  onClick={onClose}
                                />
                              ))}
                              <NavRow
                                href={COMBINED_WEB_ITEM.href}
                                icon={COMBINED_WEB_ITEM.icon}
                                label={COMBINED_WEB_ITEM.label}
                                active={pathname.startsWith(COMBINED_WEB_ITEM.href)}
                                onClick={onClose}
                              />
                            </div>
                          )}
                        </div>
                      );
                    }

                    return (
                      <NavRow
                        key={item.href}
                        href={item.href}
                        icon={item.icon}
                        label={item.label}
                        active={isNavItemActive(item.href, pathname)}
                        collapsed={railed}
                        onClick={onClose}
                        badge={
                          item.showsCaptureState && captureWords.tone !== "off" && captureWords.tone !== "idle" ? (
                            <span
                              title={captureWords.long}
                              className={cn(
                                "rounded-full px-1.5 py-[1px] text-[9px] font-semibold",
                                captureWords.tone === "on"
                                  ? "bg-green-500/15 text-green-600 dark:text-green-400"
                                  : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
                              )}
                            >
                              {captureWords.tone === "on" ? "live" : "proxy"}
                            </span>
                          ) : null
                        }
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Pinned below the scrolling nav so it stays reachable from any page. */}
        <div className={cn("pb-3 pt-2 border-t border-border-subtle", railed ? "px-2" : "px-4")}>
          {railed ? null : <SupportMenu />}
          {isDrawer ? null : (
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={railed ? "Expand sidebar" : "Collapse sidebar"}
              title={railed ? "Expand sidebar" : "Collapse sidebar"}
              className={cn(
                "mt-2 flex items-center rounded-lg text-text-muted transition-colors hover:bg-surface-2 hover:text-text-main",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                railed ? "mx-auto size-9 justify-center" : "w-full gap-2 px-3 py-1.5",
              )}
            >
              <Icon name="side_navigation" size={16} className={railed ? "rotate-180" : ""} />
              {railed ? null : <span className="text-[12px] font-medium">Collapse</span>}
            </button>
          )}
        </div>
      </aside>

      {/* Update Confirmation Modal */}
      <ConfirmModal
        isOpen={showUpdateModal}
        onClose={() => setShowUpdateModal(false)}
        onConfirm={handleUpdate}
        title="Update kRouter"
        message={`Show install command for v${updateInfo?.latestVersion || ""}? You can copy it and shutdown to install manually.`}
        confirmText="Show Command"
        cancelText="Cancel"
        variant="primary"
      />

      {/* Disconnected / Updating Overlay */}
      {(isDisconnected || isUpdating) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6">
          {isUpdating ? (
            <ManualUpdatePanel
              latestVersion={updateInfo?.latestVersion}
              installCmd={INSTALL_CMD}
              copied={copied}
              onCopyAndShutdown={handleCopyAndShutdown}
              onCancel={handleCancelUpdate}
              countdown={shutdownCountdown}
              isDisconnected={isDisconnected}
            />
          ) : (
            <div className="text-center p-8">
              <div className="flex items-center justify-center size-16 rounded-full bg-red-500/20 text-red-500 mx-auto mb-4">
                <Icon name="power_off" size={32} />
              </div>
              <h2 className="text-xl font-semibold text-white mb-2">Server Disconnected</h2>
              <p className="text-text-muted mb-6">The proxy server has been stopped.</p>
              <Button variant="secondary" onClick={() => globalThis.location.reload()}>
                Reload Page
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

Sidebar.propTypes = {
  onClose: PropTypes.func,
};

function ManualUpdatePanel({ latestVersion, installCmd, copied, onCopyAndShutdown, onCancel, countdown, isDisconnected }) {
  const isCountingDown = countdown > 0;
  return (
    <div className="w-full max-w-lg rounded-xl bg-neutral-900/95 border border-white/10 p-6 text-white">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center justify-center size-11 rounded-full bg-amber-500/20 text-amber-400">
          <Icon name="content_copy" size={22} />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Update kRouter{latestVersion ? ` to v${latestVersion}` : ""}</h2>
          <p className="text-xs text-white/60">
            {isDisconnected
              ? "Server stopped. Paste the command into a terminal to install."
              : isCountingDown
                ? `Command copied. Server will stop in ${countdown}s...`
                : "Click the button below to copy the install command and shutdown."}
          </p>
        </div>
      </div>

      <p className="text-sm text-white/80 mb-2">Install command:</p>
      <div className="w-full px-3 py-2 rounded bg-white/5 mb-4">
        <code className="text-xs font-mono text-amber-400 break-all">{installCmd}</code>
      </div>

      <ol className="text-xs text-white/70 space-y-1 list-decimal list-inside mb-4">
        <li>Click <strong>Copy &amp; Shutdown</strong> below.</li>
        <li>Paste the command into your terminal and press Enter.</li>
        <li>Run <code className="px-1 rounded bg-white/10 text-green-400">krouter</code> again after install.</li>
      </ol>

      {isDisconnected ? (
        <Button variant="secondary" fullWidth onClick={() => globalThis.location.reload()}>
          Reload Page
        </Button>
      ) : (
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={isCountingDown}>
            Cancel
          </Button>
          <Button variant="primary" fullWidth onClick={onCopyAndShutdown} disabled={isCountingDown}>
            {copied ? "✓ Copied — shutting down..." : isCountingDown ? `Shutting down in ${countdown}s` : "Copy & Shutdown"}
          </Button>
        </div>
      )}
    </div>
  );
}

ManualUpdatePanel.propTypes = {
  latestVersion: PropTypes.string,
  installCmd: PropTypes.string.isRequired,
  copied: PropTypes.bool,
  onCopyAndShutdown: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  countdown: PropTypes.number,
  isDisconnected: PropTypes.bool,
};
