import fs, { rmSync } from 'fs';
import path from 'path';
import mime from 'mime';
import { AQSController } from '../aqs-controller';
import { DBOUserFile, DBONewUserFile } from '../aqs-dto';
import { AQLogger } from 'aq-logger';
import { AQServerError } from '../aqs-errors';
import { DBOStorageFile } from '../aqs-dto';
import { DBOStorageHeader } from '../aqs-dto';
import { upload } from '../aqs-multer-config';
import { TExecuter } from '../aqs-types';
import { DTORegisterReq } from './aqs-user-controller';

const logger = new AQLogger('StorageController');

export class StorageController extends AQSController {

    constructor() {
        super('StorageController', '/storage');
    }

    public async initRoutes() {
        const baseOptions = { authenticate: true }
        this.route('GET', '/', this._getUserFiles, baseOptions);
        this.route('GET', '/:storageFileId', this._downloadFile, baseOptions);
        this.route('PUT', '/', this._uploadFile, { ...baseOptions, handlers: [upload.single('file')] });
    }

    private _getUserFiles: TExecuter<DTORegisterReq> = async (body, params, server, token) => {
        const userId = token!.userId;
        logger.action('Fetching storage files', { userId: userId });
        const storageFiles = await this.db.get('userFiles', { filter: { userId: userId } });
        return storageFiles;
    };

    private _uploadFile: TExecuter<DTORegisterReq> = async (body, params, server, token) => {
        const userId = token!.userId;
        if (!userId) { throw new AQServerError('Authentication required') }
        logger.action('Storing file');
        if (!server.request.file?.filename) {
            throw new AQServerError('No file input received');
        }
        const outputFile = server.request.file?.path!;
        const originalFileName = server.request.file?.originalname;
        const storageFileId = await this.db.storeFile(
            outputFile,
            userId,
            originalFileName,
            async (storageFileId: string, file: string) => {
                const dboFile: DBONewUserFile = { userId: userId, storageFileId: storageFileId }
                await this.db.insert('userFiles', dboFile);
                fs.rmSync(file);
            }
        );
        const url = this.resolveUrl(storageFileId);
        logger.info('Download URL', url);
        return { downloadUrl: url };
    };

    private _downloadFile: TExecuter<DTORegisterReq> = async (body, params, server, token) => {
        let outputFile: string = '';
        try {

            const storageFileId = server.request.params['storageFileId'];
            logger.action('Fetching storage file', { storageFileId: storageFileId });

            const userFile = await this.db.getSingle<DBOUserFile>('userFiles', { filter: { storageFileId: storageFileId } });
            if (!userFile) { throw new AQServerError('User storage file not found') }

            const storageFile = await this.db.getSingle<DBOStorageFile>('storageFiles', { filter: { storageFileId: userFile.storageFileId } });
            if (!storageFile) { throw new AQServerError('Storage file not found') };

            const storageHeader = await this.db.getSingle<DBOStorageHeader>('storageHeaders', { filter: { storageHeaderId: storageFile.storageHeaderId } });
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

            server.response.setHeader('Content-disposition', 'attachment; filename=' + storageFile.fileName);
            server.response.setHeader('Content-type', mimetype);
            server.response.setHeader('Content-Length', storageHeader.fileSize);

            const fileStream = fs.createReadStream(outputFile);
            await new Promise<void>((resolve, reject) => {
                fileStream.pipe(server.response);
                fileStream.on('end', () => { resolve(); })
                fileStream.on('error', (error) => { reject(error); })
            });

        } catch (error) {
            throw error;
        } finally {
            if (outputFile) {
                logger.action('Deleting file', outputFile);
                fs.rmSync(outputFile, { force: true });
            }
        }
    };


}
