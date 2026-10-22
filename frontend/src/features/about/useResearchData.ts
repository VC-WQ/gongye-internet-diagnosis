import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getClassification, getCwruSignal, getDatasetRegistry, getDomainAdapt, getFpCnnCompare,
  getPumpPhm, getRulSdePf, getSelfEvalLoops, getSmartFactory, getSteamAnalysis,
  getSteamMl, getVisionComparison, getXjtuRul,
} from '../../services/api'
import { errorText } from '../../hooks/useResource'
import { inspectEvidence, type EvidenceMap } from './dataContract'
import { ResearchRequestCache, researchSources, type ResearchSource } from './researchRequests'

const LOADERS = {
  'dataset-registry': getDatasetRegistry, 'cwru-signal': getCwruSignal,
  'fpcnn-compare': getFpCnnCompare, 'domain-adapt': getDomainAdapt,
  'rul-sde-pf': getRulSdePf, 'xjtu-rul': getXjtuRul, 'digital-twin-phm': getPumpPhm,
  'self-evolution-loop': getSelfEvalLoops, 'smart-factory': getSmartFactory,
  classification: getClassification, steam: getSteamMl, 'steam-analysis': getSteamAnalysis, vision: getVisionComparison,
}
export function useResearchData(includeRuntime = false, wanted: readonly ResearchSource[] = []) {
  const scope = includeRuntime ? localStorage.getItem('token') ?? 'public' : 'public'
  const cache = useMemo(() => new ResearchRequestCache(), [scope])
  const requested = useMemo(() => new Set<ResearchSource>(), [cache])
  const [state, setState] = useState<{ scope: string; evidence: EvidenceMap }>({ scope, evidence: {} })
  const live = useRef(true), revision = useRef(0), currentScope = useRef(scope)
  currentScope.current = scope
  useEffect(() => { live.current=true; return () => { live.current=false } }, [cache])
  const ensure = useCallback((sources: readonly ResearchSource[]) => {
    const allowed=researchSources(includeRuntime)
    const valid=[...new Set(sources)].filter(source=>allowed.includes(source))
    valid.forEach(source=>requested.add(source))
    const generation=revision.current
    setState(current=>{
      const evidence=current.scope===scope?current.evidence:{}
      const missing=valid.filter(source=>!evidence[source])
      if(current.scope===scope&&!missing.length)return current
      return {scope,evidence:{...evidence,...Object.fromEntries(missing.map(source=>[source,{status:'loading'}]))}}
    })
    for(const source of valid)void cache.read(source,async()=>{
      try{return inspectEvidence(source,await LOADERS[source]())}
      catch(error){return {status:'error',message:errorText(error)}}
    }).then(entry=>{
      if(!live.current||currentScope.current!==scope||generation!==revision.current)return
      setState(current=>current.scope===scope&&current.evidence[source]===entry?current:{scope,evidence:{...(current.scope===scope?current.evidence:{}),[source]:entry}})
    })
  },[cache,requested,includeRuntime,scope])
  const key=wanted.join(',')
  useEffect(()=>{ensure(key?key.split(',') as ResearchSource[]:[])},[ensure,key])
  const refresh=useCallback(()=>{
    revision.current++;cache.clear();setState({scope,evidence:{}});ensure([...requested])
  },[cache,scope,ensure,requested])
  return { evidence: state.scope===scope?state.evidence:{}, refresh, ensure }
}
