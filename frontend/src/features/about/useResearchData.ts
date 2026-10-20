import { useEffect, useState } from 'react'
import {
  getClassification, getCwruSignal, getDatasetRegistry, getDomainAdapt, getFpCnnCompare,
  getPumpPhm, getRulSdePf, getSelfEvalLoops, getSmartFactory, getSteamAnalysis,
  getSteamMl, getVisionComparison, getXjtuRul,
} from '../../services/api'
import { errorText } from '../../hooks/useResource'
import { inspectEvidence, type EvidenceMap } from './dataContract'

const LOADERS = {
  'dataset-registry': getDatasetRegistry, 'cwru-signal': getCwruSignal,
  'fpcnn-compare': getFpCnnCompare, 'domain-adapt': getDomainAdapt,
  'rul-sde-pf': getRulSdePf, 'xjtu-rul': getXjtuRul, 'digital-twin-phm': getPumpPhm,
  'self-evolution-loop': getSelfEvalLoops, 'smart-factory': getSmartFactory,
  classification: getClassification, steam: getSteamMl, 'steam-analysis': getSteamAnalysis, vision: getVisionComparison,
}
export function useResearchData() {
  const [evidence, setEvidence] = useState<EvidenceMap>({})
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let active = true
    // Resolve each source independently: missing vision assets or login-only runtime metrics must not hide public experiments.
    for (const [key, load] of Object.entries(LOADERS)) {
      const source = key as keyof typeof LOADERS
      setEvidence(current => ({ ...current, [source]: { ...current[source], status: 'loading' } }))
      void load().then(
        payload => { if (active) setEvidence(current => ({ ...current, [source]: inspectEvidence(source, payload) })) },
        error => { if (active) setEvidence(current => ({ ...current, [source]: { status: 'error', message: errorText(error) } })) },
      )
    }
    return () => { active = false }
  }, [version])
  return { evidence, refresh: () => setVersion(value => value + 1) }
}
