import http from 'http';
import path from 'path';
import fs from 'fs';
import os from 'os';
import cookieParser from 'cookie-parser';
import bodyParser from 'body-parser';
import express from 'express';
import { Request, Response, NextFunction } from 'express';
import { TAQSServerStatus } from './server-status.type';
import { TAQSServerConfig } from './server-config.type';
import { AQTemplate } from './aqs-template';
import { BaseError } from './aqs-base-error';
import { env } from 'process';
import { AQServerError } from './aqs-errors';
import {
  DBColumnID,
  DBColumnInteger,
  DBColumnString,
  SQLiteAdapter
} from '../aq-sqlite-adapter';
import { AQSController } from './aqs-controller';
import { AQLogger } from 'aq-logger';
import { StorageController, UserController } from './aqs-controllers';
import { AddressInfo } from 'net';

const logger = new AQLogger('AQServer');

export class AQSServer {
  private _port: number;
  private _serverName: string;
  private _serverStatus: TAQSServerStatus;
  private _app: express.Application;
  private _server?: http.Server;
  private _dirApp: string;
  private _dirPublic?: string;
  private _db: SQLiteAdapter;
  private _config: TAQSServerConfig;
  private _controllers: Array<AQSController>;
  private _address: string | undefined;

  public get db() { return this._db; }
  public get status() { return this._serverStatus; }
  public get app() { return this._app; }
  public get port() { return this._port; }
  public get address() { return this._address; }

  public constructor(config?: TAQSServerConfig) {
    this._controllers = [];
    this._dirApp = env['APP_DIR']!;
    const defaultPublic = path.join(this._dirApp, 'resources', 'public');
    const defaultPort = 3000;
    const defaultServerName = 'AQServer';
    const defaultDatabaseFile = 'database.db';
    this._config = {
      port: defaultPort,
      serverName: defaultServerName,
      publicDir: defaultPublic,
      databaseFile: defaultDatabaseFile,
      ...(config || {})
    };
    logger.info('Server Config', this._config);
    this._serverName = this._config.serverName;
    this._dirPublic = this._config.publicDir;
    this._serverStatus = 'IDLE';
    this._app = express();
    this._port = this._config?.port || 3000;
    this._db = new SQLiteAdapter(this._config.databaseFile!, { key: 'A91G847FE1EIPM2560SGRWO' });
    this._controllers = this.onControllers();
    this._initRoutes();
  }

  private _initRoutes() {
    logger.action('Initiating body parser');
    this._app.use(cookieParser())
    this._app.use(bodyParser.json());
    this._app.use(bodyParser.urlencoded({ extended: true }));

    logger.action('Initiating router logger');
    this._app.use((req: Request, res: Response, next: NextFunction) => {
      logger.request(`${req.path} (${req.method.toUpperCase()})`);
      res.setHeader('Access-Control-Allow-Headers', '*');
      next();
    });

    logger.action('Registering controllers');
    const controllers = [
      new StorageController(this),
      new UserController(this),
      ...this.onControllers()
    ];
    for (let controller of controllers) {
      logger.action('Registering controller', { id: controller.id, path: controller.path })
      this._app.use(controller.path, controller.router);
    }

    if (this._config.publicDir) {
      if (fs.existsSync(this._config.publicDir)) {
        logger.action('Initiating public dir', { path: this._config.publicDir });
        this._app.use('/', express.static(this._config.publicDir, { index: 'index.html' }));
      } else {
        const message = `Failed to server static folder. Path does not exists: ${this._config.publicDir}`;
        throw new AQServerError(message);
      }
    }

    logger.action('Initiating 404 detection');
    this._app.use((req: Request, res: Response, next: NextFunction) => {
      logger.warn('404 Resource not found', { requestPath: req.path });
      next(new AQServerError('Page not found', `
        We apologize for any inconvenience, but it appears that the page
        you have requested, "${req.path}", does not exists or It may have been
         removed. Thank you for your understanding.
      `));
    });

    logger.action('Initiating global error handler');
    this._app.use((error: any, req: Request, res: Response, next: NextFunction) => {
      logger.error(`AQServer Error: ${error}`);
      this._handleGlobalError(error, res);
    });

    logger.success('Routes initiated successfully');
  }

  private async _handleGlobalError(error: any, res: Response) {
    if (!error) { return; }
    let errorObject: BaseError;
    if (error instanceof BaseError) {
      errorObject = error
    } else if (error instanceof Error) {
      errorObject = new AQServerError(error.message)
    } else if (typeof error === 'string') {
      errorObject = new AQServerError(error);
    } else {
      errorObject = new AQServerError(`${error}`);
    }

    try {
      await this.db.insert('errors', {
        message: errorObject.message,
        stack: errorObject.stack,
        ts: errorObject.ts,
        ticket: errorObject.ticket
      })
    } catch (error) {
      logger.error('Failed to write error into database', error);
    }

    const html = new AQTemplate('error-page.html', {
      title: errorObject.name,
      header: errorObject.name,
      shortDesc: errorObject.message,
      longDesc: errorObject.stack,
      ticket: errorObject.ticket,
      ts: errorObject.ts
    });
    res.status(500).send(html.templateText);
  }

  private async _onBeforeStart() {
    await this.db.addTable('errors', [
      new DBColumnID('errorId'),
      new DBColumnString('message'),
      new DBColumnString('stack'),
      new DBColumnString('ticket'),
      new DBColumnInteger('ts')
    ]);
    await this.onBeforeStart();
  }

  public async onBeforeStart() { }
  public async onStart() { }
  public async onBeforeStop() { }
  public async onStop() { }
  public onControllers(): AQSController[] {
    return [];
  }

  public async start(): Promise<void> {
    try {
      logger.action('Starting server', { serverName: this._serverName, port: this._port });
      this._serverStatus = 'STARTING';
      await this._onBeforeStart();
      await new Promise<void>((resolve) => {
        this._server = this._app.listen(this._port, () => {
          resolve();
        });
      })
      this._address = os.hostname().toLowerCase();
      this._serverStatus = 'LISTENING'
      logger.success('AQServer is running', { port: this._port, address: this._address });
    } catch (error) {
      throw new AQServerError('Failed to start server', error);
    }
  }

  public async stop() {
    logger.action('Stopping server', { serverName: this._serverName, port: this._port })
    this._serverStatus = 'STOPPING';
    this._server?.close((error) => {
      if (error) {
        throw new AQServerError('Failed to stop server', error);
      }
    })
    this._serverStatus = 'STOPPED';
    logger.warn('Server has stopped');
  }
}
