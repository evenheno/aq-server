const fse = require('fs-extra');
const path = require('path');
const cwd = process.cwd();

function clearDist(){
    fse.rmSync(path.join(cwd, 'dist'), { recursive: true, force: true });
}

async function init(){
    clearDist();
}

init();
