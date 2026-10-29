import fs from 'fs';
import { resolve } from '/rom/lib/resolve';

export function main(args: string[], cwd: string): void {
    if (args.length === 0) {
        console.error('cat: missing file operand');
        return;
    }
    for (let arg of args) {
        let path = resolve(cwd, arg);
        try {
            process.stdout.write(fs.readFileSync(path, 'utf8'));
        } catch (e: unknown) {
            console.error(`cat: ${arg}: ${(e as any)?.message ?? 'error'}`);
        }
    }
}
