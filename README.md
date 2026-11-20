# Allegra Gestão Pro ERP — Intranet Windows

**Versão 0.4.0 · Windows 10 · PostgreSQL local · Serviço automático**

O projeto usa o PostgreSQL já instalado no computador (porta padrão 5432) e Node.js. Não exige Docker, Supabase ou Vercel.

## Como funciona
- O computador Windows 10 é o servidor da intranet.
- O serviço Windows `AllegraGestaoPro` inicia automaticamente com o sistema.
- O site fica disponível na porta 3000 para os dispositivos conectados ao mesmo Wi-Fi.
- PostgreSQL fica em `127.0.0.1:5432`; a porta 5432 não precisa ser aberta no Wi-Fi.
- Login único da administradora.

## Instalação
1. Confirme que o serviço PostgreSQL do Windows está iniciado.
2. Crie o banco `allegra` executando `database/01-criar-banco.sql` no pgAdmin conectado ao banco `postgres`.
3. Copie `.env.example` para `.env` e preencha as credenciais.
4. Execute `INSTALAR_SERVICO.bat` como Administrador.
5. Acesse `http://localhost:3000` no servidor.
6. Em outros dispositivos no mesmo Wi-Fi, acesse `http://IP-DO-SERVIDOR:3000`.

Consulte `docs/IMPLANTACAO_WINDOWS.md` para instruções detalhadas e geração segura do hash bcrypt.

Para consultar as melhorias funcionais das telas de clientes e estoque, veja `docs/ALTERACOES_FUNCIONAIS.md`.

## Serviço
- Instalar/iniciar: `INSTALAR_SERVICO.bat` (Administrador).
- Remover: `REMOVER_SERVICO.bat` (Administrador).
- Inicialização automática: configurada pelo Windows Service Control Manager.
- Logs do wrapper Node Windows: diretório `%APPDATA%\\npm\\node_modules\\node-windows\\logs` (pode variar conforme a conta do serviço).

## Segurança
- Não exponha a porta 5432 na rede.
- Firewall do Windows: permitir TCP 3000 somente em perfil Privado e rede local.
- Não configure port forwarding no roteador.
- Troque a senha padrão `postgres` por uma senha forte antes de usar dados reais.
- O arquivo `.env` contém segredos e não deve ser compartilhado.
- A configuração inicial usa HTTP na LAN; use somente Wi-Fi privado confiável.
