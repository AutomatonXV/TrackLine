// ACC sector boundaries as a fraction of lap distance (the end of sectors 1, 2 and 3).
// Source: Lovely-Sim-Racing/lovely-track-data, assettocorsacompetizione/*.json (CC BY-NC-SA 4.0).
export const SECTOR_MARKERS: Record<string, number[]> = {
  Monza: [0.339, 0.666, 1],
  'Spa-Francorchamps': [0.333, 0.719, 1],
  'Nürburgring GP': [0.453, 0.861, 1],
}

export const sectorMarkers = (track: string) => SECTOR_MARKERS[track] ?? [1 / 3, 2 / 3, 1]
