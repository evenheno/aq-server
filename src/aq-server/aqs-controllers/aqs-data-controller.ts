/*import { AQLogger } from "aq-logger";
import { DBColumnID, DBColumnString, DBColumnInteger, DBColumnAutoTS } from "../../aq-sqlite-adapter";
import { AQSController } from '../aqs-controller';
import { DBOTableColumn, DBOTableRow, DBOTable, DBOTableRowData } from "../aqs-dto";
import { AQServerError } from "../aqs-errors";

const logger = new AQLogger('DataController');
export class DataController extends AQSController {

    constructor() {
        super('DataController', '/db');
    }

    public async init() {
        await this.db.createTable('tables', [
            new DBColumnID('tableId'),
            new DBColumnString('tableName')
        ]);

        await this.db.createTable('tableColumns', [
            new DBColumnID('columnId'),
            new DBColumnInteger('tableId'),
            new DBColumnString('columnName'),
            new DBColumnString('dataType'),
            new DBColumnInteger('required'),
            new DBColumnInteger('array'),
            new DBColumnString('regex')
        ]);

        await this.db.createTable('tableRows', [
            new DBColumnID('tableRowId'),
            new DBColumnInteger('tableId'),
            new DBColumnAutoTS('created'),
            new DBColumnInteger('modified')
        ]);

        await this.db.createTable('tableRowData', [
            new DBColumnID('tableRowDataId'),
            new DBColumnInteger('tableRowId'),
            new DBColumnInteger('columnId'),
            new DBColumnString('value')
        ]);

        await this.db.run(`
            CREATE VIEW IF NOT EXISTS vTableData AS SELECT 
                tableRows.tableId,
                tableRows.tableRowId,
                created,
                tableRowData.columnId,
                tableRowData.value,
                tableColumns.columnName
            FROM 
                [tableRows]
            INNER JOIN
                [tableRowData]
            INNER JOIN 
                [tableColumns]
            ON
                [tableRowData].tableRowID = [tableRows].tableRowId AND
                [tableColumns].columnId = [tableRowData].columnId;
        `);
    }

    public async initRoutes() {
        this.route<DBOTable>({
            path: '/table',
            type: 'put',
            authenticate: true,
            executer: async (body, express, tokenPayload) => {
                logger.action('Adding new table', body);
                const tableId = await this.db.insert<DBOTable>('tables', {
                    tableName: body.tableName
                });
                return { tableId: tableId };
            }
        });

        this.route<DBOTableColumn>({
            path: '/table/column',
            type: 'put',
            authenticate: true,
            executer: async (body, express, tokenPayload) => {
                const tableColumn: DBOTableColumn = {
                    tableId: body.tableId,
                    columnName: body.columnName,
                    dataType: body.dataType,
                    required: body.required,
                    array: body.array,
                    regex: body.regex
                }
                logger.action('Adding new table', body);
                const columnId = await this.db.insert<DBOTableColumn>('tableColumns', tableColumn);
                return { columnId: columnId };
            }
        });

        this.route<{ tableId: number }>({
            path: '/table/:tableId',
            type: 'get',
            authenticate: true,
            executer: async (body, express, tokenPayload) => {
                const tableId = express.request.params['tableId']
                const res = await this.db.all(`select columnName, value from vTableData where tableId = ${tableId}`);
                return res;
            }
        });

        this.route<{ tableId: number, data?: any }>({
            path: '/table/record',
            type: 'put',
            authenticate: true,
            executer: async (body, express, tokenPayload) => {
                logger.action('Adding new table row', body);
                const insertResult = await this.db.insert<DBOTableRow>('tableRows', { tableId: body.tableId });
                logger.info('Table row created', { tableRowID: insertResult.lastId });
                for (let key in body.data) {
                    const column = await this.db.getSingle<DBOTableColumn>(
                        'tableColumns', {
                        filter: {
                            columnName: key,
                            tableId: body.tableId
                        }
                    });
                    if (!column) { throw new AQServerError(`Invalid column: ${key}`) }
                    const columnId = column?.columnId;
                    const value = body.data[key];
                    logger.action('Adding data', {
                        tableId: body.tableId,
                        columnKey: key,
                        columnId: columnId,
                        value: value
                    });
                    if (column.required && value == null) {
                        throw new AQServerError(`Column "${column.columnName}" is required`);
                    }
                    if (column.regex != null) {
                        const regex = new RegExp(column.regex);
                        const strValue: string = value;
                        if (!strValue.match(regex)) {
                            throw new AQServerError(`Invalid value`);
                        }
                    }
                    await this.db.insert<DBOTableRowData>('tableRowData', {
                        tableRowID: insertResult.lastId,
                        columnId: columnId,
                        value: body.data[key]
                    });
                }
                logger.success('Row added successfully')
                return { tableRowID: insertResult.lastId };
            }
        });

        this.route<{ tableId: number }>({
            path: '/table/:tableId/records',
            type: 'get',
            authenticate: true,
            executer: async (body, express, tokenPayload) => {
                const tableId = parseInt(express.request.params['tableId']);
                const table = await this.db.getSingle('tables', { filter: { tableId: tableId } });
                if (!table) { return new AQServerError('Table not found') };
                logger.action('Fetching table data', { tableId: tableId });
                const values: TVTableData[] = await this.db.get('vTableData', { filter: { tableId: tableId } });
                logger.info('Data fetched', values);
                const tableRows: { [key: string]: any } = {};
                for (const value of values) {
                    if (!tableRows[value.tableRowId]) {
                        tableRows[value.tableRowId] = {}
                    }
                    const rowData = tableRows[value.tableRowId];
                    rowData[value.columnName] = value.value;
                    rowData.tableRowId = value.tableRowId;
                    rowData.created = value.created;
                }
                const result = Object.values(tableRows);
                return result;
            }
        });

        this.route<{ data: any }>({
            path: '/table/:tableId/record/:tableRowId',
            type: 'put',
            authenticate: true,
            executer: async (body, express, tokenPayload) => {
                const tableRowId = parseInt(express.request.params['tableRowId']);
                const data = body.data;
                logger.action('Updating table row', { tableRowId, data });
                const row = await this.db.getSingle<DBOTableRow>('tableRows', { filter: { tableRowId } });
                if (!row) { throw new AQServerError(`Row with id ${tableRowId} not found`); }
                await this.db.beginTransaction();
                try {
                    for (let key in data) {
                        const column = await this.db.getSingle<DBOTableColumn>('tableColumns', {
                            filter: {
                                columnName: key,
                                tableId: row.tableId
                            }
                        });
                        if (!column) { throw new AQServerError(`Table column does not exist: "${key}"`) }
                        const columnId = column.columnId;
                        const value = data[key];
                        logger.action('Updating data', { tableRowId, columnKey: key, columnId, value });
                        if (column.required && value == null) { throw new AQServerError(`Column "${column.columnName}" is required`); }
                        if (column.regex != null) {
                            const regex = new RegExp(column.regex);
                            const strValue: string = value;
                            if (!strValue.match(regex)) {
                                throw new AQServerError(`Invalid value for column "${column.columnName}"`);
                            }
                        }
                        logger.info('Updating column', { columnName: column.columnName, columnId: column.columnId, value: value });
                        await this.db.update('tableRowData',
                            { tableRowID: row.tableRowId, columnId: columnId },
                            { value: value });
                    }
                } catch (error) {
                    await this.db.rollbackTransaction();
                    throw error;
                }
                await this.db.endTransaction();
                logger.success('Row updated successfully')
                return { tableRowId };
            }
        });



    }
}

export type TVTableData = {
    tableId: number,
    tableRowId: number,
    created: number,
    columnId: number,
    value: string,
    columnName: string
}*/