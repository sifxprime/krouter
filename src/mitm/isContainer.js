/**
 * Container detection for the MITM subsystem.
 *
 * MITM works by pointing provider hostnames at 127.0.0.1 in the OS hosts file
 * and terminating TLS on :443. Inside a container both of those apply to the
 * container, not the host — the IDEs being intercepted (Antigravity, Copilot,
 * Kiro, Cursor, Claude Desktop) run on the host and never consult the
 * container's /etc/hosts. Offering the control there produces a confusing
 * partial success: the server starts, DNS entries are written, and nothing is
 * intercepted.
 *
 * Deliberately lives inside src/mitm so it is covered by the Dockerfile COPY of
 * that directory — a require reaching outside it is what broke the MITM server
 * in the container to begin with (see tests/unit/docker-mitm-packaging.test.js).
 */

"use strict";

const CGROUP_MARKERS = ["docker", "containerd", "kubepods", "podman", "lxc", "crio"];

/**
 * @param {{existsSync:Function, readFileSync:Function, env:object, platform:string}} [probe]
 * @returns {{containerized: boolean, kind: string|null}}
 */
function detectContainer(probe) {
  const fsLike = probe || {
    existsSync: require("fs").existsSync,
    readFileSync: require("fs").readFileSync,
    env: process.env,
    platform: process.platform,
  };

  const safeExists = (p) => { try { return !!fsLike.existsSync(p); } catch { return false; } };
  const safeRead = (p) => { try { return String(fsLike.readFileSync(p, "utf8") ?? ""); } catch { return ""; } };
  const env = fsLike.env || {};

  // Kubernetes announces itself regardless of runtime, and on any platform.
  if (env.KUBERNETES_SERVICE_HOST) return { containerized: true, kind: "kubernetes" };

  // An explicit escape hatch for anyone running a setup where interception does
  // reach the host and who accepts the consequences.
  if (String(env.KROUTER_FORCE_MITM || "") === "1") return { containerized: false, kind: null };

  // Everything below is Linux-only. macOS and Windows hosts have no /proc, and
  // probing there would be guesswork rather than detection.
  if (fsLike.platform !== "linux") return { containerized: false, kind: null };

  if (safeExists("/.dockerenv")) return { containerized: true, kind: "docker" };
  if (safeExists("/run/.containerenv")) return { containerized: true, kind: "podman" };

  const cgroup = safeRead("/proc/1/cgroup").toLowerCase();
  const hit = CGROUP_MARKERS.find((m) => cgroup.includes(m));
  if (hit) return { containerized: true, kind: hit === "crio" ? "cri-o" : hit };

  return { containerized: false, kind: null };
}

module.exports = { detectContainer };
