const fs   = require('fs')   as FsModule;
const term = require('term') as TermModule;
import resolve = require('/rom/lib/resolve');

function main(args: string[], cwd: string): void {
    const path = args[0] ? resolve(cwd, args[0]) : cwd;
    try {
        const entries = (fs.readdirSync(path) as string[]).slice().sort();
        const canColor = term.isColor();
        const base = path.replace(/\/$/, '');
        for (let name of entries) {
            let full = (base === '' ? '' : base) + '/' + name;
            try {
                let stat = fs.statSync(full);
                if (canColor) term.setTextColor(stat.isDirectory ? 32 : 1); // lime / white
                print(stat.isDirectory ? name + '/' : name);
            } catch {
                print(name);
            }
        }
        if (canColor) term.setTextColor(1);
    } catch (e: unknown) {
        print(`ls: ${(e as any)?.message ?? 'error'}`);
    }
}

export = {
    main,
}
