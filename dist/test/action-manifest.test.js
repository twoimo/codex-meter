import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/**
 * GitHub fails the whole workflow with "Mapping values are not allowed in this
 * context" when a manifest string contains an unquoted colon, and it only
 * reports that at run time. Parsing the manifest here turns that into a build
 * failure instead.
 */
async function manifest() {
    const text = await readFile(path.join(REPO_ROOT, 'action.yml'), 'utf8');
    const parsed = parse(text);
    assert.ok(parsed, 'action.yml did not parse as YAML');
    return parsed;
}
test('action.yml is valid YAML and declares the expected entry point', async () => {
    const parsed = await manifest();
    assert.equal(parsed['name'], 'codex-meter');
    assert.equal(typeof parsed['description'], 'string');
    assert.ok(parsed['description'].length > 20, 'description should say what the action does');
    assert.equal(parsed['runs']?.['using'], 'composite');
    const steps = parsed['runs']?.['steps'];
    assert.ok(Array.isArray(steps) && steps.length > 0, 'composite actions need steps');
    const runSteps = steps.filter((step) => typeof step['run'] === 'string');
    assert.ok(runSteps.some((step) => /dist\/src\/cli\.js/.test(String(step['run']))), 'one step must execute the built CLI (dist/src/cli.js)');
    assert.ok(steps.some((step) => step['uses'] === 'actions/setup-node@v4'), 'the action installs Node itself');
});
test('every input and output is documented', async () => {
    const parsed = await manifest();
    const inputs = parsed['inputs'];
    const outputs = parsed['outputs'];
    for (const [name, input] of Object.entries(inputs)) {
        assert.equal(typeof input['description'], 'string', `input ${name} needs a description`);
        assert.ok(input['description'].trim().length > 0, `input ${name} needs a description`);
        if ('required' in input)
            assert.equal(typeof input['required'], 'boolean', `input ${name} required must be a boolean`);
    }
    for (const [name, output] of Object.entries(outputs)) {
        assert.equal(typeof output['description'], 'string', `output ${name} needs a description`);
        assert.equal(typeof output['value'], 'string', `output ${name} needs a value expression`);
    }
    // The workflow example in the README passes these inputs; keep them in sync.
    for (const required of ['api-key', 'budget-tokens', 'state', 'fail-on', 'allow-fork-prs']) {
        assert.ok(required in inputs, `README workflow uses input "${required}"`);
    }
});
test('workflow files are valid YAML with triggers and jobs', async () => {
    for (const file of ['ci.yml', 'codex-meter.yml']) {
        const text = await readFile(path.join(REPO_ROOT, '.github', 'workflows', file), 'utf8');
        const parsed = parse(text);
        assert.ok(parsed, `${file} did not parse as YAML`);
        assert.ok(parsed['on'], `${file} needs a trigger`);
        assert.ok(parsed['jobs'], `${file} needs jobs`);
    }
});
//# sourceMappingURL=action-manifest.test.js.map