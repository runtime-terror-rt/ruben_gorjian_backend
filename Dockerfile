FROM node:20-alpine

WORKDIR /app

# Prisma needs OpenSSL in many environments.
RUN apk add --no-cache openssl

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 4000

CMD ["sh", "-c", "npx prisma migrate resolve --applied 20260226214644_ || true; npx prisma migrate deploy && npx prisma generate && npx ts-node --transpile-only src/index.ts"]
