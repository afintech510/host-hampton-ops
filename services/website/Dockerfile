FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# NEXT_PUBLIC_* is inlined by `next build`, so these have to be ARGs here and be
# passed as build args in docker-compose.yml. Setting one in the runtime
# `environment:` block does nothing for client components — the value is already
# baked (or already missing) by then, and the failure is silent.
ARG NEXT_PUBLIC_GA_ID=G-BX1DJ77T15
ARG NEXT_PUBLIC_GADS_ID=AW-16667795146
ARG NEXT_PUBLIC_META_PIXEL_ID=1543468516699272
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_GA_ID=$NEXT_PUBLIC_GA_ID
ENV NEXT_PUBLIC_GADS_ID=$NEXT_PUBLIC_GADS_ID
ENV NEXT_PUBLIC_META_PIXEL_ID=$NEXT_PUBLIC_META_PIXEL_ID
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3002
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3002
CMD ["node", "server.js"]
