const fs = require('fs');
const { crc32 } = require('crc');

class CRCCalc {
  constructor() {
    this._crc = 0;
  }

  get crc() {
    return this._crc;
  }

  async calcFileCRC(file) {
    const stream = fs.createReadStream(file);
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => {
        this._crc = crc32(chunk, this._crc);
      });
      stream.on('end', () => {
        resolve(this._crc);
      });
      stream.on('error', (error) => {
        reject(error);
      });
    });
  }

  digest(buffer) {
    this._crc = crc32(buffer, this._crc);
  }
}

module.exports = { CRCCalc };