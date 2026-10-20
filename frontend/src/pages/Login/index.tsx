import { useSpatialNavigate } from '../../hooks/useSpatialNavigate'
import { useState } from 'react'
import { Button, Form, Input, Tabs, message } from 'antd'
import { useLocation } from 'react-router-dom'
import { login, register } from '../../services/api'
import { errorText } from '../../hooks/useResource'
export default function Login() {
  const navigate = useSpatialNavigate()
  const location = useLocation()
  const [loading, setLoading] = useState(false)
  const submit = async (
    values: { username: string; password: string },
    isRegister: boolean,
  ) => {
    setLoading(true)
    try {
      const data = await (isRegister ? register : login)(
        values.username,
        values.password,
      )
      localStorage.setItem('token', data.token)
      localStorage.setItem('user', JSON.stringify(data.user))
      const target =
        (location.state as { returnTo?: string } | null)?.returnTo ??
        sessionStorage.getItem('auth:returnTo') ??
        '/dashboard'
      sessionStorage.removeItem('auth:returnTo')
      navigate(
        target.startsWith('/') &&
          !target.startsWith('//') &&
          !target.startsWith('/login')
          ? target
          : '/dashboard',
        { replace: true },
      )
    } catch (error) {
      message.error(errorText(error))
    } finally {
      setLoading(false)
    }
  }
  const form = (isRegister: boolean) => (
    <Form layout="vertical" onFinish={(values) => submit(values, isRegister)}>
      <Form.Item
        name="username"
        label="用户名"
        rules={[{ required: true, min: 3, message: '用户名至少 3 位' }]}
      >
        <Input autoComplete="username" placeholder="请输入用户名" />
      </Form.Item>
      <Form.Item
        name="password"
        label="密码"
        rules={[{ required: true, min: 6, message: '密码至少 6 位' }]}
      >
        <Input.Password
          autoComplete={isRegister ? 'new-password' : 'current-password'}
          placeholder="请输入密码"
        />
      </Form.Item>
      <Button type="primary" htmlType="submit" block loading={loading}>
        {isRegister ? '注册并登录' : '登录'}
      </Button>
    </Form>
  )
  return (
    <main className="login-page">
      <section className="login-brand">
        <div className="brand-mark" aria-hidden>
          <i />
          <i />
          <i />
        </div>
        <div>
          <h1>
            设备状态，
            <br />
            清晰可见。
          </h1>
          <div className="login-graphic" aria-hidden>
            <i />
            <i />
            <i />
          </div>
        </div>
        <small>工业设备智能诊断平台</small>
      </section>
      <section className="login-form">
        <div className="login-form-inner">
          <h2>登录工作空间</h2>
          <Tabs
            destroyOnHidden
            items={[
              { key: 'login', label: '登录', children: form(false) },
              { key: 'register', label: '注册', children: form(true) },
            ]}
          />
          <div className="login-footer">工业设备智能诊断平台</div>
        </div>
      </section>
    </main>
  )
}
