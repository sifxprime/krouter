import https from "https";
import pkg from "../../../../package.json" with { type: "json" };

// Brand: this fork publishes under @sifxprime/krouter on npm. The dashboard's
// "Update now" banner polls this package's "latest" tag and compares against
