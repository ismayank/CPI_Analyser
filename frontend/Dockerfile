# Frontend Dockerfile (build with Vite, serve via Nginx)
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci || npm install
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime
# Copy build artifacts
COPY --from=build /app/dist /usr/share/nginx/html
# Add nginx config to proxy /api to backend
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
