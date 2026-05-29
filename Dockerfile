FROM node:24-slim

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    MULTIPLAYER_APP_PORT=4186 \
    MULTIPLAYER_API_PORT=4196

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts

EXPOSE 4186 4196

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.MULTIPLAYER_API_PORT || 4196) + '/health').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1));"

CMD ["npm", "run", "start:multiplayer:stack"]
