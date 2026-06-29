# Builds and runs the whole game as one Node service.
FROM node:20.9.0-bookworm-slim
WORKDIR /app
COPY . .
RUN npm ci && npm run build
ENV NODE_ENV=production
EXPOSE 2567
CMD ["npm", "start"]
