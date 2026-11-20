// Execute como Administrador: node server\install-service.cjs
const Service = require('node-windows').Service;
const path = require('path');
const svc = new Service({
  name: 'AllegraGestaoPro',
  description: 'Allegra Gestão Pro ERP - intranet privada da Allegra',
  script: path.join(__dirname, 'server.js'),
  workingDirectory: path.resolve(__dirname, '..'),
  nodeOptions: [],
  env: [
    { name: 'NODE_ENV', value: 'production' }
  ],
  wait: 2,
  grow: 0.5,
  maxRestarts: 10
});
svc.on('install', () => { console.log('Serviço instalado. Configurando inicialização automática...'); svc.start(); });
svc.on('start', () => console.log('Allegra Gestão Pro iniciado como serviço do Windows.'));
svc.on('alreadyinstalled', () => console.log('O serviço AllegraGestaoPro já está instalado.'));
svc.on('error', e => console.error('Erro no serviço:', e));
svc.install();
