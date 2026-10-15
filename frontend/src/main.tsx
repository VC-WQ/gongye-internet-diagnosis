import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App'
import { registerTechDarkTheme } from './theme/echarts'
import './index.css'

// 深色科技大屏：注册 ECharts 深色主题
registerTechDarkTheme()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        // 真实暗色算法：一次翻转所有 Antd 组件（菜单/卡片/表格/下拉/表单等）
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#22d3ee',
          colorInfo: '#22d3ee',
          colorLink: '#22d3ee',
          // 蓝色调的暗底，替代 Antd 默认的中性灰黑
          colorBgBase: '#0b1220',
          colorBgContainer: '#111a2e',
          colorBgElevated: '#18233a',
          colorBgLayout: 'transparent',
          colorBorder: '#26324a',
          colorBorderSecondary: '#1c2840',
          colorText: '#e6edf7',
          colorTextSecondary: '#9aa8bd',
          colorTextTertiary: '#78879b',
          borderRadius: 8,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
        },
      }}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConfigProvider>
  </React.StrictMode>,
)