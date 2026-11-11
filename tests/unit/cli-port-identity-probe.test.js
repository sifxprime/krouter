/**
 * 0.5.176 — kRouter refusing to start because it did not recognise its own server.
 *
 * Reported as: `krouter` printing
 *   "Port 20128 is held by next-server (v16.4.1) (pid 47515) — not kRouter.
 *    Refusing to kill it."
 * with kRouter, and nothing else, listening on that port.
 *
 * isOwnServerPid() identifies the holder by comparing its cwd against
 * standaloneDir. npm upgrades by staging into `.krouter-XXXX` and renaming that
 * into place, so a server still running across `npm install -g` has a cwd whose
 * path no longer exists under that name. Measured on the real upgrade that
 * produced the report:
 *
 *   holder cwd    : .../@sifxprime/.krouter-rqcc3q2I/app   (since deleted)
 *   standaloneDir : .../@sifxprime/krouter/app
 *
 * The compare can never succeed again, so the user's own server is classed as
 * foreign and the CLI exits. The fix asks the port instead: /api/version is
 * unauthenticated and names the package.
 *
 * The probe runs in a child node, and HOW it is launched is the subtle half.
 * Launching it through a shell means JSON-escaping the script, which turns every
 * newline into the two characters \n; node then gets a SyntaxError, the catch
 * swallows it, portServesKrouter returns false, and the original bug is back
 * with no symptom. That mistake was made and caught here first -- it passes
 * every "does it compile" check and fails only against a live port.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CLI = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..", "cli", "cli.js");
const SRC = fs.readFileSync(CLI, "utf-8");

/** The real probe source out of cli.js, so this cannot drift from what ships. */
const PROBE = (SRC.match(/const PORT_IDENTITY_PROBE = `([\s\S]*?)`;/) || [])[1];

// execFile, not execFileSync, ONLY here: the stub servers below live in this
// same process, so a synchronous child would block the event loop that has to
// accept its connection and the probe would time out against a server that is
// running perfectly. cli.js is right to use the sync form -- it has no server of
// its own to starve -- and that choice is pinned by source assertion instead.
async function runProbe(port) {
  try {
    const { stdout } = await execFileAsync(process.execPath, ["-e", PROBE, String(port)], {
      encoding: "utf-8", timeout: 10000,
    });
    return stdout.trim() === "yes";
  } catch {
    return false;
  }
}

function serve(body, port) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

let krouterLike, decoy, krouterPort, decoyPort, deadPort;

beforeAll(async () => {
  krouterLike = await serve(
    { currentVersion: "0.5.176", latestVersion: "0.5.176", hasUpdate: false, packageName: "@sifxprime/krouter" },
    0
  );
  decoy = await serve({ packageName: "something-else", version: "1.0.0" }, 0);
  krouterPort = krouterLike.address().port;
  decoyPort = decoy.address().port;
  // A port nothing is on: bind one, read it, release it.
  const tmp = await serve({}, 0);
  deadPort = tmp.address().port;
  await new Promise((r) => tmp.close(r));
}, 30000);

afterAll(async () => {
  if (krouterLike) await new Promise((r) => krouterLike.close(r));
  if (decoy) await new Promise((r) => decoy.close(r));
});

describe("the probe is wired into the CLI at all", () => {
  it("exists and is consulted before classifying any pid", () => {
    expect(PROBE, "PORT_IDENTITY_PROBE not found in cli.js").toBeTruthy();
    expect(SRC).toMatch(/const portIsOurs = portServesKrouter\(port\)/);

    // Both platform branches use it -- the Windows one had the same bug -- but
    // they are deliberately NOT the same expression. `lsof -ti:PORT` lists
    // clients of the port as well as its listener, so the unix branch must
    // additionally require the pid to be listening; netstat on Windows has
    // already filtered to LISTENING rows, so there it stands alone.
    expect(SRC).toMatch(/portIsOurs && listeners\.has\(pid\)/);      // unix
    expect(SRC).toMatch(/if \(portIsOurs \|\| isOwnServerPid\(pid\)\)/); // win32
  });

  // The whole fix is defeated, silently, by launching the probe through a shell.
  it("launches the probe without a shell", () => {
    const fn = SRC.slice(SRC.indexOf("function portServesKrouter"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toContain("execFileSync");
    expect(body).not.toMatch(/execSync\(/);
    // An args array, not an interpolated command line.
    expect(body).toMatch(/\["-e", PORT_IDENTITY_PROBE, String\(port\)\]/);
  });
});

describe("what the probe answers", () => {
  it("says yes to something that identifies as kRouter", async () => {
    await expect(runProbe(krouterPort)).resolves.toBe(true);
  }, 20000);

  it("says no to another service on the port", async () => {
    // The old check would have said "not kRouter" here too -- but for the wrong
    // reason, and it said it about real kRouters as well.
    await expect(runProbe(decoyPort)).resolves.toBe(false);
  }, 20000);

  it("says no when nothing is listening", async () => {
    await expect(runProbe(deadPort)).resolves.toBe(false);
  }, 20000);
});

describe("the message the user saw", () => {
  it("still refuses to kill a port that is genuinely someone else's", () => {
    // The guard must stay -- the fix widens what counts as ours, it does not
    // make kRouter kill strangers.
    expect(SRC).toMatch(/is held by .* — not kRouter/);
    expect(SRC).toMatch(/Refusing to kill it/);
    expect(SRC).toMatch(/foreign\.push\(pid\)/);
  });
});
