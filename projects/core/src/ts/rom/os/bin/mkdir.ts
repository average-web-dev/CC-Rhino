import fs from 'fs';
import { resolve } from '/rom/lib/resolve';

export function main(args: string[], cwd: string): void {
    const flags = args.filter(a => a.startsWith('-'));
    const paths = args.filter(a => !a.startsWith('-'));
    const recursive = flags.some(f => /p/.test(f));
    if (paths.length === 0) { console.error('mkdir: missing operand'); return; }
    for (let arg of paths) {
        let path = resolve(cwd, arg);
        try {
            fs.mkdirSync(path, { recursive });
        } catch (e: unknown) {
            console.error(`mkdir: ${arg}: ${(e as any)?.message ?? 'error'}`);
        }
    }
}
