// The CLI as GitHub Actions runs it: a token from the environment, no browser, no prompt, and the
// result left in GITHUB_OUTPUT and the job summary. Prototir is a small fake on localhost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { envToken, isCi } from '../src/config.mjs';

const BIN = fileURLToPath(new URL('../bin/prototir.mjs', import.meta.url));
const TOKEN = 'ci-token-123';

/** A fake Prototir that accepts TOKEN and owns the slug "mine". Records what it was sent. */
async function fakePrototir() {
	const seen = { registered: null, paired: false };
	const server = createServer(async (req, res) => {
		const chunks = [];
		for await (const chunk of req) chunks.push(chunk);
		const body = chunks.length ? Buffer.concat(chunks) : null;
		const json = (status, data) => {
			res.writeHead(status, { 'content-type': 'application/json' });
			res.end(JSON.stringify(data));
		};
		const authorized = req.headers.authorization === `Bearer ${TOKEN}`;
		const base = `http://127.0.0.1:${server.address().port}`;

		if (req.url === '/api/editor/pair') return (seen.paired = true), json(200, { code: 'X', deviceCode: 'd' });
		if (!req.url.startsWith('/storage/') && !authorized) return json(401, {});
		if (req.method === 'GET' && req.url === '/api/editor/me') return json(200, { displayName: 'Ada' });
		if (req.method === 'POST' && req.url === '/api/me/uploads/direct')
			return json(200, {
				uploadRef: 'ref',
				uploadId: 'up',
				partSizeBytes: 8 * 1024 * 1024,
				parts: [{ partNumber: 1, url: `${base}/storage/part1` }],
			});
		if (req.method === 'PUT' && req.url === '/storage/part1') {
			res.writeHead(200, { etag: '"e1"' });
			return res.end();
		}
		if (req.method === 'POST' && req.url === '/api/me/uploads/direct/complete') return json(200, { claim: 'claim' });
		if (req.method === 'POST' && req.url === '/api/editor/uploads') {
			seen.registered = JSON.parse(body.toString());
			return json(200, { id: 'u1', forPrototype: seen.registered.slug === 'mine' });
		}
		json(404, {});
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	return { server, seen, api: `http://127.0.0.1:${server.address().port}/api` };
}

async function webBuild() {
	const root = await mkdtemp(join(tmpdir(), 'prototir-ci-'));
	await mkdir(join(root, 'build'), { recursive: true });
	await writeFile(join(root, 'build', 'index.html'), '<!doctype html><title>t</title>');
	return root;
}

function run(args, env) {
	return new Promise((resolve) => {
		execFile(process.execPath, [BIN, ...args], { env: { PATH: process.env.PATH, ...env } }, (error, stdout, stderr) =>
			resolve({ code: error?.code ?? 0, stdout, stderr }),
		);
	});
}

async function inActions(root, fake, extraEnv = {}) {
	const output = join(root, 'output.txt');
	const summary = join(root, 'summary.md');
	await writeFile(output, '');
	await writeFile(summary, '');
	return {
		output,
		summary,
		env: {
			CI: 'true',
			GITHUB_ACTIONS: 'true',
			GITHUB_OUTPUT: output,
			GITHUB_STEP_SUMMARY: summary,
			PROTOTIR_API: fake.api,
			PROTOTIR_SITE: 'https://prototir.test',
			PROTOTIR_HOME: join(root, 'home'),
			...extraEnv,
		},
	};
}

test('PROTOTIR_TOKEN and CI are read from the environment', () => {
	assert.equal(envToken({ PROTOTIR_TOKEN: '  abc ' }), 'abc');
	assert.equal(envToken({ PROTOTIR_TOKEN: '   ' }), null);
	assert.equal(envToken({}), null);
	assert.equal(isCi({ CI: 'true' }), true);
	assert.equal(isCi({ GITHUB_ACTIONS: 'true' }), true);
	assert.equal(isCi({}), false);
});

test('in GitHub Actions a token uploads to the slug and fills outputs and summary', async () => {
	const fake = await fakePrototir();
	const root = await webBuild();
	try {
		const ctx = await inActions(root, fake, { PROTOTIR_TOKEN: TOKEN });
		const result = await run(['publish', join(root, 'build'), '--slug', 'mine', '--version', 'build 7', '--no-open'], ctx.env);

		assert.equal(result.code, 0, result.stderr);
		assert.equal(fake.seen.registered.slug, 'mine');
		assert.equal(fake.seen.registered.versionLabel, 'build 7');
		assert.equal(fake.seen.registered.kind, 'web');
		assert.equal(fake.seen.paired, false, 'never asks for a code');
		assert.doesNotMatch(result.stdout, /\r/, 'no carriage-return progress in logs');

		const outputs = await readFile(ctx.output, 'utf8');
		assert.match(outputs, /^url=https:\/\/prototir\.test\/dashboard\/mine\/edit#builds$/m);
		assert.match(outputs, /^for-prototype=true$/m);
		assert.match(await readFile(ctx.summary, 'utf8'), /Use it on Prototir\]\(https:\/\/prototir\.test\/dashboard\/mine\/edit#builds\)/);
	} finally {
		fake.server.close();
		await rm(root, { recursive: true, force: true });
	}
});

test('a slug the account does not own still uploads, with a warning', async () => {
	const fake = await fakePrototir();
	const root = await webBuild();
	try {
		const ctx = await inActions(root, fake, { PROTOTIR_TOKEN: TOKEN });
		const result = await run(['publish', join(root, 'build'), '--slug', 'someone-else'], ctx.env);

		assert.equal(result.code, 0, result.stderr);
		assert.match(result.stdout, /^::warning::"someone-else" is not one of your prototypes/m);
		assert.match(await readFile(ctx.output, 'utf8'), /^for-prototype=false$/m);
	} finally {
		fake.server.close();
		await rm(root, { recursive: true, force: true });
	}
});

test('in CI without a token it fails at once instead of waiting for a code', async () => {
	const fake = await fakePrototir();
	const root = await webBuild();
	try {
		const ctx = await inActions(root, fake);
		const result = await run(['publish', join(root, 'build')], ctx.env);

		assert.equal(result.code, 1);
		assert.equal(fake.seen.paired, false);
		assert.match(result.stdout, /^::error::No Prototir token/m);
	} finally {
		fake.server.close();
		await rm(root, { recursive: true, force: true });
	}
});

test('a refused token fails with how to replace it', async () => {
	const fake = await fakePrototir();
	const root = await webBuild();
	try {
		const ctx = await inActions(root, fake, { PROTOTIR_TOKEN: 'expired' });
		const result = await run(['publish', join(root, 'build')], ctx.env);

		assert.equal(result.code, 1);
		assert.match(result.stderr, /refused PROTOTIR_TOKEN/);
		assert.equal(fake.seen.registered, null);
	} finally {
		fake.server.close();
		await rm(root, { recursive: true, force: true });
	}
});

test('token refuses to run in CI', async () => {
	const fake = await fakePrototir();
	const root = await webBuild();
	try {
		const ctx = await inActions(root, fake);
		const result = await run(['token'], ctx.env);
		assert.equal(result.code, 1);
		assert.equal(fake.seen.paired, false);
	} finally {
		fake.server.close();
		await rm(root, { recursive: true, force: true });
	}
});
