const fs = require('fs') as FsModule;

function main(args: string[]): void {
    if (args.length === 0) {
        print('cat: missing file operand');
        return;
    }
    for (let path of args) {
        try {
            let content = fs.readFileSync(path, 'utf8') as string;
            // Split on newlines so each line goes through print()'s scroll/cursor logic.
            let lines = content.split('\n');
            // Trim trailing empty element from a final newline.
            if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
            for (let line of lines) print(line);
        } catch (e: unknown) {
            print(`cat: ${path}: ${(e as any)?.message ?? 'error'}`);
        }
    }
}

export = {
    main,
}
