# 阶段 1：构建 React 静态资源
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci || npm install
COPY . .
RUN npm run build

# 阶段 2：Nginx 托管静态资源 + 反向代理后端
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80