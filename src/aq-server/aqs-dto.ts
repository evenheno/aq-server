export type DBOUser = DBONewUser & {
    userId: number;
}

export type DBONewUser = {
    displayName: string;
    email: string;
    password: string;
    salt: string;
}

export type DBOUserFile = DBONewUserFile & {
    id: number;
}

export interface DBONewUserFile {
    userId: number;
    storageFileId: string;
}

export interface DTORegisterRes {
    id: number
}

export interface DTORegisterReq {
    displayName: string,
    email: string,
    password: string
}

export interface DTOLoginReq {
    email: string,
    password: string
}

export interface DBOStorageFile {
    storageFileId: string,
    storageHeaderId: number,
    fileName: string,
    created: number,
    userId: number
}

export interface DBOStorageHeader {
    storageHeaderId: number,
    crc: number,
    fileSize: number
}