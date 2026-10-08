import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuid } from 'uuid'

export type ActivityStatus = 'idea' | 'planned' | 'done'

export type PinKind = 'destination' | 'activity' | 'visited'

export type VisitedWith = '' | 'solo' | 'friends' | 'family'

export const VISITED_WITH_LABEL: Record<VisitedWith, string> = {
  '': 'Not set',
  solo: 'Solo',
  friends: 'Friends',
  family: 'Family',
}

export const PIN_KIND_INFO: Record<
  PinKind,
  { label: string; color: string }
> = {
  destination: { label: 'Destination', color: '#ff6b6b' },
  activity: { label: 'Activity', color: '#9775fa' },
  visited: { label: 'Visited', color: '#51cf66' },
}

export interface Pin {
  id: string
  lat: number
  lng: number
  name: string
  notes: string
  kind: PinKind
  color: string
  // Only meaningful for kind: 'visited', but kept on every pin so they
  // survive a kind change and back without re-entering them.
  visitDate: string // ISO date, empty if unset
  visitedWith: VisitedWith
  photos: string[] // compressed data URLs
  createdAt: number
}

export interface Activity {
  id: string
  pinId: string
  title: string
  notes: string
  date: string // ISO date, optional (empty string if unset)
  price: string // free-form (e.g. "$40"), optional (empty string if unset)
  parentId: string // id of a category activity (e.g. "Museums"), empty if ungrouped
  isCategory: boolean // a pure grouping header created via the category form
  status: ActivityStatus
  createdAt: number
}

export interface DayPlanItem {
  id: string
  date: string // ISO date (YYYY-MM-DD) this item belongs to
  time: string // HH:MM 24h, optional (empty = untimed, sorts after timed items)
  title: string
  notes: string
  pinId: string // linked location, empty string if none
  createdAt: number
}

interface TravelState {
  pins: Pin[]
  activities: Activity[]
  dayPlanItems: DayPlanItem[]

  addPin: (pin: Omit<Pin, 'id' | 'createdAt'>) => string
  updatePin: (id: string, patch: Partial<Omit<Pin, 'id'>>) => void
  deletePin: (id: string) => void

  addActivity: (activity: Omit<Activity, 'id' | 'createdAt'>) => string
  updateActivity: (id: string, patch: Partial<Omit<Activity, 'id'>>) => void
  deleteActivity: (id: string) => void

  addDayPlanItem: (item: Omit<DayPlanItem, 'id' | 'createdAt'>) => string
  updateDayPlanItem: (id: string, patch: Partial<Omit<DayPlanItem, 'id'>>) => void
  deleteDayPlanItem: (id: string) => void
}

export const useTravelStore = create<TravelState>()(
  persist(
    (set) => ({
      pins: [],
      activities: [],
      dayPlanItems: [],

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
          dayPlanItems: state.dayPlanItems.map((d) =>
            d.pinId === id ? { ...d, pinId: '' } : d,
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
          activities: state.activities
            .filter((a) => a.id !== id)
            .map((a) => (a.parentId === id ? { ...a, parentId: '' } : a)),
        }))
      },

      addDayPlanItem: (item) => {
        const id = uuid()
        set((state) => ({
          dayPlanItems: [
            ...state.dayPlanItems,
            { ...item, id, createdAt: Date.now() },
          ],
        }))
        return id
      },
      updateDayPlanItem: (id, patch) => {
        set((state) => ({
          dayPlanItems: state.dayPlanItems.map((d) =>
            d.id === id ? { ...d, ...patch } : d,
          ),
        }))
      },
      deleteDayPlanItem: (id) => {
        set((state) => ({
          dayPlanItems: state.dayPlanItems.filter((d) => d.id !== id),
        }))
      },
    }),
    {
      name: 'travel-journal-storage',
      version: 6,
      migrate: (persisted) => {
        const state = persisted as {
          pins?: Pin[]
          activities?: Activity[]
          wishes?: unknown
          dayPlanItems?: DayPlanItem[]
        }
        if (state.pins) {
          state.pins = state.pins.map((p) => ({
            ...p,
            kind: p.kind ?? 'destination',
            visitDate: p.visitDate ?? '',
            visitedWith: p.visitedWith ?? '',
            photos: p.photos ?? [],
          }))
        }
        if (state.activities) {
          state.activities = state.activities.map((a) => ({
            ...a,
            price: a.price ?? '',
            parentId: a.parentId ?? '',
            isCategory: a.isCategory ?? false,
          }))
        }
        // The Speculations & Wishes tab was replaced by day planning -
        // drop its old data rather than carrying it forward unused.
        delete state.wishes
        state.dayPlanItems = state.dayPlanItems ?? []
        return state
      },
    },
  ),
)
