const fs   = require('fs');
const term = require('term');
import resolve = require('/rom/lib/resolve');

function main(args: string[], cwd: string): void {
    const path = args[0] ? resolve(cwd, args[0]) : cwd;
    try {
        const entries = fs.readdirSync(path, { withFileTypes: true })
            .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        const canColor = term.isColor();
        for (let entry of entries) {
            let isDir = entry.isDirectory();
            if (canColor) term.setTextColor(isDir ? 32 : 1); // lime / white
            print(isDir ? entry.name + '/' : entry.name);
        }
        if (canColor) term.setTextColor(1);
    } catch (e: unknown) {
        print(`ls: ${(e as any)?.message ?? 'error'}`);
    }
}

export = {
    main,
}
