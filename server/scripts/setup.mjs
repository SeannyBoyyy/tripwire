#!/usr/bin/env node
// One command for the whole server setup: npm run setup
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  findDatabaseId,
  isUuid,
  parseDatabaseId,
  parseDeployUrl,
  randomKey,
  readEnvValue,
  setDatabaseId,
  upsertEnv,
} from './lib.mjs';

const DB_NAME = 'tripwire';

export class SetupError extends Error {}
const fail = (message) => {
  throw new SetupError(message);
};

/**
 * Does the manual steps from the README, in order, and is safe to run again.
 * Every side effect arrives through `deps`, so the whole flow is tested without Cloudflare.
 */
export async function runSetup(deps) {
  const { wrangler, ask, log, fs, paths, newKey, tmpFile, checkHealth } = deps;
  const step = (n, text) => log(`\n[${n}/6] ${text}`);

  step(1, 'Checking your Cloudflare login…');
  if (!wrangler(['whoami', '--json'], { capture: true }).ok) {
    log('Opening your browser so you can sign in to Cloudflare. A free account is fine.');
    if (!wrangler(['login']).ok) fail('The Cloudflare sign-in didn’t finish. Run npm run setup again.');
    if (!wrangler(['whoami', '--json'], { capture: true }).ok) {
      fail('Still not signed in. Run npx wrangler login, then npm run setup.');
    }
  }

  step(2, 'Setting up the database…');
  let databaseId = null;
  const listed = wrangler(['d1', 'list', '--json'], { capture: true });
  if (listed.ok) databaseId = findDatabaseId(listed.stdout, DB_NAME);
  if (databaseId) {
    log(`Found your existing "${DB_NAME}" database.`);
  } else {
    const created = wrangler(['d1', 'create', DB_NAME], { capture: true });
    databaseId = parseDatabaseId(created.stdout);
    if (!databaseId) {
      log(created.stdout);
      databaseId = (await ask('Paste the database_id printed above (or shown by npx wrangler d1 list): ')).trim();
    }
  }
  if (!isUuid(databaseId)) fail(`"${databaseId}" doesn’t look like a database id.`);
  const tomlPath = path.join(paths.server, 'wrangler.toml');
  fs.write(tomlPath, setDatabaseId(fs.read(tomlPath), databaseId));

  step(3, 'Creating the tables…');
  if (!wrangler(['d1', 'execute', DB_NAME, '--remote', '--file=schema.sql', '--yes']).ok) {
    fail('Couldn’t create the tables. Read the message above, then run npm run setup again.');
  }

  step(4, 'Deploying the Worker…');
  const outputFile = tmpFile();
  fs.write(outputFile, '');
  if (!wrangler(['deploy'], { env: { WRANGLER_OUTPUT_FILE_PATH: outputFile } }).ok) {
    fail('The deploy failed. Read the message above, fix it, then run npm run setup again.');
  }
  let url = parseDeployUrl(fs.read(outputFile));
  if (!url) url = (await ask('Paste the https://….workers.dev address printed above: ')).trim().replace(/\/+$/, '');
  if (!/^https:\/\//.test(url)) fail(`"${url}" isn’t a web address.`);

  step(5, 'Setting the Worker’s keys…');
  const envPath = path.join(paths.root, '.env');
  const examplePath = path.join(paths.root, '.env.example');
  const envText = fs.exists(envPath) ? fs.read(envPath) : fs.exists(examplePath) ? fs.read(examplePath) : '';
  // Reuse the key already in .env, so running setup again never breaks an installed app.
  const apiKey = readEnvValue(envText, 'EXPO_PUBLIC_TRIPWIRE_KEY') ?? newKey();
  if (!wrangler(['secret', 'put', 'API_KEY'], { input: apiKey }).ok) fail('Couldn’t set API_KEY on the Worker.');
  const gecko = (
    await ask('Paste your free CoinGecko Demo key for steadier prices, or press Enter to skip: ')
  ).trim();
  if (gecko && !wrangler(['secret', 'put', 'COINGECKO_KEY'], { input: gecko }).ok) {
    fail('Couldn’t set COINGECKO_KEY on the Worker.');
  }

  step(6, 'Pointing the app at your server…');
  fs.write(envPath, upsertEnv(envText, { EXPO_PUBLIC_TRIPWIRE_API: url, EXPO_PUBLIC_TRIPWIRE_KEY: apiKey }));
  log('Wrote EXPO_PUBLIC_TRIPWIRE_API and EXPO_PUBLIC_TRIPWIRE_KEY to .env');

  const healthy = await checkHealth(url);
  log(
    healthy
      ? `\n✓ Your server is live at ${url}`
      : `\nDeployed to ${url}, but it didn’t answer yet. New workers.dev addresses can take a minute.`,
  );
  log(
    [
      '',
      'Next, in the project root:',
      '  npx eas-cli init        (once: gives the app a project ID for push)',
      '  npx expo start -c',
      'Then open Tripwires → Coverage. It should say your server is connected. Tap Send test alert.',
    ].join('\n'),
  );
  return { url, apiKey, databaseId };
}

function realDeps() {
  const server = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return {
    rl,
    deps: {
      paths: { server, root: path.resolve(server, '..') },
      log: (message) => console.log(message),
      ask: (question) => rl.question(question),
      newKey: randomKey,
      tmpFile: () => path.join(mkdtempSync(path.join(tmpdir(), 'tripwire-')), 'wrangler-output.ndjson'),
      fs: {
        read: (p) => readFileSync(p, 'utf8'),
        write: (p, data) => writeFileSync(p, data),
        exists: existsSync,
      },
      wrangler: (args, { capture = false, input, env } = {}) => {
        const result = spawnSync('npx', ['--no-install', 'wrangler', ...args], {
          cwd: server,
          encoding: 'utf8',
          input,
          env: { ...process.env, ...env },
          stdio: input !== undefined ? ['pipe', 'inherit', 'inherit'] : capture ? ['inherit', 'pipe', 'inherit'] : 'inherit',
          shell: process.platform === 'win32',
        });
        return { ok: result.status === 0, stdout: result.stdout ?? '' };
      },
      checkHealth: async (url) => {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          try {
            const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
            if (res.ok && (await res.text()).includes('tripwire ok')) return true;
          } catch {
            // not reachable yet
          }
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
        return false;
      },
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { rl, deps } = realDeps();
  try {
    await runSetup(deps);
  } catch (error) {
    console.error(`\n✗ ${error instanceof SetupError ? error.message : error}`);
    process.exitCode = 1;
  } finally {
    rl.close();
  }
}
