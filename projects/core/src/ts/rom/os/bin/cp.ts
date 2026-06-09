const fs = require('fs') as FsModule;

function main(args: string[]): void {
    const flags = args.filter(a => a.startsWith('-'));
    const paths = args.filter(a => !a.startsWith('-'));
    if (paths.length < 2) { print('cp: missing destination operand'); return; }
    const src = paths[0];
    const dst = paths[paths.length - 1];
    const recursive = flags.some(f => /r/i.test(f));
    try {
        fs.cpSync(src, dst, { recursive });
    } catch (e: unknown) {
        print(`cp: ${(e as any)?.message ?? 'error'}`);
    }
}

export = {
    main,
}
