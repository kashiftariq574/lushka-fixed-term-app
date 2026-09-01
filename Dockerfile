FROM node:22-alpine

RUN apk add --no-cache openssl

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

# Install all dependencies required for building.
RUN npm ci --include=dev

COPY . .

RUN npx prisma generate
RUN npm run build

# Keep only production dependencies in the final image.
RUN npm prune --omit=dev && npm cache clean --force

EXPOSE 3000

CMD ["npm", "run", "docker-start"]
