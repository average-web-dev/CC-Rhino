const fs = require('fs');
import resolve = require('/rom/lib/resolve');

function main(args: string[], cwd: string): void {
    const paths = args.filter(a => !a.startsWith('-'));
    if (paths.length < 2) { console.error('mv: missing operand'); return; }
    const src = resolve(cwd, paths[0]);
    const dst = resolve(cwd, paths[paths.length - 1]);
    try {
        fs.renameSync(src, dst);
    } catch (e: unknown) {
        console.error(`mv: ${(e as any)?.message ?? 'error'}`);
    }
}

export = {
    main,
}
