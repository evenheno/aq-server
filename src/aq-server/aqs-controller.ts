import path from "path";
import jwt from 'jsonwebtoken';
import 'reflect-metadata';

import { AQSServer } from "./aqs-server";
import { env } from "process";
import { AQServerError } from "./aqs-errors";
import { AQLogger } from "aq-logger";
import { BaseError } from "./aqs-base-error";
import { TExecuter, TExpressArgs, TMethod, TParams, TRegisterPathOptions, TTokenPayload } from "./aqs-types";
import { Router, Request, Response, Handler, NextFunction } from "express";
import { SQLiteAdapter } from "../aq-sqlite-adapter";

const logger = new AQLogger('AQController');

export interface IAQSController {
    get db(): SQLiteAdapter;
    get router(): Router;
    get path(): string;
    get id(): string;
    get server(): AQSServer
    set server(value: AQSServer);
}

export class AQSController implements IAQSController {
    private _id: string;
    private _router: Router;
    private _path: string;
    private _server!: AQSServer;

    public get db() { return this._server.db };
    public get router() { return this._router };
    public get path() { return this._path }
    public get id() { return this._id }
    public get server() { return this._server };
    public set server(value) { this._server = value }

    constructor(id: string, path: string) {
        logger.action('Creating new controller', { id: id, path: path });
        this._router = Router();
        this._path = path;
        this._id = id;
    }

    private _authenticate(request: Request) {
        const rawToken = request?.cookies?.token;
        logger.action('Authenticating JWT', { rawToken: rawToken });
        if (!rawToken) { throw new AQServerError('JWT Cookie header not found. Authentication failed') }
        const jwtSecret = env['JWT_SECRET']!;
        logger.action('Verifying JWT authentication', { token: rawToken });
        const secret = jwtSecret;
        let verifiedToken;
        try {
            verifiedToken = jwt.verify(rawToken, secret, { complete: true }).payload;
        } catch (error) {
            throw new AQServerError('Failed to verify JWT. Authentication failed');
        }
        const tokenPayload = verifiedToken as TTokenPayload;
        if (!tokenPayload?.userId) { throw new AQServerError('Failed to parse JWT. Authentication failed'); }
        return tokenPayload;
    }

    public route<TReqBody = any, TResBody = any>(
        method: TMethod,
        path: string,
        onRequest: TExecuter<TReqBody, TResBody>,
        options?: TRegisterPathOptions<TReqBody, TResBody>) {
        logger.action('Registering path', path);
        const handlers = options?.handlers || [];
        const executer: Handler = async (request: Request, response: Response, next: NextFunction) => {
            logger.action(`Executing: ${request.method.toUpperCase()} ${request}`)
            try {
                let token: TTokenPayload;
                if (options?.authenticate === true) {
                    token = this._authenticate(request);
                }

                const express: TExpressArgs<TReqBody, TResBody> = {
                    request: request, response: response, next: next
                };

                const params: TParams = {
                    number: (paramName: string) => {
                        const params = request?.params;
                        if (!paramName) { return; }
                        const val = request?.params && request.params[paramName];
                        if (!val) { return undefined; }
                        const num = parseInt(val);
                        const result = isNaN(num) ? undefined : num;
                        return result;
                    },
                    string: (paramName: string) => {
                        const params = request?.params;
                        if (!paramName) { return; }
                        const val = request?.params && request.params[paramName];
                        if (!val) { return undefined; }
                        return val;
                    }
                }
                const result = await onRequest(request.body, params, express, token);

                if (response.headersSent) { return; }

                if (result instanceof BaseError) {
                    throw result;
                } else if (typeof result === 'string' || typeof result === 'object') {
                    return response.status(200).send(result);
                } else if (!result) {
                    return response.sendStatus(200);
                } else {
                    throw new AQServerError('Executer returned an invalid result type');
                }
            } catch (error) {
                return next(error);
            }
        }
        switch (method) {
            case 'GET':
                this._router.get(path, ...handlers, executer);
                break;
            case 'POST':
                this._router.post(path, ...handlers, executer);
                break;
            case 'PUT':
                this._router.put(path, ...handlers, executer);
                break;
            case 'DELETE':
                this._router.delete(path, ...handlers, executer);
                break;
            case 'PATCH':
                this._router.patch(path, ...handlers, executer);
                break;
            default:
                throw new AQServerError(`Request of method type: "${method}" is not supported`);
        }
    }

    public resolveUrl(...pathComponents: string[]) {
        const baseUrl = new URL(`http://${this._server.address}:${this._server.port}`);
        const resolvedUrl = new URL(path.posix.join(baseUrl.pathname, this._path, ...pathComponents), baseUrl);
        return resolvedUrl.toString();
    }

    public async initRoutes() {

    }

    public async init() {

    }

}