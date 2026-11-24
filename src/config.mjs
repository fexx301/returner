// Shared JSON config loader (--config returner.json) for returner.mjs and repair.mjs.
// Paths in a config file resolve relative to the config file's directory; explicit CLI flags always win.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isUrl } from "./server.mjs";

const ALLOWED_KEYS = new Set([
  "$schema",
  "old",
  "new",
  "source",
  "serve",
  "build",
  "start",
  "promise",
  "seed",
  "check",
  "policy",
  "agent",
  "attempts",
  "note",
  "reference",
  "holdout",
  "holdout-seed",
  "holdout-check",
  "holdout-secret",
  "holdout-field",
]);
const HOLDOUT_KEYS = new Set(["seed", "check", "secrets", "fields"]);

function asString(name, value) {
  if (typeof value !== "string") throw new Error(`Config "${name}" must be a string.`);
  return value;
}

function asStringArray(name, value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) return value;
  throw new Error(`Config "${name}" must be a string or array of strings.`);
}

export function loadConfig(configPath) {
  const full = resolve(configPath);
  let raw;
  try {
    raw = JSON.parse(readFileSync(full, "utf8"));
  } catch (err) {
    throw new Error(`Could not read config ${configPath}: ${err.message}`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Config ${configPath} must be a JSON object.`);
  }
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.has(key)) throw new Error(`Unknown config key "${key}" in ${configPath}.`);
  }
  const base = dirname(full);
  const resolveRef = (p) => (isUrl(p) ? p : resolve(base, p));
  const out = {};

  for (const key of ["old", "new", "source"]) {
    if (raw[key] !== undefined) out[key] = resolveRef(asString(key, raw[key]));
  }
  for (const key of ["serve", "build", "start", "promise", "seed", "check", "agent", "note"]) {
    if (raw[key] !== undefined) out[key] = asString(key, raw[key]);
  }
  if (raw.attempts !== undefined) {
    if (typeof raw.attempts !== "number" && typeof raw.attempts !== "string") {
      throw new Error('Config "attempts" must be a positive integer.');
    }
    out.attempts = String(raw.attempts);
  }
  if (raw.policy !== undefined) out.policy = asStringArray("policy", raw.policy).map((p) => resolve(base, p));
  if (raw.reference !== undefined) out.reference = asStringArray("reference", raw.reference).map((p) => resolve(base, p));

  if (raw["holdout-seed"] !== undefined) out["holdout-seed"] = asString("holdout-seed", raw["holdout-seed"]);
  if (raw["holdout-check"] !== undefined) out["holdout-check"] = asString("holdout-check", raw["holdout-check"]);
  if (raw["holdout-secret"] !== undefined) out["holdout-secret"] = asStringArray("holdout-secret", raw["holdout-secret"]);
  if (raw["holdout-field"] !== undefined) out["holdout-field"] = asStringArray("holdout-field", raw["holdout-field"]);

  if (raw.holdout !== undefined) {
    if (!raw.holdout || typeof raw.holdout !== "object" || Array.isArray(raw.holdout)) {
      throw new Error('Config "holdout" must be a JSON object.');
    }
    for (const key of Object.keys(raw.holdout)) {
      if (!HOLDOUT_KEYS.has(key)) throw new Error(`Unknown holdout key "${key}" in ${configPath}.`);
    }
    if (raw.holdout.seed !== undefined) out["holdout-seed"] = asString("holdout.seed", raw.holdout.seed);
    if (raw.holdout.check !== undefined) out["holdout-check"] = asString("holdout.check", raw.holdout.check);
    if (raw.holdout.secrets !== undefined) out["holdout-secret"] = asStringArray("holdout.secrets", raw.holdout.secrets);
    if (raw.holdout.fields !== undefined) out["holdout-field"] = asStringArray("holdout.fields", raw.holdout.fields);
  }

  return out;
}

export function mergeOptions(defaults, cfg, cli) {
  const merged = { ...defaults, ...cfg };
  for (const [key, value] of Object.entries(cli)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}
