// Prototir's API for linked clients: the same calls the Unity, Godot and Unreal editors make.
//
// Linking is a device code: this computer asks for a code, the creator approves it on
// prototir.com, and the poll returns a token that can only stage uploads. Uploading goes straight
// to storage in parts through presigned URLs, and registering the result makes it wait for the
// creator on the website, where they finish publishing. Nothing here can publish on its own.
import { open } from 'node:fs/promises';

export class PrototirError extends Error {
	constructor(message, status) {
		super(message);
		this.status = status;
	}
}

async function call(api, method, path, { body, token } = {}) {
	let response;
	try {
		response = await fetch(api + path, {
			method,
			headers: {
				...(body === undefined ? {} : { 'content-type': 'application/json' }),
				...(token ? { authorization: `Bearer ${token}` } : {}),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	} catch (error) {
		throw new PrototirError(`Could not reach Prototir at ${api} (${error.cause?.code ?? error.message}).`, 0);
	}
	const text = await response.text();
	let data = null;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		data = null;
	}
	return { status: response.status, data };
}

function fail(result, fallback) {
	if (result.status === 401) return new PrototirError('This computer is no longer linked to Prototir. Link it again.', 401);
	return new PrototirError(result.data?.error ?? `${fallback} (HTTP ${result.status}).`, result.status);
}

/** Asks for a code to approve on prototir.com. */
export async function startLink(api, label) {
	const result = await call(api, 'POST', '/editor/pair', { body: { engine: 'cli', editorLabel: label } });
	if (result.status !== 200) throw fail(result, 'Prototir did not start the link');
	return result.data;
}

/** One poll: { pending: true }, { token, displayName } once approved, or throws when the code is dead. */
export async function pollLink(api, code) {
	const result = await call(api, 'POST', '/editor/pair/poll', { body: { code } });
	if (result.status === 202) return { pending: true, intervalSeconds: result.data?.intervalSeconds ?? 5 };
	if (result.status === 200) return result.data;
	// The API's own wording speaks to editors; here the way out is simply to run the command again.
	if (result.status === 410)
		throw new PrototirError('The code expired or was already used. Run the command again to get a new one.', 410);
	throw fail(result, 'The link was not approved');
}

/** Polls until the code is approved or expires. */
export async function waitForLink(api, start, { onWait } = {}) {
	const deadline = Date.now() + (start.expiresInSeconds ?? 600) * 1000;
	let interval = start.intervalSeconds ?? 5;
	while (Date.now() < deadline) {
		await sleep(interval * 1000);
		const result = await pollLink(api, start.code);
		if (!result.pending) return result;
		interval = result.intervalSeconds ?? interval;
		onWait?.();
	}
	throw new PrototirError('The code expired before it was approved. Run the command again to get a new one.', 410);
}

/** Who this computer is linked as, or null if the token no longer works. */
export async function whoami(api, token) {
	const result = await call(api, 'GET', '/editor/me', { token });
	if (result.status === 401) return null;
	if (result.status !== 200) throw fail(result, 'Prototir did not answer');
	return result.data;
}

const PART_ATTEMPTS = 4;

/**
 * Uploads the file at path to staging and registers it. Returns the registered upload.
 * `onProgress(sentBytes, totalBytes)` is called after each part.
 */
export async function uploadBuild(api, token, file, details, { onProgress } = {}) {
	const start = await call(api, 'POST', '/me/uploads/direct', { token, body: { sizeBytes: file.size } });
	if (start.status !== 200) throw fail(start, 'Prototir did not start the upload');
	const { uploadRef, uploadId, partSizeBytes, parts } = start.data;

	const done = [];
	let sent = 0;
	const handle = await open(file.path, 'r');
	try {
		for (const part of parts) {
			const offset = (part.partNumber - 1) * partSizeBytes;
			const length = Math.min(partSizeBytes, file.size - offset);
			if (length <= 0) continue;
			// One part in memory at a time, so a large native build does not need its size in RAM.
			const bytes = Buffer.alloc(length);
			await handle.read(bytes, 0, length, offset);
			done.push({ partNumber: part.partNumber, etag: await putPart(part.url, bytes) });
			sent += length;
			onProgress?.(sent, file.size);
		}
	} catch (error) {
		await call(api, 'DELETE', `/me/uploads/direct/${encodeURIComponent(uploadRef)}?uploadId=${encodeURIComponent(uploadId)}`, { token }).catch(() => {});
		throw error;
	} finally {
		await handle.close();
	}

	const complete = await call(api, 'POST', '/me/uploads/direct/complete', { token, body: { uploadRef, uploadId, parts: done } });
	if (complete.status !== 200) throw fail(complete, 'Prototir did not accept the upload');

	const registered = await call(api, 'POST', '/editor/uploads', {
		token,
		body: { claim: complete.data.claim, fileName: file.name, engine: 'cli', ...details },
	});
	if (registered.status !== 200) throw fail(registered, 'Prototir did not register the upload');
	return registered.data;
}

/** A storage refusal (4xx) will not change on retry; a dropped connection or a 5xx might. */
async function putPart(url, bytes) {
	for (let attempt = 1; ; attempt++) {
		let status = 0;
		try {
			const response = await fetch(url, { method: 'PUT', body: bytes });
			status = response.status;
			const etag = response.headers.get('etag');
			if (response.ok && etag) return etag;
		} catch {
			status = 0;
		}
		if ((status !== 0 && status < 500) || attempt >= PART_ATTEMPTS)
			throw new PrototirError('Storage did not accept part of the upload. Check the connection and try again.', status);
		await sleep(500 * 2 ** attempt);
	}
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
