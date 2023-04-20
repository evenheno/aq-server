import fs from 'fs';
import sqlite3 from 'sqlite3';
import path from 'path';
import { SQLiteAdapterGetOptions, SQLiteAdapterOptions, TDBState, TParam, TRunResult, TSQLiteObject } from './aq-sqlite-adapter.types';
import { AQCRCCalc } from './aqs-crc';
import { DBColumn, DBColumnAutoTS, DBColumnBlob, DBColumnID, DBColumnInteger, DBColumnString, DBColumnStringID } from './aq-sqlite-db-column';
import { AQServerDBError } from '../aq-server';
import { AQLogger } from 'aq-logger';
import { DBOStorageFile, DBOStorageHeader } from '../aq-server/aqs-dto';
import { randomBytes } from 'crypto';

const logger = new AQLogger('AQSQLiteAdapter');

export class SQLiteAdapter {
    private _dbFile: string;
    private _state: TDBState;
    private _db?: sqlite3.Database;
    private _key: string | undefined;

    constructor(dbFile: string, options?: SQLiteAdapterOptions) {
        this._state = 'CLOSED';
        this._dbFile = dbFile;
        this._key = options?.key;
    }

    get state() { return this._state; }

    public async connect() {
        try {
            if (this._state === 'OPEN') { return; }
            await new Promise<void>((resolve, reject) => {
                this._db = new sqlite3.Database(this._dbFile, (error: any) => {
                    if (error) { return reject(error) }
                    this._state = 'OPEN';
                    resolve();
                });
            });
            await this.initDB();
            logger.success('DB Connection established.');
        } catch (error) {
            throw new AQServerDBError('DB_ERROR_CONNECTING', error);
        }
    }

    private async initDB() {
        await this.addTable('storageHeaders', [
            new DBColumnID('storageHeaderId'),
            new DBColumnInteger('crc'),
            new DBColumnInteger('fileSize')
        ]);

        await this.addTable('storageFiles', [
            new DBColumnStringID('storageFileId'),
            new DBColumnInteger('storageHeaderId'),
            new DBColumnString('fileName'),
            new DBColumnAutoTS('created'),
            new DBColumnInteger('userId')
        ]);

        await this.addTable('dataChunks', [
            new DBColumnID('dataChunkId'),
            new DBColumnInteger('storageHeaderId'),
            new DBColumnBlob('chunk')
        ]);
    }

    public async addTable(tableName: string, columns: DBColumn[]) {
        try {
            const sql = `CREATE TABLE IF NOT EXISTS ${tableName} (${columns.join(', ')})`;
            const result = await this.run(sql);
            if (result.changes) {
                logger.success('Table created.', { tableName: tableName });
            } else {
                logger.info('Skipping table creation, table already exists.', { tableName: tableName })
            }
        } catch (error) {
            throw new AQServerDBError('DB_ERROR_FAILED_INSERT_TABLE', error);
        }
    }

    public async beginTransaction() {
        logger.action('Beginning transaction');
        const sql = 'BEGIN TRANSACTION';
        return await this.run(sql);
    }

    public async endTransaction() {
        logger.action('Ending transaction');
        const sql = 'END TRANSACTION';
        return await this.run(sql);
    }

    public async rollbackTransaction() {
        logger.action('Rolling back transaction');
        const sql = 'ROLLBACK TRANSACTION';
        return await this.run(sql);
    }

    public async commit() {
        const sql = 'COMMIT';
        return await this.run(sql);
    }

    public async dropTable(tableName: string) {
        const sql = `DROP TABLE IF EXISTS ${tableName}`;
        return await this.run(sql);
    }

    public async dropColumn(tableName: string, columnName: string) {
        const sql = `ALTER TABLE ${tableName} DROP COLUMN ${columnName}`;
        return await this.run(sql);
    }

    public async addColumn(tableName: string, column: DBColumn) {
        const sql = `ALTER TABLE ${tableName} ADD COLUMN ${column.toString()}`;
        return await this.run(sql);
    }

    private _encryptData(data: any) {
        if (!this._key) { return; }
        const key = this._key;
        const result = new Int8Array(data.length);
        for (let i = 0; i < data.length; i++) {
            result[i] = (data as any)[i] ^ (key as any)[i % key.length];
        }
        return result;
    }

    async exportFile(storageFileId: string) {
        try {
            const storageFile = await this.getSingle<DBOStorageFile>(
                'storageFiles', { storageFileId: storageFileId });

            if (!storageFile) { throw new AQServerDBError('Storage file entry has not been found'); }
            const storageHeader = await this.getSingle<DBOStorageHeader>(
                'storageHeaders', { storageHeaderId: storageFile.storageHeaderId });

            if (!storageHeader) { throw new AQServerDBError('Storage file header has not found'); }
            const dataChunks = await this.get('dataChunks',
                { storageHeaderId: storageFile.storageHeaderId },
                { orderBy: 'dataChunkId' });

            const downloadsDir = 'downloads';
            if (!fs.existsSync(downloadsDir)) {
                fs.mkdirSync(downloadsDir, { recursive: true })
            }

            const outputFile = path.join(downloadsDir, `${storageFile.storageFileId}.bin`);
            const writeStream = fs.createWriteStream(outputFile);
            const crcCalculator = new AQCRCCalc();

            let totalBytes = 0;
            let totalChunks = 0;

            for (const dataChunk of dataChunks) {
                const chunk = dataChunk.chunk;
                crcCalculator.digest(chunk);
                const buffer = Buffer.from(chunk);
                await new Promise<void>((resolve) => {
                    writeStream.write(buffer, () => { resolve(); });
                });
                totalBytes += chunk.length;
                totalChunks++;
            }

            writeStream.end();
            if (crcCalculator.crc !== storageHeader.crc) {
                throw new AQServerDBError('File CRC is corrupted');
            }
            logger.success('File exported successfully', {
                size: storageHeader.fileSize,
                totalBytes: totalBytes,
                totalChunks: totalChunks,
                crc: crcCalculator.crc,
                outputFile: outputFile
            })
            return outputFile;
        } catch (error) {
            throw new AQServerDBError(`Failed to export file: ${error}`, error);
        }
    }

    async storeFile(
        file: string,
        userId: number,
        originalFileName: string,
        onBeforeTransactionEnds: (storageFileId: string) => void) {
        try {
            const stat = fs.statSync(file);
            const fileSize = stat.size;
            const crcCalculator = new AQCRCCalc();
            const bufferSize = 250000;
            const fileCRC = await crcCalculator.fileCRC(file);
            const storageFileId = randomBytes(16).toString('hex').toUpperCase();

            await this.beginTransaction();
            const storageHeaderId = await this.insert('storageHeaders', {
                fileSize: fileSize,
                crc: fileCRC
            });

            await this.insert('storageFiles', {
                storageFileId: storageFileId,
                storageHeaderId: storageHeaderId,
                fileName: originalFileName,
                userId: userId
            });

            const readStream = fs.createReadStream(file, { highWaterMark: bufferSize });
            return await new Promise<string>((resolve, reject) => {
                let totalBytes = 0;
                let totalChunks = 0;
                const crcCalculator = new AQCRCCalc();
                readStream.on('readable', async () => {
                    let chunk;
                    while (null !== (chunk = readStream.read())) {
                        crcCalculator.digest(chunk);
                        await this.insert('dataChunks', { storageHeaderId: storageHeaderId, chunk: chunk });
                        totalBytes += chunk.length;
                        totalChunks++;
                        if (totalBytes === fileSize) {
                            if (crcCalculator.crc !== fileCRC) {
                                reject(new AQServerDBError('DB_ERROR_FAILED_ADD_FILE', 'Mismatched CRC'));
                            }
                            await onBeforeTransactionEnds(storageFileId);
                            await this.endTransaction();
                            logger.success('File stored successfully', {
                                storageFileId: storageFileId,
                                storageHeaderId: storageHeaderId,
                                fileName: originalFileName,
                                userId: userId,
                                fileSize: fileSize,
                                crc: fileCRC
                            })
                            resolve(storageFileId);
                        }
                    }
                });
                readStream.on('error', (error) => {
                    reject(new AQServerDBError('DB_ERROR_FAILED_ADD_FILE', error));
                });
            });
            return storageFileId;
        } catch (error) {
            await this.rollbackTransaction();
            throw new AQServerDBError('DB_ERROR_FAILED_ADD_FILE', error);
        }
    }

    public async insert<T>(tableName: string, data: T) {
        try {
            let sql: string;
            if (Array.isArray(data)) {
                const columns = Object.keys(data[0]).map((column) => `[${column}]`).join(', ');
                const placeholders = Object.keys(data[0]).map(() => '?').join(', ');
                const values: TParam[] = data.flatMap((row) => Object.values(row));
                sql = `INSERT INTO ${tableName} (${columns}) VALUES (${placeholders})`;
                const result = await this.run(sql, values);
                return result.changes;
            } else {
                const columns = Object.keys(data as any).map((column) => `[${column}]`).join(', ');
                const placeholders = Object.keys(data as any).map(() => '?').join(', ');
                const values: TParam[] = Object.values(data as any);
                sql = `INSERT INTO ${tableName} (${columns}) VALUES (${placeholders})`;
                const result = await this.run(sql, values);
                return result.lastId;
            }
        } catch (error) {
            throw new AQServerDBError('DB_ERROR_INSERTING', error);
        }
    }

    public async run(sql: string, params: TParam[] = []): Promise<TRunResult> {
        await this.connect();
        return new Promise<TRunResult>(async (resolve, reject) => {
            try {
                this._db!.run(sql, params, function (error) {
                    if (error) { reject(error) }
                    const lastId = this?.lastID;
                    const changes = this?.changes;
                    resolve({ lastId: lastId, changes: changes });
                });
            } catch (error) {
                reject(new AQServerDBError('DB_ERROR_RUN', error));
            }
        });
    }

    public async all<T>(sql: string, params: TParam[] = []): Promise<T[]> {
        await this.connect();
        return new Promise<T[]>(async (resolve, reject) => {
            try {
                this._db!.all(sql, params, function (error, rows) {
                    if (error) { reject(error) }
                    resolve(rows as T[]);
                });
            } catch (error) {
                reject(new AQServerDBError('DB_ERROR_RUN', error));
            }
        });
    }

    public async getSingle<T>(tableName: string, filter?: TSQLiteObject, options?: SQLiteAdapterGetOptions) {
        const result = await this.get<T>(tableName, filter, options);
        if (result?.length) { return result[0] }
    }

    public async get<T = any>(
        tableName: string,
        filter?: TSQLiteObject,
        options?: SQLiteAdapterGetOptions
    ): Promise<Array<T>> {

        await this.connect();
        const maxResults = options?.maxResults;
        const orderBy = options?.orderBy;
        let sql: string;
        let params: any = [];

        if (filter && typeof filter === 'object') {
            const conditions = Object.entries(filter).map(([column, value]) => {
                params.push(value);
                return `[${column}] = ?`;
            }).join(' AND ');
            sql = `SELECT * FROM ${tableName} WHERE ${conditions}`;
        } else {
            sql = `SELECT * FROM ${tableName}`;
        }

        if (orderBy) {
            if (Array.isArray(orderBy)) {
                const columns = orderBy.map(column => `[${column}]`).join(', ');
                sql += ` ORDER BY ${columns}`;
            } else { sql += ` ORDER BY [${orderBy}]`; }
        }
        if (maxResults) {
            sql += ' LIMIT ?';
            params.push(maxResults);
        }
        return new Promise((resolve, reject) => {
            this._db!.all(sql, params, (err, data) => {
                if (err) { return reject(err) }
                resolve(data as Array<T>);
            });
        });
    }

    public async delete(tableName: string, filter: any) {
        await this.connect();
        let sql: string;
        if (typeof filter === 'object') {
            const conditions = Object.entries(filter).map(([column, value]) => `[${column}] = '${value}'`).join(' AND ');
            sql = `DELETE FROM ${tableName} WHERE ${conditions}`;
        } else {
            sql = `DELETE FROM ${tableName}`;
        }
        return await this.run(sql);
    }

    public async update(tableName: string, filter: any, data: any) {
        try {
            await this.connect();
            const setValues = Object.entries(data)
                .map(([column, value]) => `[${column}] = '${value}'`)
                .join(', ');
            let sql: string = `UPDATE ${tableName} SET ${setValues}`;
            if (typeof filter === 'object') {
                const conditions = Object.entries(filter)
                    .map(([column, value]) => `[${column}] = '${value}'`)
                    .join(' AND ');
                sql += ` WHERE ${conditions}`;
            }
            const result = await this.all(sql);
            return result;
        } catch (error) {
            throw new AQServerDBError('DB_ERROR_UPDATING', error);
        }
    }
}