// Execute como Administrador: node server\uninstall-service.cjs
const Service = require('node-windows').Service;
const path = require('path');
const svc = new Service({
  name: 'AllegraGestaoPro',
  script: path.join(__dirname, 'server.js'),
  workingDirectory: path.resolve(__dirname, '..')
});
svc.on('uninstall', () => console.log('Serviço AllegraGestaoPro removido.'));
svc.on('error', e => console.error('Erro:', e));
svc.uninstall();
