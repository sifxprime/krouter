import https from "https";
import pkg from "../../../../package.json" with { type: "json" };

// Brand: this fork publishes under @sifxprime/krouter on npm. The dashboard's
// "Update now" banner polls this package's "latest" tag and compares against
// the running pkg.version. Pointing at the upstream "9router" name would
// surface upstream's version as available and let the user wipe this fork by
// clicking Update.
const NPM_PACKAGE_NAME = "@sifxprime/krouter";

// Fetch latest version from npm registry. Scoped packages need URL-encoding:
// "@sifxprime/krouter" → "@sifxprime%2Fkrouter".
function fetchLatestVersion() {
  const encoded = NPM_PACKAGE_NAME.replace("/", "%2F");
  return new Promise((resolve) => {
    const req = https.get(
      `https://registry.npmjs.org/${encoded}/latest`,
      { timeout: 4000 },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data).version || null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

export async function GET() {
  const latestVersion = await fetchLatestVersion();
  const currentVersion = pkg.version;
  const hasUpdate = latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : false;

  return Response.json({ currentVersion, latestVersion, hasUpdate });
}
