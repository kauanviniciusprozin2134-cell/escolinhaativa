# EscolinhaAtiva ⚽

Micro SaaS (MVP) para donos de escolinhas de futebol organizarem **alunos**, **turmas**, **presenças** e **mensalidades** — e enxergarem rapidamente **quem está devendo** e **quem está faltando**, com contato pronto pelo WhatsApp do responsável.

## Como rodar

```bash
cd escolinhaativa
node server.js          # requer Node 22.5+ (usa o SQLite nativo do Node)
```

Abra <http://localhost:4173>. Na primeira tela, crie a conta da sua escolinha (nome, e-mail e senha) — cada escolinha vê somente os próprios dados.

Porta e banco podem ser trocados por variável de ambiente:

```bash
PORT=5000 ESCOLINHA_DB=C:/dados/escolinha.db node server.js
```

## Teste do fluxo principal

```bash
node test/flow.test.js
```

Roda em banco temporário e cobre: cadastro/login, isolamento entre escolinhas, turmas, alunos, geração de mensalidades sem duplicar, pagamento manual (registrar/desfazer), chamada de presença (salvar/corrigir), painel com João atrasado + 2 faltas seguidas, registro de contato e histórico.

## Funcionalidades

| Função | O que faz |
|---|---|
| **Cadastro e login** | Conta por escolinha, senha com hash (`scrypt`) e sessão por token. Todos os dados são filtrados por `escolinha_id`. |
| **Alunos** | Nome, responsável, WhatsApp, turma, valor da mensalidade, dia do vencimento e situação (ativo/inativo). Criar, editar, excluir e buscar. |
| **Turmas** | Nome, professor e horários dos treinos. Criar, editar e excluir (alunos ficam sem turma). |
| **Presenças** | Escolhe turma + data, carrega a lista de alunos ativos e marca **presente** ou **falta**. Salva e pode ser corrigida depois (não duplica registro por dia). |
| **Mensalidades** | Gera os registros do mês para todos os alunos **ativos**, sem duplicar (`UNIQUE(aluno_id, competencia)`). Filtra pendentes / pagas / atrasadas. Registrar, desfazer ou corrigir pagamento manualmente (valor, vencimento, data, forma, observação). |
| **Painel** | Total de alunos ativos, valor recebido no mês, valor atrasado e lista de alunos que precisam de atenção (mensalidade atrasada e/ou 2+ faltas seguidas). |
| **Contato** | Botão que abre o WhatsApp do responsável (`wa.me`) com mensagem pronta e **editável** de cobrança ou de acompanhamento de faltas, e botão que registra o contato realizado no histórico do aluno. |
| **Histórico** | Por aluno: mensalidades (com situação), presenças (com turma) e contatos realizados. |

**Exemplo do dia a dia:** João está com a mensalidade atrasada e faltou aos dois últimos treinos → ele aparece destacado no painel com os dois motivos → o gestor clica em **Cobrar no WhatsApp** (ou **Falar sobre faltas**), revisa a mensagem, abre o WhatsApp da responsável e registra o contato.

## Estrutura

```
escolinhaativa/
├── server.js              # servidor HTTP + API + SQLite (sem dependências externas)
├── db.js                  # conexão e criação das tabelas
├── public/
│   ├── index.html         # interface única (português), responsiva
│   ├── styles.css         # visual verde / branco / azul-escuro
│   └── app.js             # telas, formulários e chamadas de API
├── test/flow.test.js      # teste do fluxo principal
└── data/escolinha.db      # banco persistente (criado no primeiro start)
```

## API (resumo)

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/cadastro` · `/api/login` · `/api/logout` | autenticação |
| GET | `/api/eu` | escolinha logada |
| GET/POST | `/api/turmas` · `/api/alunos` | listar/criar |
| PUT/DELETE | `/api/turmas/:id` · `/api/alunos/:id` | editar/excluir |
| GET | `/api/presencas?turma_id=&data=` | lista de chamada |
| POST | `/api/presencas` | salvar chamada |
| GET | `/api/mensalidades?competencia=&status=` | lista com resumo |
| POST | `/api/mensalidades/gerar` | gera o mês sem duplicar |
| POST/PUT/DELETE | `/api/mensalidades` · `/api/mensalidades/:id` | registrar/corrigir pagamento |
| POST | `/api/contatos` | registra contato realizado |
| GET | `/api/dashboard` | painel |
| GET | `/api/alunos/:id/historico` | histórico do aluno |

## Fora do escopo desta versão (proposital)

Pagamento online, cobrança automática, envio automático de WhatsApp (a API oficial do WhatsApp exige aprovação da Meta) e aplicativo nativo. Nesta versão os pagamentos são manuais e o contato é feito por link do WhatsApp.
