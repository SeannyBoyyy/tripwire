// The whole `npm run setup` flow against a pretend wrangler, plus its helpers. No Cloudflare involved.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  findDatabaseId, parseDatabaseId, parseDeployUrl, readEnvValue, setDatabaseId, upsertEnv,
} from '../scripts/lib.mjs';
import { runSetup, SetupError } from '../scripts/setup.mjs';

const ID = '3f2a9c1e-7b4d-4e8a-9f10-5c6d7e8f9a0b';
const URL_ = 'https://tripwire.example-sub.workers.dev';
const TOML = 'name = "tripwire"\n\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "tripwire"\ndatabase_id = "paste-the-id-printed-by-wrangler-d1-create"\n';
const ENV_EXAMPLE = '# comment kept\nEXPO_PUBLIC_COINGECKO_KEY=\n\nEXPO_PUBLIC_TRIPWIRE_API=\nEXPO_PUBLIC_TRIPWIRE_KEY=\n';

type Opts = {
  loggedIn?: boolean; databases?: { name: string; uuid: string }[]; deployUrl?: string | null;
  failDeploy?: boolean; failSchema?: boolean; createPrints?: boolean; answers?: Record<string, string>; env?: string; healthy?: boolean;
};

function setup(opts: Opts = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'tw-root-'));
  const server = path.join(root, 'server');
  mkdirSync(server);
  writeFileSync(path.join(server, 'wrangler.toml'), TOML);
  writeFileSync(path.join(root, '.env.example'), ENV_EXAMPLE);
  if (opts.env !== undefined) writeFileSync(path.join(root, '.env'), opts.env);

  const s = { loggedIn: opts.loggedIn ?? false, databases: [...(opts.databases ?? [])], secrets: {} as Record<string, string>, calls: [] as string[][] };
  const deployUrl = opts.deployUrl === undefined ? URL_ : opts.deployUrl;
  const answers = { 'database_id': ID, 'workers.dev': URL_, 'CoinGecko': '', ...opts.answers };
  const logs: string[] = [];

  const wrangler = (args: string[], o: { input?: string; env?: Record<string, string> } = {}) => {
    s.calls.push(args);
    const cmd = args.slice(0, 2).join(' ');
    if (args[0] === 'whoami') return { ok: s.loggedIn, stdout: s.loggedIn ? '{"loggedIn":true}' : '{"loggedIn":false}' };
    if (args[0] === 'login') { s.loggedIn = true; return { ok: true, stdout: '' }; }
    if (cmd === 'd1 list') return { ok: true, stdout: JSON.stringify(s.databases) };
    if (cmd === 'd1 create') {
      s.databases.push({ name: 'tripwire', uuid: ID });
      const printed = opts.createPrints === false ? 'something unexpected' : `✅ Successfully created DB 'tripwire'\n{ "d1_databases": [ { "binding": "tripwire", "database_id": "${ID}" } ] }`;
      return { ok: true, stdout: printed };
    }
    if (cmd === 'd1 execute') return { ok: !opts.failSchema, stdout: '' };
    if (args[0] === 'deploy') {
      if (opts.failDeploy) return { ok: false, stdout: '' };
      if (deployUrl) writeFileSync(o.env!.WRANGLER_OUTPUT_FILE_PATH, `${JSON.stringify({ type: 'deploy', version: 1, targets: [deployUrl] })}\n`);
      return { ok: true, stdout: '' };
    }
    if (args[0] === 'secret') { s.secrets[args[2]] = o.input ?? ''; return { ok: true, stdout: '' }; }
    throw new Error(`unexpected wrangler call: ${args.join(' ')}`);
  };

  const deps = {
    wrangler,
    paths: { server, root },
    log: (m: string) => logs.push(m),
    ask: async (q: string) => Object.entries(answers).find(([k]) => q.includes(k))?.[1] ?? '',
    newKey: () => 'generated-key-0001',
    tmpFile: () => path.join(mkdtempSync(path.join(tmpdir(), 'tw-out-')), 'out.ndjson'),
    fs: { read: (p: string) => readFileSync(p, 'utf8'), write: (p: string, d: string) => writeFileSync(p, d), exists: existsSync },
    checkHealth: async () => opts.healthy ?? true,
  };
  const read = (f: string) => readFileSync(path.join(root, f), 'utf8');
  return { deps, s, logs, read, exists: (f: string) => existsSync(path.join(root, f)) };
}

describe('runSetup', () => {
  it('goes from nothing to a deployed server and a configured app', async () => {
    const t = setup({ answers: { CoinGecko: 'CG-demo-key' } });
    const result = await runSetup(t.deps);

    assert.equal(result.url, URL_);
    assert.deepEqual(t.s.calls.filter((c) => c[0] === 'login').length, 1, 'signs in when it has to');
    assert.ok(t.s.calls.some((c) => c.join(' ') === 'd1 create tripwire'));
    assert.match(t.read('server/wrangler.toml'), new RegExp(`database_id = "${ID}"`));

    const execute = t.s.calls.find((c) => c[0] === 'd1' && c[1] === 'execute')!;
    assert.deepEqual(execute.slice(3), ['--remote', '--file=schema.sql', '--yes']);

    // the Worker must exist before secrets are put on it, or wrangler stops to ask about creating one
    const order = t.s.calls.map((c) => c[0]);
    assert.ok(order.indexOf('deploy') < order.indexOf('secret'));
    assert.equal(t.s.secrets.API_KEY, 'generated-key-0001');
    assert.equal(t.s.secrets.COINGECKO_KEY, 'CG-demo-key');

    const env = t.read('.env');
    assert.match(env, /^# comment kept$/m, 'keeps the template’s comments');
    assert.match(env, new RegExp(`^EXPO_PUBLIC_TRIPWIRE_API=${URL_}$`, 'm'));
    assert.match(env, /^EXPO_PUBLIC_TRIPWIRE_KEY=generated-key-0001$/m);
    assert.ok(t.logs.join('\n').includes('✓ Your server is live'));
  });

  it('is safe to run again: reuses the database and the existing key, keeps other settings', async () => {
    const t = setup({
      loggedIn: true,
      databases: [{ name: 'tripwire', uuid: ID }],
      env: 'EXPO_PUBLIC_COINGECKO_KEY=mine\nEXPO_PUBLIC_TRIPWIRE_API=https://old.example\nEXPO_PUBLIC_TRIPWIRE_KEY=existing-key-xyz\n',
    });
    await runSetup(t.deps);

    assert.ok(!t.s.calls.some((c) => c[0] === 'login'), 'no second sign-in');
    assert.ok(!t.s.calls.some((c) => c.join(' ') === 'd1 create tripwire'), 'no duplicate database');
    assert.equal(t.s.secrets.API_KEY, 'existing-key-xyz', 'the key an installed app already holds is not rotated');
    assert.equal(t.s.secrets.COINGECKO_KEY, undefined, 'skipping the CoinGecko prompt leaves any existing secret alone');
    const env = t.read('.env');
    assert.match(env, /^EXPO_PUBLIC_COINGECKO_KEY=mine$/m);
    assert.match(env, new RegExp(`^EXPO_PUBLIC_TRIPWIRE_API=${URL_}$`, 'm'));
    assert.match(env, /^EXPO_PUBLIC_TRIPWIRE_KEY=existing-key-xyz$/m);
  });

  it('stops on a failed deploy before touching secrets or .env', async () => {
    const t = setup({ loggedIn: true, failDeploy: true });
    await assert.rejects(runSetup(t.deps), (e: Error) => e instanceof SetupError && /deploy failed/i.test(e.message));
    assert.deepEqual(t.s.secrets, {});
    assert.ok(!t.exists('.env'));
  });

  it('stops when the tables can’t be created', async () => {
    const t = setup({ loggedIn: true, failSchema: true });
    await assert.rejects(runSetup(t.deps), /tables/);
    assert.ok(!t.s.calls.some((c) => c[0] === 'deploy'));
  });

  it('asks you for the address when wrangler’s output doesn’t contain it', async () => {
    const t = setup({ loggedIn: true, deployUrl: null, answers: { 'workers.dev': 'https://pasted.example.workers.dev/' } });
    const result = await runSetup(t.deps);
    assert.equal(result.url, 'https://pasted.example.workers.dev');
  });

  it('asks you for the database id when it can’t read it, and refuses nonsense', async () => {
    const ok = setup({ loggedIn: true, createPrints: false });
    assert.equal((await runSetup(ok.deps)).databaseId, ID);
    const bad = setup({ loggedIn: true, createPrints: false, answers: { database_id: 'not-an-id' } });
    await assert.rejects(runSetup(bad.deps), /doesn’t look like a database id/);
  });

  it('still finishes, with a gentler message, when the new address isn’t answering yet', async () => {
    const t = setup({ loggedIn: true, healthy: false });
    await runSetup(t.deps);
    assert.ok(t.logs.join('\n').includes('didn’t answer yet'));
  });
});

describe('setup helpers', () => {
  it('rewrites only the database_id line', () => {
    const out = setDatabaseId(TOML, ID);
    assert.match(out, new RegExp(`database_id = "${ID}"`));
    assert.match(out, /binding = "DB"/);
    assert.throws(() => setDatabaseId('name = "x"\n', ID), /no database_id/);
  });

  it('reads ids from either config flavour wrangler prints', () => {
    assert.equal(parseDatabaseId(`"database_id": "${ID}"`), ID);
    assert.equal(parseDatabaseId(`database_id = "${ID}"`), ID);
    assert.equal(parseDatabaseId('nothing here'), null);
    assert.equal(findDatabaseId(JSON.stringify([{ name: 'other', uuid: 'x' }, { name: 'tripwire', uuid: ID }]), 'tripwire'), ID);
    assert.equal(findDatabaseId('not json', 'tripwire'), null);
  });

  it('takes the last deploy entry and ignores noise', () => {
    const file = `garbage\n${JSON.stringify({ type: 'wrangler-session' })}\n${JSON.stringify({ type: 'deploy', targets: ['https://a.workers.dev'] })}\n${JSON.stringify({ type: 'deploy', targets: ['https://b.workers.dev/'] })}\n`;
    assert.equal(parseDeployUrl(file), 'https://b.workers.dev');
    assert.equal(parseDeployUrl(''), null);
  });

  it('upserts .env lines without disturbing the rest', () => {
    assert.equal(upsertEnv('A=1', { B: '2' }), 'A=1\nB=2\n');
    assert.equal(upsertEnv('A=1\nB=old\n', { B: 'new' }), 'A=1\nB=new\n');
    assert.equal(upsertEnv('', { A: 'x$&y' }), 'A=x$&y\n', 'special characters in values are safe');
    assert.equal(readEnvValue('A=1\nB=\n', 'B'), null);
    assert.equal(readEnvValue('A=1\nB= two \n', 'B'), 'two');
  });
});
