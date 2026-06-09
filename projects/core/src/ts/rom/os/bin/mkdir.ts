const fs = require('fs') as FsModule;

function main(args: string[]): void {
    const paths = args.filter(a => !a.startsWith('-'));
    if (paths.length === 0) { print('mkdir: missing operand'); return; }
    for (let path of paths) {
        try {
            fs.mkdirSync(path);
        } catch (e: unknown) {
            print(`mkdir: ${path}: ${(e as any)?.message ?? 'error'}`);
        }
    }
}

export = {
    main,
}
