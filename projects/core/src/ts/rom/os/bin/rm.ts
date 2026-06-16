const fs = require('fs');
import resolve = require('/rom/lib/resolve');

function main(args: string[], cwd: string): void {
    const flags = args.filter(a => a.startsWith('-'));
    const paths = args.filter(a => !a.startsWith('-'));
    if (paths.length === 0) { print('rm: missing operand'); return; }
    const recursive = flags.some(f => /r/i.test(f));
    for (let arg of paths) {
        let path = resolve(cwd, arg);
        try {
            // TODO: fix the flags in java
            fs.rmSync(path, /*{ recursive, force: true }*/);
        } catch (e: unknown) {
            print(`rm: ${arg}: ${(e as any)?.message ?? 'error'}`);
        }
    }
}

export = {
    main,
}
