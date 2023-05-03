import { env } from "process";
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

import { AQLogger } from "aq-logger";
import { DBColumnID, DBColumnString, DBColumnAutoStringID, DBColumnBlob } from "../../aq-sqlite-adapter";
import { AQSController } from '../aqs-controller';
import { AQServerError } from '../aqs-errors';
import { TExecuter } from "../aqs-types";

const logger = new AQLogger('UserController');


export class UserController extends AQSController {

    private readonly saltRounds = 10;

    constructor() {
        super('UserController', '/users');
    }

    private _register: TExecuter<DTORegisterReq> = async (body) => {
        const user = await this.db.getSingle<DBOUser>('users', {
            filter: { email: body.email }
        });

        if (user != null) {
            throw new AQServerError('User already exists')
        }

        const salt = await bcrypt.genSalt(this.saltRounds);
        const hashedPassword = await bcrypt.hash(body.password, salt);

        const newUser: DBONewUser = {
            displayName: body.displayName,
            email: body.email,
            password: hashedPassword,
            salt
        }
        await this.db.insert('users', newUser);
    }

    private _getUser: TExecuter<DTORegisterReq> = async (body, params) => {
        const userId = params.number('userId');
        if (!userId) { throw new AQServerError('Parameter: "userId" not supplied.') }
        const user = await this.db.getSingle('users', { filter: { userId: userId } });
        if (!user) { throw new AQServerError(`User with id: "${userId}" not found`) }
        return user;
    }

    private _login: TExecuter<DTOLoginReq> = async (body, params, server, token) => {
        logger.action('Logging in', body);
        const user = await this.db.getSingle<DBOUser>('users', {
            filter: { email: body.email }
        });
        if (user == null) { throw new AQServerError('Invalid credentials') }

        const isValidPassword = await bcrypt.compare(body.password, user.password);
        if (!isValidPassword) { throw new AQServerError('Invalid credentials') }

        logger.info('User found', user);
        const secret: jwt.Secret = (env as any)['JWT_SECRET'] as string;
        logger.action('Signing JWT token', { secret: secret });
        const payload = { userId: user.userId, displayName: user.displayName };
        const newToken = jwt.sign(payload, secret, { expiresIn: '7d', allowInsecureKeySizes: true });
        logger.info('JWT Token created', { token: newToken, userId: user.userId });
        server.response.cookie('token', newToken, { httpOnly: true });
    }


    public async init() {
        await this.db.createTable('users', [
            new DBColumnAutoStringID('userId'),
            new DBColumnString('displayName'),
            new DBColumnString('email'),
            new DBColumnString('password'),
            new DBColumnString('salt'),
            new DBColumnString('publicKey')
        ]);

        await this.db.createTable('userFiles', [
            new DBColumnID('userFileId'),
            new DBColumnBlob('userId'),
            new DBColumnString('storageFileId')
        ]);
    }

    public async initRoutes() {
        this.route('GET', '/', this._getUser);
        this.route('POST', '/register', this._register);
        this.route('POST', '/login', this._login);
    }
}

export interface DTORegisterRes {
    userId: string
}

export interface DTORegisterReq {
    displayName: string,
    email: string,
    password: string
}

export interface DTOLoginReq {
    email: string,
    password: string
}

export type DBOUser = DBONewUser & {
    userId: number;
}

export type DBONewUser = {
    displayName: string;
    email: string;
    password: string;
    salt: string;
}