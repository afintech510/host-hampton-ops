FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_GA_ID
ARG NEXT_PUBLIC_GADS_ID
ENV NEXT_PUBLIC_GA_ID=$NEXT_PUBLIC_GA_ID
ENV NEXT_PUBLIC_GADS_ID=$NEXT_PUBLIC_GADS_ID
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
