export type TDBDataType = 'INTEGER' | 'TEXT' | 'BLOB';
export type TDBState = 'OPEN' | 'CLOSED';
export type TParam = string | number;
export type TRunResult = { lastId: number, changes: number };

export type TDefaultValues =
    number |
    string |
    boolean |
    'NULL' |
    'CURRENT_DATE' |
    'CURRENT_TIME' |
    'CURRENT_TIMESTAMP';

export interface IDBColumn {
    columnName: string,
    dataType: TDBDataType,
    unique?: boolean,
    pk?: boolean,
    defaultValue?: TDefaultValues,
    autoIncrement?: boolean,
    nullable?: boolean
}

export type SQLiteAdapterOptions = {
    key?: string
}

export type SQLiteAdapterGetOptions = {
    maxResults?: number,
    orderBy?: string[] | string,
    pageIndex?: number
}

export type TOrderByItem = {
    select: string[],
    columnName: string,
    direction: TOrderDirection
}

export type TSQLiteObject = {
    
}

export type TOrderDirection = 'ASC' | 'DSC';