import { useEffect } from 'react'
import { useLoginTransitionOptional } from './LoginTransition'

/** 目标路由真正挂载后再让登录遮罩开始揭幕，避免白屏。 */
export default function RouteReady() {
  const transition = useLoginTransitionOptional()
  useEffect(() => {
    transition?.markTargetReady()
  }, [transition])
  return null
}
