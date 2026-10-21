export const RESEARCH_FIGURE_LOADERS = {
  'dataset-registry': () => import('../../components/DataAssetRegistry'),
  'cwru-signal': () => import('../../components/CwruSignal'),
  'fpcnn-compare': () => import('../../components/FPCnnCompare'),
  'domain-adapt': () => import('../../components/DomainAdapt'),
  'rul-sde-pf': () => import('../../components/RulSdePf'),
  'xjtu-rul': () => import('./figures/XjtuRul'),
  'digital-twin-phm': () => import('../../components/DigitalTwinPhm'),
  'self-evolution-loop': () => import('../../components/SelfEvolutionLoop'),
  'smart-factory': () => import('../../components/SmartFactory'),
  classification: () => import('./figures/ClassificationResearch'),
  steam: () => import('./figures/SteamResearch'),
  vision: () => import('./figures/VisionResearch'),
}
