const { AQSServer, AQSController } = require('../dist');
const {AQLogger} = require('aq-logger');

const logger = new AQLogger('AQServerTest');

class MainController extends AQSController {
    constructor(server) {
        super(server, 'MainController', '/');
    }
    initRoutes() {
        this.register({
            type: 'get', path: '/errors',
            executer: async (express, token) => {
                const errors = await this.db.get('errors');
                return errors;
            }
        })
    }
}

class Server extends AQSServer {
    onControllers() {
        return [new MainController(this)]
    }
}

async function init() {
    logger.action('Creating new server instance');
    const server = new Server();
    logger.action('Starting instance');
    await server.start();
    logger.action('Stopping instance');
    await server.stop();
    logger.success('Test completed')
};

init();