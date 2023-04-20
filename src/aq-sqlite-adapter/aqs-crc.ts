const fs = require('fs');
const { crc32 } = require('crc');

export class AQCRCCalc {
    private _crc: number;
    public get crc() { return this._crc }

    public constructor() {
        this._crc = 0;
    }

    public async fileCRC(file: string) {
        const stream = fs.createReadStream(file);
        return new Promise<number>((resolve, reject) => {
            stream.on('data', (chunk: any) => {
                this._crc = crc32(chunk, this._crc);
            });
            stream.on('end', () => { resolve(this._crc); });
            stream.on('error', (error: any) => { reject(error); });
        });
    }

    public digest(buffer: any) {
        this._crc = crc32(buffer, this._crc);
    }
}
