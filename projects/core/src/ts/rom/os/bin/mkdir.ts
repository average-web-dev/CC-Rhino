const fs = require('fs');
import resolve = require('/rom/lib/resolve');

function main(args: string[], cwd: string): void {
    const flags = args.filter(a => a.startsWith('-'));
    const paths = args.filter(a => !a.startsWith('-'));
    const recursive = flags.some(f => /p/.test(f));
    if (paths.length === 0) { print('mkdir: missing operand'); return; }
    for (let arg of paths) {
        let path = resolve(cwd, arg);
        try {
            fs.mkdirSync(path, { recursive });
        } catch (e: unknown) {
            print(`mkdir: ${arg}: ${(e as any)?.message ?? 'error'}`);
        }
    }
}

export = {
    main,
}
