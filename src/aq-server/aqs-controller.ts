import { Router, Request, Response, Handler, NextFunction } from "express";
import { AQSServer } from "./aqs-server";
import { env } from "process";
import { AQServerError } from "./aqs-errors";
import { AQLogger } from "aq-logger";
import jwt from 'jsonwebtoken';
import { TTokenPayload } from "./aqs-token-payload.type";
import path from "path";
import { BaseError } from "./aqs-base-error";
import 'reflect-metadata';

const logger = new AQLogger('AQController');

export type TControllerOptions = {
    auth?: boolean
}

export type TExpressArgs = {
    request: Request,
    response: Response,
    next: NextFunction
};

export type TExecuterResult = string | object | BaseError;
export type TExecuter = (express: TExpressArgs, tokenPayload?: TTokenPayload) => Promise<TExecuterResult> | TExecuterResult;

export type TRegisterPathOptions = {
    path: string,
    handlers?: Array<Handler>,
    type: 'get' | 'post',
    authenticate?: boolean,
    executer: TExecuter
}

export class AQSController {
    private _id: string;
    private _router: Router;
    private _path: string;
    private _server: AQSServer;

    public get db() { return this._server.db };
    public get router() { return this._router };
    public get path() { return this._path }
    public get id() { return this._id }
    public get server() { return this._server };

    constructor(server: AQSServer, id: string, path: string) {
        logger.action('Creating new controller', { id: id, path: path });
        this._router = Router();
        this._path = path;
        this._id = id;
        this._server = server;
        this.initRoutes();
        server.app.use(path, this._router);
    }

    public resolveUrl(...pathComponents: string[]) {
        const baseUrl = new URL(`http://${this._server.address}:${this._server.port}`);
        const resolvedUrl = new URL(path.posix.join(baseUrl.pathname, this._path, ...pathComponents), baseUrl);
        return resolvedUrl.toString();
    }

    public initRoutes() {

    }

    public getTokenPayload(req: Request) {
        const token = req?.cookies?.token;
        const jwtSecret = process.env['JWT_SECRET']!;
        if (!token?.length) { return undefined }
        logger.info('Verifying JWT authentication', {
            token: token,
            secret: (env as any)['JWT_SECRET']
        });
        const secret = jwtSecret;
        const res = jwt.verify(token, secret, { complete: true }).payload as jwt.JwtPayload;
        return res;
    }

    public register(options: TRegisterPathOptions) {
        logger.action('Registering path', options.path);
        const handlers = options?.handlers || [];
        const executer = async (req: Request, res: Response, next: NextFunction) => {
            try {
                const payload = this._checkAuth(req, { auth: options?.authenticate });
                const result = await options.executer({ request: req, response: res, next: next }, payload);

                if (result instanceof BaseError) {
                    throw result;
                } else if (typeof result === 'string' || typeof result === 'object') {
                    return res.status(200).send(result);
                } else if (!result) {
                    return res.sendStatus(200);
                } else {
                    throw new AQServerError('Executer returned an invalid result type');
                }
            } catch (error) {
                const errorMessage = [
                    'Failed to execute ', options.type.toUpperCase(), ' request "',
                    req.path, '": ', error?.toString()].join(' ');
                return next(new AQServerError(errorMessage));
            }
        }
        if (options.type === 'get') {
            this._router.get(options.path, ...handlers, executer);
        } else if (options.type === 'post') {
            this._router.post(options.path, ...handlers, executer);
        } else {
            throw new AQServerError('Request type not supported');
        }
    }

    private _checkAuth(req: Request, options: TControllerOptions) {
        if (options.auth !== true) { return; }
        logger.action('Checking authentication');
        const token: TTokenPayload = this.getTokenPayload(req) as TTokenPayload;
        req.body.token = token;
        if (!token || token && token['userId'] == null) {
            logger.warn('Authentication failed');
            throw new AQServerError(`Authentication Required: ${req.path}`);
        }
        logger.success('Authentication verified', token);
        return token;
    }
}