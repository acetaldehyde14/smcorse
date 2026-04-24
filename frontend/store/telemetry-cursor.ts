import { create } from 'zustand'

type CursorStore = {
  hoverLdp:  number | null
  lockedLdp: number | null
  setHoverLdp:  (v: number | null) => void
  setLockedLdp: (v: number | null) => void
  /** Toggle lock: clicking same location again unlocks */
  toggleLock: (v: number | null) => void
  /** Clear both hover and lock (e.g. on Escape) */
  clear: () => void
}

export const useTelemetryCursor = create<CursorStore>((set, get) => ({
  hoverLdp:  null,
  lockedLdp: null,

  setHoverLdp:  (v) => set({ hoverLdp: v }),
  setLockedLdp: (v) => set({ lockedLdp: v }),

  toggleLock: (v) => {
    const { lockedLdp } = get()
    if (lockedLdp != null && v != null && Math.abs(lockedLdp - v) < 0.008) {
      set({ lockedLdp: null })
    } else {
      set({ lockedLdp: v })
    }
  },

  clear: () => set({ hoverLdp: null, lockedLdp: null }),
}))

/** The effective ldp for display: lockedLdp takes priority over hoverLdp */
export function useActiveLdp(): number | null {
  const locked = useTelemetryCursor(s => s.lockedLdp)
  const hover  = useTelemetryCursor(s => s.hoverLdp)
  return locked ?? hover
}
