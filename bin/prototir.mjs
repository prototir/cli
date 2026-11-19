#!/usr/bin/env node
// prototir: publish a web or native build to Prototir from the terminal, or run as an MCP server
// so an AI assistant can do it for you.
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { servers, forgetLink, isCi } from '../src/config.mjs';
import { currentLink, link, publish, linkLabel, ciTokenLabel, size, PLATFORMS, ARCHITECTURES } from '../src/publish.mjs';
import { reportToGitHub, errorAnnotation } from '../src/github.mjs';

const HELP = `prototir: publish what you (or your AI) built to Prototir

Usage
  npx @prototir/cli publish [folder|file.zip]   Upload a build and get the link to finish publishing
  npx @prototir/cli link                        Link this computer to your Prototir account
  npx @prototir/cli whoami                      Show which account this computer is linked to
  npx @prototir/cli unlink                      Forget this computer's link
  npx @prototir/cli token                       Create an upload token for CI (GitHub Actions)
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

In CI, set PROTOTIR_TOKEN to a token from \`npx @prototir/cli token\` (keep it in a secret).

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
const ci = isCi();
const shouldOpen = values.open && !values['no-open'] && !ci;

try {
	switch (values.help ? 'help' : command) {
		case 'publish':
			await runPublish(target ?? '.');
			break;
		case 'link':
			await ensureLinked({ force: true });
			break;
		case 'token':
			await runToken();
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
	const annotated = errorAnnotation(error.message);
	if (annotated) console.log(annotated);
	process.exitCode = 1;
}

async function ensureLinked({ force = false } = {}) {
	if (!force) {
		const linked = await currentLink(where.api);
		if (linked) return linked;
	}
	// Nobody is at a CI runner to approve a code, so waiting for one would only hang the job.
	if (ci)
		throw new Error(
			'No Prototir token. Set PROTOTIR_TOKEN to a token from `npx @prototir/cli token`, ' +
				'run on your own computer and saved as a secret.',
		);
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
			// A carriage-return progress line is one unreadable wall of text in a CI log.
			onProgress: process.stdout.isTTY
				? (sent, total) => process.stdout.write(`\r  ${size(sent)} of ${size(total)}`)
				: undefined,
		},
	);
	console.log(`\n\nUploaded from ${result.root}. Finish publishing here:\n\n  ${result.url}\n`);
	for (const line of await reportToGitHub(result, { requestedSlug: values.slug })) console.log(line);
	if (shouldOpen) openBrowser(result.url);
}

/**
 * A token for CI: its own link, approved like any other and revocable on its own, so unlinking it
 * never unlinks this computer. It is printed, not saved here: it belongs in the CI's secrets.
 */
async function runToken() {
	if (ci) throw new Error('Run `npx @prototir/cli token` on your own computer, not in CI.');
	const created = await link(where.api, {
		label: ciTokenLabel(),
		save: false,
		onCode: ({ code, verificationUrl }) => {
			console.log(`\nTo create a CI token for your Prototir account, approve this code:\n\n    ${code}\n\n  ${verificationUrl}\n`);
			if (shouldOpen) openBrowser(verificationUrl);
			process.stdout.write('Waiting for approval');
		},
		onWait: () => process.stdout.write('.'),
	});
	console.log(
		`\nToken for ${created.displayName}:\n\n${created.token}\n\n` +
			'Save it as a repository secret named PROTOTIR_TOKEN. It can only upload builds that wait for\n' +
			'you on Prototir; it cannot publish or change anything. It expires after 90 days, and you can\n' +
			'unlink it any time from your account settings.',
	);
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
