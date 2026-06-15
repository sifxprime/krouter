"use client";

import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { Modal, Button } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

/**
 * Kiro Social OAuth Modal (Google / GitHub) — device-code flow.
 *
 * Lifecycle:
 *   1. On open: call /api/oauth/kiro/social-authorize?provider=google|github
 *      → backend returns { authUrl, deviceCode, userCode, interval }.
 *   2. Render the authUrl + userCode for the user to open in an Incognito tab.
 *   3. Poll /api/oauth/kiro/social-exchange every `interval` seconds with the
 *      deviceCode. Backend returns { pending: true } until the user finishes
 *      login, then { success: true, connection } once tokens are issued.
 *   4. On success: stop polling, fire onSuccess, show confirmation.
 *
 * Replaces the older PKCE manual-callback flow which required the user to copy
 * a `kiro://` URL out of the browser address bar.
 */
export default function KiroSocialOAuthModal({ isOpen, provider, onSuccess, onClose }) {
  const [step, setStep] = useState("loading"); // loading | polling | success | error
  const [error, setError] = useState(null);
  const [userCode, setUserCode] = useState("");
  const [authUrl, setAuthUrl] = useState("");
  const pollRef = useRef(null);
  const { copied, copy } = useCopyToClipboard();

  useEffect(() => {
    if (!isOpen || !provider) return;

    const initAuth = async () => {
      try {
        setError(null);
        setStep("loading");

        const res = await fetch(`/api/oauth/kiro/social-authorize?provider=${provider}`);
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || "Failed to start authorization");

        setUserCode(data.userCode || "");
        setAuthUrl(data.authUrl || "");
        setStep("polling");

        const interval = (data.interval || 5) * 1000;
        pollRef.current = setInterval(async () => {
          try {
            const pollRes = await fetch("/api/oauth/kiro/social-exchange", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ deviceCode: data.deviceCode, provider }),
            });
            const pollData = await pollRes.json();

            if (pollData.success) {
              if (pollRef.current) clearInterval(pollRef.current);
              pollRef.current = null;
              setStep("success");
              onSuccess?.();
            }
            // pending: true → keep polling; do nothing
          } catch {
            // Network blip — keep polling; the next tick will retry.
          }
        }, interval);
      } catch (err) {
        setError(err.message);
        setStep("error");
      }
    };

    initAuth();

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [isOpen, provider, onSuccess]);

  const handleClose = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    onClose();
  };

  const providerName = provider === "google" ? "Google" : "GitHub";

  return (
    <Modal
      isOpen={isOpen}
      title={`Connect Kiro via ${providerName}`}
      onClose={handleClose}
      size="lg"
    >
      <div className="flex flex-col gap-4">
        {step === "loading" && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-primary animate-spin">
                progress_activity
              </span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Initializing...</h3>
            <p className="text-sm text-text-muted">Setting up {providerName} authentication</p>
          </div>
        )}

        {step === "polling" && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-primary animate-pulse">
                open_in_browser
              </span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Open this link in an Incognito window</h3>
            <p className="text-sm text-text-muted mb-3">
              Use an Incognito/Private window to avoid session conflicts with existing accounts.
            </p>

            {authUrl && (
              <div className="mb-4">
                <div className="flex items-center gap-2 justify-center">
                  <a
                    href={authUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono text-primary underline break-all max-w-md inline-block"
                  >
                    {authUrl.length > 80 ? authUrl.slice(0, 80) + "..." : authUrl}
                  </a>
                  <button
                    onClick={() => copy(authUrl)}
                    className="shrink-0 p-1 rounded hover:bg-sidebar"
                    title={copied ? "Copied!" : "Copy link"}
                  >
                    <span className="material-symbols-outlined text-base">
                      {copied ? "check" : "content_copy"}
                    </span>
                  </button>
                </div>
              </div>
            )}

            {userCode && (
              <div className="mb-4">
                <p className="text-xs text-text-muted mb-1">Verification code</p>
                <p className="font-mono text-2xl font-bold tracking-widest">{userCode}</p>
              </div>
            )}

            <div className="flex items-center justify-center gap-2 text-sm text-text-muted">
              <span className="material-symbols-outlined text-base animate-spin">
                progress_activity
              </span>
              Waiting for authorization...
            </div>

            <div className="mt-6">
              <Button onClick={handleClose} variant="ghost" fullWidth>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {step === "success" && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-green-600">
                check_circle
              </span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Connected Successfully!</h3>
            <p className="text-sm text-text-muted mb-4">
              Your Kiro account via {providerName} has been connected.
            </p>
            <Button onClick={handleClose} fullWidth>
              Done
            </Button>
          </div>
        )}

        {step === "error" && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-red-600">error</span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Connection Failed</h3>
            <p className="text-sm text-red-600 mb-4">{error}</p>
            <Button onClick={handleClose} variant="ghost" fullWidth>
              Close
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

KiroSocialOAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  provider: PropTypes.oneOf(["google", "github"]).isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
