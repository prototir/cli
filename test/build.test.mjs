import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yauzl from 'yauzl';
import { prepareBuild, findWebRoot, BuildError } from '../src/build.mjs';
import { finishUrl, size } from '../src/publish.mjs';

async function project(files) {
	const root = await mkdtemp(join(tmpdir(), 'prototir-test-'));
	for (const [path, content] of Object.entries(files)) {
		await mkdir(join(root, path, '..'), { recursive: true });
		await writeFile(join(root, path), content);
	}
	return root;
}

const entries = (zip) =>
	new Promise((resolve, reject) =>
		yauzl.open(zip, { lazyEntries: true }, (error, file) => {
			if (error) return reject(error);
			const names = [];
			file.on('entry', (e) => (names.push(e.fileName), file.readEntry()));
			file.on('end', () => resolve(names.sort()));
			file.readEntry();
		}),
	);

test('a folder with index.html is the build itself', async () => {
	const root = await project({ 'index.html': '<p>hi</p>', 'assets/app.js': '1' });
	assert.equal(await findWebRoot(root), root);
	await rm(root, { recursive: true });
});

test('a project folder publishes its dist/ output', async () => {
	const root = await project({ 'package.json': '{}', 'src/main.js': '1', 'dist/index.html': 'x', 'dist/a.js': '1' });
	const build = await prepareBuild(root);
	assert.equal(build.root, join(root, 'dist'));
	assert.deepEqual(await entries(build.zipPath), ['a.js', 'index.html']);
	await build.cleanup();
	await rm(root, { recursive: true });
});

test('source code without a build is refused with a hint to build it', async () => {
	const root = await project({ 'package.json': '{}', 'src/main.js': '1' });
	await assert.rejects(prepareBuild(root), (error) => error instanceof BuildError && /npm run build/.test(error.message));
	await rm(root, { recursive: true });
});

test('node_modules and .git never go into the ZIP', async () => {
	const root = await project({ 'index.html': 'x', 'node_modules/big/index.js': '1', '.git/HEAD': 'ref', 'game.js': '1' });
	const build = await prepareBuild(root);
	assert.deepEqual(await entries(build.zipPath), ['game.js', 'index.html']);
	await build.cleanup();
	await rm(root, { recursive: true });
});

test('a native build is zipped as it is, with no index.html needed', async () => {
	const root = await project({ 'Game.exe': 'MZ', 'Game_Data/level0': '1' });
	const build = await prepareBuild(root, { kind: 'native' });
	assert.deepEqual(await entries(build.zipPath), ['Game.exe', 'Game_Data/level0']);
	await build.cleanup();
	await rm(root, { recursive: true });
});

test('a web ZIP must have index.html at its top or inside one folder', async () => {
	// Zipped as native so the folder is kept: index.html sits inside site/, one level down.
	const good = await project({ 'site/index.html': 'x', 'site/app.js': '1' });
	const zipped = await prepareBuild(good, { kind: 'native' });
	assert.ok((await prepareBuild(zipped.zipPath)).size > 0);
	await zipped.cleanup();

	const bad = await project({ 'a/b/index.html': 'x', 'c.txt': '1' });
	const deep = await prepareBuild(bad, { kind: 'native' });
	await assert.rejects(prepareBuild(deep.zipPath), BuildError);
	await deep.cleanup();
	await rm(good, { recursive: true });
	await rm(bad, { recursive: true });
});

test('the finish link points at the prototype, or at the upload page for a new one', () => {
	assert.equal(finishUrl('https://prototir.com', { slug: 'my-game' }), 'https://prototir.com/dashboard/my-game/edit#builds');
	assert.equal(finishUrl('https://prototir.com', { title: 'Tiny Knight' }), 'https://prototir.com/dashboard/upload?title=Tiny%20Knight');
});

test('sizes read in KB below a megabyte', () => {
	assert.equal(size(300), '1 KB');
	assert.equal(size(51200), '50 KB');
	assert.equal(size(5 * 1048576), '5 MB');
});
