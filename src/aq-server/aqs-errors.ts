import { BaseError, TError } from './aqs-base-error';

export class AQServerError extends BaseError {
    public constructor(message: string, error?: TError) {
        super('AQServerError', message, error);
    }
}

export class AQServerDBError extends BaseError {
    public constructor(message: string, error?: TError) {
        super('AQServerDBError', message, error);
    }
}