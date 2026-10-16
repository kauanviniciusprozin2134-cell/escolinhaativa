/* EscolinhaAtiva — front-end (JS puro, sem dependencias) */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const state = {
    escolinha: null,
    turmas: [],
    alunos: [],
    competencia: new Date().toISOString().slice(0, 7),
    chamada: { turma_id: null, data: null, alunos: [] },
    contatosFeitos: {}, // aluno_id -> timestamp do ultimo contato nesta sessao
  };

  /* ----------------------------- utils ----------------------------- */

  const money = (v) =>
    (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const dataBR = (iso) => {
    if (!iso) return '—';
    const [a, m, d] = String(iso).slice(0, 10).split('-');
    return `${d}/${m}/${a}`;
  };

  const mesBR = (comp) => {
    if (!comp) return '—';
    const [a, m] = comp.split('-');
    return new Date(Number(a), Number(m) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  };

  const dataHoraBR = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const apenasDigitos = (v) => String(v || '').replace(/\D/g, '');
  const waLink = (num) => `https://wa.me/${apenasDigitos(num).replace(/^0+/, '')}`;

  function toast(msg, tipo = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + tipo;
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 3800);
  }

  function tagStatus(status) {
    const mapa = {
      pago: ['tag-ok', 'Paga'],
      pendente: ['tag-pendente', 'Pendente'],
      atrasado: ['tag-atrasado', 'Atrasada'],
      sem_mensalidade: ['tag-neutro', 'Sem registro'],
    };
    const [cls, txt] = mapa[status] || ['tag-neutro', status];
    return `<span class="tag ${cls}">${txt}</span>`;
  }

  /* ----------------------------- api ----------------------------- */

  async function api(metodo, rota, corpo) {
    const opts = { method: metodo, headers: {} };
    const token = localStorage.getItem('ea_token');
    if (token) opts.headers.Authorization = 'Bearer ' + token;
    if (corpo !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(corpo);
    }
    const res = await fetch(rota, opts);
    const texto = await res.text();
    let dados = {};
    try { dados = texto ? JSON.parse(texto) : {}; } catch { dados = {}; }
    if (!res.ok) {
      if (res.status === 401 && state.escolinha) sair(false);
      throw new Error(dados.erro || 'Não foi possível concluir a operação.');
    }
    return dados;
  }

  /* ----------------------------- modal ----------------------------- */

  function abrirModal(titulo, htmlCorpo) {
    $('#modal-titulo').textContent = titulo;
    $('#modal-corpo').innerHTML = htmlCorpo;
    $('#modal').classList.remove('hidden');
    $('#modal').hidden = false;
  }
  function fecharModal() {
    $('#modal').classList.add('hidden');
    $('#modal').hidden = true;
    $('#modal-corpo').innerHTML = '';
  }
  $('#modal-fechar').addEventListener('click', fecharModal);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') fecharModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharModal(); });

  /* ----------------------------- auth ----------------------------- */

  $$('[data-auth-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      $$('[data-auth-tab]').forEach((x) => x.classList.toggle('active', x === b));
      const alvo = b.dataset.authTab;
      $('#form-login').classList.toggle('hidden', alvo !== 'login');
      $('#form-cadastro').classList.toggle('hidden', alvo !== 'cadastro');
      $('#auth-erro').classList.add('hidden');
    })
  );

  function erroAuth(msg) {
    const el = $('#auth-erro');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  $('#form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const r = await api('POST', '/api/login', { email: f.get('email'), senha: f.get('senha') });
      entrar(r);
    } catch (err) { erroAuth(err.message); }
  });

  $('#form-cadastro').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const r = await api('POST', '/api/cadastro', { nome: f.get('nome'), email: f.get('email'), senha: f.get('senha') });
      entrar(r);
    } catch (err) { erroAuth(err.message); }
  });

  $('#btn-sair').addEventListener('click', () => sair(true));

  function entrar(r) {
    localStorage.setItem('ea_token', r.token);
    state.escolinha = r.escolinha;
    $('#tela-auth').hidden = true;
    $('#tela-app').hidden = false;
    $('#nome-escolinha').textContent = r.escolinha.nome;
    iniciar();
  }

  async function sair(chamarApi) {
    if (chamarApi) { try { await api('POST', '/api/logout'); } catch { /* ignora */ } }
    localStorage.removeItem('ea_token');
    state.escolinha = null;
    $('#tela-app').hidden = true;
    $('#tela-auth').hidden = false;
    $('#form-login').reset();
    $('#form-cadastro').reset();
  }

  /* ----------------------------- navegacao ----------------------------- */

  const carregadores = {
    painel: carregarPainel,
    alunos: carregarAlunos,
    turmas: carregarTurmas,
    presencas: prepararPresencas,
    mensalidades: carregarMensalidades,
  };

  $$('.menu-item').forEach((b) =>
    b.addEventListener('click', () => trocarTela(b.dataset.tela))
  );

  function trocarTela(nome) {
    $$('.menu-item').forEach((b) => b.classList.toggle('active', b.dataset.tela === nome));
    $$('.tela').forEach((s) => s.classList.toggle('hidden', s.id !== 'tela-' + nome));
    if (carregadores[nome]) carregadores[nome]();
  }

  async function iniciar() {
    $('#mens-competencia').value = state.competencia;
    const hoje = new Date();
    $('#presenca-data').value = hoje.toISOString().slice(0, 10);
    await Promise.all([carregarTurmas(false), carregarAlunos(false)]);
    trocarTela('painel');
  }

  /* ----------------------------- painel ----------------------------- */

  async function carregarPainel() {
    const d = await api('GET', '/api/dashboard');
    state.competencia = d.competencia;
    $('#painel-competencia').textContent = `Mês de referência: ${mesBR(d.competencia)}`;

    $('#painel-cards').innerHTML = `
      <div class="metric">
        <div class="rotulo">Alunos ativos</div>
        <div class="valor">${d.alunos_ativos}</div>
        <small>${d.alunos_inativos} inativo(s) no cadastro</small>
      </div>
      <div class="metric info">
        <div class="rotulo">Recebido no mês</div>
        <div class="valor">${money(d.recebido_mes)}</div>
        <small>${money(d.pendente_mes)} ainda pendente</small>
      </div>
      <div class="metric alerta">
        <div class="rotulo">Valor atrasado</div>
        <div class="valor">${money(d.atrasado_total)}</div>
        <small>Mensalidades vencidas e não pagas</small>
      </div>
      <div class="metric alerta">
        <div class="rotulo">Com 2+ faltas seguidas</div>
        <div class="valor">${d.alertas.filter((a) => a.faltas_consecutivas >= 2).length}</div>
        <small>Alunos para acompanhar</small>
      </div>`;

    const alvo = $('#painel-alertas');
    if (!d.alertas.length) {
      alvo.innerHTML = '<div class="vazio">Nenhum aluno com mensalidade atrasada ou faltas consecutivas. 🎉</div>';
      return;
    }

    alvo.innerHTML = d.alertas
      .map((a) => {
        const motivos = [];
        if (a.mensalidade_status === 'atrasado')
          motivos.push(`<span class="tag tag-atrasado">Mensalidade atrasada ${money(a.mensalidade_valor)} • venc. ${dataBR(a.vencimento)}</span>`);
        if (a.mensalidade_status === 'sem_mensalidade')
          motivos.push('<span class="tag tag-neutro">Sem mensalidade gerada no mês</span>');
        if (a.faltas_consecutivas >= 2)
          motivos.push(`<span class="tag tag-falta">${a.faltas_consecutivas} faltas seguidas</span>`);
        const jaContatado = state.contatosFeitos[a.aluno_id];
        return `
        <div class="linha-alerta">
          <div class="info">
            <span class="aluno-nome">${esc(a.nome)}</span>
            <span class="aluno-sub">Responsável: ${esc(a.responsavel)} • ${esc(a.turma_nome || 'Sem turma')} • ${esc(a.whatsapp)}</span>
            <div class="motivos">${motivos.join('')}</div>
            ${jaContatado ? `<span class="aluno-sub">Contato registrado às ${jaContatado}</span>` : ''}
          </div>
          <div class="acoes">
            <button class="btn btn-whats btn-sm" data-contato-cobranca="${a.aluno_id}">Cobrar no WhatsApp</button>
            <button class="btn btn-ghost btn-sm" data-contato-faltas="${a.aluno_id}">Falar sobre faltas</button>
            <button class="btn btn-ghost btn-sm" data-historico="${a.aluno_id}">Histórico</button>
          </div>
        </div>`;
      })
      .join('');
  }

  /* ----------------------------- turmas ----------------------------- */

  async function carregarTurmas(render = true) {
    const r = await api('GET', '/api/turmas');
    state.turmas = r.turmas;
    if (render) renderTurmas();
    preencherSelectTurmas();
  }

  function preencherSelectTurmas() {
    const opcoes = state.turmas.map((t) => `<option value="${t.id}">${esc(t.nome)} — ${esc(t.professor)}</option>`).join('');
    const selAluno = $('#aluno-turma');
    const valorAtual = selAluno.value;
    selAluno.innerHTML = `<option value="">Sem turma</option>${opcoes}`;
    selAluno.value = valorAtual;

    const selPres = $('#presenca-turma');
    const valorPres = selPres.value;
    selPres.innerHTML = state.turmas.length ? opcoes : '<option value="">Nenhuma turma cadastrada</option>';
    if (valorPres) selPres.value = valorPres;
  }

  function renderTurmas() {
    const alvo = $('#lista-turmas');
    if (!state.turmas.length) {
      alvo.innerHTML = '<div class="vazio">Nenhuma turma cadastrada ainda. Clique em “+ Nova turma”.</div>';
      return;
    }
    alvo.innerHTML = `
      <div class="tabela-wrap"><table class="tabela">
        <thead><tr><th>Turma</th><th>Professor</th><th>Horários</th><th>Alunos ativos</th><th></th></tr></thead>
        <tbody>${state.turmas
          .map(
            (t) => `<tr>
              <td data-rotulo="Turma"><span class="aluno-nome">${esc(t.nome)}</span></td>
              <td data-rotulo="Professor">${esc(t.professor)}</td>
              <td data-rotulo="Horários">${esc(t.horarios)}</td>
              <td data-rotulo="Alunos ativos">${t.alunos}</td>
              <td><div class="acoes">
                <button class="btn btn-ghost btn-sm" data-editar-turma="${t.id}">Editar</button>
                <button class="btn btn-perigo btn-sm" data-apagar-turma="${t.id}">Excluir</button>
              </div></td>
            </tr>`
          )
          .join('')}</tbody>
      </table></div>`;
  }

  $('#btn-nova-turma').addEventListener('click', () => {
    $('#form-turma').reset();
    $('#form-turma').id = 'form-turma';
    $('#titulo-form-turma').textContent = 'Nova turma';
    $('#form-turma').querySelector('[name=id]').value = '';
    $('#card-form-turma').hidden = false;
  });
  $('#btn-cancelar-turma').addEventListener('click', () => ($('#card-form-turma').hidden = true));

  $('#form-turma').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const corpo = {
      nome: f.get('nome'),
      professor: f.get('professor'),
      horarios: f.get('horarios'),
    };
    const id = f.get('id');
    try {
      if (id) await api('PUT', '/api/turmas/' + id, corpo);
      else await api('POST', '/api/turmas', corpo);
      toast(id ? 'Turma atualizada.' : 'Turma cadastrada.', 'ok');
      $('#card-form-turma').hidden = true;
      e.target.reset();
      await carregarTurmas();
      await carregarAlunos(false);
    } catch (err) { toast(err.message, 'erro'); }
  });

  $('#lista-turmas').addEventListener('click', async (e) => {
    const editar = e.target.closest('[data-editar-turma]');
    const apagar = e.target.closest('[data-apagar-turma]');
    if (editar) {
      const t = state.turmas.find((x) => x.id === Number(editar.dataset.editarTurma));
      if (!t) return;
      $('#titulo-form-turma').textContent = 'Editar turma';
      const form = $('#form-turma');
      form.querySelector('[name=id]').value = t.id;
      form.querySelector('[name=nome]').value = t.nome;
      form.querySelector('[name=professor]').value = t.professor;
      form.querySelector('[name=horarios]').value = t.horarios;
      $('#card-form-turma').hidden = false;
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (apagar) {
      const t = state.turmas.find((x) => x.id === Number(apagar.dataset.apagarTurma));
      if (!confirm(`Excluir a turma “${t.nome}”? Os alunos ficarão sem turma.`)) return;
      try {
        await api('DELETE', '/api/turmas/' + t.id);
        toast('Turma excluída.', 'ok');
        await carregarTurmas();
        await carregarAlunos(false);
      } catch (err) { toast(err.message, 'erro'); }
    }
  });

  /* ----------------------------- alunos ----------------------------- */

  async function carregarAlunos(render = true) {
    const r = await api('GET', '/api/alunos');
    state.alunos = r.alunos;
    if (render) renderAlunos();
  }

  function renderAlunos() {
    const termo = $('#busca-aluno').value.trim().toLowerCase();
    const lista = state.alunos.filter(
      (a) =>
        !termo ||
        a.nome.toLowerCase().includes(termo) ||
        a.responsavel.toLowerCase().includes(termo)
    );
    const alvo = $('#lista-alunos');
    if (!lista.length) {
      alvo.innerHTML = '<div class="vazio">Nenhum aluno encontrado.</div>';
      return;
    }
    alvo.innerHTML = `
      <div class="tabela-wrap"><table class="tabela">
        <thead><tr>
          <th>Aluno</th><th>Responsável</th><th>WhatsApp</th><th>Turma</th>
          <th>Mensalidade</th><th>Venc.</th><th>Situação</th><th>Mês atual</th><th></th>
        </tr></thead>
        <tbody>${lista
          .map(
            (a) => `<tr>
              <td data-rotulo="Aluno">
                <span class="aluno-nome">${esc(a.nome)}</span>
                ${a.faltas_consecutivas >= 2 ? `<span class="tag tag-falta">${a.faltas_consecutivas} faltas</span>` : ''}
              </td>
              <td data-rotulo="Responsável">${esc(a.responsavel)}</td>
              <td data-rotulo="WhatsApp">${esc(a.whatsapp)}</td>
              <td data-rotulo="Turma">${esc(a.turma_nome || '—')}</td>
              <td data-rotulo="Mensalidade">${money(a.valor_mensalidade)}</td>
              <td data-rotulo="Vencimento">dia ${a.dia_vencimento}</td>
              <td data-rotulo="Situação"><span class="tag ${a.situacao === 'ativo' ? 'tag-ok' : 'tag-neutro'}">${a.situacao === 'ativo' ? 'Ativo' : 'Inativo'}</span></td>
              <td data-rotulo="Mês atual">${tagStatus(a.mensalidade_status)}</td>
              <td><div class="acoes">
                <button class="btn btn-ghost btn-sm" data-historico="${a.id}">Histórico</button>
                <button class="btn btn-ghost btn-sm" data-editar-aluno="${a.id}">Editar</button>
                <button class="btn btn-perigo btn-sm" data-apagar-aluno="${a.id}">Excluir</button>
              </div></td>
            </tr>`
          )
          .join('')}</tbody>
      </table></div>`;
  }

  $('#busca-aluno').addEventListener('input', renderAlunos);

  $('#btn-novo-aluno').addEventListener('click', () => {
    const form = $('#form-aluno');
    form.reset();
    form.querySelector('[name=id]').value = '';
    form.querySelector('[name=valor_mensalidade]').value = 120;
    form.querySelector('[name=dia_vencimento]').value = 10;
    $('#titulo-form-aluno').textContent = 'Novo aluno';
    $('#card-form-aluno').hidden = false;
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  $('#btn-cancelar-aluno').addEventListener('click', () => ($('#card-form-aluno').hidden = true));

  $('#form-aluno').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const corpo = {
      nome: f.get('nome'),
      responsavel: f.get('responsavel'),
      whatsapp: f.get('whatsapp'),
      turma_id: f.get('turma_id') || null,
      valor_mensalidade: f.get('valor_mensalidade'),
      dia_vencimento: f.get('dia_vencimento'),
      situacao: f.get('situacao'),
    };
    const id = f.get('id');
    try {
      if (id) await api('PUT', '/api/alunos/' + id, corpo);
      else await api('POST', '/api/alunos', corpo);
      toast(id ? 'Aluno atualizado.' : 'Aluno cadastrado.', 'ok');
      $('#card-form-aluno').hidden = true;
      e.target.reset();
      await carregarAlunos();
      await carregarTurmas(false);
    } catch (err) { toast(err.message, 'erro'); }
  });

  $('#lista-alunos').addEventListener('click', async (e) => {
    const editar = e.target.closest('[data-editar-aluno]');
    const apagar = e.target.closest('[data-apagar-aluno]');
    const hist = e.target.closest('[data-historico]');
    if (editar) {
      const a = state.alunos.find((x) => x.id === Number(editar.dataset.editarAluno));
      if (!a) return;
      const form = $('#form-aluno');
      $('#titulo-form-aluno').textContent = 'Editar aluno';
      form.querySelector('[name=id]').value = a.id;
      form.querySelector('[name=nome]').value = a.nome;
      form.querySelector('[name=responsavel]').value = a.responsavel;
      form.querySelector('[name=whatsapp]').value = a.whatsapp;
      form.querySelector('[name=turma_id]').value = a.turma_id || '';
      form.querySelector('[name=valor_mensalidade]').value = a.valor_mensalidade;
      form.querySelector('[name=dia_vencimento]').value = a.dia_vencimento;
      form.querySelector('[name=situacao]').value = a.situacao;
      $('#card-form-aluno').hidden = false;
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (apagar) {
      const a = state.alunos.find((x) => x.id === Number(apagar.dataset.apagarAluno));
      if (!confirm(`Excluir “${a.nome}” e todo o histórico dele?`)) return;
      try {
        await api('DELETE', '/api/alunos/' + a.id);
        toast('Aluno excluído.', 'ok');
        await carregarAlunos();
      } catch (err) { toast(err.message, 'erro'); }
    }
    if (hist) abrirHistorico(Number(hist.dataset.historico));
  });

  /* ----------------------------- presencas ----------------------------- */

  async function prepararPresencas() {
    if (!state.turmas.length) await carregarTurmas(false);
    preencherSelectTurmas();
  }

  $('#btn-carregar-presenca').addEventListener('click', carregarChamada);

  async function carregarChamada() {
    const turmaId = $('#presenca-turma').value;
    const data = $('#presenca-data').value;
    if (!turmaId) return toast('Cadastre e selecione uma turma.', 'erro');
    if (!data) return toast('Informe a data do treino.', 'erro');
    try {
      const r = await api('GET', `/api/presencas?turma_id=${encodeURIComponent(turmaId)}&data=${encodeURIComponent(data)}`);
      state.chamada = { turma_id: r.turma_id, data: r.data, alunos: r.alunos };
      const turma = state.turmas.find((t) => t.id === r.turma_id);
      $('#presenca-titulo').textContent = `Chamada — ${turma ? turma.nome : 'Turma'} • ${dataBR(r.data)}`;
      renderChamada();
    } catch (err) { toast(err.message, 'erro'); }
  }

  function renderChamada() {
    const { alunos } = state.chamada;
    const alvo = $('#lista-presencas');
    if (!alunos.length) {
      alvo.innerHTML = '<div class="vazio">Nenhum aluno ativo nesta turma.</div>';
      $('#presenca-acoes').hidden = true;
      return;
    }
    alvo.innerHTML = alunos
      .map(
        (a) => `<div class="chamada-linha">
          <div>
            <span class="aluno-nome">${esc(a.nome)}</span>
            <span class="aluno-sub"> • ${esc(a.responsavel)}</span>
          </div>
          <div class="seg">
            <button class="btn btn-ghost btn-sm ${a.status === 'presente' ? 'sel-presente' : ''}" data-marcar="presente" data-aluno="${a.aluno_id}">Presente</button>
            <button class="btn btn-ghost btn-sm ${a.status === 'falta' ? 'sel-falta' : ''}" data-marcar="falta" data-aluno="${a.aluno_id}">Falta</button>
          </div>
        </div>`
      )
      .join('');
    $('#presenca-acoes').hidden = false;
    atualizarResumoChamada();
  }

  function atualizarResumoChamada() {
    const a = state.chamada.alunos;
    const presentes = a.filter((x) => x.status === 'presente').length;
    const faltas = a.filter((x) => x.status === 'falta').length;
    $('#presenca-resumo').textContent = `${presentes} presente(s) • ${faltas} falta(s) • ${a.length - presentes - faltas} sem marcar`;
  }

  $('#lista-presencas').addEventListener('click', (e) => {
    const b = e.target.closest('[data-marcar]');
    if (!b) return;
    const alunoId = Number(b.dataset.aluno);
    const alvo = state.chamada.alunos.find((a) => a.aluno_id === alunoId);
    if (!alvo) return;
    alvo.status = alvo.status === b.dataset.marcar ? null : b.dataset.marcar;
    renderChamada();
  });

  $('#btn-todos-presentes').addEventListener('click', () => {
    state.chamada.alunos.forEach((a) => { if (!a.status) a.status = 'presente'; });
    renderChamada();
  });

  $('#btn-limpar-presenca').addEventListener('click', () => {
    state.chamada.alunos.forEach((a) => (a.status = null));
    renderChamada();
  });

  $('#btn-salvar-presenca').addEventListener('click', async () => {
    const registros = state.chamada.alunos
      .filter((a) => a.status === 'presente' || a.status === 'falta')
      .map((a) => ({ aluno_id: a.aluno_id, status: a.status }));
    if (!registros.length) return toast('Marque presença ou falta de pelo menos um aluno.', 'erro');
    try {
      const r = await api('POST', '/api/presencas', {
        turma_id: state.chamada.turma_id,
        data: state.chamada.data,
        registros,
      });
      toast(`Chamada salva (${r.salvos} aluno(s)).`, 'ok');
      await carregarChamada();
    } catch (err) { toast(err.message, 'erro'); }
  });

  /* ----------------------------- mensalidades ----------------------------- */

  async function carregarMensalidades() {
    if (!$('#mens-competencia').value) $('#mens-competencia').value = state.competencia;
    const comp = $('#mens-competencia').value;
    const filtro = $('#mens-filtro').value;
    try {
      const r = await api('GET', `/api/mensalidades?competencia=${encodeURIComponent(comp)}${filtro ? '&status=' + filtro : ''}`);
      $('#mens-resumo').innerHTML = `
        <div class="metric"><div class="rotulo">Pagas</div><div class="valor">${r.resumo.pagas}</div><small>${money(r.resumo.valor_pago)}</small></div>
        <div class="metric info"><div class="rotulo">Pendentes</div><div class="valor">${r.resumo.pendentes}</div><small>${money(r.resumo.valor_pendente)}</small></div>
        <div class="metric alerta"><div class="rotulo">Atrasadas</div><div class="valor">${r.resumo.atrasadas}</div><small>${money(r.resumo.valor_atrasado)}</small></div>`;

      const alvo = $('#lista-mensalidades');
      if (!r.mensalidades.length) {
        alvo.innerHTML = '<div class="vazio">Nenhuma mensalidade nesta competência. Use “Gerar mensalidades do mês”.</div>';
        return;
      }
      alvo.innerHTML = `
        <div class="tabela-wrap"><table class="tabela">
          <thead><tr><th>Aluno</th><th>Responsável</th><th>Valor</th><th>Vencimento</th><th>Situação</th><th>Pagamento</th><th></th></tr></thead>
          <tbody>${r.mensalidades
            .map(
              (m) => `<tr>
                <td data-rotulo="Aluno"><span class="aluno-nome">${esc(m.aluno_nome)}</span><br><span class="aluno-sub">${esc(m.turma_nome || 'Sem turma')} • ${esc(m.competencia)}</span></td>
                <td data-rotulo="Responsável">${esc(m.responsavel)}<br><span class="aluno-sub">${esc(m.whatsapp)}</span></td>
                <td data-rotulo="Valor">${money(m.valor)}</td>
                <td data-rotulo="Vencimento">${dataBR(m.vencimento)}</td>
                <td data-rotulo="Situação">${tagStatus(m.status_calculado)}</td>
                <td data-rotulo="Pagamento">${m.status === 'pago' ? `${dataBR(m.data_pagamento)}<br><span class="aluno-sub">${esc(m.forma_pagamento || 'Manual')}</span>` : '—'}</td>
                <td><div class="acoes">
                  ${m.status === 'pago'
                    ? `<button class="btn btn-ghost btn-sm" data-desfazer="${m.id}">Desfazer pagamento</button>`
                    : `<button class="btn btn-primary btn-sm" data-pagar="${m.id}">Registrar pagamento</button>`}
                  <button class="btn btn-ghost btn-sm" data-corrigir="${m.id}">Corrigir</button>
                  <button class="btn btn-whats btn-sm" data-cobrar="${m.aluno_id}">WhatsApp</button>
                </div></td>
              </tr>`
            )
            .join('')}</tbody>
        </table></div>`;
    } catch (err) { toast(err.message, 'erro'); }
  }

  $('#btn-buscar-mens').addEventListener('click', carregarMensalidades);
  $('#mens-filtro').addEventListener('change', carregarMensalidades);

  $('#btn-gerar-mens').addEventListener('click', async () => {
    const comp = $('#mens-competencia').value || state.competencia;
    try {
      const r = await api('POST', '/api/mensalidades/gerar', { competencia: comp });
      toast(`${r.criadas} mensalidade(s) gerada(s) para ${mesBR(r.competencia)} • ${r.existentes} já existiam.`, 'ok');
      await carregarMensalidades();
    } catch (err) { toast(err.message, 'erro'); }
  });

  $('#lista-mensalidades').addEventListener('click', async (e) => {
    const pagar = e.target.closest('[data-pagar]');
    const desfazer = e.target.closest('[data-desfazer]');
    const corrigir = e.target.closest('[data-corrigir]');
    const cobrar = e.target.closest('[data-cobrar]');
    try {
      if (pagar) {
        await api('PUT', '/api/mensalidades/' + pagar.dataset.pagar, { status: 'pago', data_pagamento: new Date().toISOString().slice(0, 10), forma_pagamento: 'Manual' });
        toast('Pagamento registrado.', 'ok');
        carregarMensalidades();
      }
      if (desfazer) {
        await api('PUT', '/api/mensalidades/' + desfazer.dataset.desfazer, { status: 'pendente' });
        toast('Pagamento desfeito.', 'ok');
        carregarMensalidades();
      }
      if (corrigir) abrirCorrecao(Number(corrigir.dataset.corrigir));
      if (cobrar) contatoWhatsApp(Number(cobrar.dataset.cobrar), 'cobranca');
    } catch (err) { toast(err.message, 'erro'); }
  });

  function abrirCorrecao(id) {
    abrirModal('Corrigir mensalidade', `
      <form id="form-corrigir" class="stack">
        <input type="hidden" name="id" value="${id}" />
        <div class="grid-form">
          <label>Valor (R$)<input type="number" step="0.01" min="0" name="valor" id="corr-valor" /></label>
          <label>Vencimento<input type="date" name="vencimento" id="corr-venc" /></label>
          <label>Situação
            <select name="status" id="corr-status">
              <option value="pendente">Pendente</option>
              <option value="pago">Paga</option>
            </select>
          </label>
          <label>Data do pagamento<input type="date" name="data_pagamento" id="corr-data" /></label>
          <label>Forma de pagamento<input type="text" name="forma_pagamento" id="corr-forma" placeholder="Pix, dinheiro, cartão..." /></label>
          <label>Observação<input type="text" name="observacao" id="corr-obs" placeholder="Ex.: pagou metade, restante dia 20" /></label>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" type="submit">Salvar correção</button>
          <button class="btn btn-ghost" type="button" id="corr-cancelar">Cancelar</button>
        </div>
      </form>`);
    $('#corr-cancelar').addEventListener('click', fecharModal);

    api('GET', `/api/mensalidades?competencia=${encodeURIComponent($('#mens-competencia').value)}`)
      .then((r) => {
        const m = (r.mensalidades || []).find((x) => x.id === id);
        if (!m) return;
        $('#corr-valor').value = m.valor;
        $('#corr-venc').value = m.vencimento;
        $('#corr-status').value = m.status;
        $('#corr-data').value = m.data_pagamento || '';
        $('#corr-forma').value = m.forma_pagamento || '';
        $('#corr-obs').value = m.observacao || '';
      });

    $('#form-corrigir').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      try {
        await api('PUT', '/api/mensalidades/' + f.get('id'), {
          valor: f.get('valor'),
          vencimento: f.get('vencimento'),
          status: f.get('status'),
          data_pagamento: f.get('data_pagamento') || null,
          forma_pagamento: f.get('forma_pagamento'),
          observacao: f.get('observacao'),
        });
        toast('Mensalidade corrigida.', 'ok');
        fecharModal();
        carregarMensalidades();
      } catch (err) { toast(err.message, 'erro'); }
    });
  }

  /* ----------------------------- contato WhatsApp ----------------------------- */

  function mensagemPadrao(aluno, tipo) {
    const escola = state.escolinha ? state.escolinha.nome : 'nossa escolinha';
    const primeiroNome = String(aluno.nome).split(' ')[0];
    if (tipo === 'faltas') {
      const faltas = aluno.faltas_consecutivas >= 2 ? aluno.faltas_consecutivas : 2;
      return (
        `Olá, ${aluno.responsavel}! Aqui é da ${escola}. ` +
        `Sentimos a falta do(a) ${primeiroNome} nos últimos ${faltas} treinos. ` +
        `Está tudo bem com ele(a)? Podemos ajudar com algo para que volte a treinar com a turma?`
      );
    }
    const valor = aluno.mensalidade_valor != null ? money(aluno.mensalidade_valor) : money(aluno.valor_mensalidade);
    const venc = aluno.vencimento ? ` com vencimento em ${dataBR(aluno.vencimento)}` : '';
    return (
      `Olá, ${aluno.responsavel}! Aqui é da ${escola}. ` +
      `Passando para lembrar da mensalidade do(a) ${primeiroNome} referente a ${mesBR(state.competencia)}, ` +
      `no valor de ${valor}${venc}. Qualquer dúvida estou à disposição. Obrigado!`
    );
  }

  async function contatoWhatsApp(alunoId, tipo) {
    let aluno = state.alunos.find((a) => a.id === alunoId);
    if (!aluno) {
      const r = await api('GET', '/api/alunos');
      state.alunos = r.alunos;
      aluno = state.alunos.find((a) => a.id === alunoId);
    }
    if (!aluno) return toast('Aluno não encontrado.', 'erro');

    abrirModal(tipo === 'faltas' ? 'Contato sobre faltas' : 'Cobrança de mensalidade', `
      <p class="muted small">Responsável: <strong>${esc(aluno.responsavel)}</strong> • WhatsApp: ${esc(aluno.whatsapp)}</p>
      <label>Mensagem (pode editar antes de enviar)
        <textarea id="msg-whats">${esc(mensagemPadrao(aluno, tipo))}</textarea>
      </label>
      <div class="form-actions">
        <button class="btn btn-whats" id="btn-abrir-whats" type="button">Abrir WhatsApp do responsável</button>
        <button class="btn btn-primary" id="btn-registrar-contato" type="button">Registrar contato realizado</button>
      </div>
      <p class="muted small">O envio é manual: a mensagem abre no WhatsApp Web/app do responsável.</p>
    `);

    $('#btn-abrir-whats').addEventListener('click', () => {
      const msg = $('#msg-whats').value;
      window.open(`${waLink(aluno.whatsapp)}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
    });

    $('#btn-registrar-contato').addEventListener('click', async () => {
      const msg = $('#msg-whats').value;
      try {
        await api('POST', '/api/contatos', { aluno_id: aluno.id, tipo, mensagem: msg });
        const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        state.contatosFeitos[aluno.id] = hora;
        toast('Contato registrado no histórico do aluno.', 'ok');
        fecharModal();
        if (!$('#tela-painel').classList.contains('hidden')) carregarPainel();
      } catch (err) { toast(err.message, 'erro'); }
    });
  }

  /* ----------------------------- historico ----------------------------- */

  async function abrirHistorico(alunoId) {
    try {
      const h = await api('GET', `/api/alunos/${alunoId}/historico`);
      const a = h.aluno;
      abrirModal(`Histórico — ${a.nome}`, `
        <p class="muted small">
          Responsável: <strong>${esc(a.responsavel)}</strong> • ${esc(a.whatsapp)}<br>
          Turma: ${esc(a.turma_nome || 'Sem turma')} • Mensalidade ${money(a.valor_mensalidade)} • vencimento dia ${a.dia_vencimento} • ${a.situacao === 'ativo' ? 'Ativo' : 'Inativo'}
        </p>

        <div class="cards cards-sm">
          <div class="metric"><div class="rotulo">Presenças</div><div class="valor">${h.resumo_presencas.presentes}</div></div>
          <div class="metric alerta"><div class="rotulo">Faltas</div><div class="valor">${h.resumo_presencas.faltas}</div><small>${h.faltas_consecutivas} seguidas</small></div>
          <div class="metric info"><div class="rotulo">Contatos</div><div class="valor">${h.contatos.length}</div></div>
        </div>

        <div class="form-actions">
          <button class="btn btn-whats btn-sm" data-contato-cobranca="${a.id}">Cobrar no WhatsApp</button>
          <button class="btn btn-ghost btn-sm" data-contato-faltas="${a.id}">Falar sobre faltas</button>
        </div>

        <h4>Mensalidades</h4>
        ${h.mensalidades.length
          ? `<div class="tabela-wrap"><table class="tabela">
              <thead><tr><th>Mês</th><th>Valor</th><th>Vencimento</th><th>Situação</th><th>Pago em</th></tr></thead>
              <tbody>${h.mensalidades
                .map(
                  (m) => `<tr>
                    <td data-rotulo="Mês">${esc(m.competencia)}</td>
                    <td data-rotulo="Valor">${money(m.valor)}</td>
                    <td data-rotulo="Vencimento">${dataBR(m.vencimento)}</td>
                    <td data-rotulo="Situação">${tagStatus(m.status_calculado)}</td>
                    <td data-rotulo="Pago em">${m.status === 'pago' ? dataBR(m.data_pagamento) : '—'}</td>
                  </tr>`
                )
                .join('')}</tbody></table></div>`
          : '<p class="muted small">Nenhuma mensalidade registrada.</p>'}

        <h4>Presenças</h4>
        ${h.presencas.length
          ? `<div class="tabela-wrap"><table class="tabela">
              <thead><tr><th>Data</th><th>Turma</th><th>Status</th></tr></thead>
              <tbody>${h.presencas
                .map(
                  (p) => `<tr>
                    <td data-rotulo="Data">${dataBR(p.data)}</td>
                    <td data-rotulo="Turma">${esc(p.turma_nome || '—')}</td>
                    <td data-rotulo="Status"><span class="tag ${p.status === 'presente' ? 'tag-presente' : 'tag-falta'}">${p.status === 'presente' ? 'Presente' : 'Falta'}</span></td>
                  </tr>`
                )
                .join('')}</tbody></table></div>`
          : '<p class="muted small">Nenhuma presença registrada.</p>'}

        <h4>Contatos realizados</h4>
        ${h.contatos.length
          ? `<div class="tabela-wrap"><table class="tabela">
              <thead><tr><th>Quando</th><th>Tipo</th><th>Mensagem</th><th></th></tr></thead>
              <tbody>${h.contatos
                .map(
                  (c) => `<tr>
                    <td data-rotulo="Quando">${dataHoraBR(c.criado_em)}</td>
                    <td data-rotulo="Tipo"><span class="tag tag-neutro">${c.tipo === 'faltas' ? 'Faltas' : 'Cobrança'}</span></td>
                    <td data-rotulo="Mensagem">${esc(c.mensagem)}</td>
                    <td><button class="btn btn-perigo btn-sm" data-apagar-contato="${c.id}">Excluir</button></td>
                  </tr>`
                )
                .join('')}</tbody></table></div>`
          : '<p class="muted small">Nenhum contato registrado.</p>'}
      `);

      $('#modal-corpo').addEventListener('click', async (ev) => {
        const b = ev.target.closest('[data-apagar-contato]');
        if (!b) return;
        try {
          await api('DELETE', '/api/contatos/' + b.dataset.apagarContato);
          toast('Registro de contato excluído.', 'ok');
          abrirHistorico(alunoId);
        } catch (err) { toast(err.message, 'erro'); }
      });
    } catch (err) { toast(err.message, 'erro'); }
  }

  /* ----------------------------- botoes globais (delegacao) ----------------------------- */

  document.addEventListener('click', (e) => {
    const cob = e.target.closest('[data-contato-cobranca]');
    if (cob) contatoWhatsApp(Number(cob.dataset.contatoCobranca), 'cobranca');
    const fal = e.target.closest('[data-contato-faltas]');
    if (fal) contatoWhatsApp(Number(fal.dataset.contatoFaltas), 'faltas');
    const h = e.target.closest('[data-historico]');
    if (h && !h.closest('#lista-alunos')) abrirHistorico(Number(h.dataset.historico));
  });

  /* ----------------------------- boot ----------------------------- */

  (async function boot() {
    const token = localStorage.getItem('ea_token');
    if (!token) return;
    try {
      const r = await api('GET', '/api/eu');
      state.escolinha = r.escolinha;
      $('#tela-auth').hidden = true;
      $('#tela-app').hidden = false;
      $('#nome-escolinha').textContent = r.escolinha.nome;
      iniciar();
    } catch {
      localStorage.removeItem('ea_token');
    }
  })();
})();
