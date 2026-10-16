/*
 * Teste do fluxo principal do EscolinhaAtiva (Node puro, sem dependencias).
 * Roda contra um banco temporario e um servidor na porta 4199.
 *
 *   node test/flow.test.js
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'escolinha-'));
const DB = path.join(TMP, 'test.db');
const PORT = 4199;
const BASE = `http://127.0.0.1:${PORT}`;

let passou = 0;
function ok(nome, cond, extra) {
  if (cond) {
    passou++;
    console.log(`  ✔ ${nome}`);
  } else {
    console.error(`  ✘ ${nome}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exitCode = 1;
  }
}

async function call(metodo, rota, corpo, token) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (corpo !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + rota, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const txt = await res.text();
  let json = null;
  try { json = txt ? JSON.parse(txt) : null; } catch { json = txt; }
  return { status: res.status, body: json };
}

function dataOffset(dias) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

(async function main() {
  const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, ESCOLINHA_DB: DB, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stderr.on('data', (d) => process.stderr.write('[servidor] ' + d));

  // espera o servidor subir
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE + '/api/eu');
      if (r.status === 401) break;
    } catch { /* ainda subindo */ }
    await new Promise((r) => setTimeout(r, 150));
  }

  try {
    console.log('\nEscolinhaAtiva — fluxo principal\n');

    /* 1. cadastro e login ------------------------------------------------ */
    const cad = await call('POST', '/api/cadastro', { nome: 'Escolinha Bola de Ouro', email: 'gestor@teste.com', senha: '1234' });
    ok('cadastro cria escolinha e retorna token', cad.status === 200 && !!cad.body.token, cad.body);
    const token = cad.body.token;

    const dup = await call('POST', '/api/cadastro', { nome: 'Outra', email: 'gestor@teste.com', senha: '1234' });
    ok('e-mail duplicado é recusado', dup.status === 409);

    const loginErrado = await call('POST', '/api/login', { email: 'gestor@teste.com', senha: 'errada' });
    ok('login com senha errada falha', loginErrado.status === 401);

    const semToken = await call('GET', '/api/alunos');
    ok('rota protegida exige login', semToken.status === 401);

    /* 2. turma ----------------------------------------------------------- */
    const turma = await call('POST', '/api/turmas', { nome: 'Sub-11', professor: 'Professor Carlos', horarios: 'Ter e Qui, 18h às 19h30' }, token);
    ok('turma criada', turma.status === 200 && turma.body.turma.nome === 'Sub-11', turma.body);
    const turmaId = turma.body.turma.id;

    /* 3. alunos ---------------------------------------------------------- */
    const joao = await call('POST', '/api/alunos', {
      nome: 'João Silva', responsavel: 'Maria Silva', whatsapp: '(11) 99999-0000',
      turma_id: turmaId, valor_mensalidade: 150, dia_vencimento: 5, situacao: 'ativo',
    }, token);
    ok('aluno João cadastrado', joao.status === 200 && joao.body.aluno.id > 0, joao.body);
    const joaoId = joao.body.aluno.id;

    const pedro = await call('POST', '/api/alunos', {
      nome: 'Pedro Souza', responsavel: 'Ana Souza', whatsapp: '11988887777',
      turma_id: turmaId, valor_mensalidade: 120, dia_vencimento: 10, situacao: 'ativo',
    }, token);
    const pedroId = pedro.body.aluno.id;

    const inativo = await call('POST', '/api/alunos', {
      nome: 'Lucas Lima', responsavel: 'Rita Lima', whatsapp: '11977776666',
      turma_id: turmaId, valor_mensalidade: 100, dia_vencimento: 10, situacao: 'inativo',
    }, token);
    ok('aluno inativo cadastrado', inativo.status === 200);

    const invalido = await call('POST', '/api/alunos', { nome: 'Sem responsável', whatsapp: '11999999999' }, token);
    ok('aluno sem responsável é recusado', invalido.status === 400);

    /* 4. mensalidades ---------------------------------------------------- */
    const comp = new Date().toISOString().slice(0, 7);
    const ger1 = await call('POST', '/api/mensalidades/gerar', { competencia: comp }, token);
    ok('gera mensalidade só dos ativos', ger1.body.criadas === 2 && ger1.body.alunos_ativos === 2, ger1.body);

    const ger2 = await call('POST', '/api/mensalidades/gerar', { competencia: comp }, token);
    ok('gerar novamente não duplica', ger2.body.criadas === 0 && ger2.body.existentes === 2, ger2.body);

    // João venceu dia 5 -> atrasado (se hoje ainda for antes do dia 5, força vencimento no passado)
    const lista = await call('GET', `/api/mensalidades?competencia=${comp}`, undefined, token);
    const mensJoao = lista.body.mensalidades.find((m) => m.aluno_id === joaoId);
    if (mensJoao.vencimento >= dataOffset(0)) {
      await call('PUT', '/api/mensalidades/' + mensJoao.id, { vencimento: dataOffset(-10) }, token);
    }
    const lista2 = await call('GET', `/api/mensalidades?competencia=${comp}`, undefined, token);
    const mj = lista2.body.mensalidades.find((m) => m.aluno_id === joaoId);
    ok('mensalidade de João aparece como atrasada', mj.status_calculado === 'atrasado', mj);

    // Pedro paga
    const mp = lista2.body.mensalidades.find((m) => m.aluno_id === pedroId);
    const pago = await call('PUT', '/api/mensalidades/' + mp.id, { status: 'pago', data_pagamento: dataOffset(0), forma_pagamento: 'Pix' }, token);
    ok('pagamento manual registrado', pago.body.mensalidade.status_calculado === 'pago' && pago.body.mensalidade.data_pagamento === dataOffset(0), pago.body);

    const desfeito = await call('PUT', '/api/mensalidades/' + mp.id, { status: 'pendente' }, token);
    ok('pagamento pode ser desfeito', desfeito.body.mensalidade.status === 'pendente');
    await call('PUT', '/api/mensalidades/' + mp.id, { status: 'pago', data_pagamento: dataOffset(0), forma_pagamento: 'Pix' }, token);

    /* 5. presenças: João falta nos dois últimos treinos ------------------- */
    const d1 = dataOffset(-14);
    const d2 = dataOffset(-7);
    const chamada1 = await call('POST', '/api/presencas', {
      turma_id: turmaId, data: d1,
      registros: [{ aluno_id: joaoId, status: 'falta' }, { aluno_id: pedroId, status: 'presente' }],
    }, token);
    ok('chamada 1 salva', chamada1.status === 200 && chamada1.body.salvos === 2, chamada1.body);

    const chamada2 = await call('POST', '/api/presencas', {
      turma_id: turmaId, data: d2,
      registros: [{ aluno_id: joaoId, status: 'falta' }, { aluno_id: pedroId, status: 'presente' }],
    }, token);
    ok('chamada 2 salva', chamada2.body.salvos === 2);

    const listaChamada = await call('GET', `/api/presencas?turma_id=${turmaId}&data=${d2}`, undefined, token);
    const lj = listaChamada.body.alunos.find((a) => a.aluno_id === joaoId);
    ok('chamada carregada com status de João = falta', lj.status === 'falta', lj);
    ok('aluno inativo não aparece na chamada', listaChamada.body.alunos.length === 2);

    // corrigir a chamada (trocar falta por presente e voltar)
    await call('POST', '/api/presencas', { turma_id: turmaId, data: d2, registros: [{ aluno_id: joaoId, status: 'presente' }] }, token);
    const semFaltas = await call('GET', `/api/alunos/${joaoId}/historico`, undefined, token);
    ok('correção da chamada é aplicada (sem faltas seguidas)', semFaltas.body.faltas_consecutivas === 0, semFaltas.body.faltas_consecutivas);
    await call('POST', '/api/presencas', { turma_id: turmaId, data: d2, registros: [{ aluno_id: joaoId, status: 'falta' }] }, token);

    /* 6. painel ---------------------------------------------------------- */
    const dash = await call('GET', '/api/dashboard', undefined, token);
    ok('painel: 2 alunos ativos', dash.body.alunos_ativos === 2, dash.body.alunos_ativos);
    ok('painel: valor recebido no mês = 120', Math.abs(dash.body.recebido_mes - 120) < 0.001, dash.body.recebido_mes);
    ok('painel: valor atrasado = 150', Math.abs(dash.body.atrasado_total - 150) < 0.001, dash.body.atrasado_total);
    const alertaJoao = dash.body.alertas.find((a) => a.aluno_id === joaoId);
    ok('painel destaca João', !!alertaJoao, dash.body.alertas);
    ok('João: 2 faltas consecutivas', alertaJoao && alertaJoao.faltas_consecutivas === 2, alertaJoao);
    ok('João: mensalidade atrasada', alertaJoao && alertaJoao.mensalidade_status === 'atrasado');

    /* 7. contato --------------------------------------------------------- */
    const contato = await call('POST', '/api/contatos', {
      aluno_id: joaoId, tipo: 'cobranca', mensagem: 'Olá, Maria! Mensalidade do João está em atraso.',
    }, token);
    ok('contato registrado', contato.status === 200 && contato.body.contato.id > 0, contato.body);

    const hist = await call('GET', `/api/alunos/${joaoId}/historico`, undefined, token);
    ok('histórico traz mensalidades, presenças e contatos',
      hist.body.mensalidades.length === 1 && hist.body.presencas.length === 2 && hist.body.contatos.length === 1,
      { m: hist.body.mensalidades.length, p: hist.body.presencas.length, c: hist.body.contatos.length });
    ok('histórico aponta 2 faltas', hist.body.resumo_presencas.faltas === 2);

    /* 8. isolamento entre escolinhas -------------------------------------- */
    const outro = await call('POST', '/api/cadastro', { nome: 'Escolinha Rivale', email: 'rival@teste.com', senha: '1234' });
    const token2 = outro.body.token;
    const alunosOutro = await call('GET', '/api/alunos', undefined, token2);
    ok('outra escolinha não vê os alunos da primeira', alunosOutro.body.alunos.length === 0);

    const roubo = await call('GET', `/api/alunos/${joaoId}/historico`, undefined, token2);
    ok('outra escolinha não acessa aluno alheio', roubo.status === 404);

    const dashOutro = await call('GET', '/api/dashboard', undefined, token2);
    ok('painel da outra escolinha está zerado', dashOutro.body.alunos_ativos === 0 && dashOutro.body.atrasado_total === 0);

    /* 9. front-end servido ------------------------------------------------ */
    const html = await fetch(BASE + '/');
    const texto = await html.text();
    ok('index.html é servido', html.status === 200 && texto.includes('EscolinhaAtiva'));

    console.log(`\n${passou} verificações passaram.`);
  } catch (e) {
    console.error('\nFalha no teste:', e);
    process.exitCode = 1;
  } finally {
    srv.kill();
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignora */ }
  }
})();
