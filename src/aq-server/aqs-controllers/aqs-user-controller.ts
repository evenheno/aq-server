import { env } from "process";
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

import { DTOLoginReq, DBOUser, DTORegisterReq, DBONewUser } from '../aqs-dto';
import { DTORegisterRes } from '../aqs-dto';
import { AQLogger } from "aq-logger";
import { DBColumnID, DBColumnString, DBColumnInteger } from "../../aq-sqlite-adapter";
import { AQSController } from '../aqs-controller';
import { AQSServer } from "../aqs-server";
import { AQServerError } from '../aqs-errors';

const logger = new AQLogger('UserController');

export class UserController extends AQSController {

    private readonly saltRounds = 10;

    constructor(server: AQSServer) {
        super(server, 'UserController', '/users');
    }

    private async _initDB() {
        await this.db.addTable('users', [
            new DBColumnID('userId'),
            new DBColumnString('displayName'),
            new DBColumnString('email'),
            new DBColumnString('password'),
            new DBColumnString('salt'),
            new DBColumnString('publicKey'),
            new DBColumnString('privateKey')
        ]);

        await this.db.addTable('userFiles', [
            new DBColumnID('userFileId'),
            new DBColumnInteger('userId'),
            new DBColumnString('storageFileId')
        ]);
    }

    public async initRoutes() {
        await this._initDB();

        this.register({
            type: 'get', path: '/', authenticate: false,
            executer: async (express, token) => {
                const users = await this.db.get('users');
                return users;
            }
        });

        this.register({
            type: 'post', path: '/register', authenticate: false,
            executer: async (express, token) => {
                const body: DTORegisterReq = express.request.body;
                const user: DBOUser | undefined = await this.db.getSingle('users', { email: body.email });
                if (user != null) { throw new AQServerError('Invalid Credentials') }

                const salt = await bcrypt.genSalt(this.saltRounds);
                const hashedPassword = await bcrypt.hash(body.password, salt);

                const newUser: DBONewUser = {
                    displayName: body.displayName,
                    email: body.email,
                    password: hashedPassword,
                    salt
                }
                const userId = await this.db.insert('users', newUser);
                const result: DTORegisterRes = { id: userId }
                return result;
            }
        });

        this.register({
            type: 'post', path: '/login', authenticate: false,
            executer: async (express, token) => {
                const body: DTOLoginReq = express.request.body;
                logger.action('Logging in', body);
                const user = await this.db.getSingle<DBOUser>('users', {
                    email: body.email
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
                express.response.cookie('token', newToken, { httpOnly: true });
            }
        });
    }
}