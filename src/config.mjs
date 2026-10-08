// Where Prototir is, and the upload token this computer got when it was linked.
//
// Tokens are kept per server, so linking against a local development API never offers its token
// to production (or the other way round). The file lives in the user's home folder, readable only
// by them where the platform supports it.
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_API = 'https://api.prototir.com/api';
export const DEFAULT_SITE = 'https://prototir.com';

/** The API and website to use: flags first, then PROTOTIR_API / PROTOTIR_SITE, then production. */
export function servers(options = {}) {
	const api = trimSlash(options.api ?? process.env.PROTOTIR_API ?? DEFAULT_API);
	const site = trimSlash(options.site ?? process.env.PROTOTIR_SITE ?? siteFor(api));
	return { api, site };
}

/** A local API (http://localhost:7071/api) pairs with the local website; anything else with prototir.com. */
function siteFor(api) {
	return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(api) ? 'http://localhost:5173' : DEFAULT_SITE;
}

function trimSlash(url) {
	return String(url).trim().replace(/\/+$/, '');
}

export function credentialsPath() {
	return join(process.env.PROTOTIR_HOME ?? join(homedir(), '.prototir'), 'credentials.json');
}

async function readAll() {
	try {
		return JSON.parse(await readFile(credentialsPath(), 'utf8'));
	} catch {
		return {};
	}
}

/** The saved link for this API, or null. */
export async function loadLink(api) {
	const all = await readAll();
	return all[api] ?? null;
}

export async function saveLink(api, link) {
	const all = await readAll();
	all[api] = link;
	const path = credentialsPath();
	await mkdir(join(path, '..'), { recursive: true });
	await writeFile(path, JSON.stringify(all, null, 2), { mode: 0o600 });
}

export async function forgetLink(api) {
	const all = await readAll();
	if (!(api in all)) return false;
	delete all[api];
	if (Object.keys(all).length === 0) await rm(credentialsPath(), { force: true });
	else await writeFile(credentialsPath(), JSON.stringify(all, null, 2), { mode: 0o600 });
	return true;
}
