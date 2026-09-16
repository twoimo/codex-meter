import { createRequire } from 'node:module';
function readVersion() {
    try {
        const require = createRequire(import.meta.url);
        const pkg = require('../../package.json');
        return pkg.version ?? '0.0.0';
    }
    catch {
        return '0.0.0';
    }
}
export const TOOL_VERSION = readVersion();
//# sourceMappingURL=version.js.map