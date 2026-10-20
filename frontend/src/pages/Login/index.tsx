import { useEffect, useState } from 'react'
import { Button, Form, Input, Tabs, message } from 'antd'
import { useLocation } from 'react-router-dom'
import { login, register } from '../../services/api'
import { errorText } from '../../hooks/useResource'
import { useLoginTransition } from '../../motion/LoginTransition'

export default function Login() {
  const location = useLocation()
  const transition = useLoginTransition()
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    transition.resetForLogin()
    const frame = requestAnimationFrame(() => transition.playIntro())
    return () => cancelAnimationFrame(frame)
    // 只在登录页挂载时启动一次；StrictMode 下第二次挂载会重新调度。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = async (
    values: { username: string; password: string },
    isRegister: boolean,
  ) => {
    if (loading || !transition.introDone) return
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
      const safe =
        target.startsWith('/') &&
        !target.startsWith('//') &&
        !target.startsWith('/login')
          ? target
          : '/dashboard'
      transition.beginSuccess(safe)
    } catch (error) {
      message.error(errorText(error))
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
      <Button
        type="primary"
        htmlType="submit"
        block
        loading={loading}
        disabled={!transition.introDone}
      >
        {isRegister ? '注册并登录' : '登录'}
      </Button>
    </Form>
  )

  return (
    <main
      className={`login-page ${transition.introDone ? 'is-ready' : 'is-intro'}`}
      data-login-phase={transition.phase}
      data-intro={transition.introDone ? 'done' : 'running'}
    >
      <div className="login-red-cover" aria-hidden />
      <section className="login-brand">
        <div className="login-brand__content">
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
        </div>
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
