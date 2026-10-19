import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_')
  return {
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      // 开发环境将 /api 请求代理到后端
      '/api': {
        target: env.VITE_API_PROXY || 'http://localhost:8000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
}
})
