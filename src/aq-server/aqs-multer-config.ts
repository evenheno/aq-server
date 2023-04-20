import multer, { Multer } from 'multer';
import { Request, Response, Express } from 'express';
import fs from 'fs';

const storage = multer.diskStorage({
    destination: (req: Request, file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => {
        const dir = 'uploads';
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true })
        }
        cb(null, dir);
    },
    filename: (req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
        cb(null, `${Date.now()}.bin`);
    }
});
export const upload: Multer = multer({ storage });