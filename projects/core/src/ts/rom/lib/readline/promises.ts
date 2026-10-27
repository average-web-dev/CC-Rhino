// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/readline/promises.ts — Node's readline/promises: the same Interface as `readline`, but question() returns
// a Promise instead of blocking. Hand-written like Node's module: the engine's generated `<module>/promises` flavours
// only exist for native (Java) modules.

import readline = require('/rom/lib/readline');

const Base = readline.Interface;

const Interface = function (this: Interface, input: ReadableInput | InterfaceOptions, output?: Writable | null,
                            completer?: Completer, terminal?: boolean): Interface | void {
    if (!(this instanceof Interface)) return new Interface(input as any, output, completer, terminal) as any;
    (Base as unknown as Function).call(this, input, output, completer, terminal);
} as unknown as PromisesInterfaceConstructor;

Object.setPrototypeOf(Interface.prototype, Base.prototype);

Object.defineProperty(Interface.prototype, 'question', {
    value: function (this: Interface, query: string, _options?: unknown): Promise<string> {
        let self = this;
        return new Promise<string>((resolve, reject) => {
            if (self.closed) {
                let err = new Error('readline was closed');
                (err as any).code = 'ERR_USE_AFTER_CLOSE';
                reject(err);
                return;
            }
            let onClose = () => {
                let err = new Error('The question was aborted, as the interface was closed');
                err.name = 'AbortError';
                (err as any).code = 'ABORT_ERR';
                reject(err);
            };
            self.once('close', onClose);
            (Base.prototype.question as (q: string, cb: (answer: string) => void) => void).call(self, query, (answer: string) => {
                self.off('close', onClose);
                resolve(answer);
            });
        });
    },
    writable: true,
    configurable: true,
});

function createInterface(input: ReadableInput | InterfaceOptions, output?: Writable | null, completer?: Completer,
                         terminal?: boolean): PromisesInterface {
    return new Interface(input as any, output, completer, terminal) as PromisesInterface;
}

const promises: ReadlinePromisesModule = { Interface, createInterface };

export = promises;
