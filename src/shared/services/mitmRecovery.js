import { existsSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { DATA_DIR } from "@/lib/dataDir";
import { updateSettings } from "@/lib/localDb";

/**
 * Crash-loop recovery: the CLI supervisor asks, the app acts.
 *
 * Written by the CLI supervisor when the server crash-loops. MUST match
 * MITM_RECOVERY_MARKER in cli/cli.js — tests/unit/mitm-recovery-marker.test.js
 * pins the two together, because a drifted copy of exactly this kind of shared
 * knowledge is what broke this path twice already.
 */
export const MITM_RECOVERY_MARKER = ".mitm-recovery";

/**
 * Honour a crash-loop recovery request from the CLI supervisor.
 *
 * The supervisor cannot turn MITM off by itself. It used to try, by patching
 * `mitmEnabled` in DATA_DIR/db.json — a file this app migrated into SQLite and
 * now only keeps as a rollback artifact, so the write landed somewhere nothing
 * reads and the server kept crash-looping with the safety valve doing nothing.
 *
 * So the supervisor drops a marker and we do the write, through the same
 * updateSettings() every other caller uses. Storage can change again; this
 * cannot silently rot with it.
 *
 * Lives in its own module rather than inside initializeApp so it can be driven
 * directly by a test — importing initializeApp pulls in the tunnel stack,
 * cloudflared and the MITM bootstrap side effects, none of which this needs.
 *
 * Never throws: it runs on the boot path and must not be able to take the server
 * down while trying to rescue it.
 *
 * @returns {Promise<"no-marker"|"disabled"|"write-failed">} what happened, for tests and callers.
 */
export async function consumeMitmRecoveryMarker() {
  const marker = join(DATA_DIR, MITM_RECOVERY_MARKER);

  let present = false;
  try {
    present = existsSync(marker);
  } catch {
    return "no-marker";
  }
  if (!present) return "no-marker";

  let detail = "";
  try {
    const info = JSON.parse(readFileSync(marker, "utf8"));
    if (info && info.restarts) detail = ` after ${info.restarts} consecutive crashes`;
  } catch {
    // An unreadable or truncated marker still means "disable MITM" — the
    // supervisor only writes one when it has already given up.
  }

  try {
    await updateSettings({ mitmEnabled: false });
  } catch (e) {
    // Deliberately not swallowed. Leaving the marker in place means the next
    // boot retries rather than silently dropping the request.
    console.error(
      `[InitApp] ✗ Could not disable MITM for crash-loop recovery: ${e.message}. ` +
      "Leaving the marker in place to retry on the next start."
    );
    return "write-failed";
  }

  console.warn(
    `[InitApp] ⚠️  MITM has been disabled automatically${detail}. The CLI supervisor asked for this ` +
    "because the server kept crashing on start. Re-enable it from the dashboard once the cause is fixed."
  );

  try {
    unlinkSync(marker);
  } catch (e) {
    // Harmless but worth knowing: a marker that cannot be removed will disable
    // MITM again on the next boot.
    console.warn(`[InitApp] Could not remove the MITM recovery marker at ${marker}: ${e.message}`);
  }

  return "disabled";
}
