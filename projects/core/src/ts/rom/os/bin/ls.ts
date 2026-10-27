const fs   = require('fs');
const util = require('util');
import resolve = require('/rom/lib/resolve');

function main(args: string[], cwd: string): void {
    let path = args[0] ? resolve(cwd, args[0]) : cwd;
    try {
        let entries = fs.readdirSync(path, { withFileTypes: true })
            .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        for (let entry of entries) {
            // Directories in lime (an ANSI style, ignored on monochrome terminals).
            console.log(entry.isDirectory() ? util.styleText('greenBright', entry.name + '/') : entry.name);
        }
    } catch (e: unknown) {
        console.error(`ls: ${(e as any)?.message ?? 'error'}`);
    }
}

export = {
    main,
}
