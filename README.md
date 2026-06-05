# BAZE P2P

BAZE P2P is a mobile-first PWA for crypto-fiat peer-to-peer USDT/USDC trades. The stack is a TypeScript monorepo:

- `apps/api`: Fastify API, PostgreSQL ledger, Redis hot state, WebSocket gateway.
- `apps/web`: Vite + React + Tailwind PWA.
- `packages/shared`: shared types and state-machine constants.

## Local Start

```bash
cp .env.example .env
docker compose up -d postgres redis
npm install
npm run migrate
npm run seed
npm run dev -w apps/api
npm run dev -w apps/web
```

Open `http://localhost:5173`.

## Production Notes

Deploy on Coolify as two services:

- API: `apps/api`, command `npm run start -w apps/api`, expose `8080`.
- Web: `apps/web`, command `npm run preview -w apps/web -- --host 0.0.0.0`, expose `4173`.

Set `sportbanter.online` to the web service and route `/api` plus `/ws` to the API service through Coolify proxy rules or a reverse proxy.

