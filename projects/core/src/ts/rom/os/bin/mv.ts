const fs = require('fs') as FsModule;

function main(args: string[]): void {
    const paths = args.filter(a => !a.startsWith('-'));
    if (paths.length < 2) { print('mv: missing operand'); return; }
    const src = paths[0];
    const dst = paths[paths.length - 1];
    try {
        fs.renameSync(src, dst);
    } catch (e: unknown) {
        print(`mv: ${(e as any)?.message ?? 'error'}`);
    }
}

export = {
    main,
}
