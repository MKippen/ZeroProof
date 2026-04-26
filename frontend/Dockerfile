FROM node:25-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build
RUN pnpm build

# Production stage - just serve the files
FROM nginx:alpine

# Copy built files
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx config for SPA routing and API proxy
# Uses Docker DNS resolver (127.0.0.11) with a variable so nginx
# re-resolves the backend hostname on each request instead of caching
# the IP at startup. This prevents 502s when the backend restarts.
RUN echo 'server { \
    listen 80; \
    root /usr/share/nginx/html; \
    index index.html; \
    resolver 127.0.0.11 valid=10s; \
    \
    location /api/ { \
        set $backend http://backend:3000; \
        proxy_pass $backend; \
        proxy_http_version 1.1; \
        proxy_set_header Upgrade $http_upgrade; \
        proxy_set_header Connection "upgrade"; \
        proxy_set_header Host $host; \
        proxy_set_header X-Real-IP $remote_addr; \
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; \
        proxy_set_header X-Forwarded-Proto $scheme; \
    } \
    \
    location /ws { \
        set $backend_ws http://backend:3000; \
        proxy_pass $backend_ws; \
        proxy_http_version 1.1; \
        proxy_set_header Upgrade $http_upgrade; \
        proxy_set_header Connection "upgrade"; \
        proxy_set_header Host $host; \
    } \
    \
    location = /index.html { \
        add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate"; \
        add_header Pragma "no-cache"; \
        add_header Expires "0"; \
        try_files $uri =404; \
    } \
    \
    location / { \
        add_header Cache-Control "no-cache"; \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
