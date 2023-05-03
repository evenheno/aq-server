import { Request, Response, Handler, NextFunction } from "express";
import { BaseError } from "./aqs-base-error";
import { ParamsDictionary } from 'express-serve-static-core';

export type TTokenPayload = undefined | {
    userId: string;
}

export type TExpressArgs<TReqBody, TResBody> = {
    request: Request<ParamsDictionary, TResBody, TReqBody>,
    response: Response<TResBody>,
    next: NextFunction
};

export type TExecuterResult = string | object | BaseError;

export type TParams = {
    string: (paramName: string) => string | undefined;
    number: (paramName: string) => number | undefined;
}
export type TExecuter<TReqBody=unknown, TResBody=unknown> = (
    body: TReqBody,
    params: TParams,
    server: TExpressArgs<TReqBody, TResBody>,
    token: TTokenPayload | undefined
) => Promise<TExecuterResult> | TExecuterResult;

export type TMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export type TRegisterPathOptions<TReqBody, TResBody> = {
    handlers?: Array<Handler>,
    scheme?: unknown,
    authenticate?: boolean
}