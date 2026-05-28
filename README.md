# 📟 AnimeDex

> Dashboard de acompanhamento de animes com estética de Pokédex, construído com Node.js + Jikan API.

![AnimeDex](https://img.shields.io/badge/status-ativo-brightgreen) ![Node](https://img.shields.io/badge/node-%3E%3D18-blue) ![License](https://img.shields.io/badge/license-MIT-blue)

---

## ✨ Funcionalidades

- 🔍 **Busca de animes** via [Jikan API v4](https://jikan.moe/) (MyAnimeList)
- 📋 **Minha Lista** com 5 status: Assistindo, Completo, Planejado, Em Pausa, Dropado
- ⭐ **Sistema de avaliação** geral + notas por categoria (História, Animação, Personagens, Trilha)
- 🎬 **Rastreador de episódios** por episódio individual com registro de data
- 📊 **Estatísticas** — distribuição de status, gêneros, histograma de notas, atividade mensal e Top 5
- 🎴 **Recomendações por gênero** com paginação (carregar mais)
- 📅 **Calendário da temporada atual** agrupado por dia da semana
- 💾 **Banco de dados persistente** (JSON local via servidor Express)
- 🃏 **Cards estilo Pokémon** com tipo colorido por status e overlay de sinopse no hover
- 🖥️ Interface inspirada na Pokédex com tema escuro

---

## 🚀 Como rodar

### Pré-requisitos

| Requisito | Versão mínima | Link |
|-----------|--------------|------|
| [Node.js](https://nodejs.org/) | v18+ | https://nodejs.org |
| npm | v8+ *(incluso no Node.js)* | — |

> Verifique com: `node -v` e `npm -v`

### Dependências

| Pacote | Versão | Função |
|--------|--------|--------|
| [express](https://expressjs.com/) | ^4.19.2 | Servidor HTTP + API REST |

> As APIs externas [Jikan v4](https://jikan.moe/) e [AniList GraphQL](https://anilist.gitbook.io/anilist-apiv2-docs/) são usadas para busca e recomendações — **sem necessidade de chave de API**. O AniList atua automaticamente como fallback caso o Jikan/MAL esteja indisponível.

### Instalação

```bash
# Clone o repositório
git clone https://github.com/PedroMenes/Animedex.git
cd Animedex

# Instale as dependências
npm install

# Inicie o servidor
npm start
```

Acesse em: **http://localhost:3131**

---

## 🗂️ Estrutura do projeto

```
Animedex/
├── index.html        # Interface principal (SPA)
├── app.js            # Lógica frontend
├── style.css         # Estilos (tema Pokédex)
├── server.js         # Servidor Express + API REST
├── data.json         # Banco de dados local (gerado automaticamente)
└── package.json
```

---

## 🔌 API do servidor

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/list` | Retorna toda a lista |
| `POST` | `/api/list` | Adiciona ou atualiza um anime |
| `DELETE` | `/api/list/:malId` | Remove um anime |

---

## 🎨 Mapeamento de tipos (status → Pokémon)

| Status | Tipo |
|--------|------|
| Assistindo | 🔥 Fire |
| Completo | 🌿 Grass |
| Planejado | 🔮 Psychic |
| Em Pausa | ❄️ Ice |
| Dropado | 🌑 Dark |

---

## 🛠️ Tecnologias

- **Frontend:** HTML5, CSS3 (Custom Properties), JavaScript ES2022
- **Backend:** Node.js + Express (proxy com cache em memória e retry automático)
- **API primária:** [Jikan v4](https://docs.api.jikan.moe/) — wrapper não oficial do MyAnimeList
- **API fallback:** [AniList GraphQL](https://anilist.gitbook.io/anilist-apiv2-docs/) — ativado automaticamente quando Jikan/MAL está fora
- **Fonte:** [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) (pixel art)
- **Persistência:** JSON file com escrita atômica

---

## 📸 Preview

| Dashboard | Minha Lista | Estatísticas |
|-----------|-------------|--------------|
| Visão geral com cards por status | Grid filtrável e ordenável | Gráficos de atividade e notas |

---

## 📄 Licença

MIT © [PedroMenes](https://github.com/PedroMenes)
