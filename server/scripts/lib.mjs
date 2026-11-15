// Small pure helpers for setup.mjs, kept separate so they can be tested without Cloudflare.
import { randomBytes } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value) => typeof value === 'string' && UUID.test(value);
export const randomKey = () => randomBytes(24).toString('hex');

/** The id of the named database in `wrangler d1 list --json` output, or null. */
export function findDatabaseId(listJson, name) {
  try {
    const list = JSON.parse(listJson);
    const match = Array.isArray(list) ? list.find((db) => db?.name === name) : undefined;
    const id = match?.uuid ?? match?.id;
    return isUuid(id) ? id : null;
  } catch {
    return null;
  }
}

/** The database_id in what `wrangler d1 create` prints, whichever config flavour it chose to show. */
export function parseDatabaseId(text) {
  const match = /database_id["'\s:=]+"?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(text);
  return match ? match[1] : null;
}

export function setDatabaseId(toml, id) {
  const line = /^database_id\s*=\s*".*"\s*$/m;
  if (!line.test(toml)) throw new Error('wrangler.toml has no database_id line to update');
  return toml.replace(line, () => `database_id = "${id}"`);
}

/** The Worker's public URL, read from the file wrangler writes when WRANGLER_OUTPUT_FILE_PATH is set. */
export function parseDeployUrl(ndjson) {
  for (const line of ndjson.split('\n').reverse()) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type !== 'deploy' || !Array.isArray(entry.targets)) continue;
      const url = entry.targets.find((t) => typeof t === 'string' && /^https:\/\//.test(t));
      if (url) return url.replace(/\/+$/, '');
    } catch {
      // not a JSON line
    }
  }
  return null;
}

export function readEnvValue(env, key) {
  const value = new RegExp(`^${key}=(.*)$`, 'm').exec(env)?.[1].trim();
  return value ? value : null;
}

/** Sets KEY=value lines in a .env file's text, keeping every other line and comment as it was. */
export function upsertEnv(env, values) {
  let out = env;
  for (const [key, value] of Object.entries(values)) {
    const line = new RegExp(`^${key}=.*$`, 'm');
    if (line.test(out)) out = out.replace(line, () => `${key}=${value}`);
    else out += `${out === '' || out.endsWith('\n') ? '' : '\n'}${key}=${value}\n`;
  }
  return out;
}
