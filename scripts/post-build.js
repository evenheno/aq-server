const fse = require('fs-extra');
const path = require('path');
const cwd = process.cwd();
const { CRCCalc } = require('./crc-calc');
const { AQLogger } = require('aq-logger');

const logger = new AQLogger('PostBuild');
const crcCalc = new CRCCalc();

async function scanDir(dirPath) {
    const exclude = ['node_modules', 'dist', 'scripts', 'package-lock.json'];
    const dirItems = fse.readdirSync(dirPath);
    const result = [];
    for (const dirItem of dirItems) {
        if (exclude.includes(dirItem)) { continue; }
        const filePath = path.join(dirPath, dirItem);
        const stat = fse.statSync(filePath);
        if (stat.size > 100000) { continue; }
        const isDir = stat.isDirectory();
        if (isDir) {
            result.push(... await scanDir(filePath));
            continue;
        }
        const relativeFilePath = path.relative(cwd, filePath);
        const fileCRC = await crcCalc.calcFileCRC(filePath);
        result.push({
            path: relativeFilePath,
            crc: fileCRC,
            fileSize: stat.size
        });
    }
    return result;
}

async function createBuildManifest(packageJsonObject, distFolderPath) {
    logger.action('Creating build manifest');
    const file = path.join(cwd, 'build.json');
    const jsonString = fse.readFileSync(file, 'utf8');
    const jsonObject = JSON.parse(jsonString);
    jsonObject.buildNumber++;
    jsonObject.buildTS = Date.now();
    jsonObject.version = packageJsonObject.version;
    jsonObject.filesSummary = await scanDir(cwd);
    fse.writeJSONSync(file, jsonObject, { spaces: 2 });
    fse.copyFileSync(file, path.join(distFolderPath, 'build.json'));
}

function copyResources() {
    logger.action('Copying resources');
    const source = path.join(cwd, 'resources');
    const dist = path.join(cwd, 'dist', 'resources');
    fse.cpSync(source, dist, { recursive: true });
}

async function init() {
    logger.action('Executing post build script');
    const packageJsonPath = path.join(cwd, 'package.json');
    const packageJsonString = fse.readFileSync(packageJsonPath, 'utf8');
    const packageJsonObject = JSON.parse(packageJsonString);
    delete packageJsonObject.devDependencies;
    delete packageJsonObject.scripts;
    packageJsonObject.types = 'types/index.d.ts';
    const distFolderPath = path.join(cwd, 'dist');
    fse.ensureDirSync(distFolderPath);
    const distPackageJsonPath = path.join(distFolderPath, 'package.json');
    fse.writeJsonSync(distPackageJsonPath, packageJsonObject, { spaces: 2 });
    await createBuildManifest(packageJsonObject, distFolderPath);
    copyResources();
}

init();