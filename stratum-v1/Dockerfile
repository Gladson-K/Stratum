FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM deps AS test
COPY . .
CMD ["npm", "test"]

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=8787 \
    STRATUM_DATA_DIR=/app/data
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/core/package.json ./packages/core/package.json
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY --from=build /app/packages/core/src ./packages/core/src
COPY --from=build /app/apps/server/src ./apps/server/src
COPY --from=build /app/apps/web/dist ./apps/web/dist
RUN useradd --uid 10001 --create-home app \
    && mkdir -p /app/data \
    && chown -R app:app /app /app/data
USER app
VOLUME /app/data
EXPOSE 8787
CMD ["npm", "start"]
