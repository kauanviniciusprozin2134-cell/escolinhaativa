# Hospedagem (deploy)

O app é um servidor Node puro (sem dependências), então roda em qualquer serviço que
execute `npm start` / `node server.js`.

## O que já está pronto para o deploy

- `Procfile` → `web: node server.js`
- `package.json` → `"engines": { "node": ">=22.5.0" }` e `"start": "node server.js"`
- `server.js` escuta em `process.env.PORT` (porta do provedor) e em `0.0.0.0`
- banco em `process.env.ESCOLINHA_DB`, quando definido

## Variáveis de ambiente recomendadas

| Variável | Valor | Por quê |
|---|---|---|
| `ESCOLINHA_DB` | `/var/data/escolinha.db` (Render) ou `/data/escolinha.db` (Railway) | coloca o banco no **disco persistente**; sem isso o banco é apagado a cada deploy |
| `PORT` | definido automaticamente pelo provedor | não precisa configurar |

## Render (tem disco persistente e plano gratuito)

1. Crie o serviço: **New → Web Service** apontando para o repositório do GitHub.
2. Runtime **Node**, Build Command `npm install`, Start Command `npm start`.
3. **Disks → Add Disk**: nome `escolinha-data`, mount path `/var/data`.
4. **Environment → Add**: `ESCOLINHA_DB = /var/data/escolinha.db`.
5. Deploy. A URL fica `https://<nome>.onrender.com`.

## Railway / Fly.io

- Railway: `railway init`, `railway up`, e um **Volume** montado em `/data` com
  `ESCOLINHA_DB=/data/escolinha.db`.
- Fly.io: `fly launch` (detecta Node), `fly volumes create escolinha_data --size 1`,
  e `ESCOLINHA_DB=/data/escolinha.db` em `fly.toml`.

## Observações importantes

- O plano gratuito do Render hiberna sem acesso; o primeiro acesso depois disso
  demora alguns segundos para responder.
- Sem disco persistente, cada deploy recria o banco (os dados de teste somem).
- Alternativa "só demonstração": hospedar um snapshot do banco demo dentro do
  repositório (`data/escolinha.db`) — funciona, mas qualquer cadastro novo se perde
  no próximo deploy.
