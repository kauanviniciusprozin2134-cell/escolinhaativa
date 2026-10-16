/*
 * EscolinhaAtiva - banco de dados (SQLite nativo do Node, sem dependencias).
 * Multi-escolinha: toda tabela de dados tem escolinha_id e todas as consultas
 * filtram por esse id.
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DB_PATH = process.env.ESCOLINHA_DB || path.join(__dirname, 'data', 'escolinha.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS escolinhas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS turmas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  escolinha_id INTEGER NOT NULL REFERENCES escolinhas(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  professor TEXT NOT NULL,
  horarios TEXT NOT NULL,
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alunos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  escolinha_id INTEGER NOT NULL REFERENCES escolinhas(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  responsavel TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  turma_id INTEGER REFERENCES turmas(id) ON DELETE SET NULL,
  valor_mensalidade REAL NOT NULL DEFAULT 0,
  dia_vencimento INTEGER NOT NULL DEFAULT 10,
  situacao TEXT NOT NULL DEFAULT 'ativo',
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS presencas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  escolinha_id INTEGER NOT NULL REFERENCES escolinhas(id) ON DELETE CASCADE,
  aluno_id INTEGER NOT NULL REFERENCES alunos(id) ON DELETE CASCADE,
  turma_id INTEGER REFERENCES turmas(id) ON DELETE SET NULL,
  data TEXT NOT NULL,
  status TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  UNIQUE (aluno_id, data)
);

CREATE TABLE IF NOT EXISTS mensalidades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  escolinha_id INTEGER NOT NULL REFERENCES escolinhas(id) ON DELETE CASCADE,
  aluno_id INTEGER NOT NULL REFERENCES alunos(id) ON DELETE CASCADE,
  competencia TEXT NOT NULL,
  valor REAL NOT NULL DEFAULT 0,
  vencimento TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente',
  data_pagamento TEXT,
  forma_pagamento TEXT,
  observacao TEXT,
  criado_em TEXT NOT NULL,
  UNIQUE (aluno_id, competencia)
);

CREATE TABLE IF NOT EXISTS contatos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  escolinha_id INTEGER NOT NULL REFERENCES escolinhas(id) ON DELETE CASCADE,
  aluno_id INTEGER NOT NULL REFERENCES alunos(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  mensagem TEXT NOT NULL,
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessoes (
  token TEXT PRIMARY KEY,
  escolinha_id INTEGER NOT NULL REFERENCES escolinhas(id) ON DELETE CASCADE,
  criado_em TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alunos_esc ON alunos(escolinha_id);
CREATE INDEX IF NOT EXISTS idx_mens_esc ON mensalidades(escolinha_id, competencia);
CREATE INDEX IF NOT EXISTS idx_pres_esc ON presencas(escolinha_id, data);
CREATE INDEX IF NOT EXISTS idx_cont_esc ON contatos(escolinha_id, aluno_id);
`);

module.exports = { db, DB_PATH };
