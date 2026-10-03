import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuid } from 'uuid'

export type ActivityStatus = 'idea' | 'planned' | 'done'

export type PinKind = 'destination' | 'activity'

export const PIN_KIND_INFO: Record<
  PinKind,
  { label: string; color: string }
> = {
  destination: { label: 'Destination', color: '#ff6b6b' },
  activity: { label: 'Activity', color: '#9775fa' },
}

export interface Pin {
  id: string
  lat: number
  lng: number
  name: string
  notes: string
  kind: PinKind
  color: string
  createdAt: number
}

export interface Activity {
  id: string
  pinId: string
  title: string
  notes: string
  date: string // ISO date, optional (empty string if unset)
  status: ActivityStatus
  createdAt: number
}

export interface WishItem {
  id: string
  title: string
  notes: string
  pinId: string // linked pin id, empty string if none
  placeName: string // freeform place name when not linked to a pin
  tags: string
  createdAt: number
}

interface TravelState {
  pins: Pin[]
  activities: Activity[]
  wishes: WishItem[]

  addPin: (pin: Omit<Pin, 'id' | 'createdAt'>) => string
  updatePin: (id: string, patch: Partial<Omit<Pin, 'id'>>) => void
  deletePin: (id: string) => void

  addActivity: (activity: Omit<Activity, 'id' | 'createdAt'>) => string
  updateActivity: (id: string, patch: Partial<Omit<Activity, 'id'>>) => void
  deleteActivity: (id: string) => void

  addWish: (wish: Omit<WishItem, 'id' | 'createdAt'>) => string
  updateWish: (id: string, patch: Partial<Omit<WishItem, 'id'>>) => void
  deleteWish: (id: string) => void
}

export const useTravelStore = create<TravelState>()(
  persist(
    (set) => ({
      pins: [],
      activities: [],
      wishes: [],

      addPin: (pin) => {
        const id = uuid()
        set((state) => ({
          pins: [...state.pins, { ...pin, id, createdAt: Date.now() }],
        }))
        return id
      },
      updatePin: (id, patch) => {
        set((state) => ({
          pins: state.pins.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        }))
      },
      deletePin: (id) => {
        set((state) => ({
          pins: state.pins.filter((p) => p.id !== id),
          activities: state.activities.filter((a) => a.pinId !== id),
          wishes: state.wishes.map((w) =>
            w.pinId === id ? { ...w, pinId: '' } : w,
          ),
        }))
      },

      addActivity: (activity) => {
        const id = uuid()
        set((state) => ({
          activities: [
            ...state.activities,
            { ...activity, id, createdAt: Date.now() },
          ],
        }))
        return id
      },
      updateActivity: (id, patch) => {
        set((state) => ({
          activities: state.activities.map((a) =>
            a.id === id ? { ...a, ...patch } : a,
          ),
        }))
      },
      deleteActivity: (id) => {
        set((state) => ({
          activities: state.activities.filter((a) => a.id !== id),
        }))
      },

      addWish: (wish) => {
        const id = uuid()
        set((state) => ({
          wishes: [...state.wishes, { ...wish, id, createdAt: Date.now() }],
        }))
        return id
      },
      updateWish: (id, patch) => {
        set((state) => ({
          wishes: state.wishes.map((w) =>
            w.id === id ? { ...w, ...patch } : w,
          ),
        }))
      },
      deleteWish: (id) => {
        set((state) => ({ wishes: state.wishes.filter((w) => w.id !== id) }))
      },
    }),
    {
      name: 'travel-journal-storage',
      version: 1,
      migrate: (persisted) => {
        const state = persisted as { pins?: Pin[] }
        if (state.pins) {
          state.pins = state.pins.map((p) => ({
            ...p,
            kind: p.kind ?? 'destination',
          }))
        }
        return state
      },
    },
  ),
)
