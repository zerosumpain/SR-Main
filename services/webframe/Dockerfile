FROM mcr.microsoft.com/playwright:v1.61.1-noble@sha256:5b8f294aff9041b7191c34a4bab3ac270157a28774d4b0660e9743297b697e48

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --omit=optional

COPY server.ts ./
COPY tsconfig.json ./

RUN chown -R pwuser:pwuser /app
USER pwuser

ENV PORT=3000
EXPOSE 3000

CMD ["npx", "tsx", "server.ts"]
