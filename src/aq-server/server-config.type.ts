import { CorsOptions } from "cors"

export type TAQSServerConfig = {
    serverName: string
    port: number,
    hostname?: string,
    publicDir?: string,
    databaseFile?: string,
    enableCors: boolean
    corsOptions?: CorsOptions
}