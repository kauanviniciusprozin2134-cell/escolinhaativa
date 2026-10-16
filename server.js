/*
 * EscolinhaAtiva - servidor HTTP + API (Node puro, sem dependencias).
 * Rotas de API em /api/*, front-end estatico em /public.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db } = require('./db');

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = path.join(__dirname, 'public');

/* ------------------------------ helpers ------------------------------ */

const nowISO = () => new Date().toISOString();

function hashSenha(senha, salt) {
  return crypto.scryptSync(String(senha), salt, 32).toString('hex');
}

function novaSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${hashSenha(senha, salt)}`;
}

function confereSenha(senha, armazenada) {
  const [salt, hash] = String(armazenada).split(':');
  if (!salt || !hash) return false;
  const teste = hashSenha(senha, salt);
  const a = Buffer.from(teste, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function onlyDigits(v) {
  return String(v == null ? '' : v).replace(/\D/g, '');
}

function hojeLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function competenciaAtual() {
  return hojeLocal().slice(0, 7);
}

function dataVencimento(competencia, dia) {
  const [ano, mes] = competencia.split('-').map(Number);
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const d = Math.min(Math.max(Number(dia) || 10, 1), 28);
  const p = (n) => String(n).padStart(2, '0');
  return `${ano}-${p(mes)}-${p(d)}`;
}

function statusMensalidade(m) {
  if (m.status === 'pago') return 'pago';
  return hojeLocal() > m.vencimento ? 'atrasado' : 'pendente';
}

function withStatus(m) {
  return { ...m, status_calculado: statusMensalidade(m) };
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ------------------------------ consultas ------------------------------ */

const q = {
  escolinhaPorEmail: db.prepare('SELECT * FROM escolinhas WHERE email = ?'),
  escolinhaPorId: db.prepare('SELECT id, nome, email FROM escolinhas WHERE id = ?'),
  criarEscolinha: db.prepare(
    'INSERT INTO escolinhas (nome, email, senha_hash, criado_em) VALUES (?, ?, ?, ?)'
  ),
  criarSessao: db.prepare('INSERT INTO sessoes (token, escolinha_id, criado_em) VALUES (?, ?, ?)'),
  sessao: db.prepare(
    `SELECT s.token, s.escolinha_id, e.nome AS escolinha_nome, e.email AS escolinha_email
     FROM sessoes s JOIN escolinhas e ON e.id = s.escolinha_id WHERE s.token = ?`
  ),
  apagarSessao: db.prepare('DELETE FROM sessoes WHERE token = ?'),

  turmas: db.prepare('SELECT * FROM turmas WHERE escolinha_id = ? ORDER BY nome COLLATE NOCASE'),
  turma: db.prepare('SELECT * FROM turmas WHERE id = ? AND escolinha_id = ?'),
  criarTurma: db.prepare(
    'INSERT INTO turmas (escolinha_id, nome, professor, horarios, criado_em) VALUES (?, ?, ?, ?, ?)'
  ),
  editarTurma: db.prepare(
    'UPDATE turmas SET nome = ?, professor = ?, horarios = ? WHERE id = ? AND escolinha_id = ?'
  ),
  apagarTurma: db.prepare('DELETE FROM turmas WHERE id = ? AND escolinha_id = ?'),

  alunos: db.prepare(
    `SELECT a.*, t.nome AS turma_nome FROM alunos a
     LEFT JOIN turmas t ON t.id = a.turma_id
     WHERE a.escolinha_id = ? ORDER BY a.nome COLLATE NOCASE`
  ),
  aluno: db.prepare(
    `SELECT a.*, t.nome AS turma_nome FROM alunos a
     LEFT JOIN turmas t ON t.id = a.turma_id
     WHERE a.id = ? AND a.escolinha_id = ?`
  ),
  criarAluno: db.prepare(
    `INSERT INTO alunos (escolinha_id, nome, responsavel, whatsapp, turma_id, valor_mensalidade, dia_vencimento, situacao, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  editarAluno: db.prepare(
    `UPDATE alunos SET nome = ?, responsavel = ?, whatsapp = ?, turma_id = ?, valor_mensalidade = ?,
     dia_vencimento = ?, situacao = ? WHERE id = ? AND escolinha_id = ?`
  ),
  apagarAluno: db.prepare('DELETE FROM alunos WHERE id = ? AND escolinha_id = ?'),

  alunosDaTurma: db.prepare(
    `SELECT a.* FROM alunos a WHERE a.escolinha_id = ? AND a.turma_id = ? AND a.situacao = 'ativo'
     ORDER BY a.nome COLLATE NOCASE`
  ),
  presencaAlunoData: db.prepare('SELECT * FROM presencas WHERE aluno_id = ? AND data = ?'),
  inserirPresenca: db.prepare(
    `INSERT INTO presencas (escolinha_id, aluno_id, turma_id, data, status, criado_em)
     VALUES (?, ?, ?, ?, ?, ?)`
  ),
  atualizarPresenca: db.prepare('UPDATE presencas SET status = ?, turma_id = ? WHERE id = ?'),
  apagarPresenca: db.prepare('DELETE FROM presencas WHERE id = ? AND escolinha_id = ?'),
  presencasDoDia: db.prepare(
    `SELECT p.*, a.nome AS aluno_nome, a.responsavel, a.whatsapp
     FROM presencas p JOIN alunos a ON a.id = p.aluno_id
     WHERE p.escolinha_id = ? AND p.data = ? ORDER BY a.nome COLLATE NOCASE`
  ),
  presencasAluno: db.prepare(
    `SELECT p.*, t.nome AS turma_nome FROM presencas p
     LEFT JOIN turmas t ON t.id = p.turma_id
     WHERE p.escolinha_id = ? AND p.aluno_id = ? ORDER BY p.data DESC`
  ),
  ultimasPresencas: db.prepare(
    `SELECT * FROM presencas WHERE escolinha_id = ? AND aluno_id = ? ORDER BY data DESC LIMIT ?`
  ),

  mensalidadeAlunoCompetencia: db.prepare(
    'SELECT * FROM mensalidades WHERE aluno_id = ? AND competencia = ?'
  ),
  inserirMensalidade: db.prepare(
    `INSERT INTO mensalidades (escolinha_id, aluno_id, competencia, valor, vencimento, status, criado_em)
     VALUES (?, ?, ?, ?, ?, 'pendente', ?)`
  ),
  mensalidade: db.prepare('SELECT * FROM mensalidades WHERE id = ? AND escolinha_id = ?'),
  atualizarMensalidade: db.prepare(
    `UPDATE mensalidades SET valor = ?, vencimento = ?, status = ?, data_pagamento = ?, forma_pagamento = ?, observacao = ?
     WHERE id = ? AND escolinha_id = ?`
  ),
  apagarMensalidade: db.prepare('DELETE FROM mensalidades WHERE id = ? AND escolinha_id = ?'),
  mensalidadesAluno: db.prepare(
    `SELECT * FROM mensalidades WHERE escolinha_id = ? AND aluno_id = ?
     ORDER BY competencia DESC, id DESC`
  ),

  contato: db.prepare(
    `INSERT INTO contatos (escolinha_id, aluno_id, tipo, mensagem, criado_em) VALUES (?, ?, ?, ?, ?)`
  ),
  contatosAluno: db.prepare(
    'SELECT * FROM contatos WHERE escolinha_id = ? AND aluno_id = ? ORDER BY id DESC'
  ),
  apagarContato: db.prepare('DELETE FROM contatos WHERE id = ? AND escolinha_id = ?'),
};

/* ------------------------------ dominio ------------------------------ */

function turmaDoAluno(escolinhaId, turmaId) {
  if (turmaId === null || turmaId === undefined || turmaId === '') return null;
  const t = q.turma.get(Number(turmaId), escolinhaId);
  if (!t) throw new HttpError(400, 'Turma não encontrada.');
  return t.id;
}

function gerarMensalidades(escolinhaId, competencia) {
  if (!/^\d{4}-\d{2}$/.test(competencia)) throw new HttpError(400, 'Competência inválida.');
  const alunos = q.alunos.all(escolinhaId).filter((a) => a.situacao === 'ativo');
  let criadas = 0;
  let existentes = 0;
  for (const a of alunos) {
    if (q.mensalidadeAlunoCompetencia.get(a.id, competencia)) {
      existentes++;
      continue;
    }
    q.inserirMensalidade.run(
      escolinhaId,
      a.id,
      competencia,
      Number(a.valor_mensalidade) || 0,
      dataVencimento(competencia, a.dia_vencimento),
      nowISO()
    );
    criadas++;
  }
  return { competencia, alunos_ativos: alunos.length, criadas, existentes };
}

function faltasConsecutivas(escolinhaId, alunoId) {
  const registros = q.ultimasPresencas.all(escolinhaId, alunoId, 20);
  let n = 0;
  for (const r of registros) {
    if (r.status === 'falta') n++;
    else break;
  }
  return n;
}

function alertas(escolinhaId) {
  const comp = competenciaAtual();
  const alunos = q.alunos.all(escolinhaId).filter((a) => a.situacao === 'ativo');
  const out = [];
  for (const a of alunos) {
    const mens = q.mensalidadeAlunoCompetencia.get(a.id, comp);
    const status = mens ? statusMensalidade(mens) : 'sem_mensalidade';
    const faltas = faltasConsecutivas(escolinhaId, a.id);
    if (status === 'atrasado' || faltas >= 2) {
      out.push({
        aluno_id: a.id,
        nome: a.nome,
        responsavel: a.responsavel,
        whatsapp: a.whatsapp,
        turma_nome: a.turma_nome,
        valor_mensalidade: a.valor_mensalidade,
        mensalidade_status: status,
        mensalidade_valor: mens ? mens.valor : a.valor_mensalidade,
        vencimento: mens ? mens.vencimento : null,
        faltas_consecutivas: faltas,
      });
    }
  }
  out.sort((x, y) => y.faltas_consecutivas - x.faltas_consecutivas || x.nome.localeCompare(y.nome));
  return out;
}

function dashboard(escolinhaId) {
  const comp = competenciaAtual();
  const alunos = q.alunos.all(escolinhaId);
  const ativos = alunos.filter((a) => a.situacao === 'ativo').length;
  const todos = db
    .prepare('SELECT * FROM mensalidades WHERE escolinha_id = ?')
    .all(escolinhaId)
    .map(withStatus);

  const recebidoMes = todos
    .filter((m) => m.status === 'pago' && (m.data_pagamento || '').slice(0, 7) === comp)
    .reduce((s, m) => s + Number(m.valor), 0);

  const atrasado = todos
    .filter((m) => m.status_calculado === 'atrasado')
    .reduce((s, m) => s + Number(m.valor), 0);

  const pendenteMes = todos
    .filter((m) => m.competencia === comp && m.status_calculado === 'pendente')
    .reduce((s, m) => s + Number(m.valor), 0);

  return {
    competencia: comp,
    alunos_total: alunos.length,
    alunos_ativos: ativos,
    alunos_inativos: alunos.length - ativos,
    recebido_mes: recebidoMes,
    atrasado_total: atrasado,
    pendente_mes: pendenteMes,
    alertas: alertas(escolinhaId),
  };
}

/* ------------------------------ roteador ------------------------------ */

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e6) reject(new HttpError(413, 'Requisição muito grande.'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, 'JSON inválido.'));
      }
    });
    req.on('error', reject);
  });
}

function requireAuth(ctx) {
  const h = ctx.req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) throw new HttpError(401, 'Faça login para continuar.');
  const s = q.sessao.get(token);
  if (!s) throw new HttpError(401, 'Sessão expirada. Faça login novamente.');
  return s;
}

const routes = [];
function route(method, pattern, handler, opts = {}) {
  const keys = [];
  const regex = new RegExp(
    '^' +
      pattern.replace(/:([A-Za-z_]+)/g, (_, k) => {
        keys.push(k);
        return '([^/]+)';
      }) +
      '$'
  );
  routes.push({ method, regex, keys, handler, auth: opts.auth !== false });
}

/* ---- auth ---- */
route(
  'POST',
  '/api/cadastro',
  async (ctx) => {
    const { nome, email, senha } = ctx.body;
    if (!nome || !String(nome).trim()) throw new HttpError(400, 'Informe o nome da escolinha.');
    if (!email || !/^\S+@\S+\.\S+$/.test(String(email))) throw new HttpError(400, 'E-mail inválido.');
    if (!senha || String(senha).length < 4) throw new HttpError(400, 'A senha precisa ter ao menos 4 caracteres.');
    const mail = String(email).trim().toLowerCase();
    if (q.escolinhaPorEmail.get(mail)) throw new HttpError(409, 'Já existe uma escolinha com este e-mail.');
    const info = q.criarEscolinha.run(String(nome).trim(), mail, novaSenha(senha), nowISO());
    const id = Number(info.lastInsertRowid);
    const token = crypto.randomBytes(24).toString('hex');
    q.criarSessao.run(token, id, nowISO());
    return { token, escolinha: { id, nome: String(nome).trim(), email: mail } };
  },
  { auth: false }
);

route(
  'POST',
  '/api/login',
  async (ctx) => {
    const { email, senha } = ctx.body;
    const e = q.escolinhaPorEmail.get(String(email || '').trim().toLowerCase());
    if (!e || !confereSenha(senha, e.senha_hash)) throw new HttpError(401, 'E-mail ou senha incorretos.');
    const token = crypto.randomBytes(24).toString('hex');
    q.criarSessao.run(token, e.id, nowISO());
    return { token, escolinha: { id: e.id, nome: e.nome, email: e.email } };
  },
  { auth: false }
);

route('POST', '/api/logout', async (ctx) => {
  q.apagarSessao.run(ctx.token);
  return { ok: true };
});

route('GET', '/api/eu', async (ctx) => ({
  escolinha: { id: ctx.sessao.escolinha_id, nome: ctx.sessao.escolinha_nome, email: ctx.sessao.escolinha_email },
}));

/* ---- turmas ---- */
route('GET', '/api/turmas', async (ctx) => {
  const turmas = q.turmas.all(ctx.sessao.escolinha_id).map((t) => ({
    ...t,
    alunos: db
      .prepare('SELECT COUNT(*) AS n FROM alunos WHERE turma_id = ? AND situacao = ?')
      .get(t.id, 'ativo').n,
  }));
  return { turmas };
});

route('POST', '/api/turmas', async (ctx) => {
  const { nome, professor, horarios } = ctx.body;
  if (!nome || !String(nome).trim()) throw new HttpError(400, 'Informe o nome da turma.');
  if (!professor || !String(professor).trim()) throw new HttpError(400, 'Informe o professor.');
  if (!horarios || !String(horarios).trim()) throw new HttpError(400, 'Informe os horários dos treinos.');
  const info = q.criarTurma.run(
    ctx.sessao.escolinha_id,
    String(nome).trim(),
    String(professor).trim(),
    String(horarios).trim(),
    nowISO()
  );
  return { turma: q.turma.get(Number(info.lastInsertRowid), ctx.sessao.escolinha_id) };
});

route('PUT', '/api/turmas/:id', async (ctx) => {
  const { nome, professor, horarios } = ctx.body;
  if (!q.turma.get(Number(ctx.params.id), ctx.sessao.escolinha_id)) throw new HttpError(404, 'Turma não encontrada.');
  q.editarTurma.run(
    String(nome || '').trim(),
    String(professor || '').trim(),
    String(horarios || '').trim(),
    Number(ctx.params.id),
    ctx.sessao.escolinha_id
  );
  return { turma: q.turma.get(Number(ctx.params.id), ctx.sessao.escolinha_id) };
});

route('DELETE', '/api/turmas/:id', async (ctx) => {
  db.prepare('UPDATE alunos SET turma_id = NULL WHERE turma_id = ? AND escolinha_id = ?').run(
    Number(ctx.params.id),
    ctx.sessao.escolinha_id
  );
  q.apagarTurma.run(Number(ctx.params.id), ctx.sessao.escolinha_id);
  return { ok: true };
});

/* ---- alunos ---- */
route('GET', '/api/alunos', async (ctx) => {
  const comp = competenciaAtual();
  const alunos = q.alunos.all(ctx.sessao.escolinha_id).map((a) => {
    const mens = q.mensalidadeAlunoCompetencia.get(a.id, comp);
    return {
      ...a,
      mensalidade_status: mens ? statusMensalidade(mens) : 'sem_mensalidade',
      mensalidade_valor: mens ? mens.valor : null,
      faltas_consecutivas: faltasConsecutivas(ctx.sessao.escolinha_id, a.id),
    };
  });
  return { alunos };
});

route('POST', '/api/alunos', async (ctx) => {
  const b = ctx.body;
  const nome = String(b.nome || '').trim();
  const responsavel = String(b.responsavel || '').trim();
  const whatsapp = onlyDigits(b.whatsapp);
  if (!nome) throw new HttpError(400, 'Informe o nome do aluno.');
  if (!responsavel) throw new HttpError(400, 'Informe o responsável.');
  if (whatsapp.length < 10) throw new HttpError(400, 'Informe o WhatsApp com DDD.');
  const turmaId = turmaDoAluno(ctx.sessao.escolinha_id, b.turma_id);
  const valor = Number(b.valor_mensalidade);
  if (!(valor >= 0)) throw new HttpError(400, 'Valor da mensalidade inválido.');
  const dia = Math.min(Math.max(Number(b.dia_vencimento) || 10, 1), 28);
  const situacao = b.situacao === 'inativo' ? 'inativo' : 'ativo';
  const info = q.criarAluno.run(
    ctx.sessao.escolinha_id,
    nome,
    responsavel,
    whatsapp,
    turmaId,
    valor,
    dia,
    situacao,
    nowISO()
  );
  return { aluno: q.aluno.get(Number(info.lastInsertRowid), ctx.sessao.escolinha_id) };
});

route('PUT', '/api/alunos/:id', async (ctx) => {
  const id = Number(ctx.params.id);
  if (!q.aluno.get(id, ctx.sessao.escolinha_id)) throw new HttpError(404, 'Aluno não encontrado.');
  const b = ctx.body;
  const nome = String(b.nome || '').trim();
  const responsavel = String(b.responsavel || '').trim();
  const whatsapp = onlyDigits(b.whatsapp);
  if (!nome) throw new HttpError(400, 'Informe o nome do aluno.');
  if (!responsavel) throw new HttpError(400, 'Informe o responsável.');
  if (whatsapp.length < 10) throw new HttpError(400, 'Informe o WhatsApp com DDD.');
  const valor = Number(b.valor_mensalidade);
  if (!(valor >= 0)) throw new HttpError(400, 'Valor da mensalidade inválido.');
  q.editarAluno.run(
    nome,
    responsavel,
    whatsapp,
    turmaDoAluno(ctx.sessao.escolinha_id, b.turma_id),
    valor,
    Math.min(Math.max(Number(b.dia_vencimento) || 10, 1), 28),
    b.situacao === 'inativo' ? 'inativo' : 'ativo',
    id,
    ctx.sessao.escolinha_id
  );
  return { aluno: q.aluno.get(id, ctx.sessao.escolinha_id) };
});

route('DELETE', '/api/alunos/:id', async (ctx) => {
  q.apagarAluno.run(Number(ctx.params.id), ctx.sessao.escolinha_id);
  return { ok: true };
});

/* ---- presencas ---- */
route('GET', '/api/presencas', async (ctx) => {
  const { turma_id: turmaId, data } = ctx.query;
  if (!turmaId || !data) throw new HttpError(400, 'Informe turma e data.');
  const escolinhaId = ctx.sessao.escolinha_id;
  if (!q.turma.get(Number(turmaId), escolinhaId)) throw new HttpError(404, 'Turma não encontrada.');
  const alunos = q.alunosDaTurma.all(escolinhaId, Number(turmaId)).map((a) => {
    const p = q.presencaAlunoData.get(a.id, data);
    return {
      aluno_id: a.id,
      nome: a.nome,
      responsavel: a.responsavel,
      whatsapp: a.whatsapp,
      status: p ? p.status : null,
      presenca_id: p ? p.id : null,
    };
  });
  return { turma_id: Number(turmaId), data, alunos };
});

route('POST', '/api/presencas', async (ctx) => {
  const escolinhaId = ctx.sessao.escolinha_id;
  const { turma_id: turmaId, data, registros } = ctx.body;
  if (!turmaId || !data) throw new HttpError(400, 'Informe turma e data.');
  if (!q.turma.get(Number(turmaId), escolinhaId)) throw new HttpError(404, 'Turma não encontrada.');
  if (!Array.isArray(registros)) throw new HttpError(400, 'Registros inválidos.');
  let salvos = 0;
  for (const r of registros) {
    const alunoId = Number(r.aluno_id);
    if (!q.aluno.get(alunoId, escolinhaId)) throw new HttpError(400, 'Aluno inválido na lista.');
    if (r.status !== 'presente' && r.status !== 'falta') throw new HttpError(400, 'Status inválido.');
    const existente = q.presencaAlunoData.get(alunoId, data);
    if (existente) q.atualizarPresenca.run(r.status, Number(turmaId), existente.id);
    else q.inserirPresenca.run(escolinhaId, alunoId, Number(turmaId), data, r.status, nowISO());
    salvos++;
  }
  return { salvos };
});

route('DELETE', '/api/presencas/:id', async (ctx) => {
  q.apagarPresenca.run(Number(ctx.params.id), ctx.sessao.escolinha_id);
  return { ok: true };
});

/* ---- mensalidades ---- */
route('GET', '/api/mensalidades', async (ctx) => {
  const escolinhaId = ctx.sessao.escolinha_id;
  const { competencia, status, aluno_id: alunoId } = ctx.query;
  const params = [escolinhaId];
  let sql = `SELECT m.*, a.nome AS aluno_nome, a.responsavel, a.whatsapp, t.nome AS turma_nome
             FROM mensalidades m JOIN alunos a ON a.id = m.aluno_id
             LEFT JOIN turmas t ON t.id = a.turma_id
             WHERE m.escolinha_id = ?`;
  if (competencia) {
    sql += ' AND m.competencia = ?';
    params.push(competencia);
  }
  if (alunoId) {
    sql += ' AND m.aluno_id = ?';
    params.push(Number(alunoId));
  }
  sql += ' ORDER BY m.competencia DESC, a.nome COLLATE NOCASE';
  let lista = db.prepare(sql).all(...params).map(withStatus);
  if (status) lista = lista.filter((m) => m.status_calculado === status);
  const resumo = {
    pendentes: lista.filter((m) => m.status_calculado === 'pendente').length,
    pagas: lista.filter((m) => m.status_calculado === 'pago').length,
    atrasadas: lista.filter((m) => m.status_calculado === 'atrasado').length,
    valor_pendente: lista.filter((m) => m.status_calculado === 'pendente').reduce((s, m) => s + Number(m.valor), 0),
    valor_pago: lista.filter((m) => m.status_calculado === 'pago').reduce((s, m) => s + Number(m.valor), 0),
    valor_atrasado: lista.filter((m) => m.status_calculado === 'atrasado').reduce((s, m) => s + Number(m.valor), 0),
  };
  return { competencia: competencia || null, resumo, mensalidades: lista };
});

route('POST', '/api/mensalidades/gerar', async (ctx) => {
  const competencia = String(ctx.body.competencia || competenciaAtual());
  return gerarMensalidades(ctx.sessao.escolinha_id, competencia);
});

route('POST', '/api/mensalidades', async (ctx) => {
  const escolinhaId = ctx.sessao.escolinha_id;
  const b = ctx.body;
  const aluno = q.aluno.get(Number(b.aluno_id), escolinhaId);
  if (!aluno) throw new HttpError(404, 'Aluno não encontrado.');
  const competencia = String(b.competencia || '');
  if (!/^\d{4}-\d{2}$/.test(competencia)) throw new HttpError(400, 'Competência inválida (use AAAA-MM).');
  if (q.mensalidadeAlunoCompetencia.get(aluno.id, competencia))
    throw new HttpError(409, 'Já existe mensalidade deste aluno nesta competência.');
  const valor = b.valor === undefined || b.valor === '' ? aluno.valor_mensalidade : Number(b.valor);
  if (!(valor >= 0)) throw new HttpError(400, 'Valor inválido.');
  const venc = b.vencimento || dataVencimento(competencia, aluno.dia_vencimento);
  const info = q.inserirMensalidade.run(escolinhaId, aluno.id, competencia, valor, venc, nowISO());
  const id = Number(info.lastInsertRowid);
  if (b.status === 'pago') {
    q.atualizarMensalidade.run(
      valor,
      venc,
      'pago',
      b.data_pagamento || hojeLocal(),
      b.forma_pagamento || 'Manual',
      b.observacao || null,
      id,
      escolinhaId
    );
  }
  return { mensalidade: withStatus(q.mensalidade.get(id, escolinhaId)) };
});

route('PUT', '/api/mensalidades/:id', async (ctx) => {
  const escolinhaId = ctx.sessao.escolinha_id;
  const id = Number(ctx.params.id);
  const atual = q.mensalidade.get(id, escolinhaId);
  if (!atual) throw new HttpError(404, 'Mensalidade não encontrada.');
  const b = ctx.body;
  const status = b.status === 'pago' ? 'pago' : b.status === 'pendente' ? 'pendente' : atual.status;
  const valor = b.valor === undefined || b.valor === '' ? atual.valor : Number(b.valor);
  if (!(valor >= 0)) throw new HttpError(400, 'Valor inválido.');
  const venc = b.vencimento || atual.vencimento;
  const dataPag = status === 'pago' ? b.data_pagamento || atual.data_pagamento || hojeLocal() : null;
  q.atualizarMensalidade.run(
    valor,
    venc,
    status,
    dataPag,
    status === 'pago' ? b.forma_pagamento || atual.forma_pagamento || 'Manual' : null,
    b.observacao === undefined ? atual.observacao : b.observacao,
    id,
    escolinhaId
  );
  return { mensalidade: withStatus(q.mensalidade.get(id, escolinhaId)) };
});

route('DELETE', '/api/mensalidades/:id', async (ctx) => {
  q.apagarMensalidade.run(Number(ctx.params.id), ctx.sessao.escolinha_id);
  return { ok: true };
});

/* ---- contatos ---- */
route('POST', '/api/contatos', async (ctx) => {
  const escolinhaId = ctx.sessao.escolinha_id;
  const aluno = q.aluno.get(Number(ctx.body.aluno_id), escolinhaId);
  if (!aluno) throw new HttpError(404, 'Aluno não encontrado.');
  const tipo = ctx.body.tipo === 'faltas' ? 'faltas' : 'cobranca';
  const mensagem = String(ctx.body.mensagem || '').trim();
  if (!mensagem) throw new HttpError(400, 'Mensagem vazia.');
  const info = q.contato.run(escolinhaId, aluno.id, tipo, mensagem, nowISO());
  const contato = db.prepare('SELECT * FROM contatos WHERE id = ?').get(Number(info.lastInsertRowid));
  return {
    contato,
    aluno: { id: aluno.id, nome: aluno.nome, responsavel: aluno.responsavel, whatsapp: aluno.whatsapp },
  };
});

route('DELETE', '/api/contatos/:id', async (ctx) => {
  q.apagarContato.run(Number(ctx.params.id), ctx.sessao.escolinha_id);
  return { ok: true };
});

/* ---- painel ---- */
route('GET', '/api/dashboard', async (ctx) => dashboard(ctx.sessao.escolinha_id));

/* ---- historico do aluno ---- */
route('GET', '/api/alunos/:id/historico', async (ctx) => {
  const escolinhaId = ctx.sessao.escolinha_id;
  const id = Number(ctx.params.id);
  const aluno = q.aluno.get(id, escolinhaId);
  if (!aluno) throw new HttpError(404, 'Aluno não encontrado.');
  const presencas = q.presencasAluno.all(escolinhaId, id);
  const mensalidades = q.mensalidadesAluno.all(escolinhaId, id).map(withStatus);
  const contatos = q.contatosAluno.all(escolinhaId, id);
  return {
    aluno,
    faltas_consecutivas: faltasConsecutivas(escolinhaId, id),
    resumo_presencas: {
      presentes: presencas.filter((p) => p.status === 'presente').length,
      faltas: presencas.filter((p) => p.status === 'falta').length,
    },
    presencas,
    mensalidades,
    contatos,
  };
});

/* ------------------------------ static ------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res) {
  let rel = decodeURIComponent((req.url || '/').split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const full = path.join(PUBLIC_DIR, rel);
  if (!full.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Acesso negado');
    return;
  }
  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Não encontrado');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}

/* ------------------------------ server ------------------------------ */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (!pathname.startsWith('/api/')) return serveStatic(req, res);

  const found = routes.filter((r) => r.regex.test(pathname));
  const match = found.find((r) => r.method === req.method);
  if (!match) {
    if (found.length) return json(res, 405, { erro: 'Método não permitido.' });
    return json(res, 404, { erro: 'Rota não encontrada.' });
  }

  try {
    const m = pathname.match(match.regex);
    const params = {};
    match.keys.forEach((k, i) => (params[k] = m[i + 1]));
    const query = Object.fromEntries(url.searchParams.entries());
    const ctx = { req, res, params, query, body: {}, sessao: null, token: null };
    if (match.method === 'POST' || match.method === 'PUT') ctx.body = await readBody(req);
    if (match.auth) {
      const s = requireAuth(ctx);
      ctx.sessao = s;
      ctx.token = s.token;
    }
    const result = await match.handler(ctx);
    return json(res, 200, result);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error('[erro]', e);
    return json(res, status, { erro: status === 500 ? 'Erro interno do servidor.' : e.message });
  }
});

if (require.main === module) {
  server.listen(PORT, process.env.HOST || '0.0.0.0', () => {
    console.log(`EscolinhaAtiva rodando na porta ${PORT}`);
  });
}

module.exports = { server, db, gerarMensalidades, dashboard, faltasConsecutivas, statusMensalidade };
