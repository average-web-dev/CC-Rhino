const fs = require('fs');
import resolve = require('/rom/lib/resolve');

function main(args: string[], cwd: string): void {
    if (args.length === 0) {
        print('cat: missing file operand');
        return;
    }
    for (let arg of args) {
        let path = resolve(cwd, arg);
        try {
            let content = fs.readFileSync(path, 'utf8') as string;
            // Split on newlines so each line goes through print()'s scroll/cursor logic.
            let lines = content.split('\n');
            // Trim trailing empty element from a final newline.
            if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
            for (let line of lines) print(line);
        } catch (e: unknown) {
            print(`cat: ${arg}: ${(e as any)?.message ?? 'error'}`);
        }
    }
}

export = {
    main,
}
