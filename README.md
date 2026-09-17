# AnimeDex

> Dashboard de acompanhamento de animes com múltiplos perfis, construído com Node.js + Jikan API.

![AnimeDex](https://img.shields.io/badge/status-ativo-brightgreen) ![Node](https://img.shields.io/badge/node-%3E%3D18-blue) ![License](https://img.shields.io/badge/license-MIT-blue)

---

## Funcionalidades

- **Busca de animes** via [Jikan API v4](https://jikan.moe/) (MyAnimeList), com sugestões populares na tela de busca
- **Minha Lista** com 5 status: Assistindo, Completo, Planejado, Em Pausa, Dropado — filtros com contagem e ordenação
- **Avaliação** geral + notas por categoria (História, Animação, Personagens, Trilha)
- **Rastreador de episódios** por episódio individual com registro de data e barra de progresso nos cards
- **Estatísticas** — horas assistidas, distribuição por status e gênero, histograma de notas, atividade mensal e Top 5
- **Recomendações por gênero** com paginação
- **Calendário da temporada atual** agrupado por dia da semana
- **Sinopses em pt-BR** — traduzidas automaticamente e salvas junto com o anime
- **Múltiplos perfis** com login por usuário + senha (cada perfil tem sua própria lista)
- **Persistência** em [Turso](https://turso.tech/) (produção) ou JSON local (desenvolvimento)
- Interface escura com navbar no topo, cards com badge de status, nota, tags de gênero e sinopse no hover

---

## Como rodar

### Pré-requisitos

| Requisito | Versão mínima | Link |
|-----------|--------------|------|
| [Node.js](https://nodejs.org/) | v18+ | https://nodejs.org |
| npm | v8+ *(incluso no Node.js)* | — |

> Verifique com: `node -v` e `npm -v`

### Instalação

```bash
git clone https://github.com/PedroMenes/Animedex.git
cd Animedex
npm install
npm start
```

Acesse em: **http://localhost:3131**

Na primeira execução, crie um perfil pela aba **Criar conta**. Em desenvolvimento os dados ficam em `data.json` e `users.json` (gerados automaticamente e ignorados pelo git).

### Variáveis de ambiente

Todas opcionais em desenvolvimento local:

| Variável | Descrição |
|----------|-----------|
| `PORT` | Porta do servidor (padrão `3131`) |
| `TURSO_URL` | URL do banco Turso — se definida junto com `TURSO_TOKEN`, substitui o JSON local |
| `TURSO_TOKEN` | Token de acesso do Turso |
| `SESSION_SECRET` | Segredo das sessões — se ausente, é gerado e salvo em `.session-secret` |

---

## Deploy (Render)

O projeto inclui um [`render.yaml`](render.yaml) para deploy como *Web Service* no [Render](https://render.com/). O `SESSION_SECRET` é gerado automaticamente; `TURSO_URL` e `TURSO_TOKEN` precisam ser adicionados manualmente em **Environment** no painel — sem eles o app usaria o JSON local, que não persiste entre deploys.

Cada push na branch `main` dispara um novo deploy.

---

## Estrutura do projeto

```
Animedex/
├── index.html        # Interface principal (SPA)
├── app.js            # Lógica frontend
├── style.css         # Estilos
├── server.js         # Servidor Express + API REST + autenticação
├── render.yaml       # Configuração de deploy no Render
├── data.json         # Lista local (dev, ignorado pelo git)
├── users.json        # Perfis locais (dev, ignorado pelo git)
└── package.json
```

---

## API do servidor

Rotas de lista exigem sessão autenticada.

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/auth/me` | Perfil logado |
| `POST` | `/api/auth/register` | Cria perfil (`username`, `password`) |
| `POST` | `/api/auth/login` | Entra em um perfil |
| `POST` | `/api/auth/logout` | Sai do perfil |
| `GET` | `/api/list` | Lista do perfil logado |
| `POST` | `/api/list` | Adiciona ou atualiza um anime |
| `DELETE` | `/api/list/:malId` | Remove um anime |
| `GET` | `/api/jikan?path=…` | Proxy para a Jikan API (cache + retry, fallback AniList) |
| `POST` | `/api/translate` | Traduz um texto en → pt-BR (`text`) |

---

## Tecnologias

- **Frontend:** HTML5, CSS3 (Custom Properties), JavaScript ES2022 — sem framework nem build
- **Backend:** Node.js + [Express](https://expressjs.com/), sessões com [express-session](https://github.com/expressjs/session), senhas com [bcryptjs](https://github.com/dcodeIO/bcrypt.js)
- **Banco:** [Turso](https://turso.tech/) via [@libsql/client](https://github.com/tursodatabase/libsql-client-ts), com fallback em JSON
- **API de animes:** [Jikan v4](https://docs.api.jikan.moe/) (MyAnimeList) — fallback automático para [AniList GraphQL](https://anilist.gitbook.io/anilist-apiv2-docs/)
- **Tradução:** Google Translate (endpoint público, sem chave)
- **Fontes:** [Inter](https://fonts.google.com/specimen/Inter) e [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) (só no logo)

---

## Licença

MIT © [PedroMenes](https://github.com/PedroMenes)
