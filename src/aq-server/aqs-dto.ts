

export interface DBONewUserFile {
    userId: string;
    storageFileId: string;
}



export type DBOUserFile = DBONewUserFile & {
    id: number;
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
export type DBOTable = {
    tableId?: number;
    tableName?: string;
};

export type DBOTableColumn = {
    columnId?: number;
    tableId?: number;
    columnName?: string;
    dataType?: TDataType;
    required?: number;
    array?: number;
    regex?: string;
};

export type TDataType = 'string';

export type DBOTableRow = {
    tableRowId?: number;
    tableId?: number;
    columnId?: string;
    created?: number;
    modified?: number;
};

export type DBOTableRowData = {
    tableRowDataId?: number;
    tableRowID?: number | string;
    columnId?: number;
    value?: string;
};

