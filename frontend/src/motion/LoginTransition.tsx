import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react'
import { flushSync } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { useUiPreferences } from '../services/uiPrefs'
import { DURATION, LOGIN_SEQUENCE } from './tokens'
import { panelInsets, sampleA, sampleB, sampleC } from './loginTimeline'
import './login.css'

type Phase = 'boot' | 'intro' | 'ready' | 'auth-pending' | 'auth-success' | 'committed' | 'logout-preparing' | 'logout-return' | 'idle'
interface Rect { left: number; top: number; width: number; height: number }
interface Snapshot { html: string; rect: Rect; brandHtml: string; brandRect: Rect; viewportWidth: number }
type EntranceClient = (elapsed: number) => void
interface LoginTransitionValue {
  phase: Phase
  introDone: boolean
  reducedMotion: boolean
  playIntro: () => void
  cancelIntro: () => void
  beginSuccess: (target: string) => void
  beginLogout: (invalidateSession: () => void) => void
  prepareLogoutReturn: () => boolean
  resetForLogin: () => void
  markTargetReady: () => void
  /** -1 means prepared beneath the cover; elapsed ms comes from the cover's RAF. */
  subscribeEntrance: (client: EntranceClient) => () => void
}
const LoginTransitionContext = createContext<LoginTransitionValue | null>(null)

function cloneSafe(node: HTMLElement): string {
  const clone = node.cloneNode(true) as HTMLElement
  const inputs = Array.from(node.querySelectorAll('input'))
  clone.querySelectorAll('input').forEach((input, index) => {
    const original = inputs[index]
    if (original) input.setAttribute('value', original.type === 'password' ? '••••••••' : original.value)
  })
  clone.removeAttribute('id')
  clone.querySelectorAll<HTMLElement>('[id]').forEach((item) => item.removeAttribute('id'))
  clone.querySelectorAll<HTMLElement>('button, a, input, [tabindex]').forEach((item) => item.setAttribute('tabindex', '-1'))
  clone.setAttribute('aria-hidden', 'true')
  clone.setAttribute('inert', '')
  return clone.outerHTML
}
function rectOf(node: HTMLElement): Rect {
  const { left, top, width, height } = node.getBoundingClientRect()
  return { left, top, width, height }
}
function captureForm(): Snapshot | null {
  const panel = document.querySelector<HTMLElement>('.login-form-inner')
  const brand = document.querySelector<HTMLElement>('.login-brand')
  if (!panel || !brand) return null
  return {
    html: cloneSafe(panel), rect: rectOf(panel),
    brandHtml: cloneSafe(brand), brandRect: rectOf(brand), viewportWidth: innerWidth,
  }
}

export function LoginTransitionProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { reducedMotion } = useUiPreferences()
  const reducedRef = useRef(reducedMotion)
  reducedRef.current = reducedMotion
  const [phase, setPhase] = useState<Phase>(() => location.pathname === '/login' ? 'boot' : 'idle')
  const phaseRef = useRef(phase)
  const [introDone, setIntroDone] = useState(false)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [overlayVisible, setOverlayVisible] = useState(false)
  const [logoutMode, setLogoutMode] = useState(false)
  const [waiting, setWaiting] = useState<'quiet' | 'loading' | 'help'>('quiet')
  const introStarted = useRef(false)
  const beginStarted = useRef(false)
  const introEpoch = useRef(0)
  const successEpoch = useRef(0)
  const logoutEpoch = useRef(0)
  const logoutStarted = useRef(false)
  const logoutSkipAnimation = useRef(false)
  const introRaf = useRef(0)
  const successRaf = useRef(0)
  const logoutRaf = useRef(0)
  const preparationFrames = useRef(new Set<number>())
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const targetReady = useRef<(() => void) | null>(null)
  const coverRef = useRef<HTMLDivElement>(null)
  const paperRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const bodyStyle = useRef<{ overflow: string; padding: string } | null>(null)
  const clients = useRef(new Set<EntranceClient>())
  const elapsedRef = useRef<number | undefined>()

  const stage = useCallback((next: Phase) => {
    phaseRef.current = next
    document.documentElement.dataset.loginTransition = next
    setPhase(next)
  }, [])
  const publish = useCallback((elapsed: number) => {
    elapsedRef.current = elapsed
    for (const client of clients.current) client(elapsed)
  }, [])
  const subscribeEntrance = useCallback((client: EntranceClient) => {
    clients.current.add(client)
    if (elapsedRef.current !== undefined) client(elapsedRef.current)
    return () => { clients.current.delete(client) }
  }, [])
  const delay = useCallback((duration: number) => new Promise<void>((resolve) => {
    const timer = setTimeout(() => { timers.current.delete(timer); resolve() }, duration)
    timers.current.add(timer)
  }), [])
  const nextFrame = useCallback(() => new Promise<void>((resolve) => {
    const id = requestAnimationFrame(() => { preparationFrames.current.delete(id); resolve() })
    preparationFrames.current.add(id)
  }), [])
  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout)
    timers.current.clear()
  }, [])
  const unlockBody = useCallback(() => {
    if (!bodyStyle.current) return
    document.body.style.overflow = bodyStyle.current.overflow
    document.body.style.paddingRight = bodyStyle.current.padding
    bodyStyle.current = null
  }, [])
  const lockBody = useCallback(() => {
    if (bodyStyle.current) return
    const body = document.body
    bodyStyle.current = { overflow: body.style.overflow, padding: body.style.paddingRight }
    const gap = Math.max(0, innerWidth - document.documentElement.clientWidth)
    body.style.overflow = 'hidden'
    if (gap) body.style.paddingRight = `${gap}px`
  }, [])
  const finishIntro = useCallback(() => {
    cancelAnimationFrame(introRaf.current)
    const cover = document.querySelector<HTMLElement>('[data-login-intro-cover]')
    if (cover) { cover.style.transform = 'translateX(-100vw)'; cover.style.visibility = 'hidden' }
    setIntroDone(true)
    stage('ready')
  }, [stage])
  const cancelIntro = useCallback(() => {
    introEpoch.current += 1
    cancelAnimationFrame(introRaf.current)
  }, [])
  const resetForLogin = useCallback(() => {
    cancelIntro()
    successEpoch.current += 1
    cancelAnimationFrame(successRaf.current)
    logoutEpoch.current += 1
    cancelAnimationFrame(logoutRaf.current)
    logoutStarted.current = false
    clearTimers()
    unlockBody()
    targetReady.current = null
    beginStarted.current = false
    introStarted.current = false
    elapsedRef.current = undefined
    setIntroDone(false)
    setOverlayVisible(false)
    setLogoutMode(false)
    setSnapshot(null)
    setWaiting('quiet')
    stage('boot')
  }, [cancelIntro, clearTimers, stage, unlockBody])
  const playIntro = useCallback(() => {
    if (introStarted.current) return
    introStarted.current = true
    const epoch = ++introEpoch.current
    if (reducedRef.current) { finishIntro(); return }
    stage('intro')
    const cover = document.querySelector<HTMLElement>('[data-login-intro-cover]')
    const form = document.querySelector<HTMLElement>('.login-form')
    const brand = document.querySelector<HTMLElement>('.login-brand')
    if (!cover || !form || !brand) { finishIntro(); return }
    cover.style.visibility = 'visible'
    cover.style.transform = 'translateX(0)'
    const measure = () => {
      const mobile = matchMedia('(max-width: 780px)').matches
      cover.style.top = mobile ? `${form.offsetTop}px` : '0px'
      const travel = mobile ? innerWidth : Math.max(0, innerWidth - brand.getBoundingClientRect().width)
      return travel
    }
    measure()
    void (async () => {
      await Promise.race([document.fonts?.ready.catch(() => undefined), delay(600)])
      if (epoch !== introEpoch.current) return
      await nextFrame()
      if (epoch !== introEpoch.current) return
      const start = performance.now()
      const step = (now: number) => {
        if (epoch !== introEpoch.current) return
        if (reducedRef.current) { finishIntro(); return }
        const frame = sampleA((now - start) / (DURATION.loginReveal * 1000))
        cover.style.transform = `translateX(${frame.redX * measure()}px)`
        cover.dataset.loginProgress = frame.progress.toFixed(4)
        if (!frame.done) introRaf.current = requestAnimationFrame(step)
        else finishIntro()
      }
      introRaf.current = requestAnimationFrame(step)
    })()
  }, [delay, finishIntro, nextFrame, stage])

  const finishSuccess = useCallback(() => {
    cancelAnimationFrame(successRaf.current)
    clearTimers()
    publish(DURATION.loginSuccess * 1000)
    unlockBody()
    setOverlayVisible(false)
    setSnapshot(null)
    stage('committed')
    document.getElementById('main-content')?.focus({ preventScroll: true })
  }, [clearTimers, publish, stage, unlockBody])
  const beginSuccess = useCallback((target: string) => {
    if (beginStarted.current) return
    beginStarted.current = true
    cancelIntro()
    const epoch = ++successEpoch.current
    const captured = captureForm()
    if (reducedRef.current || !captured) {
      stage('committed')
      publish(DURATION.loginSuccess * 1000)
      navigate(target, { replace: true })
      return
    }
    // Commit the protective snapshot before replacing the login route.
    flushSync(() => {
      setLogoutMode(false)
      setSnapshot(captured)
      setOverlayVisible(true)
      setWaiting('quiet')
      stage('auth-pending')
    })
    lockBody()
    publish(-1)
    const ready = new Promise<void>((resolve) => { targetReady.current = resolve })
    void import('../features/factory/FactoryWorkspace').catch(() => undefined)
    navigate(target, { replace: true })
    for (const [duration, state] of [[LOGIN_SEQUENCE.waitingNotice, 'loading'], [LOGIN_SEQUENCE.waitingHelp, 'help']] as const) {
      const timer = setTimeout(() => {
        timers.current.delete(timer)
        if (epoch === successEpoch.current && phaseRef.current === 'auth-pending') setWaiting(state)
      }, duration)
      timers.current.add(timer)
    }
    void (async () => {
      // RouteReady is a real mounted route signal. A timeout never fakes readiness.
      await ready
      if (epoch !== successEpoch.current) return
      clearTimers()
      await nextFrame()
      if (epoch !== successEpoch.current) return
      if (reducedRef.current) { finishSuccess(); return }
      const geometry = {
        viewportWidth: captured.viewportWidth,
        redTravel: Math.max(1, captured.brandRect.left + captured.brandRect.width),
      }
      const start = performance.now()
      setWaiting('quiet')
      stage('auth-success')
      publish(0)
      const step = (now: number) => {
        if (epoch !== successEpoch.current) return
        if (reducedRef.current) { finishSuccess(); return }
        const elapsed = Math.min(DURATION.loginSuccess * 1000, now - start)
        const frame = sampleB(elapsed, geometry)
        if (coverRef.current) {
          coverRef.current.style.transform = `translateX(${frame.redX}px)`
          coverRef.current.style.visibility = frame.redDone ? 'hidden' : 'visible'
          coverRef.current.dataset.loginProgress = frame.redProgress.toFixed(4)
        }
        if (paperRef.current) {
          paperRef.current.style.transform = `translateX(${frame.paperX}px)`
          paperRef.current.dataset.loginProgress = frame.paperProgress.toFixed(4)
        }
        if (panelRef.current) {
          const inset = panelInsets(frame.panelProgress, captured.rect.width, captured.rect.height)
          panelRef.current.style.transform = `scale(${frame.panelScale})`
          panelRef.current.style.clipPath = `inset(${inset.y}% ${inset.x}% round ${frame.panelRadius}%)`
          panelRef.current.style.opacity = String(frame.panelOpacity)
          panelRef.current.style.visibility = frame.panelDone ? 'hidden' : 'visible'
          panelRef.current.dataset.loginProgress = frame.panelProgress.toFixed(4)
        }
        publish(elapsed)
        if (!frame.paperDone) successRaf.current = requestAnimationFrame(step)
        else finishSuccess()
      }
      successRaf.current = requestAnimationFrame(step)
    })()
  }, [cancelIntro, clearTimers, finishSuccess, lockBody, navigate, nextFrame, publish, stage])

  const finishLogout = useCallback(() => {
    cancelAnimationFrame(logoutRaf.current)
    clearTimers()
    unlockBody()
    introStarted.current = true
    beginStarted.current = false
    setIntroDone(true)
    setOverlayVisible(false)
    setLogoutMode(false)
    setSnapshot(null)
    setWaiting('quiet')
    stage('ready')
    document.querySelector<HTMLInputElement>('.login-form-inner input')?.focus({ preventScroll: true })
  }, [clearTimers, stage, unlockBody])

  const prepareLogoutReturn = useCallback(() => {
    if (phaseRef.current !== 'logout-preparing' && phaseRef.current !== 'logout-return') return false
    // Login's layout effect can run twice in StrictMode. Only one C owns the DOM.
    if (logoutStarted.current) return true
    const captured = captureForm()
    if (!captured) return true
    logoutStarted.current = true
    const epoch = logoutEpoch.current
    clearTimers()
    setSnapshot(captured)
    setWaiting('quiet')
    void (async () => {
      await nextFrame()
      if (epoch !== logoutEpoch.current) return
      if (reducedRef.current || logoutSkipAnimation.current) { finishLogout(); return }
      const geometry = {
        viewportWidth: captured.viewportWidth,
        redTravel: captured.brandRect.left + captured.brandRect.width,
      }
      const start = performance.now()
      stage('logout-return')
      const step = (now: number) => {
        if (epoch !== logoutEpoch.current) return
        if (reducedRef.current || logoutSkipAnimation.current) { finishLogout(); return }
        const elapsed = Math.min(DURATION.logoutReturn * 1000, now - start)
        const frame = sampleC(elapsed, geometry)
        if (paperRef.current) {
          paperRef.current.style.transform = `translateX(${frame.paperX}px)`
          paperRef.current.dataset.loginProgress = frame.paperProgress.toFixed(4)
        }
        if (coverRef.current) {
          coverRef.current.style.transform = `translateX(${frame.redX}px)`
          coverRef.current.style.visibility = 'visible'
          coverRef.current.dataset.loginProgress = frame.redProgress.toFixed(4)
        }
        if (panelRef.current) {
          const inset = panelInsets(1 - frame.panelProgress, captured.rect.width, captured.rect.height)
          panelRef.current.style.transform = `scale(${frame.panelScale})`
          panelRef.current.style.clipPath = `inset(${inset.y}% ${inset.x}% round ${frame.panelRadius}%)`
          panelRef.current.style.opacity = String(frame.panelOpacity)
          panelRef.current.style.visibility = 'visible'
          panelRef.current.dataset.loginProgress = frame.panelProgress.toFixed(4)
        }
        if (!frame.done) logoutRaf.current = requestAnimationFrame(step)
        else finishLogout()
      }
      logoutRaf.current = requestAnimationFrame(step)
    })()
    return true
  }, [clearTimers, finishLogout, nextFrame, stage])

  const beginLogout = useCallback((invalidateSession: () => void) => {
    if (phaseRef.current === 'logout-preparing' || phaseRef.current === 'logout-return') return
    // Auth has priority over any private-page browser snapshot. The one global
    // document coordinator consumes this event and invalidates old visual work.
    document.dispatchEvent(new Event('workspace:auth-transition'))
    cancelIntro()
    successEpoch.current += 1
    logoutEpoch.current += 1
    cancelAnimationFrame(successRaf.current)
    cancelAnimationFrame(logoutRaf.current)
    clearTimers()
    targetReady.current = null
    logoutStarted.current = false
    logoutSkipAnimation.current = reducedRef.current
    elapsedRef.current = undefined
    lockBody()
    // This cover contains only brand colours. No protected DOM is cloned.
    flushSync(() => {
      setSnapshot(null)
      setLogoutMode(true)
      setOverlayVisible(true)
      setIntroDone(false)
      setWaiting('quiet')
      stage('logout-preparing')
    })
    invalidateSession()
    // Raw Router navigation deliberately bypasses page snapshot transitions.
    flushSync(() => navigate('/login', { replace: true, state: { logoutReturn: true } }))
    const epoch = logoutEpoch.current
    for (const [duration, state] of [[LOGIN_SEQUENCE.waitingNotice, 'loading'], [LOGIN_SEQUENCE.waitingHelp, 'help']] as const) {
      const timer = setTimeout(() => {
        timers.current.delete(timer)
        if (epoch === logoutEpoch.current && phaseRef.current === 'logout-preparing') setWaiting(state)
      }, duration)
      timers.current.add(timer)
    }
  }, [cancelIntro, clearTimers, lockBody, navigate, stage])
  const markTargetReady = useCallback(() => { targetReady.current?.(); targetReady.current = null }, [])
  const returnToLogin = () => {
    resetForLogin()
    navigate('/login', { replace: true })
  }
  useEffect(() => {
    if (reducedMotion && phaseRef.current === 'intro') finishIntro()
    if (reducedMotion && phaseRef.current === 'auth-success') finishSuccess()
    if (reducedMotion && phaseRef.current === 'logout-preparing') logoutSkipAnimation.current = true
    if (reducedMotion && phaseRef.current === 'logout-return') finishLogout()
  }, [reducedMotion, finishIntro, finishSuccess, finishLogout])
  useEffect(() => {
    const resized = () => {
      if (phaseRef.current === 'auth-success') finishSuccess()
      if (phaseRef.current === 'logout-preparing') logoutSkipAnimation.current = true
      if (phaseRef.current === 'logout-return') finishLogout()
    }
    window.addEventListener('resize', resized)
    return () => window.removeEventListener('resize', resized)
  }, [finishSuccess, finishLogout])
  useEffect(() => {
    if (location.pathname === '/login' || !['logout-preparing', 'logout-return'].includes(phaseRef.current)) return
    logoutEpoch.current += 1
    cancelAnimationFrame(logoutRaf.current)
    clearTimers()
    unlockBody()
    setOverlayVisible(false)
    setLogoutMode(false)
    setSnapshot(null)
    stage('idle')
  }, [location.key, location.pathname, clearTimers, stage, unlockBody])
  useEffect(() => () => {
    introEpoch.current += 1
    successEpoch.current += 1
    logoutEpoch.current += 1
    cancelAnimationFrame(introRaf.current)
    cancelAnimationFrame(successRaf.current)
    cancelAnimationFrame(logoutRaf.current)
    preparationFrames.current.forEach(cancelAnimationFrame)
    preparationFrames.current.clear()
    clearTimers()
    unlockBody()
    delete document.documentElement.dataset.loginTransition
  }, [clearTimers, unlockBody])
  const value = useMemo<LoginTransitionValue>(() => ({
    phase, introDone, reducedMotion, playIntro, cancelIntro, beginSuccess, beginLogout, prepareLogoutReturn,
    resetForLogin, markTargetReady, subscribeEntrance,
  }), [phase, introDone, reducedMotion, playIntro, cancelIntro, beginSuccess, beginLogout, prepareLogoutReturn, resetForLogin, markTargetReady, subscribeEntrance])
  return (
    <LoginTransitionContext.Provider value={value}>
      {children}
      {overlayVisible && (snapshot || logoutMode) && (
        <div className={`login-transition${logoutMode ? ' login-transition--logout' : ''}`}
          data-login-success={!logoutMode ? phase : undefined} data-login-logout={logoutMode ? phase : undefined}>
          <div className="login-transition__visual" aria-hidden="true">
            <div ref={paperRef} className="login-paper" />
            {snapshot && <><div ref={coverRef} className="login-red-block" style={{
              left: snapshot.brandRect.left, top: snapshot.brandRect.top,
              width: snapshot.brandRect.width, height: snapshot.brandRect.height,
            }} dangerouslySetInnerHTML={{ __html: snapshot.brandHtml }} />
            <div ref={panelRef} className="login-panel-layer" style={snapshot.rect}
              dangerouslySetInnerHTML={{ __html: snapshot.html }} /></>}
          </div>
          {waiting !== 'quiet' && (
            <div className="login-transition__waiting" role="status">
              <p>{waiting === 'help' ? '目标页面暂未准备完成，可重试或返回登录。' : logoutMode ? '身份已退出，正在准备登录页面…' : '登录已验证，正在准备工作空间…'}</p>
              {waiting === 'help' && <div>
                <button type="button" onClick={() => window.location.reload()}>重试目标页面</button>
                <button type="button" onClick={returnToLogin}>返回登录</button>
              </div>}
            </div>
          )}
        </div>
      )}
    </LoginTransitionContext.Provider>
  )
}
export function useLoginTransition(): LoginTransitionValue {
  const value = useContext(LoginTransitionContext)
  if (!value) throw new Error('useLoginTransition must be used inside LoginTransitionProvider')
  return value
}
export function useLoginTransitionOptional(): LoginTransitionValue | null { return useContext(LoginTransitionContext) }
