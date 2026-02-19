FROM node:20-alpine AS builder

ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:alpine

COPY ./nginx.default.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

