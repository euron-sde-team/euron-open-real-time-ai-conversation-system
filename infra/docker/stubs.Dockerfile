# syntax=docker/dockerfile:1.7
# Local stand-ins for the model providers (OpenAI-compatible, Anthropic, Gemini) and the
# realtime credential endpoints (OpenAI Realtime, Gemini Live) (apps/stubs). One
# dependency-free script, port 5139. Development and CI only: production talks to the real providers.
#   docker build -f infra/docker/stubs.Dockerfile -t open-conversation-stubs .
FROM node:22.23.4-alpine
ENV NODE_ENV=production PORT=5139
WORKDIR /app
COPY --chown=node:node apps/stubs/server.mjs apps/stubs/package.json ./
USER node
EXPOSE 5139
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=10 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5139)+'/up').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
