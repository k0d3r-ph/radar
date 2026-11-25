/**
 * Migrações do esquema PostgreSQL do Radar, aplicadas em ordem na inicialização dos processos
 * (ver migrador.ts). Uma migração publicada nunca é editada: mudanças entram como nova versão.
 */
export interface Migracao {
  versao: number;
  nome: string;
  sql: string;
}

// Lista congelada da versão 1; coleções novas entram em migrações futuras.
const TABELAS_V1 = [
  'usuarios', 'empresas', 'ocorrencias', 'gamificacao_pontos', 'checklist_tarefas', 'configuracoes',
  'temas_ocorrencia', 'integracoes', 'favoritos_ocorrencias', 'csat_reservas', 'csat_links', 'csat_controle',
  'validacao_perguntas', 'validacao_tentativas', 'validacao_clientes', 'validacao_controle',
  'ssx_desk_importacoes', 'ssx_desk_sessoes',
];

const colunasComuns = `
  dados jsonb not null check (jsonb_typeof(dados) = 'object'),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  versao bigint not null default 0,
  transacao xid8 not null default pg_current_xact_id()`;

const tabelaRaiz = (t: string) => `
create table ${t} (
  id text primary key check (id <> '' and strpos(id, '/') = 0),${colunasComuns}
);
create trigger ${t}_versionar before insert or update on ${t} for each row execute function radar_versionar();
create trigger ${t}_exclusao after delete on ${t} for each row execute function radar_registrar_exclusao();
create index ${t}_dados on ${t} using gin (dados jsonb_path_ops);
create index ${t}_transacao on ${t} (transacao);`;

const tabelaSubcolecao = (t: string) => `
create table ${t} (
  pai_id text not null check (pai_id <> '' and strpos(pai_id, '/') = 0),
  id text not null check (id <> '' and strpos(id, '/') = 0),${colunasComuns},
  primary key (pai_id, id)
);
create trigger ${t}_versionar before insert or update on ${t} for each row execute function radar_versionar();
create trigger ${t}_exclusao after delete on ${t} for each row execute function radar_registrar_exclusao_subcolecao();
create index ${t}_transacao on ${t} (transacao);`;

export const MIGRACOES: Migracao[] = [
  {
    versao: 1,
    nome: 'documentos iniciais (coleções vindas do Firestore)',
    sql: `
-- Versão de cada gravação: muda a cada insert/update e substitui o updateTime do Firestore.
create sequence radar_versao as bigint;

-- Leitura tipada de campos JSON, usada em filtros de intervalo (>, >=, <, <=) e índices.
create function radar_numero(v jsonb) returns numeric language sql immutable parallel safe
  as $$ select case when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric end $$;
create function radar_texto(v jsonb) returns text language sql immutable parallel safe
  as $$ select case when jsonb_typeof(v) = 'string' then v #>> '{}' end $$;

-- A importação do Firestore (radar.importacao = 'on' na transação) preserva as datas originais.
create function radar_versionar() returns trigger language plpgsql as $$
begin
  new.versao := nextval('radar_versao');
  new.transacao := pg_current_xact_id();
  if coalesce(current_setting('radar.importacao', true), '') <> 'on' then
    new.atualizado_em := now();
    if tg_op = 'UPDATE' then new.criado_em := old.criado_em; end if;
  end if;
  return new;
end $$;

-- Exclusões ficam registradas para que índices em memória e navegadores descartem o documento.
create table radar_exclusoes (
  tabela text not null,
  chave text not null,
  versao bigint not null default nextval('radar_versao'),
  transacao xid8 not null default pg_current_xact_id(),
  excluido_em timestamptz not null default now()
);
create index radar_exclusoes_tabela_transacao on radar_exclusoes (tabela, transacao);
create index radar_exclusoes_excluido_em on radar_exclusoes (excluido_em);

create function radar_registrar_exclusao() returns trigger language plpgsql as $$
begin
  insert into radar_exclusoes (tabela, chave) values (tg_table_name, old.id);
  return old;
end $$;
create function radar_registrar_exclusao_subcolecao() returns trigger language plpgsql as $$
begin
  insert into radar_exclusoes (tabela, chave) values (tg_table_name, old.pai_id || '/' || old.id);
  return old;
end $$;
${TABELAS_V1.map(tabelaRaiz).join('\n')}
${tabelaSubcolecao('csat_reservas_respostas')}

-- Filtros de intervalo usados pelo backend.
create index empresas_updated_at on empresas (radar_numero(dados -> 'updatedAt'));
create index validacao_tentativas_concluida_em on validacao_tentativas (radar_numero(dados -> 'concluidaEm'));
`,
  },
];
