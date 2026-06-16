const fs = require('fs');
import resolve = require('/rom/lib/resolve');

function main(args: string[], cwd: string): void {
    const flags = args.filter(a => a.startsWith('-'));
    const paths = args.filter(a => !a.startsWith('-'));
    if (paths.length < 2) { print('cp: missing destination operand'); return; }
    const src = resolve(cwd, paths[0]);
    const dst = resolve(cwd, paths[paths.length - 1]);
    const recursive = flags.some(f => /r/i.test(f));
    try {
        // TODO: fix the recursive flag in java
        fs.cpSync(src, dst, /*{ recursive }*/);
    } catch (e: unknown) {
        print(`cp: ${(e as any)?.message ?? 'error'}`);
    }
}

export = {
    main,
}
