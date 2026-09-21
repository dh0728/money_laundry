# syntax=docker/dockerfile:1

FROM node:24-alpine AS builder

WORKDIR /app

# 팀과 Docker 빌드에서 동일한 pnpm 버전을 사용한다.
RUN npm install --global pnpm@11.24.0

# 의존성 파일을 먼저 복사해 Docker 레이어 캐시를 활용한다.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# VITE_ 변수는 빌드 시점에 브라우저 코드에 포함된다.
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN pnpm run build

FROM nginx:stable-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --quiet --output-document=/dev/null http://127.0.0.1/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
