# Coolify Deployment

## Services

Create four Coolify resources:

- PostgreSQL 16
- Redis 7
- API service from `apps/api/Dockerfile`
- Web service from `apps/web/Dockerfile`

## API Environment

Set these variables on the API service:

```txt
NODE_ENV=production
PORT=8080
WEB_ORIGIN=https://sportbanter.online
DATABASE_URL=postgres://...
REDIS_URL=redis://...
JWT_SECRET=...
KYC_VAULT_ENCRYPTION_KEY_BASE64=...
DISCLOSURE_MASTER_KEY=...
```

Run migrations once from the API container shell:

```bash
npm run migrate -w apps/api
```

## Web Environment

Set these at build time:

```txt
VITE_API_BASE_URL=https://sportbanter.online
VITE_WS_URL=wss://sportbanter.online/ws
```

## Routing

Route:

- `/` to the web container.
- `/api/*`, `/health`, and `/ws` to the API container.

WebSocket proxying must be enabled for `/ws`.

