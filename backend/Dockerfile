# Backend Dockerfile
FROM node:20-alpine

WORKDIR /app

# Install git for cloning repositories
RUN apk add --no-cache git openssh

COPY package*.json ./
RUN npm ci --only=production || npm install --only=production

COPY src ./src

ENV PORT=3001
EXPOSE 3001

CMD ["npm", "start"]
