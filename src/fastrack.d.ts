interface LapSummary {
  id: string
  path: string
  name: string
  car: string
  track: string
  date: string
  lapTime: number
  lapTimes?: number[]
  fastestLapIndex?: number
  hasSidecar: boolean
  error?: boolean
}

interface LapSample {
  distance: number
  time: number
  speed: number
  throttle: number
  brake: number
  x: number | null
  y: number | null
}

interface ParsedLap extends LapSummary {
  driver: string
  samples: LapSample[]
  channels: { name: string; unit: string }[]
  lapIndex: number
  fastestLapIndex: number
  lapTimes: number[]
  hasPosition: boolean
  positionSource: 'measured' | 'estimated' | 'none'
  hasDistance: boolean
  hasThrottle: boolean
  hasBrake: boolean
}

interface Preferences {
  preferredPath: string
  preferredLapIndex?: number
  overrides?: Record<string, string>
}

interface PedalReading { you: number; ref: number; warn?: number }

interface LiveLateral {
  status: 'ok' | 'calibrating' | 'unavailable'
  offsetM?: number
  ahead?: { x: number; y: number }[]
  progress?: number
  reason?: 'lap' | 'fit' | 'direction'
}

interface LiveFrame {
  state: 'active' | 'paused' | 'noReference'
  throttle?: PedalReading
  brake?: PedalReading
  lateral?: LiveLateral
  speedKmh?: number
  gear?: number
  pos?: number
  lapMs?: number
  rpm?: number
  maxRpm?: number
  tyres?: { pressuresPsi: number[]; coreTempsC: number[] }
  cue?: { id: string; clip: string; interrupt: boolean; text: string }
}

interface SetupSummary {
  path: string
  name: string
  car: string
  track: string
  pressureValues: number[]
}

interface SetupFeedback {
  id: string
  car: string
  track: string
  durationSeconds: number
  completedLaps: number
  maxSpeedKmh: number
  endedAt: number
}

interface SetupVariant {
  setup: SetupSummary
  issue: string
  description: string
  change: string
}

interface LiveStatus {
  connected: boolean
  car: string
  track: string
  reference: { path: string; name: string; lapTime: number; lapIndex: number } | null
  referenceError: string
  accError: string
  calibrated: boolean
  settings: { hudEnabled: boolean; hudMode: 'overlay' | 'window'; coachMarkers: boolean; swapLR: boolean; leadSeconds: number; voiceEnabled: boolean; voiceVolume: number; cooldownSeconds: number; hudSize: number }
  hud: { visible: boolean; edit: boolean }
}

interface Window {
  fastrack: {
    liveStatus: () => Promise<LiveStatus>
    saveLiveSettings: (patch: Partial<LiveStatus['settings']>) => Promise<LiveStatus>
    reconnectAcc: () => Promise<LiveStatus>
    toggleHudEdit: () => Promise<LiveStatus>
    resizeHud: (width: number) => Promise<void>
    onLiveFrame: (callback: (frame: LiveFrame) => void) => () => void
    onLiveStatus: (callback: (status: LiveStatus) => void) => () => void
    pathForFile: (file: File) => string
    describeLap: (filePath: string) => Promise<LapSummary | null>
    library: () => Promise<LapSummary[]>
    discover: () => Promise<LapSummary[]>
    pickLap: () => Promise<LapSummary | null>
    importLap: () => Promise<LapSummary[]>
    loadLap: (filePath: string, lapIndex?: number) => Promise<ParsedLap>
    getPreferences: () => Promise<Preferences>
    savePreferences: (preferences: Preferences) => Promise<Preferences>
    getBestSectors: () => Promise<Record<string, number[]>>
    saveBestSectors: (entry: { track: string; car: string; sectors: number[] }) => Promise<Record<string, number[]>>
    getSetup: () => Promise<{ setup: SetupSummary | null; error: string }>
    importSetup: () => Promise<SetupSummary | null>
    clearSetup: () => Promise<void>
    getPendingSetupFeedback: () => Promise<SetupFeedback | null>
    submitSetupFeedback: (sessionId: string, issue: 'frontPush' | 'rearLoose' | 'brakingStability' | 'balanced') => Promise<SetupVariant>
    dismissSetupFeedback: (sessionId: string) => Promise<void>
    onSetupFeedback: (callback: (feedback: SetupFeedback) => void) => () => void
  }
}