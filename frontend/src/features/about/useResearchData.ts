import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getClassification, getCwruSignal, getDatasetRegistry, getDomainAdapt, getFpCnnCompare,
  getPumpPhm, getRulSdePf, getSelfEvalLoops, getSmartFactory, getSteamAnalysis,
  getSteamMl, getVisionComparison, getXjtuRul,
} from '../../services/api'
import { errorText } from '../../hooks/useResource'
import { inspectEvidence, type EvidenceMap } from './dataContract'
import { ResearchRequestCache, researchSources } from './researchRequests'

const LOADERS = {
  'dataset-registry': getDatasetRegistry, 'cwru-signal': getCwruSignal,
  'fpcnn-compare': getFpCnnCompare, 'domain-adapt': getDomainAdapt,
  'rul-sde-pf': getRulSdePf, 'xjtu-rul': getXjtuRul, 'digital-twin-phm': getPumpPhm,
  'self-evolution-loop': getSelfEvalLoops, 'smart-factory': getSmartFactory,
  classification: getClassification, steam: getSteamMl, 'steam-analysis': getSteamAnalysis, vision: getVisionComparison,
}
export function useResearchData(includeRuntime = false) {
  // No global payload cache: public and authenticated article instances never share data.
  const scope = includeRuntime ? localStorage.getItem('token') ?? 'public' : 'public'
  const cache = useMemo(() => new ResearchRequestCache(), [scope])
  const [state, setState] = useState<{ scope: string; evidence: EvidenceMap }>({ scope, evidence: {} })
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let active = true
    const sources = researchSources(includeRuntime)
    const initial: EvidenceMap = Object.fromEntries(sources.map(source => [source, { status: 'loading' }]))
    if (!includeRuntime) initial['self-evolution-loop'] = { status: 'missing', message: '运行统计需登录后查看；公开文章仅提供机制说明。' }
    setState({ scope, evidence: initial })
    for (const source of sources) {
      void cache.read(source, async () => {
        try { return inspectEvidence(source, await LOADERS[source]()) }
        catch (error) { return { status: 'error', message: errorText(error) } }
      }).then(entry => {
        if (active) setState(current => ({ scope, evidence: { ...current.evidence, [source]: entry } }))
      })
    }
    return () => { active = false }
  }, [version, scope, cache, includeRuntime])
  const refresh = useCallback(() => { cache.clear(); setVersion(value => value + 1) }, [cache])
  return { evidence: state.scope === scope ? state.evidence : {}, refresh }
}
