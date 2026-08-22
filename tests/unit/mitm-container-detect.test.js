import { describe, it, expect } from "vitest";
import { detectContainer } from "../../src/mitm/isContainer.js";

/** Build a fake filesystem + env for the detector. */
const fsOf = (files = {}, env = {}) => ({
  existsSync: (p) => p in files,
  readFileSync: (p) => {
    if (!(p in files)) throw new Error("ENOENT");
    return files[p];
  },
  env,
  platform: "linux",
});

describe("detectContainer", () => {
  it("reports false on a plain host with nothing container-ish", () => {
    expect(detectContainer(fsOf())).toEqual({ containerized: false, kind: null });
  });

  it("detects Docker via /.dockerenv", () => {
    expect(detectContainer(fsOf({ "/.dockerenv": "" }))).toMatchObject({ containerized: true, kind: "docker" });
  });

  it("detects Podman via /run/.containerenv", () => {
    expect(detectContainer(fsOf({ "/run/.containerenv": "" }))).toMatchObject({ containerized: true, kind: "podman" });
  });

  it("detects Docker from the cgroup of pid 1", () => {
    const d = detectContainer(fsOf({ "/proc/1/cgroup": "12:pids:/docker/6f2a1b\n11:cpu:/docker/6f2a1b\n" }));
    expect(d).toMatchObject({ containerized: true, kind: "docker" });
  });

  it("detects containerd", () => {
    const d = detectContainer(fsOf({ "/proc/1/cgroup": "0::/system.slice/containerd.service\n" }));
    expect(d.containerized).toBe(true);
  });

  it("detects Kubernetes from the service env", () => {
    const d = detectContainer(fsOf({}, { KUBERNETES_SERVICE_HOST: "10.0.0.1" }));
    expect(d).toMatchObject({ containerized: true, kind: "kubernetes" });
  });

  it("does not mistake an ordinary host cgroup for a container", () => {
    const d = detectContainer(fsOf({ "/proc/1/cgroup": "0::/init.scope\n" }));
    expect(d.containerized).toBe(false);
  });

  // macOS and Windows hosts have no /proc; the detector must not throw or guess.
  it("reports false on darwin without touching linux-only paths", () => {
    const probe = { ...fsOf(), platform: "darwin" };
    expect(detectContainer(probe)).toEqual({ containerized: false, kind: null });
  });

  it("never throws when the filesystem misbehaves", () => {
    const hostile = {
      existsSync: () => { throw new Error("EACCES"); },
      readFileSync: () => { throw new Error("EACCES"); },
      env: {},
      platform: "linux",
    };
    expect(() => detectContainer(hostile)).not.toThrow();
    expect(detectContainer(hostile).containerized).toBe(false);
  });

  it("works with no argument at all (uses the real process)", () => {
    const d = detectContainer();
    expect(typeof d.containerized).toBe("boolean");
  });
});
