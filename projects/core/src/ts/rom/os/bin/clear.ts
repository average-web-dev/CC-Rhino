const term = require('term') as TermModule;

function main(): void {
    term.clear();
    term.setCursorPos({ x: 0, y: 0 });
}

export = {
    main,
}
