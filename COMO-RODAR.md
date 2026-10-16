# Como rodar o EscolinhaAtiva

## 1. Iniciar o servidor

No terminal (Windows), rode:

```bat
cd C:\Users\USER\.abacusai-bot\session-home\escolinhaativa
"C:\Program Files\nodejs\node.exe" server.js
```

A mensagem `EscolinhaAtiva rodando em http://localhost:4173` confirma que subiu.

## 2. Abrir no navegador

<http://localhost:4173>

Ou dê dois cliques no arquivo **`abrir-escolinha.bat`** desta pasta: ele inicia o
servidor (se ainda não estiver rodando) e abre o navegador.

## 3. Entrar

- **Conta de demonstração (já criada):**
  - e-mail: `demo@escolinha.com`
  - senha: `1234`
  - já vem com 2 turmas, 6 alunos, mensalidades de outubro/2026, chamadas e o
    caso do João (mensalidade atrasada + 2 faltas seguidas) destacado no painel.
- **Ou crie a sua escolinha:** aba **Criar conta** → nome, e-mail e senha.

## Observações

- Requer **Node.js 22.5 ou superior** (instalado nesta máquina: v24.20.0). O banco
  de dados é o SQLite nativo do Node — **não é preciso instalar nada** (`npm install`).
- O banco fica em `data\escolinha.db` e é persistente: feche o servidor e reabra,
  os dados continuam lá.
- Para usar outra porta ou outro arquivo de banco:
  ```bat
  set PORT=5000
  set ESCOLINHA_DB=C:\dados\escolinha.db
  "C:\Program Files\nodejs\node.exe" server.js
  ```
- Teste automático do fluxo principal: `"C:\Program Files\nodejs\node.exe" test\flow.test.js`
