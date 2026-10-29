import fs from 'fs';
import { resolve } from '/rom/lib/resolve';

export function main(args: string[], cwd: string): void {
    const flags = args.filter(a => a.startsWith('-'));
    const paths = args.filter(a => !a.startsWith('-'));
    if (paths.length < 2) { console.error('cp: missing destination operand'); return; }
    const src = resolve(cwd, paths[0]);
    const dst = resolve(cwd, paths[paths.length - 1]);
    const recursive = flags.some(f => /r/i.test(f));
    try {
        fs.cpSync(src, dst, { recursive });
    } catch (e: unknown) {
        console.error(`cp: ${(e as any)?.message ?? 'error'}`);
    }
}
