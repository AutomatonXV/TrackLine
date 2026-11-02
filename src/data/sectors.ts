// ACC sector boundaries as a fraction of lap distance (the end of sectors 1, 2 and 3).
// Source: Lovely-Sim-Racing/lovely-track-data, assettocorsacompetizione/*.json (CC BY-NC-SA 4.0).
export const SECTOR_MARKERS: Record<string, number[]> = {
  Monza: [0.339, 0.666, 1],
  'Spa-Francorchamps': [0.333, 0.719, 1],
  'Nürburgring GP': [0.453, 0.861, 1],
  'Donington Park': [0.255, 0.679, 1],
  Imola: [0.258, 0.557, 1],
  Kyalami: [0.323, 0.717, 1],
  'Laguna Seca': [0.254, 0.636, 1],
  Misano: [0.224, 0.625, 1],
  'Mount Panorama': [0.316, 0.764, 1],
  'Oulton Park': [0.272, 0.716, 1],
  'Paul Ricard': [0.263, 0.597, 1],
  Snetterton: [0.329, 0.674, 1],
  Valencia: [0.379, 0.728, 1],
  'Watkins Glen': [0.332, 0.637, 1],
  Zolder: [0.368, 0.693, 1],
  'Circuit of the Americas': [0.239, 0.659, 1],
  'Brands Hatch': [0.294, 0.568, 1],
  Hungaroring: [0.397, 0.75, 1],
  Barcelona: [0.35, 0.733, 1],
  Indianapolis: [0.398, 0.714, 1],
  Silverstone: [0.32, 0.709, 1],
  'Red Bull Ring': [0.287, 0.687, 1],
  Zandvoort: [0.322, 0.659, 1],
  Suzuka: [0.328, 0.763, 1],
}

export const sectorMarkers = (track: string) => SECTOR_MARKERS[track] ?? [1 / 3, 2 / 3, 1]
