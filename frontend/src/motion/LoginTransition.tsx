import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { DURATION } from './tokens'
import { sampleA, sampleB } from './loginTimeline'

type Phase =
  | 'boot'
  | 'intro'
  | 'ready'
  | 'auth-pending'
  | 'auth-success'
  | 'committed'
  | 'idle'

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

interface Snapshot {
  html: string
  rect: Rect
  brandHtml: string
  brandRect: Rect
  brandRatio: number
}

interface LoginTransitionValue {
  phase: Phase
  introDone: boolean
  reducedMotion: boolean
  playIntro: () => void
  beginSuccess: (target: string) => void
  resetForLogin: () => void
  markTargetReady: () => void
}

const LoginTransitionContext = createContext<LoginTransitionValue | null>(null)

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

function reducedMotion(): boolean {
  return (
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function captureForm(): Snapshot | null {
  const form = document.querySelector<HTMLElement>('.login-form')
  if (!form) return null
  const rect = form.getBoundingClientRect()
  const clone = form.cloneNode(true) as HTMLElement
  const originalInputs = Array.from(form.querySelectorAll('input'))
  clone.querySelectorAll('input').forEach((input, index) => {
    const original = originalInputs[index]
    if (!original) return
    input.setAttribute(
      'value',
      original.type === 'password' ? '••••••••' : original.value,
    )
    input.setAttribute('tabindex', '-1')
  })
  clone.querySelectorAll<HTMLElement>('[id]').forEach((element) => {
    element.removeAttribute('id')
  })
  clone.querySelectorAll<HTMLElement>('button, a, input').forEach((element) => {
    element.setAttribute('tabindex', '-1')
  })
  clone.setAttribute('aria-hidden', 'true')
  const brand = document.querySelector<HTMLElement>('.login-brand')
  const brandRect = brand?.getBoundingClientRect()
  const ratio = brandRect
    ? Math.min(1, Math.max(0.2, brandRect.width / innerWidth))
    : 0.545
  return {
    html: clone.outerHTML,
    rect: {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    },
    brandHtml: brand?.outerHTML ?? '',
    brandRect: brandRect
      ? {
          left: brandRect.left,
          top: brandRect.top,
          width: brandRect.width,
          height: brandRect.height,
        }
      : { left: 0, top: 0, width: innerWidth * ratio, height: innerHeight },
    brandRatio: ratio,
  }
}

export function LoginTransitionProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [phase, setPhase] = useState<Phase>(() =>
    location.pathname === '/login' ? 'boot' : 'idle',
  )
  const [introDone, setIntroDone] = useState(false)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [overlayVisible, setOverlayVisible] = useState(false)
  const reduced = useRef(reducedMotion()).current
  const introStarted = useRef(false)
  const beginStarted = useRef(false)
  const targetReady = useRef<(() => void) | null>(null)
  const readyPromise = useRef<Promise<void> | null>(null)
  const raf = useRef(0)
  const coverRef = useRef<HTMLDivElement>(null)
  const paperRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const bodyStyle = useRef<{ overflow: string; padding: string } | null>(null)
  const brandRatio = useRef(0.545)

  const finishIntro = useCallback(() => {
    cancelAnimationFrame(raf.current)
    document.documentElement.style.setProperty(
      '--login-a-right-inset',
      `${(1 - brandRatio.current) * 100}%`,
    )
    setIntroDone(true)
    setPhase('ready')
    try {
      sessionStorage.setItem('login:introPlayed', '1')
    } catch {
      /* ignore */
    }
  }, [])

  const playIntro = useCallback(() => {
    if (introStarted.current) return
    introStarted.current = true
    const played = (() => {
      try {
        return sessionStorage.getItem('login:introPlayed') === '1'
      } catch {
        return false
      }
    })()
    const mobile =
      typeof matchMedia === 'function' && matchMedia('(max-width: 780px)').matches
    const brand = document.querySelector<HTMLElement>('.login-brand')
    if (brand) {
      brandRatio.current = Math.min(
        1,
        Math.max(0.2, brand.getBoundingClientRect().width / innerWidth),
      )
    }
    if (reduced || played || mobile) {
      finishIntro()
      return
    }
    setPhase('intro')
    void (async () => {
      await Promise.race([
        document.fonts?.ready.catch(() => undefined),
        sleep(600),
      ])
      await nextFrame()
      await nextFrame()
      const duration = DURATION.loginReveal * 1000
      const start = performance.now()
      const step = (now: number) => {
        const progress = Math.min(1, (now - start) / duration)
        const frame = sampleA(progress, brandRatio.current)
        document.documentElement.style.setProperty(
          '--login-a-right-inset',
          `${frame.rightInset * 100}%`,
        )
        if (progress < 1) {
          raf.current = requestAnimationFrame(step)
        } else {
          finishIntro()
        }
      }
      raf.current = requestAnimationFrame(step)
    })()
  }, [finishIntro, reduced])

  const lockBody = useCallback(() => {
    if (bodyStyle.current) return
    const body = document.body
    bodyStyle.current = {
      overflow: body.style.overflow,
      padding: body.style.paddingRight,
    }
    const gap = innerWidth - document.documentElement.clientWidth
    body.style.overflow = 'hidden'
    if (gap > 0) body.style.paddingRight = `${gap}px`
  }, [])

  const unlockBody = useCallback(() => {
    if (!bodyStyle.current) return
    document.body.style.overflow = bodyStyle.current.overflow
    document.body.style.paddingRight = bodyStyle.current.padding
    bodyStyle.current = null
  }, [])

  const beginSuccess = useCallback(
    (target: string) => {
      if (beginStarted.current) return
      beginStarted.current = true
      if (reduced) {
        setPhase('committed')
        navigate(target, { replace: true })
        return
      }
      const captured = captureForm()
      if (!captured) {
        navigate(target, { replace: true })
        return
      }
      brandRatio.current = captured.brandRatio
      setSnapshot(captured)
      setOverlayVisible(true)
      setPhase('auth-pending')
      document.documentElement.style.setProperty(
        '--login-a-right-inset',
        `${(1 - captured.brandRatio) * 100}%`,
      )
      lockBody()
      readyPromise.current = new Promise<void>((resolve) => {
        targetReady.current = resolve
      })
      // 目标路由在遮罩下先挂载；预取工厂块降低白屏风险。
      void import('../features/factory/FactoryWorkspace').catch(() => undefined)
      navigate(target, { replace: true })
      void (async () => {
        await Promise.race([readyPromise.current, sleep(900)])
        await nextFrame()
        setPhase('auth-success')
        await nextFrame()
        const cover = coverRef.current
        const paper = paperRef.current
        const panel = panelRef.current
        const duration = DURATION.loginSuccess * 1000
        const start = performance.now()
        const step = (now: number) => {
          const progress = Math.min(1, (now - start) / duration)
          const frame = sampleB(progress, brandRatio.current)
          if (cover)
            cover.style.clipPath = `inset(0 ${frame.redRightInset * 100}% 0 0)`
          if (paper) paper.style.transform = `translateX(${frame.paperX * 100}%)`
          if (panel) {
            panel.style.transform = `scale(${frame.panelScale})`
            panel.style.clipPath = `inset(0 round ${frame.panelRadius}%)`
            panel.style.opacity = String(frame.panelOpacity)
          }
          if (progress < 1) {
            raf.current = requestAnimationFrame(step)
          } else {
            unlockBody()
            setOverlayVisible(false)
            setPhase('committed')
            document
              .getElementById('main-content')
              ?.focus({ preventScroll: true })
          }
        }
        raf.current = requestAnimationFrame(step)
      })()
    },
    [lockBody, navigate, reduced, unlockBody],
  )

  const markTargetReady = useCallback(() => {
    targetReady.current?.()
    targetReady.current = null
  }, [])

  const resetForLogin = useCallback(() => {
    beginStarted.current = false
    introStarted.current = false
    setIntroDone(false)
    setPhase('boot')
    setOverlayVisible(false)
    setSnapshot(null)
    document.documentElement.style.setProperty('--login-a-right-inset', '0%')
  }, [])

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current)
      unlockBody()
    },
    [unlockBody],
  )

  const value = useMemo<LoginTransitionValue>(
    () => ({
      phase,
      introDone,
      reducedMotion: reduced,
      playIntro,
      beginSuccess,
      resetForLogin,
      markTargetReady,
    }),
    [
      phase,
      introDone,
      reduced,
      playIntro,
      beginSuccess,
      resetForLogin,
      markTargetReady,
    ],
  )

  return (
    <LoginTransitionContext.Provider value={value}>
      {children}
      {snapshot && overlayVisible && (
        <div className="login-transition" aria-hidden="true">
          <div ref={paperRef} className="login-paper" />
          <div
            ref={coverRef}
            className="login-red-cover login-red-cover--global"
          >
            {snapshot.brandHtml && (
              <div
                className="login-red-brand"
                style={{
                  left: snapshot.brandRect.left,
                  top: snapshot.brandRect.top,
                  width: snapshot.brandRect.width,
                  height: snapshot.brandRect.height,
                }}
                dangerouslySetInnerHTML={{ __html: snapshot.brandHtml }}
              />
            )}
          </div>
          <div
            ref={panelRef}
            className="login-panel-layer"
            style={{
              left: snapshot.rect.left,
              top: snapshot.rect.top,
              width: snapshot.rect.width,
              height: snapshot.rect.height,
            }}
            dangerouslySetInnerHTML={{ __html: snapshot.html }}
          />
        </div>
      )}
    </LoginTransitionContext.Provider>
  )
}

export function useLoginTransition(): LoginTransitionValue {
  const value = useContext(LoginTransitionContext)
  if (!value)
    throw new Error('useLoginTransition must be used inside LoginTransitionProvider')
  return value
}

export function useLoginTransitionOptional(): LoginTransitionValue | null {
  return useContext(LoginTransitionContext)
}
