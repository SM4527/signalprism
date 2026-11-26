FROM node:24-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/node_modules/zod ./node_modules/zod
COPY --from=build /app/src ./src
COPY --from=build /app/scripts/watch-add.ts /app/scripts/watch-remove.ts /app/scripts/poll-now.ts ./scripts/
EXPOSE 3000
CMD ["node", "server.js"]
