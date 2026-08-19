// Production entry: install the socket/peer patch, then boot Next standalone.
require("./server-peer-patch.js");

// Standalone builds place server.js next to this file; a repo-root run has none.
const fs = require("fs");
const path = require("path");
const entry = [path.join(__dirname, "server.js"), path.join(__dirname, ".next", "standalone", "server.js")]
  .find((f) => fs.existsSync(f));
if (!entry) {
  console.error("[custom-server] no Next server.js found — run `npm run build` first");
  process.exit(1);
}
require(entry);
