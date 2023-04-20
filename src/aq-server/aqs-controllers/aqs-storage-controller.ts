import fs from 'fs';
import path from 'path';
import mime from 'mime';
import { AQSController } from '../aqs-controller';
import { AQSServer } from '../aqs-server';

import { DBOUserFile, DBONewUserFile } from '../aqs-dto';

import { AQLogger } from 'aq-logger';
import { upload } from '../aqs-multer-config';
import { AQServerError } from '../aqs-errors';
import { DBOStorageFile } from '../aqs-dto';
import { DBOStorageHeader } from '../aqs-dto';

const logger = new AQLogger('StorageController');

export class StorageController extends AQSController {

    constructor(server: AQSServer) {
        super(server, 'StorageController', '/storage');
    }

    public async initRoutes() {

        this.register({
            type: 'get', path: '/', authenticate: false,
            executer: async (express, token) => {
                const userId = token!.userId;
                logger.action('Fetching storage files', { userId: userId });
                const storageFiles = await this.db.get('userFiles', { userId: userId });
                return storageFiles;
            }
        });

        this.register({
            type: 'get', path: '/:storageFileId', authenticate: false,
            executer: async (express, token) => {
                let outputFile: string = '';
                try {
                    const userId = token?.userId;
                    const storageFileId = express.request.params['storageFileId'];
                    logger.action('Fetching storage file', { storageFileId: storageFileId, userId: userId });

                    const userFile = await this.db.getSingle<DBOUserFile>('userFiles', { storageFileId: storageFileId/*, userId: userId*/ });
                    if (!userFile) { throw new AQServerError('User storage file not found') }

                    const storageFile = await this.db.getSingle<DBOStorageFile>('storageFiles', { storageFileId: userFile.storageFileId });
                    if (!storageFile) { throw new AQServerError('Storage file not found') };

                    const storageHeader = await this.db.getSingle<DBOStorageHeader>('storageHeaders', { storageHeaderId: storageFile.storageHeaderId });
                    if (!storageHeader) { throw new AQServerError('Storage header not found') };

                    outputFile = path.resolve(await this.db.exportFile(storageFileId));
                    const mimetype = mime.getType(outputFile) || '';

                    logger.action('Sending file', {
                        fileName: storageFile.fileName,
                        outputFile: outputFile,
                        mimetype: mimetype,
                        fileSize: storageHeader.fileSize,
                        crc: storageHeader.crc
                    });

                    express.response.setHeader('Content-disposition', 'attachment; filename=' + storageFile.fileName);
                    express.response.setHeader('Content-type', mimetype);
                    express.response.setHeader('Content-Length', storageHeader.fileSize);

                    const fileStream = fs.createReadStream(outputFile);
                    await new Promise<void>((resolve, reject) => {
                        fileStream.pipe(express.response);
                        fileStream.on('end', () => {
                            resolve();
                        })
                        fileStream.on('error', (error) => {
                            reject(error);
                        })
                    });

                } catch (error) {
                    throw error;
                } finally {
                    if (outputFile) {
                        logger.action('Deleting file', outputFile);
                        fs.rmSync(outputFile);
                    }
                }
            }
        });

        this.register({
            type: 'post', path: '/store', authenticate: true,
            handlers: [upload.single('file')],
            executer: async (express, token) => {
                const userId = token!.userId;
                if (!userId) { throw new AQServerError('Authentication required') }
                logger.action('Storing file');
                if (!express.request.file?.filename) {
                    throw new AQServerError('No file input received');
                }
                const uniqueFilename = Date.now().toString() + '.bin';
                const extension = path.extname(express.request.file?.filename!);
                const outputFile = express.request.file?.path!;
                const stats = fs.statSync(outputFile);
                const originalFileName = express.request.file?.originalname;

                const onBeforeTransactionEnds = async (storageFileId: string) => {
                    const dboFile: DBONewUserFile = { userId: userId, storageFileId: storageFileId }
                    await this.db.insert('userFiles', dboFile);
                };

                const storageFileId = await this.db.storeFile(
                    outputFile, userId,
                    originalFileName,
                    onBeforeTransactionEnds
                );

                const url = this.resolveUrl(storageFileId);
                logger.info('Download URL', url);
                return { downloadUrl: url };
            }
        });
    }
}
