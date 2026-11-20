CREATE TABLE IF NOT EXISTS schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clientes (
  id text PRIMARY KEY,
  nome text NOT NULL,
  telefone text NOT NULL DEFAULT '',
  nascimento date,
  endereco text NOT NULL DEFAULT '',
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clientes_nome_idx ON clientes (lower(nome));
CREATE INDEX IF NOT EXISTS clientes_telefone_idx ON clientes (telefone);

CREATE TABLE IF NOT EXISTS estoque (
  id text PRIMARY KEY,
  nome text NOT NULL,
  unidade text NOT NULL DEFAULT 'un',
  quantidade numeric(14,3) NOT NULL DEFAULT 0 CHECK (quantidade >= 0),
  quantidade_minima numeric(14,3) CHECK (quantidade_minima >= 0),
  custo_unitario numeric(14,4) NOT NULL DEFAULT 0 CHECK (custo_unitario >= 0),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE estoque ADD COLUMN IF NOT EXISTS unidade text NOT NULL DEFAULT 'un';
ALTER TABLE estoque ADD COLUMN IF NOT EXISTS quantidade_minima numeric(14,3) CHECK (quantidade_minima >= 0);
ALTER TABLE estoque ALTER COLUMN quantidade_minima DROP NOT NULL;
ALTER TABLE estoque ALTER COLUMN quantidade_minima DROP DEFAULT;
CREATE INDEX IF NOT EXISTS estoque_nome_idx ON estoque (lower(nome));

CREATE TABLE IF NOT EXISTS produtos (
  id bigserial PRIMARY KEY,
  nome text NOT NULL,
  nome_normalizado text NOT NULL UNIQUE,
  preco_padrao numeric(14,2) NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS produtos_nome_idx ON produtos (lower(nome));

CREATE TABLE IF NOT EXISTS compras (
  id text PRIMARY KEY,
  data_compra date NOT NULL,
  fornecedor text NOT NULL DEFAULT '',
  total numeric(14,2) NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS compras_data_idx ON compras (data_compra DESC);
CREATE TABLE IF NOT EXISTS compra_itens (
  id bigserial PRIMARY KEY,
  compra_id text NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
  estoque_id text REFERENCES estoque(id) ON DELETE SET NULL,
  nome_insumo text NOT NULL,
  quantidade numeric(14,3) NOT NULL CHECK (quantidade > 0),
  custo_unitario numeric(14,4) NOT NULL DEFAULT 0,
  subtotal numeric(14,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS compra_itens_compra_idx ON compra_itens (compra_id);
CREATE INDEX IF NOT EXISTS compra_itens_estoque_idx ON compra_itens (estoque_id);

CREATE TABLE IF NOT EXISTS vendas (
  id text PRIMARY KEY,
  data_venda date NOT NULL,
  data_pedido date,
  cliente_id text REFERENCES clientes(id) ON DELETE SET NULL,
  nome_cliente text NOT NULL DEFAULT 'Cliente avulso',
  telefone_cliente text NOT NULL DEFAULT '',
  endereco_entrega text NOT NULL DEFAULT '',
  produto_resumo text NOT NULL DEFAULT '',
  quantidade numeric(14,3) NOT NULL DEFAULT 1,
  total numeric(14,2) NOT NULL DEFAULT 0,
  recebido numeric(14,2) NOT NULL DEFAULT 0,
  custo numeric(14,2) NOT NULL DEFAULT 0,
  pagamento text NOT NULL DEFAULT '',
  entrega text NOT NULL DEFAULT '',
  previsao_entrega date,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vendas_data_idx ON vendas (data_venda DESC);
CREATE INDEX IF NOT EXISTS vendas_cliente_idx ON vendas (cliente_id, data_venda DESC);
CREATE TABLE IF NOT EXISTS venda_itens (
  id text PRIMARY KEY,
  venda_id text NOT NULL REFERENCES vendas(id) ON DELETE CASCADE,
  produto_id bigint REFERENCES produtos(id) ON DELETE SET NULL,
  nome_produto text NOT NULL,
  quantidade numeric(14,3) NOT NULL DEFAULT 1,
  preco_unitario numeric(14,2) NOT NULL DEFAULT 0,
  recebido numeric(14,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS venda_itens_venda_idx ON venda_itens (venda_id);
CREATE INDEX IF NOT EXISTS venda_itens_produto_idx ON venda_itens (produto_id);
CREATE TABLE IF NOT EXISTS venda_item_insumos (
  id bigserial PRIMARY KEY,
  venda_item_id text NOT NULL REFERENCES venda_itens(id) ON DELETE CASCADE,
  estoque_id text REFERENCES estoque(id) ON DELETE SET NULL,
  nome_insumo text NOT NULL,
  quantidade_por_item numeric(14,3) NOT NULL DEFAULT 0,
  custo_unitario numeric(14,4) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS venda_item_insumos_item_idx ON venda_item_insumos (venda_item_id);
CREATE INDEX IF NOT EXISTS venda_item_insumos_estoque_idx ON venda_item_insumos (estoque_id);

CREATE TABLE IF NOT EXISTS controles_da_producao (
  id text PRIMARY KEY,
  venda_id text REFERENCES vendas(id) ON DELETE SET NULL,
  cliente_id text REFERENCES clientes(id) ON DELETE SET NULL,
  nome_cliente text NOT NULL DEFAULT 'Cliente avulso',
  telefone_cliente text NOT NULL DEFAULT '',
  endereco_entrega text NOT NULL DEFAULT '',
  produto_resumo text NOT NULL DEFAULT '',
  quantidade numeric(14,3) NOT NULL DEFAULT 1,
  total numeric(14,2) NOT NULL DEFAULT 0,
  recebido numeric(14,2) NOT NULL DEFAULT 0,
  custo numeric(14,2) NOT NULL DEFAULT 0,
  data_pedido date,
  previsao_entrega date,
  tipo_entrega text NOT NULL DEFAULT 'Loja',
  pagamento text NOT NULL DEFAULT '',
  etapa text NOT NULL DEFAULT 'Criação de Arte',
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE controles_da_producao ADD COLUMN IF NOT EXISTS custo numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE controles_da_producao DROP CONSTRAINT IF EXISTS controles_da_producao_venda_id_key;
CREATE INDEX IF NOT EXISTS controles_venda_idx ON controles_da_producao (venda_id);
CREATE INDEX IF NOT EXISTS controles_etapa_idx ON controles_da_producao (etapa, previsao_entrega);
CREATE INDEX IF NOT EXISTS controles_cliente_idx ON controles_da_producao (cliente_id, data_pedido DESC);
CREATE TABLE IF NOT EXISTS controle_producao_itens (
  id text PRIMARY KEY,
  controle_id text NOT NULL REFERENCES controles_da_producao(id) ON DELETE CASCADE,
  produto_id bigint REFERENCES produtos(id) ON DELETE SET NULL,
  nome_produto text NOT NULL,
  quantidade numeric(14,3) NOT NULL DEFAULT 1,
  preco_unitario numeric(14,2) NOT NULL DEFAULT 0,
  recebido numeric(14,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS controle_itens_controle_idx ON controle_producao_itens (controle_id);
CREATE INDEX IF NOT EXISTS controle_itens_produto_idx ON controle_producao_itens (produto_id);
CREATE TABLE IF NOT EXISTS controle_item_insumos (
  id bigserial PRIMARY KEY,
  controle_item_id text NOT NULL REFERENCES controle_producao_itens(id) ON DELETE CASCADE,
  estoque_id text REFERENCES estoque(id) ON DELETE SET NULL,
  nome_insumo text NOT NULL,
  quantidade_por_item numeric(14,3) NOT NULL DEFAULT 0,
  custo_unitario numeric(14,4) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS controle_item_insumos_item_idx ON controle_item_insumos (controle_item_id);
CREATE INDEX IF NOT EXISTS controle_item_insumos_estoque_idx ON controle_item_insumos (estoque_id);

CREATE TABLE IF NOT EXISTS orcamentos (
  id text PRIMARY KEY,
  data_orcamento date NOT NULL,
  data_pedido date,
  previsao_entrega date,
  cliente_id text REFERENCES clientes(id) ON DELETE SET NULL,
  nome_cliente text NOT NULL DEFAULT 'Cliente avulso',
  telefone_cliente text NOT NULL DEFAULT '',
  endereco_entrega text NOT NULL DEFAULT '',
  nome_produto text NOT NULL DEFAULT '',
  nome_composicao text NOT NULL DEFAULT '',
  quantidade numeric(14,3) NOT NULL DEFAULT 1,
  preco numeric(14,2) NOT NULL DEFAULT 0,
  custo numeric(14,2) NOT NULL DEFAULT 0,
  margem numeric(10,3) NOT NULL DEFAULT 0,
  tipo_margem text NOT NULL DEFAULT 'margin',
  percentual_sinal numeric(10,3) NOT NULL DEFAULT 50,
  valor_entrada numeric(14,2) CHECK (valor_entrada >= 0),
  pagamento text NOT NULL DEFAULT '',
  entrega text NOT NULL DEFAULT 'Loja',
  status text NOT NULL DEFAULT 'Aguardando aprovação',
  venda_id text REFERENCES vendas(id) ON DELETE SET NULL,
  controle_id text REFERENCES controles_da_producao(id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS valor_entrada numeric(14,2) CHECK (valor_entrada >= 0);
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS nome_composicao text NOT NULL DEFAULT '';
ALTER TABLE orcamentos ALTER COLUMN margem TYPE numeric(10,3);
ALTER TABLE orcamentos ALTER COLUMN percentual_sinal TYPE numeric(10,3);
CREATE INDEX IF NOT EXISTS orcamentos_data_idx ON orcamentos (data_orcamento DESC);
CREATE INDEX IF NOT EXISTS orcamentos_cliente_idx ON orcamentos (cliente_id);
CREATE INDEX IF NOT EXISTS orcamentos_venda_idx ON orcamentos (venda_id);
CREATE INDEX IF NOT EXISTS orcamentos_controle_idx ON orcamentos (controle_id);
CREATE TABLE IF NOT EXISTS orcamento_insumos (
  id bigserial PRIMARY KEY,
  orcamento_id text NOT NULL REFERENCES orcamentos(id) ON DELETE CASCADE,
  estoque_id text REFERENCES estoque(id) ON DELETE SET NULL,
  nome_insumo text NOT NULL,
  quantidade numeric(14,3) NOT NULL DEFAULT 0,
  custo_unitario numeric(14,4) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS orcamento_insumos_orcamento_idx ON orcamento_insumos (orcamento_id);
CREATE INDEX IF NOT EXISTS orcamento_insumos_estoque_idx ON orcamento_insumos (estoque_id);

CREATE TABLE IF NOT EXISTS despesas (
  id text PRIMARY KEY,
  descricao text NOT NULL,
  valor numeric(14,2) NOT NULL DEFAULT 0,
  data_despesa date NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS despesas_data_idx ON despesas (data_despesa DESC);

CREATE TABLE IF NOT EXISTS modelos (
  id text PRIMARY KEY,
  nome text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS modelo_insumos (
  id bigserial PRIMARY KEY,
  modelo_id text NOT NULL REFERENCES modelos(id) ON DELETE CASCADE,
  estoque_id text REFERENCES estoque(id) ON DELETE SET NULL,
  nome_insumo text NOT NULL,
  quantidade numeric(14,3) NOT NULL DEFAULT 0,
  custo_unitario numeric(14,4) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS modelo_insumos_modelo_idx ON modelo_insumos (modelo_id);
CREATE INDEX IF NOT EXISTS modelo_insumos_estoque_idx ON modelo_insumos (estoque_id);

CREATE TABLE IF NOT EXISTS configuracoes (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  negocio text NOT NULL DEFAULT 'Allegra gráfica & personalizados',
  telefone text NOT NULL DEFAULT '',
  endereco text NOT NULL DEFAULT '',
  estoque_baixo numeric(14,3) NOT NULL DEFAULT 5,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
INSERT INTO configuracoes(id) VALUES (1) ON CONFLICT (id) DO NOTHING;
