// Linking and publishing, shared by the command line and the MCP server.
import { hostname } from 'node:os';
import { startLink, waitForLink, whoami, uploadBuild, PrototirError } from './api.mjs';
import { prepareBuild } from './build.mjs';
import { loadLink, saveLink } from './config.mjs';

export const PLATFORMS = ['windows', 'macos', 'linux'];
export const ARCHITECTURES = ['x64', 'arm64', 'universal'];

/** What the approval page shows, so the creator can tell this request from someone else's. */
export function linkLabel(client) {
	return `${client ?? 'Command line'} on ${hostname()}`.slice(0, 120);
}

/** The saved link if Prototir still accepts it, else null (and a dead link is never reused). */
export async function currentLink(api) {
	const link = await loadLink(api);
	if (!link) return null;
	const me = await whoami(api, link.token);
	return me ? { ...link, displayName: me.displayName } : null;
}

/**
 * Links this computer: shows the code through onCode({ code, verificationUrl }), waits for the
 * creator to approve it, and saves the token.
 */
export async function link(api, { label, onCode, onWait } = {}) {
	const start = await startLink(api, label ?? linkLabel());
	onCode?.(start);
	const approved = await waitForLink(api, start, { onWait });
	const saved = { token: approved.token, displayName: approved.displayName, linkedAt: new Date().toISOString() };
	await saveLink(api, saved);
	return saved;
}

/** Where the creator finishes: the prototype's builds in Studio, or the upload page for a new one. */
export function finishUrl(site, { slug, title } = {}) {
	if (slug) return `${site}/dashboard/${encodeURIComponent(slug)}/edit#builds`;
	return `${site}/dashboard/upload${title ? `?title=${encodeURIComponent(title)}` : ''}`;
}

/**
 * Uploads a build for the linked account. Options: kind ('web' or 'native'), platform and
 * architecture (native only), slug (an existing prototype), title (a new one), version.
 */
export async function publish(servers, linkInfo, input, options = {}, { onStage, onProgress } = {}) {
	const kind = options.kind ?? 'web';
	if (kind === 'native') {
		if (!PLATFORMS.includes(options.platform))
			throw new PrototirError(`A native build needs a platform: ${PLATFORMS.join(', ')}.`, 400);
		if (!ARCHITECTURES.includes(options.architecture))
			throw new PrototirError(`A native build needs an architecture: ${ARCHITECTURES.join(', ')}.`, 400);
	}

	onStage?.('Preparing the build');
	const build = await prepareBuild(input, { kind });
	try {
		onStage?.(`Uploading ${build.name} (${megabytes(build.size)} MB)`);
		const registered = await uploadBuild(
			servers.api,
			linkInfo.token,
			{ path: build.zipPath, name: build.name, size: build.size },
			{
				kind,
				platform: kind === 'native' ? options.platform : null,
				architecture: kind === 'native' ? options.architecture : null,
				slug: options.slug ?? null,
				versionLabel: options.version ?? null,
			},
			{ onProgress },
		);
		return {
			root: build.root,
			name: build.name,
			bytes: build.size,
			// A slug the account does not own still uploads; the build then waits on the upload page.
			url: finishUrl(servers.site, registered.forPrototype ? { slug: options.slug } : { title: options.title }),
			forPrototype: registered.forPrototype,
		};
	} finally {
		await build.cleanup();
	}
}

export function megabytes(bytes) {
	return Math.round((bytes / 1048576) * 10) / 10;
}
