const fs = require('fs') as FsModule;
import resolve = require('/rom/lib/resolve');

function main(args: string[], cwd: string): void {
    const paths = args.filter(a => !a.startsWith('-'));
    if (paths.length === 0) { print('mkdir: missing operand'); return; }
    for (let arg of paths) {
        let path = resolve(cwd, arg);
        try {
            fs.mkdirSync(path);
        } catch (e: unknown) {
            print(`mkdir: ${arg}: ${(e as any)?.message ?? 'error'}`);
        }
    }
}

export = {
    main,
}
