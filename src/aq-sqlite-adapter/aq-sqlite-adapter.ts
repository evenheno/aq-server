import fs, { ReadStream } from 'fs';
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
    private _key?: string;

    constructor(dbFile?: string, options?: SQLiteAdapterOptions) {
        this._state = 'CLOSED';
        this._dbFile = dbFile || 'database.db';
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
        await this.createTable('storageHeaders', [
            new DBColumnID('storageHeaderId'),
            new DBColumnInteger('crc'),
            new DBColumnInteger('fileSize')
        ]);

        await this.createTable('storageFiles', [
            new DBColumnStringID('storageFileId'),
            new DBColumnInteger('storageHeaderId'),
            new DBColumnString('fileName'),
            new DBColumnAutoTS('created'),
            new DBColumnInteger('userId')
        ]);

        await this.createTable('dataChunks', [
            new DBColumnID('dataChunkId'),
            new DBColumnInteger('storageHeaderId'),
            new DBColumnBlob('blob')
        ]);
    }

    public async createTable(tableName: string, columns: DBColumn[]) {
        try {
            const sql = `CREATE TABLE IF NOT EXISTS ${tableName} (${columns.join(', ')})`;
            const result = await this.run(sql);
            if (result.changes) {
                logger.success('Table created.', { tableName: tableName });
            }
        } catch (error) {
            throw new AQServerDBError('DB_ERROR_FAILED_INSERT_TABLE', error);
        }
    }

    public async transaction(fn: (db: SQLiteAdapter) => void) {
        await this.beginTransaction();
        try {
            await fn(this);
            await this.endTransaction();
        } catch (error) {
            await this.rollbackTransaction();
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

    async streamStorageFile(storageFileId: string) {
        logger.debug('Storage file requested', { storageFileId: storageFileId });

        const storageFile = await this.getSingle<DBOStorageFile>(
            'storageFiles', { filter: { storageFileId: storageFileId } });
        if (!storageFile) { throw new AQServerDBError('Storage file entry has not been found'); }

        const storageHeader = await this.getSingle<DBOStorageHeader>(
            'storageHeaders', {
            filter: { storageHeaderId: storageFile.storageHeaderId }
        });
        if (!storageHeader) { throw new AQServerDBError('Storage file header has not found'); }

        logger.action('Fetching data chunk headers');
        const chunkHeaders = await this.get('dataChunks', {
            orderBy: 'dataChunkId',
            columns: ['dataChunkId'],
            filter: {
                storageHeaderId: storageFile.storageHeaderId
            }
        });

        logger.info('Chunks found', { found: chunkHeaders.length });
        const crcCalculator = new AQCRCCalc();
        for (const chunkHeader of chunkHeaders) {
            const chunkId = chunkHeader.dataChunkId;

            logger.action('Fetching chunk', { chunkId: chunkId })
            const row = await this.getSingle<any>('dataChunks',
                { columns: ['blob'], filter: { dataChunkId: chunkId } });

            const blob = row.blob;

            crcCalculator.digest(blob);
            const buffer = Buffer.from(blob);
            await new Promise<void>((resolve) => {

            });

            logger.success('Chunk fetched', row);
        }

    }

    async exportFile(storageFileId: string) {
        try {
            const storageFile = await this.getSingle<DBOStorageFile>(
                'storageFiles', { filter: { storageFileId: storageFileId } });

            if (!storageFile) { throw new AQServerDBError('Storage file entry has not been found'); }
            const storageHeader = await this.getSingle<DBOStorageHeader>(
                'storageHeaders', { filter: { storageHeaderId: storageFile.storageHeaderId } });

            if (!storageHeader) { throw new AQServerDBError('Storage file header has not found'); }

            logger.action('Fetching chunk headers');
            const chunkHeaders = await this.get('dataChunks', {
                orderBy: 'dataChunkId',
                columns: ['dataChunkId'],
                filter: { storageHeaderId: storageFile.storageHeaderId },
            });

            logger.info(`${chunkHeaders.length} chunk headers fetched`);
            const downloadsDir = 'downloads';
            if (!fs.existsSync(downloadsDir)) {
                fs.mkdirSync(downloadsDir, { recursive: true })
            }

            const outputFile = path.join(downloadsDir, `${storageFile.storageFileId}.bin`);
            const writeStream = fs.createWriteStream(outputFile);
            const crcCalculator = new AQCRCCalc();

            let totalBytes = 0;
            let totalChunks = 0;

            for (const chunkHeader of chunkHeaders) {
                const chunkId = chunkHeader.dataChunkId;
                const chunkData = await this.getSingle<any>('dataChunks',
                    { columns: ['blob'], filter: { dataChunkId: chunkId } });
                const chunk = chunkData.blob;
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
        userId: string,
        originalFileName: string,
        onBeforeTransactionEnds: (storageFileId: string, file: string) => void) {
        try {
            const stat = fs.statSync(file);
            const fileSize = stat.size;
            const crcCalculator = new AQCRCCalc();
            const bufferSize = 250000;
            const fileCRC = await crcCalculator.fileCRC(file);
            const storageFileId = randomBytes(16).toString('hex').toUpperCase();

            await this.beginTransaction();
            const insertResult = await this.insert('storageHeaders', { fileSize: fileSize, crc: fileCRC });

            const storageHeaderId = insertResult.lastId;

            await this.insert('storageFiles', {
                storageFileId: storageFileId,
                storageHeaderId: storageHeaderId,
                fileName: originalFileName,
                userId: userId
            });

            const readStream = fs.createReadStream(file, { highWaterMark: bufferSize });
            await new Promise<string>((resolve, reject) => {
                let totalBytes = 0;
                let totalChunks = 0;
                const crcCalculator = new AQCRCCalc();
                readStream.on('readable', async () => {
                    let blob;
                    while (null !== (blob = readStream.read())) {
                        crcCalculator.digest(blob);
                        await this.insert('dataChunks', {
                            storageHeaderId: storageHeaderId,
                            blob: blob
                        });
                        totalBytes += blob.length;
                        totalChunks++;
                        if (totalBytes === fileSize) {
                            if (crcCalculator.crc !== fileCRC) {
                                reject(new AQServerDBError('DB_ERROR_FAILED_ADD_FILE', 'Mismatched CRC'));
                            }
                            await onBeforeTransactionEnds(storageFileId, file);
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

    public async insert<T>(tableName: string, data: T): Promise<TRunResult> {
        try {
            let sql: string;
            if (Array.isArray(data)) {
                const columns = Object.keys(data[0]).map((column) => `[${column}]`).join(', ');
                const placeholders = Object.keys(data[0]).map(() => '?').join(', ');
                const values: TParam[] = data.flatMap((row) => Object.values(row));
                sql = `INSERT INTO ${tableName} (${columns}) VALUES (${placeholders})`;
                const result = await this.run(sql, values);
                return result;
            } else {
                const columns = Object.keys(data as any).map((column) => `[${column}]`).join(', ');
                const placeholders = Object.keys(data as any).map(() => '?').join(', ');
                const values: TParam[] = Object.values(data as any);
                sql = `INSERT INTO ${tableName} (${columns}) VALUES (${placeholders})`;
                const result = await this.run(sql, values);
                return result;
            }
        } catch (error) {
            throw new AQServerDBError(`Failed to insert data`, error);
        }
    }

    public async run(sql: string, params: TParam[] = []): Promise<TRunResult> {
        await this.connect();
        const result = await new Promise<TRunResult>(async (resolve, reject) => {
            try {
                this._db!.run(sql, params, function (error) {
                    if (error) { reject(error) }
                    const lastId: any = this?.lastID;
                    const changes = this?.changes;
                    resolve({ lastStringId: `${lastId}`, lastId: lastId, changes: changes });
                });
            } catch (error) {
                reject(new AQServerDBError('DB_ERROR_RUN', error));
            }
        });
        return result;
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

    public async getSingle<T>(tableName: string, options?: SQLiteAdapterGetOptions) {
        const result = await this.get<T>(tableName, options);
        if (result?.length) { return result[0] }
    }


    public async getScalar<T = any>(tableName: string, filter?: TSQLiteObject, options?: SQLiteAdapterGetOptions) {
        const result = await this.get<T>(tableName, options);
        if (!result?.length) { return null }
        const row: any = result[0];
        const values = Object.values;
        if (!values?.length) { return null; }
        const value: any = (values as any)[0];
        return value;
    }

    public async get<T = any>(
        tableName: string,
        options?: SQLiteAdapterGetOptions
    ): Promise<Array<T>> {
        await this.connect();
        const maxResults = options?.maxResults;
        const orderBy = options?.orderBy;
        let sql: string;
        let params: any = [];

        const selection = options?.columns?.length ? options.columns.join(', ') : '*';

        if (options?.filter && typeof options.filter === 'object') {
            const conditions = Object.entries(options.filter).map(([column, value]) => {
                params.push(value);
                return `[${column}] = ?`;
            }).join(' AND ');
            sql = `SELECT ${selection} FROM ${tableName} WHERE ${conditions}`;
        } else {
            sql = `SELECT ${selection} FROM ${tableName}`;
        }

        if (orderBy) {
            if (Array.isArray(orderBy)) {
                const columns = orderBy.map(column => `[${column}]`).join(', ');
                sql += ` ORDER BY ${columns}`;
            } else { sql += ` ORDER BY [${orderBy}]`; }
        }
        if (maxResults) { sql += ' LIMIT ?'; params.push(maxResults); }
        const result = await new Promise<T[]>((resolve, reject) => {
            this._db!.all<T>(sql, params, (err, data) => {
                if (err) { return reject(err) }
                resolve(data);
            });
        });
        return result;
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