// Finds the build to upload and turns it into one ZIP.
//
// AI tools and coding agents usually leave a whole project behind, not just the build, so for a
// web build this looks for the folder that actually holds index.html (the folder itself, or the
// usual dist/, build/ or out/) and refuses plain source code with a hint to build it first.
import { createWriteStream } from 'node:fs';
import { readdir, stat, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join, relative, sep } from 'node:path';
import yazl from 'yazl';
import yauzl from 'yauzl';

/** Where web builds usually land, in the order they are tried. */
export const OUTPUT_FOLDERS = ['dist', 'build', 'out', 'public', 'www'];

/** Never part of a build, and often huge. */
const SKIPPED = new Set(['node_modules', '.git', '.svn', '.hg', '.DS_Store', 'Thumbs.db']);

export class BuildError extends Error {}

const exists = (path) => stat(path).then(() => true, () => false);

/**
 * Resolves what to upload. Returns { zipPath, name, size, root, cleanup }: zipPath is the input
 * itself for a ZIP, or a temporary ZIP of the build folder, which cleanup() removes.
 */
export async function prepareBuild(input, { kind = 'web' } = {}) {
	const info = await stat(input).catch(() => null);
	if (!info) throw new BuildError(`Nothing found at ${input}.`);

	if (info.isFile()) {
		if (extname(input).toLowerCase() !== '.zip') throw new BuildError('Give a folder or a .zip file.');
		if (kind === 'web') await checkWebZip(input);
		return { zipPath: input, name: basename(input), size: info.size, root: input, cleanup: async () => {} };
	}

	const root = kind === 'web' ? await findWebRoot(input) : input;
	const name = `${basename(input === '.' ? process.cwd() : input) || 'build'}.zip`;
	const folder = await mkdtemp(join(tmpdir(), 'prototir-'));
	const zipPath = join(folder, name);
	await zipFolder(root, zipPath);
	return {
		zipPath,
		name,
		size: (await stat(zipPath)).size,
		root,
		cleanup: () => rm(folder, { recursive: true, force: true }),
	};
}

/** The folder holding index.html: the input, or one of its usual output folders. */
export async function findWebRoot(folder) {
	if (await exists(join(folder, 'index.html'))) return folder;
	for (const candidate of OUTPUT_FOLDERS) {
		if (await exists(join(folder, candidate, 'index.html'))) return join(folder, candidate);
	}
	if (await exists(join(folder, 'package.json')))
		throw new BuildError(
			'This looks like source code, not a build: there is no index.html here or in dist/, build/ or out/. ' +
				'Build it first (for example npm run build), then publish the output folder.',
		);
	throw new BuildError('No index.html found. A web build needs an index.html at its top level.');
}

/** Refuses a web ZIP whose index.html is missing or buried deeper than one folder. */
async function checkWebZip(path) {
	const names = await zipEntries(path);
	const tops = new Set(names.map((n) => n.split('/')[0]));
	const atRoot = names.includes('index.html');
	const inOneFolder = tops.size === 1 && names.some((n) => /^[^/]+\/index\.html$/.test(n));
	if (!atRoot && !inOneFolder) throw new BuildError('This ZIP has no index.html at its top level, so it is not a web build.');
}

function zipEntries(path) {
	return new Promise((resolve, reject) => {
		yauzl.open(path, { lazyEntries: true }, (error, zip) => {
			if (error) return reject(new BuildError(`This ZIP could not be read (${error.message}).`));
			const names = [];
			zip.on('entry', (entry) => {
				names.push(entry.fileName);
				zip.readEntry();
			});
			zip.on('end', () => resolve(names));
			zip.on('error', (e) => reject(new BuildError(`This ZIP could not be read (${e.message}).`)));
			zip.readEntry();
		});
	});
}

async function* files(root, folder = root) {
	for (const entry of await readdir(folder, { withFileTypes: true })) {
		if (SKIPPED.has(entry.name)) continue;
		const path = join(folder, entry.name);
		if (entry.isDirectory()) yield* files(root, path);
		else if (entry.isFile()) yield path;
	}
}

async function zipFolder(root, target) {
	const zip = new yazl.ZipFile();
	let count = 0;
	for await (const path of files(root)) {
		zip.addFile(path, relative(root, path).split(sep).join('/'));
		count++;
	}
	if (count === 0) throw new BuildError('The folder is empty.');
	await new Promise((resolve, reject) => {
		const out = createWriteStream(target);
		zip.outputStream.pipe(out).on('close', resolve).on('error', reject);
		zip.end();
	});
}
