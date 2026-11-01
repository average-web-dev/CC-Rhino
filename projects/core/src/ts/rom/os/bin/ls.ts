import fs   from 'fs';
import util from 'util';
import { resolve } from '/rom/lib/resolve';
import { Term, ColorIndex } from '/rom/lib/term';

export function main(args: string[], cwd: string): void {
    let path = args[0] ? resolve(cwd, args[0]) : cwd;
    try {
        let entries = fs.readdirSync(path, { withFileTypes: true })
            .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        if (process.stdout.isTTY) {
            // On a terminal: in columns, the directories first, in lime (ignored on monochrome terminals).
            let dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name + '/');
            let files = entries.filter((e) => !e.isDirectory()).map((e) => e.name);
            new Term().tabulate(ColorIndex.LIME, dirs, ColorIndex.WHITE, files);
            return;
        }
        for (let entry of entries) {
            console.log(entry.isDirectory() ? util.styleText('greenBright', entry.name + '/') : entry.name);
        }
    } catch (e: unknown) {
        console.error(`ls: ${(e as any)?.message ?? 'error'}`);
    }
}
