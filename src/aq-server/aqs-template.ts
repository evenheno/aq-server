import fs from 'fs';
import path from 'path';
import { env } from 'process';
import { AQServerError } from './aqs-errors';
import { AQLogger } from 'aq-logger';
const logger = new AQLogger('AQTemplate');

export class AQTemplate<T> {
    private _template: string;
    private _payload: T;

    constructor(fileInput: string, data: T) {
        try {
            const root = env['APP_DIR']!;
            const file = path.join(root, 'resources', 'templates', fileInput);
            this._template = fs.readFileSync(file, 'utf8');
            this._payload = data;
            this._fillPlaceholders();
        } catch (error) {
            throw new AQServerError('Failed to read template file', error);
        }
    }

    public get templateText() { return this._template; }

    private _fillPlaceholders() {
        const regex = /\${(.+?)}/g;
        const placeholders = this._template.match(regex);
        let result = this._template;
        if (placeholders == null) { return result }
        for (const placeholder of placeholders) {
            const key = placeholder.slice(2, -1);
            const value = (this._payload as any)[key];
            if (value !== undefined) {
                result = result.replace(placeholder, value);
            }
        }
        this._template = result;
    }
}