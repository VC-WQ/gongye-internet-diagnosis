import { useState } from 'react'
import { Button, Card, Form, Input, Tabs, message } from 'antd'
import { useNavigate } from 'react-router-dom'
import { login, register } from '../../services/api'

export default function Login() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)

  const submit = async (values: { username: string; password: string }, isRegister: boolean) => {
    setLoading(true)
    try {
      const data = isRegister
        ? await register(values.username, values.password)
        : await login(values.username, values.password)
      localStorage.setItem('token', data.token)
      localStorage.setItem('user', JSON.stringify(data.user))
      message.success(isRegister ? '注册成功，已登录' : '登录成功')
      navigate('/dashboard')
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      message.error(err?.response?.data?.detail ?? '操作失败')
    } finally {
      setLoading(false)
    }
  }

  const form = (isRegister: boolean) => (
    <Form layout="vertical" onFinish={(v) => submit(v, isRegister)}>
      <Form.Item name="username" label="用户名" rules={[{ required: true, min: 3, message: '用户名至少 3 位' }]}>
        <Input placeholder="请输入用户名" />
      </Form.Item>
      <Form.Item name="password" label="密码" rules={[{ required: true, min: 6, message: '密码至少 6 位' }]}>
        <Input.Password placeholder="请输入密码" />
      </Form.Item>
      <Button type="primary" htmlType="submit" block loading={loading}>
        {isRegister ? '注册并登录' : '登录'}
      </Button>
    </Form>
  )

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
      <Card style={{ width: 400 }}>
        <div style={{ textAlign: 'center', fontSize: 18, fontWeight: 700, color: '#22d3ee', marginBottom: 16 }}>
          工业设备智能诊断系统
        </div>
        <Tabs
          items={[
            { key: 'login', label: '登录', children: form(false) },
            { key: 'register', label: '注册', children: form(true) },
          ]}
        />
        <div style={{ color: '#94a3b8', fontSize: 12, textAlign: 'center' }}>
          默认管理员：admin / admin123
        </div>
      </Card>
    </div>
  )
}