FROM mcr.microsoft.com/playwright:v1.47.0-jammy

WORKDIR /app

COPY package.json ./
RUN npm install --no-audit --no-fund --omit=optional

COPY server.ts ./
COPY tsconfig.json ./

ENV PORT=3000
EXPOSE 3000

CMD ["npx", "tsx", "server.ts"]
