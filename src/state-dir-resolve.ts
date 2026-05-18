import * as path from "node:path";
import * as os from "node:os";

export function resolveStateDir(): string {
  const stateOverride = process.env.OPENCLAW_STATE_DIR?.trim() || process.env.CLAWDBOT_STATE_DIR?.trim();
  if (stateOverride) return stateOverride;
  return path.join(os.homedir(), ".openclaw");
}
