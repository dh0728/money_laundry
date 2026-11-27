import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import { designDevGate } from './design-dev-gate.mts'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // .env* 파일 값은 process.env 에 들어가지 않아서 loadEnv 로 직접 읽는다. 셸에서 넘긴 값이 먼저다.
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = process.env.VITE_API_PROXY_TARGET ?? env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:8080'
  // dev 는 Cloudflare Access 뒤에 있다. 서비스 토큰이 있으면 proxy 가 헤더를 붙인다(VITE_ 가 아니라 번들에 안 들어간다).
  const cfId = process.env.CF_ACCESS_CLIENT_ID ?? env.CF_ACCESS_CLIENT_ID
  const cfSecret = process.env.CF_ACCESS_CLIENT_SECRET ?? env.CF_ACCESS_CLIENT_SECRET
  const cfHeaders = cfId && cfSecret ? { 'CF-Access-Client-Id': cfId, 'CF-Access-Client-Secret': cfSecret } : undefined

  return {
    plugins: [designDevGate(), react(), tailwindcss()],
    server: {
      proxy: { '/api': { target: apiTarget, changeOrigin: true, cookieDomainRewrite: 'localhost', headers: cfHeaders } },
    },
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, 'src') },
    },
  }
})
