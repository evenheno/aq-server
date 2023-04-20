import { IDBColumn, TDBDataType, TDefaultValues } from "./aq-sqlite-adapter.types";

export class DBColumn extends Object implements IDBColumn {
    public columnName!: string;
    public dataType!: TDBDataType;
    public unique?: boolean | undefined;
    public nullable?: boolean;
    public pk?: boolean | undefined;
    public defaultValue?: TDefaultValues | undefined;
    public autoIncrement?: boolean | undefined;

    public constructor(column: IDBColumn) {
        super();
        this._setData(column);
    }

    private _setData(column: IDBColumn) {
        for (let key in column) {
            (this as any)[key] = (column as any)[key];
        }
    }

    public override toString() {
        let sql = `[${this.columnName}] ${this.dataType}`;
        if (this.pk) { sql += ' PRIMARY KEY'; if (this.autoIncrement) { sql += ' AUTOINCREMENT'; } }
        if (this.defaultValue !== undefined) { sql += ` DEFAULT ${this.defaultValue}` };
        if (!this.nullable) { sql += ' NOT NULL'; }
        if (this.unique) { sql += ' UNIQUE'; }
        return sql;
    }
}

export class DBColumnID extends DBColumn {
    constructor(columnName: string) {
        super({
            columnName: columnName,
            dataType: 'INTEGER',
            autoIncrement: true,
            nullable: false,
            pk: true,
            unique: true
        })
    }
}

export class DBColumnStringID extends DBColumn {
    constructor(columnName: string) {
        super({
            columnName: columnName,
            dataType: 'TEXT',
            nullable: false,
            pk: true,
            unique: true
        })
    }
}

export class DBColumnString extends DBColumn {
    constructor(columnName: string) {
        super({
            columnName: columnName,
            dataType: 'TEXT',
            autoIncrement: false,
            nullable: true,
            pk: false,
            unique: false
        })
    }
}

export class DBColumnInteger extends DBColumn {
    constructor(columnName: string) {
        super({
            columnName: columnName,
            dataType: 'INTEGER',
            autoIncrement: false,
            nullable: true,
            pk: false,
            unique: false
        })
    }
}

export class DBColumnAutoTS extends DBColumn {
    constructor(columnName: string) {
        super({
            columnName: columnName,
            dataType: 'INTEGER',
            autoIncrement: false,
            nullable: false,
            pk: false,
            unique: false,
            defaultValue: 'CURRENT_TIMESTAMP'
        })
    }
}

export class DBColumnBlob extends DBColumn {
    constructor(columnName: string) {
        super({
            columnName: columnName,
            dataType: 'BLOB',
            autoIncrement: false,
            nullable: true,
            pk: false,
            unique: false
        })
    }
}