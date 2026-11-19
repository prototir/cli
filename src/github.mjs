// What a publish leaves behind in GitHub Actions: step outputs for later steps, a job summary for
// the person reading the run, and a warning when the build did not land where it was asked to.
// Outside GitHub Actions every function here does nothing.
import { appendFile } from 'node:fs/promises';
import { size } from './publish.mjs';

/** GitHub's syntax for a one-line annotation; newlines would end it early. */
function annotation(kind, message) {
	return `::${kind}::${String(message).replace(/\r?\n/g, ' ')}`;
}

export function errorAnnotation(message, env = process.env) {
	return env.GITHUB_ACTIONS === 'true' ? annotation('error', message) : null;
}

/**
 * Records a finished publish. `requestedSlug` is the slug the run asked for: when Prototir did not
 * file the build under it (the account does not own it), the build waits on the upload page
 * instead, which is easy to miss in a green run.
 */
export async function reportToGitHub(result, { requestedSlug } = {}, env = process.env) {
	if (env.GITHUB_ACTIONS !== 'true') return [];
	const lines = [];
	if (env.GITHUB_OUTPUT)
		await appendFile(env.GITHUB_OUTPUT, `url=${result.url}\nfor-prototype=${result.forPrototype}\n`);
	if (env.GITHUB_STEP_SUMMARY) {
		await appendFile(
			env.GITHUB_STEP_SUMMARY,
			[
				'### Build uploaded to Prototir',
				'',
				`**${result.name}** (${size(result.bytes)}) is waiting for you. [Use it on Prototir](${result.url})`,
				'',
				'Nothing is published until you choose it there.',
				'',
			].join('\n'),
		);
	}
	if (requestedSlug && !result.forPrototype)
		lines.push(
			annotation(
				'warning',
				`"${requestedSlug}" is not one of your prototypes, so the build is waiting on the upload page instead.`,
			),
		);
	return lines;
}
