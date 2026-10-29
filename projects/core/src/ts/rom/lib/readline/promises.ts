// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

// /rom/lib/readline/promises.ts — Node's readline/promises: the same Interface as `readline`, but question() returns
// a Promise instead of blocking. Hand-written like Node's module: the engine's generated `<module>/promises` flavours
// only exist for native (Java) modules.

import * as readline from '/rom/lib/readline';
import { callable } from '/rom/lib/internal/callable';

const Base = readline.Interface;

class Interface extends Base {
    // @ts-expect-error: returns a promise instead of blocking (or taking a callback).
    override question(query: string, _options?: object): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            if (this.closed) {
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
            this.once('close', onClose);
            super.question(query, (answer: string) => {
                this.off('close', onClose);
                resolve(answer);
            });
        });
    }
}

// Like the readline Interface, it also works without `new`.
const PublicInterface = callable(Interface) as unknown as PromisesInterfaceConstructor;

export function createInterface(input: ReadableInput | InterfaceOptions, output?: Writable | null, completer?: Completer,
                         terminal?: boolean): PromisesInterface {
    return new Interface(input as any, output, completer, terminal) as unknown as PromisesInterface;
}

export { PublicInterface as Interface };

// The exports implement the module's public type (types/readline.d.ts).
type Exports<T extends ReadlinePromisesModule> = T;
type _Exports = Exports<typeof import('/rom/lib/readline/promises')>;
