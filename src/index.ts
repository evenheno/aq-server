import { env } from 'process';
import { randomBytes } from 'crypto';
env['APP_DIR'] = __dirname;
env['JWT_SECRET'] = randomBytes(32).toString('hex');

export * from './aq-server';
export * from './aq-sqlite-adapter';