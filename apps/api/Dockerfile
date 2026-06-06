FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache curl

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --include=dev

COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w packages/shared && npm run build -w apps/api

EXPOSE 8080
CMD ["npm", "run", "start", "-w", "apps/api"]
