#!/usr/bin/env node
// prototir: publish a web or native build to Prototir from the terminal, or run as an MCP server
// so an AI assistant can do it for you.
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { servers } from '../src/config.mjs';
import { forgetLink } from '../src/config.mjs';
import { currentLink, link, publish, linkLabel, megabytes, PLATFORMS, ARCHITECTURES } from '../src/publish.mjs';

const HELP = `prototir: publish what you (or your AI) built to Prototir

Usage
  npx @prototir/cli publish [folder|file.zip]   Upload a build and get the link to finish publishing
  npx @prototir/cli link                        Link this computer to your Prototir account
  npx @prototir/cli whoami                      Show which account this computer is linked to
  npx @prototir/cli unlink                      Forget this computer's link
  npx @prototir/cli mcp                         Run as an MCP server for AI assistants

Publish options
  --title <text>        Title to start a new prototype with
  --slug <slug>         Add the build to an existing prototype of yours
  --version <label>     Version label, like 1.2 or "Beta 2"
  --native              A downloadable build instead of a web build; needs:
  --platform <name>       ${PLATFORMS.join(' | ')}
  --arch <name>           ${ARCHITECTURES.join(' | ')}
  --no-open             Do not open the browser

Other options
  --api <url>           Prototir API (default https://api.prototir.com/api, or PROTOTIR_API)
  --site <url>          Prototir website (default https://prototir.com, or PROTOTIR_SITE)

A web build is a folder (or ZIP) with index.html at its top. Given a project folder, publish uses
its dist/, build/ or out/ folder when that is where index.html is. Nothing is made public: the
build waits for you on prototir.com, where you choose the title, visibility and rights.`;

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		title: { type: 'string' },
		slug: { type: 'string' },
		version: { type: 'string' },
		native: { type: 'boolean', default: false },
		platform: { type: 'string' },
		arch: { type: 'string' },
		open: { type: 'boolean', default: true },
		'no-open': { type: 'boolean', default: false },
		api: { type: 'string' },
		site: { type: 'string' },
		help: { type: 'boolean', short: 'h', default: false },
	},
});

const [command = 'help', target] = positionals;
const where = servers(values);
const shouldOpen = values.open && !values['no-open'];

try {
	switch (values.help ? 'help' : command) {
		case 'publish':
			await runPublish(target ?? '.');
			break;
		case 'link':
			await ensureLinked({ force: true });
			break;
		case 'whoami': {
			const linked = await currentLink(where.api);
			console.log(linked ? `Linked to Prototir as ${linked.displayName}.` : 'Not linked. Run: npx @prototir/cli link');
			break;
		}
		case 'unlink':
			console.log((await forgetLink(where.api)) ? 'This computer is no longer linked.' : 'This computer was not linked.');
			break;
		case 'mcp': {
			const { runMcpServer } = await import('../src/mcp.mjs');
			await runMcpServer(where);
			break;
		}
		default:
			console.log(HELP);
	}
} catch (error) {
	console.error(`\n${error.message}`);
	process.exitCode = 1;
}

async function ensureLinked({ force = false } = {}) {
	if (!force) {
		const linked = await currentLink(where.api);
		if (linked) return linked;
	}
	const saved = await link(where.api, {
		label: linkLabel(),
		onCode: ({ code, verificationUrl }) => {
			console.log(`\nTo link this computer to your Prototir account, approve this code:\n\n    ${code}\n\n  ${verificationUrl}\n`);
			if (shouldOpen) openBrowser(verificationUrl);
			process.stdout.write('Waiting for approval');
		},
		onWait: () => process.stdout.write('.'),
	});
	console.log(`\nLinked as ${saved.displayName}.`);
	return saved;
}

async function runPublish(input) {
	const linked = await ensureLinked();
	const result = await publish(
		where,
		linked,
		input,
		{
			kind: values.native ? 'native' : 'web',
			platform: values.platform,
			architecture: values.arch,
			title: values.title,
			slug: values.slug,
			version: values.version,
		},
		{
			onStage: (stage) => console.log(stage),
			onProgress: (sent, total) => process.stdout.write(`\r  ${megabytes(sent)} of ${megabytes(total)} MB`),
		},
	);
	console.log(`\n\nUploaded from ${result.root}. Finish publishing here:\n\n  ${result.url}\n`);
	if (shouldOpen) openBrowser(result.url);
}

/** Best effort: on a machine with no browser the link is printed anyway. */
function openBrowser(url) {
	const [cmd, args] =
		process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
	try {
		spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
	} catch {
		// No browser here; the link is on screen.
	}
}
