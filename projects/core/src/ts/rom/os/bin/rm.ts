const fs = require('fs') as FsModule;

function main(args: string[]): void {
    const flags = args.filter(a => a.startsWith('-'));
    const paths = args.filter(a => !a.startsWith('-'));
    if (paths.length === 0) { print('rm: missing operand'); return; }
    const recursive = flags.some(f => /r/i.test(f));
    for (let path of paths) {
        try {
            fs.rmSync(path, { recursive, force: true });
        } catch (e: unknown) {
            print(`rm: ${path}: ${(e as any)?.message ?? 'error'}`);
        }
    }
}

export = {
    main,
}
