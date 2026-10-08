// The MCP server: the same linking and publishing, as tools an AI assistant can call.
//
// Linking needs the creator to approve a code on prototir.com, which can take longer than a tool
// call is allowed to run. So prototir_link returns the code at once and keeps waiting in the
// background; prototir_whoami says whether it went through, and prototir_publish uses it.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { startLink, waitForLink } from './api.mjs';
import { saveLink, forgetLink } from './config.mjs';
import { currentLink, publish, linkLabel, megabytes, PLATFORMS, ARCHITECTURES } from './publish.mjs';

const INSTRUCTIONS = `Prototir (prototir.com) is where people publish working prototypes (web apps, games, tools) and get real players, sessions and feedback.
Use these tools when the user wants to publish, share, host or playtest something they built.
1. prototir_publish uploads a build. A web build is a folder (or .zip) with index.html at its top; for a project, build it first and pass the output folder (dist/, build/ or out/ is found automatically).
2. If this computer is not linked yet, call prototir_link, show the user the code and link, and ask them to approve it; then call prototir_publish again.
3. Nothing becomes public by itself: always give the user the returned link, where they choose the title, visibility and rights, and press Publish.`;

const text = (value) => ({ content: [{ type: 'text', text: value }] });

export async function runMcpServer(where) {
	const server = new McpServer({ name: 'prototir', version: '0.1.0' }, { instructions: INSTRUCTIONS });
	/** The link waiting for approval, if any: { code, verificationUrl, done, error }. */
	let pending = null;

	const client = () => server.server.getClientVersion()?.name;

	server.registerTool(
		'prototir_whoami',
		{
			title: 'Prototir account',
			description: 'Shows whether this computer is linked to a Prototir account, and as whom.',
			inputSchema: {},
		},
		async () => {
			const linked = await currentLink(where.api);
			if (linked) return text(`Linked to Prototir as ${linked.displayName}.`);
			if (pending && !pending.error)
				return text(`Not linked yet: waiting for approval of code ${pending.code} at ${pending.verificationUrl}.`);
			return text('Not linked. Call prototir_link to link this computer.');
		},
	);

	server.registerTool(
		'prototir_link',
		{
			title: 'Link to Prototir',
			description:
				'Links this computer to the user\'s Prototir account. Returns a code and a link the user must open and approve; the link completes in the background once they do.',
			inputSchema: {},
		},
		async () => {
			const linked = await currentLink(where.api);
			if (linked) return text(`Already linked to Prototir as ${linked.displayName}.`);
			if (pending && !pending.error)
				return text(`Waiting for approval. Ask the user to approve code ${pending.code} at ${pending.verificationUrl}`);

			const start = await startLink(where.api, linkLabel(client()));
			pending = { code: start.code, verificationUrl: start.verificationUrl, error: null };
			const mine = pending;
			waitForLink(where.api, start)
				.then((approved) =>
					saveLink(where.api, { token: approved.token, displayName: approved.displayName, linkedAt: new Date().toISOString() }),
				)
				.then(() => {
					if (pending === mine) pending = null;
				})
				.catch((error) => {
					mine.error = error.message;
				});
			return text(
				`Ask the user to open ${start.verificationUrl} and approve code ${start.code}. ` +
					`It expires in ${Math.round((start.expiresInSeconds ?? 600) / 60)} minutes. Once approved, call prototir_publish.`,
			);
		},
	);

	server.registerTool(
		'prototir_publish',
		{
			title: 'Publish to Prototir',
			description:
				'Uploads a build to the linked Prototir account and returns the link where the user finishes publishing (title, visibility, rights). ' +
				'A web build is a folder or .zip with index.html at its top; a project folder works too if its dist/, build/ or out/ folder holds index.html. ' +
				'Builds are never made public by this tool.',
			inputSchema: {
				path: z.string().describe('Absolute path to the build folder or .zip file.'),
				title: z.string().max(120).optional().describe('Title to suggest for a new prototype.'),
				slug: z.string().optional().describe('Add the build to this existing prototype of the user instead of starting a new one.'),
				version: z.string().max(40).optional().describe('Version label, like 1.2.'),
				kind: z.enum(['web', 'native']).default('web').describe('web (runs in the browser) or native (a download).'),
				platform: z.enum(PLATFORMS).optional().describe('Native builds only.'),
				architecture: z.enum(ARCHITECTURES).optional().describe('Native builds only.'),
			},
		},
		async (args) => {
			const linked = await currentLink(where.api);
			if (!linked) {
				return {
					...text(
						pending && !pending.error
							? `Not linked yet: the user still has to approve code ${pending.code} at ${pending.verificationUrl}. Try again once they have.`
							: 'This computer is not linked to Prototir yet. Call prototir_link first.',
					),
					isError: true,
				};
			}
			try {
				const result = await publish(where, linked, args.path, args);
				return text(
					`Uploaded ${result.name} (${megabytes(result.bytes)} MB, from ${result.root}) to ${linked.displayName}'s Prototir account. ` +
						`It is not public yet. Give the user this link to finish publishing: ${result.url}`,
				);
			} catch (error) {
				return { ...text(error.message), isError: true };
			}
		},
	);

	server.registerTool(
		'prototir_unlink',
		{
			title: 'Unlink from Prototir',
			description: 'Forgets this computer\'s link to Prototir.',
			inputSchema: {},
		},
		async () => text((await forgetLink(where.api)) ? 'Unlinked.' : 'This computer was not linked.'),
	);

	await server.connect(new StdioServerTransport());
}
