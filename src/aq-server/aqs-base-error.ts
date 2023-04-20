export type TError = Error | BaseError | string | unknown;

export class BaseError extends Error {
    protected _ts: number;
    protected _ticket: string;
    protected _stack: string[];
    protected _thrownError?: TError;

    public get ticket() { return this._ticket; }
    public get thrownError() { return this._thrownError; }
    public get ts() { return this._ts; }
    public get stack() { return this._stack.length ? this._stack.join('\n') : ''; }

    public constructor(name: string, message: string, error?: TError) {
        const stack: any[] = [];
        if (error instanceof BaseError) {
            //message = `${error.name}: ${error.message}`;
            error.stack && stack.push(error.stack);
        } else if (error instanceof Error) {
            //message = `${error.name}: ${error.message}`;
            error.stack && stack.push(error.stack);
        } else if (typeof error === 'string') {
            //message = error;
            stack.push(error);
        } else {
            //message = `${error}`;
            stack.push(message);
        }

        super(message);
        this.message = message;
        this.name = name;
        this._thrownError = error;
        this._stack = stack;
        this._ts = Date.now();
        this._ticket = this.createTicketNumber();
    }

    private createTicketNumber(): string {
        const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        const randomLetters = [...Array(2)].map(() => letters[Math.floor(Math.random() * letters.length)]);
        const randomNumbers = [...Array(4)].map(() => Math.floor(Math.random() * 10));
        return `${randomLetters.join("")}${randomNumbers.join("")}`;
    }

    public toString(): string {
        const timeStamp = new Date(this._ts).toLocaleString();
        const result = [this.message, `Ticket: ${this.ticket}`, `TS: ${timeStamp}`];
        return result.join(' ');
    }

}