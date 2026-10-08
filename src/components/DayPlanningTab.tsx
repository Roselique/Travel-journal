import { useMemo, useState } from 'react'
import {
  DAY_ITEM_CATEGORIES,
  useTravelStore,
  type Activity,
  type DayPlanItem,
  type Pin,
  type Trip,
} from '../store'
import { esriExportImageUrl, fitMercatorBBox, projectToPixel } from '../lib/mercator'

const JOURNEY_MAP_WIDTH = 900
const JOURNEY_MAP_HEIGHT = 380

// The trip's route: every pin a day was linked to, in the order it's first
// visited, with how many days (not necessarily consecutive) end up pointing
// at it. Pins never linked to a day don't appear - this traces the
// itinerary actually laid out, not every pin that exists.
function JourneyMap({ stops }: { stops: { pin: Pin; days: number }[] }) {
  if (stops.length === 0) {
    return (
      <div className="journey-map journey-map-empty">
        <p className="empty">
          Link a pin to a day below to see your route here.
        </p>
      </div>
    )
  }

  const bbox = fitMercatorBBox(
    stops.map((s) => s.pin),
    JOURNEY_MAP_WIDTH,
    JOURNEY_MAP_HEIGHT,
  )
  const imageUrl = esriExportImageUrl(bbox, JOURNEY_MAP_WIDTH, JOURNEY_MAP_HEIGHT)
  const points = stops.map((s) => ({
    ...s,
    px: projectToPixel(s.pin.lat, s.pin.lng, bbox, JOURNEY_MAP_WIDTH, JOURNEY_MAP_HEIGHT),
  }))
  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.px.x} ${p.px.y}`)
    .join(' ')

  return (
    <div className="journey-map">
      <img
        className="journey-map-image"
        src={imageUrl}
        alt="Map of the trip's route"
        width={JOURNEY_MAP_WIDTH}
        height={JOURNEY_MAP_HEIGHT}
      />
      <svg
        className="journey-map-overlay"
        viewBox={`0 0 ${JOURNEY_MAP_WIDTH} ${JOURNEY_MAP_HEIGHT}`}
      >
        {points.length > 1 && (
          <path d={pathD} className="journey-route-line" fill="none" />
        )}
        {points.map((p, i) => (
          <g key={p.pin.id}>
            <foreignObject
              x={p.px.x - 75}
              y={p.px.y - 64}
              width={150}
              height={52}
            >
              <div className="journey-pin-label">
                <span className="journey-pin-name">{p.pin.name}</span>
                <span className="journey-pin-days">
                  {p.days} {p.days === 1 ? 'day' : 'days'}
                </span>
              </div>
            </foreignObject>
            <circle cx={p.px.x} cy={p.px.y} r={7} fill={p.pin.color} className="journey-pin-dot" />
            <text x={p.px.x} y={p.px.y + 1} className="journey-pin-num" textAnchor="middle">
              {i + 1}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

// Schedule grid spans 6 AM to 10 PM - covers a normal waking day without
// making the grid absurdly long; anything outside that (or without a time)
// goes in the "Anytime" section instead.
const HOURS = Array.from({ length: 17 }, (_, i) => i + 6)

// All date-only strings here (YYYY-MM-DD) are treated as plain calendar
// dates, not tied to any instant - parsed/built/formatted entirely in UTC
// so a viewer's local timezone offset can never shift the date by a day.
// Mixing UTC and local-time Date handling for the same string (e.g.
// building with local midnight but reading back via toISOString) is the
// classic bug that makes "+1 day" silently stay on the same date for
// anyone east of UTC - keep every helper below on the UTC side only.
function parseIsoUTC(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function formatHour(h: number): string {
  const period = h < 12 ? 'AM' : 'PM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12} ${period}`
}

function formatShortDate(iso: string): string {
  const d = parseIsoUTC(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function formatShortDateYear(iso: string): string {
  const d = parseIsoUTC(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
    timeZone: 'UTC',
  })
}

function formatDayLabel(iso: string): string {
  const d = parseIsoUTC(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function tripDayCount(trip: Trip): number {
  if (!trip.tripStart || !trip.tripEnd || trip.tripStart > trip.tripEnd) return 0
  let count = 0
  let cur = trip.tripStart
  let guard = 0
  while (cur <= trip.tripEnd && guard < 400) {
    count++
    cur = addDaysIso(cur, 1)
    guard++
  }
  return count
}

function tripStatus(trip: Trip): 'now' | 'upcoming' | 'past' | null {
  if (!trip.tripStart || !trip.tripEnd) return null
  const today = todayIso()
  if (today < trip.tripStart) return 'upcoming'
  if (today > trip.tripEnd) return 'past'
  return 'now'
}

type ItemDraft = {
  time: string
  endTime: string
  title: string
  notes: string
  location: string
  category: string
  price: string
}

function ItemForm({
  initial,
  defaultTime,
  onSave,
  onCancel,
}: {
  initial?: DayPlanItem
  defaultTime?: string
  onSave: (data: ItemDraft) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [location, setLocation] = useState(initial?.location ?? '')
  const [category, setCategory] = useState(initial?.category ?? '')
  const [price, setPrice] = useState(initial?.price ?? '')
  const [time, setTime] = useState(initial?.time ?? defaultTime ?? '')
  const [endTime, setEndTime] = useState(initial?.endTime ?? '')

  return (
    <form
      className="dayplan-item-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (!title.trim()) return
        onSave({
          time,
          endTime,
          title: title.trim(),
          notes,
          location: location.trim(),
          category,
          price: price.trim(),
        })
      }}
    >
      <div className="section-label">Name</div>
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="e.g. Fushimi Inari hike"
        maxLength={120}
      />

      <div className="section-label">Category</div>
      <div className="category-pills">
        {DAY_ITEM_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            className={`category-pill ${category === c ? 'active' : ''}`}
            onClick={() => setCategory((prev) => (prev === c ? '' : c))}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="activity-form-row">
        <label className="dayplan-time-field">
          Start
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <label className="dayplan-time-field">
          End
          <input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </label>
      </div>

      <div className="section-label">Location (optional)</div>
      <input
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        placeholder="e.g. a neighborhood or district"
        maxLength={120}
      />

      <div className="section-label">Price (optional)</div>
      <input
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        placeholder="e.g. $40"
        maxLength={20}
      />

      <div className="section-label">Note (optional)</div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Any details worth remembering"
        rows={2}
      />

      <button type="submit" className="primary dayplan-item-submit">
        {initial ? 'Save changes' : 'Add to day'}
      </button>
      <button type="button" className="small dayplan-item-cancel" onClick={onCancel}>
        Cancel
      </button>
    </form>
  )
}

function ItemCard({
  item,
  onEdit,
  onDelete,
}: {
  item: DayPlanItem
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="dayplan-item-card">
      <div className="dayplan-item-main">
        {item.time && (
          <div className="dayplan-item-time">
            {item.time}
            {item.endTime && ` – ${item.endTime}`}
          </div>
        )}
        <div className="dayplan-title">{item.title}</div>
        {item.category && <div className="dayplan-category">{item.category}</div>}
        {item.location && <div className="dayplan-place">{item.location}</div>}
        {item.price && <div className="dayplan-price">{item.price}</div>}
        {item.notes && <div className="dayplan-notes">{item.notes}</div>}
      </div>
      <div className="dayplan-item-actions">
        <button type="button" className="small" onClick={onEdit}>
          Edit
        </button>
        <button type="button" className="danger small" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  )
}

function DaySchedule({
  items,
  onAdd,
  onUpdate,
  onDelete,
}: {
  items: DayPlanItem[]
  onAdd: (data: ItemDraft) => void
  onUpdate: (id: string, patch: ItemDraft) => void
  onDelete: (id: string) => void
}) {
  const [addingHour, setAddingHour] = useState<number | null>(null)
  const [addingAnytime, setAddingAnytime] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const untimed = items.filter((i) => !i.time)
  const hourOf = (t: string) => Number.parseInt(t.slice(0, 2), 10)
  // An item is placed in the hour slot it starts in - a 6:00-8:30 item
  // shows once, in the 6 AM row, with its end time in the card.
  const itemsInHour = (h: number) =>
    items.filter((i) => i.time && hourOf(i.time) === h)

  const renderItem = (item: DayPlanItem) =>
    editingId === item.id ? (
      <ItemForm
        key={item.id}
        initial={item}
        onSave={(data) => {
          onUpdate(item.id, data)
          setEditingId(null)
        }}
        onCancel={() => setEditingId(null)}
      />
    ) : (
      <ItemCard
        key={item.id}
        item={item}
        onEdit={() => setEditingId(item.id)}
        onDelete={() => onDelete(item.id)}
      />
    )

  return (
    <div className="dayplan-schedule">
      <div className="dayplan-anytime">
        <div className="dayplan-hour-label">Anytime</div>
        <div className="dayplan-hour-slot">
          {untimed.map(renderItem)}
          {addingAnytime ? (
            <ItemForm
              onSave={(data) => {
                onAdd(data)
                setAddingAnytime(false)
              }}
              onCancel={() => setAddingAnytime(false)}
            />
          ) : (
            <button
              type="button"
              className="dayplan-add-slot"
              onClick={() => setAddingAnytime(true)}
            >
              + add
            </button>
          )}
        </div>
      </div>

      <div className="dayplan-hours">
        {HOURS.map((h) => (
          <div key={h} className="dayplan-hour-row">
            <div className="dayplan-hour-label">{formatHour(h)}</div>
            <div className="dayplan-hour-slot">
              {itemsInHour(h).map(renderItem)}
              {addingHour === h ? (
                <ItemForm
                  defaultTime={`${String(h).padStart(2, '0')}:00`}
                  onSave={(data) => {
                    onAdd(data)
                    setAddingHour(null)
                  }}
                  onCancel={() => setAddingHour(null)}
                />
              ) : (
                <button
                  type="button"
                  className="dayplan-add-slot"
                  onClick={() => setAddingHour(h)}
                >
                  + add
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Stay reservation + category breakdown for one pin on the route. The
// pill counts are a read-only summary here (there's no activity list on
// this tab to filter) - full browsing/editing of individual places still
// happens on the Activities tab.
function PlacesOverview({
  pin,
  activities,
  updatePin,
}: {
  pin: Pin
  activities: Activity[]
  updatePin: (id: string, patch: Partial<Omit<Pin, 'id'>>) => void
}) {
  const [addingStay, setAddingStay] = useState(false)
  const [stayName, setStayName] = useState('')
  const [stayNotes, setStayNotes] = useState('')

  const pinActivities = useMemo(
    () => activities.filter((a) => a.pinId === pin.id),
    [activities, pin.id],
  )
  const categories = pinActivities.filter((a) => a.isCategory)
  const categoryIds = new Set(categories.map((c) => c.id))
  const countByCategory = new Map<string, number>()
  let ungroupedCount = 0
  for (const a of pinActivities) {
    if (a.isCategory) continue
    if (a.parentId && categoryIds.has(a.parentId)) {
      countByCategory.set(a.parentId, (countByCategory.get(a.parentId) ?? 0) + 1)
    } else {
      ungroupedCount++
    }
  }
  const savedCount = pinActivities.filter((a) => !a.isCategory).length

  return (
    <div className="places-stay-overview">
      <div className="stay-section">
        <div className="section-label">Stay</div>
        {addingStay ? (
          <form
            className="stay-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (!stayName.trim()) return
              updatePin(pin.id, { stayName: stayName.trim(), stayNotes })
              setAddingStay(false)
            }}
          >
            <input
              autoFocus
              value={stayName}
              onChange={(e) => setStayName(e.target.value)}
              placeholder="Hotel / reservation name"
              maxLength={120}
            />
            <input
              value={stayNotes}
              onChange={(e) => setStayNotes(e.target.value)}
              placeholder="Dates, confirmation #, address... (optional)"
              maxLength={200}
            />
            <div className="activity-edit-actions">
              <button type="submit" className="primary small">
                Save
              </button>
              <button type="button" className="small" onClick={() => setAddingStay(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : pin.stayName ? (
          <div className="stay-card">
            <div className="activity-main">
              <div className="activity-title">{pin.stayName}</div>
              {pin.stayNotes && <div className="activity-notes">{pin.stayNotes}</div>}
            </div>
            <div className="activity-controls">
              <button
                type="button"
                className="small"
                onClick={() => {
                  setStayName(pin.stayName)
                  setStayNotes(pin.stayNotes)
                  setAddingStay(true)
                }}
              >
                Edit
              </button>
              <button
                type="button"
                className="danger small"
                onClick={() => updatePin(pin.id, { stayName: '', stayNotes: '' })}
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="dayplan-add-slot stay-add"
            onClick={() => {
              setStayName('')
              setStayNotes('')
              setAddingStay(true)
            }}
          >
            + add accommodation reservation
          </button>
        )}
        <a
          className="stay-search-link"
          href={`https://www.google.com/search?q=${encodeURIComponent(`hotels in ${pin.name}`)}`}
          target="_blank"
          rel="noreferrer"
        >
          Search hotels in {pin.name} →
        </a>
      </div>

      <div className="places-overview">
        <div className="places-overview-top">
          <div className="section-label">Places in {pin.name}</div>
          <div className="places-overview-stats">{savedCount} saved</div>
        </div>
        <div className="category-pills">
          {categories.length === 0 && ungroupedCount === 0 ? (
            <span className="category-pill static">No places saved yet</span>
          ) : (
            <>
              {categories.map((c) => (
                <span key={c.id} className="category-pill static">
                  {c.title}
                  <span className="pill-count">{countByCategory.get(c.id) ?? 0}</span>
                </span>
              ))}
              {ungroupedCount > 0 && (
                <span className="category-pill static">
                  Other
                  <span className="pill-count">{ungroupedCount}</span>
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

type TripDraft = { name: string; destination: string; tripStart: string; tripEnd: string }

function TripForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Trip
  onSave: (data: TripDraft) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [destination, setDestination] = useState(initial?.destination ?? '')
  const [tripStart, setTripStart] = useState(initial?.tripStart ?? '')
  const [tripEnd, setTripEnd] = useState(initial?.tripEnd ?? '')

  return (
    <form
      className="trip-card trip-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim()) return
        onSave({ name: name.trim(), destination: destination.trim(), tripStart, tripEnd })
      }}
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Trip name (e.g. Japan)"
        maxLength={80}
      />
      <input
        value={destination}
        onChange={(e) => setDestination(e.target.value)}
        placeholder="Destination (optional)"
        maxLength={80}
      />
      <div className="activity-form-row">
        <label className="dayplan-time-field">
          Start date
          <input type="date" value={tripStart} onChange={(e) => setTripStart(e.target.value)} />
        </label>
        <label className="dayplan-time-field">
          End date
          <input
            type="date"
            value={tripEnd}
            min={tripStart || undefined}
            onChange={(e) => setTripEnd(e.target.value)}
          />
        </label>
      </div>
      <div className="activity-edit-actions">
        <button type="submit" className="primary small">
          Save
        </button>
        <button type="button" className="small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function TripCard({
  trip,
  dayItemCount,
  onOpen,
  onEdit,
  onDelete,
}: {
  trip: Trip
  dayItemCount: number
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const status = tripStatus(trip)
  const days = tripDayCount(trip)
  return (
    <div className="trip-card">
      <button type="button" className="trip-card-open" onClick={onOpen}>
        <div className="trip-card-top">
          <span className="trip-card-name">{trip.name}</span>
          {status === 'now' && <span className="trip-badge">Traveling now</span>}
          {status === 'upcoming' && <span className="trip-badge upcoming">Upcoming</span>}
        </div>
        {trip.destination && <div className="trip-card-destination">{trip.destination}</div>}
        <div className="trip-card-meta">
          {trip.tripStart && trip.tripEnd
            ? `${formatShortDateYear(trip.tripStart)} – ${formatShortDateYear(trip.tripEnd)}`
            : 'No dates set'}
          {days > 0 && <> · {days} {days === 1 ? 'day' : 'days'}</>}
          {dayItemCount > 0 && <> · {dayItemCount} planned</>}
        </div>
      </button>
      <div className="trip-card-actions">
        <button type="button" className="small" onClick={onEdit}>
          Edit
        </button>
        <button type="button" className="danger small" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  )
}

function TripDetail({
  trip,
  pins,
  activities,
  dayPlanItems,
  dayLocations,
  onBack,
  onUpdateTrip,
  onDeleteTrip,
  addDayPlanItem,
  updateDayPlanItem,
  deleteDayPlanItem,
  setDayLocation,
  updatePin,
}: {
  trip: Trip
  pins: Pin[]
  activities: Activity[]
  dayPlanItems: DayPlanItem[]
  dayLocations: Record<string, string>
  onBack: () => void
  onUpdateTrip: (patch: TripDraft) => void
  onDeleteTrip: () => void
  addDayPlanItem: (item: Omit<DayPlanItem, 'id' | 'createdAt'>) => string
  updateDayPlanItem: (id: string, patch: Partial<Omit<DayPlanItem, 'id'>>) => void
  deleteDayPlanItem: (id: string) => void
  setDayLocation: (tripId: string, date: string, pinId: string) => void
  updatePin: (id: string, patch: Partial<Omit<Pin, 'id'>>) => void
}) {
  const [expandedDate, setExpandedDate] = useState<string | null>(null)
  const [editingTrip, setEditingTrip] = useState(false)
  const [overviewPinId, setOverviewPinId] = useState<string | null>(null)

  // The trip's start/end dates always win, so the day list reads like a
  // real itinerary (including quiet days with nothing planned yet) rather
  // than only the dates that already have an item. Falls back to the
  // planned items' own date range until a trip range is set.
  const dayList = useMemo(() => {
    let start = trip.tripStart
    let end = trip.tripEnd
    if (!start || !end || start > end) {
      const dates = dayPlanItems.map((d) => d.date).sort()
      if (dates.length === 0) return []
      start = dates[0]
      end = dates[dates.length - 1]
    }
    const out: string[] = []
    let cur = start
    let guard = 0
    while (cur <= end && guard < 400) {
      out.push(cur)
      cur = addDaysIso(cur, 1)
      guard++
    }
    return out
  }, [dayPlanItems, trip.tripStart, trip.tripEnd])

  const itemsByDate = useMemo(() => {
    const map = new Map<string, DayPlanItem[]>()
    for (const item of dayPlanItems) {
      const list = map.get(item.date)
      if (list) list.push(item)
      else map.set(item.date, [item])
    }
    return map
  }, [dayPlanItems])

  const locationsUsed = useMemo(
    () => new Set(Object.values(dayLocations).filter(Boolean)).size,
    [dayLocations],
  )

  // The route: every pin a day links to, in the order it's first visited,
  // with how many of the trip's days (not necessarily consecutive) point at
  // it. Days with no linked pin are skipped rather than breaking the route.
  const routeStops = useMemo(() => {
    const order: string[] = []
    const daysByPin = new Map<string, number>()
    for (const date of dayList) {
      const pinId = dayLocations[date]
      if (!pinId) continue
      if (!order.includes(pinId)) order.push(pinId)
      daysByPin.set(pinId, (daysByPin.get(pinId) ?? 0) + 1)
    }
    return order
      .map((id) => pins.find((p) => p.id === id))
      .filter((p): p is Pin => !!p)
      .map((pin) => ({ pin, days: daysByPin.get(pin.id) ?? 0 }))
  }, [dayList, dayLocations, pins])

  const activeOverviewPin =
    routeStops.find((s) => s.pin.id === overviewPinId)?.pin ?? routeStops[0]?.pin ?? null

  const toggleDay = (date: string) => {
    setExpandedDate((prev) => (prev === date ? null : date))
  }

  return (
    <div className="dayplan-tab">
      <div className="dayplan-header">
        <button type="button" className="dayplan-back" onClick={onBack}>
          ← All trips
        </button>
        {editingTrip ? (
          <TripForm
            initial={trip}
            onSave={(data) => {
              onUpdateTrip(data)
              setEditingTrip(false)
            }}
            onCancel={() => setEditingTrip(false)}
          />
        ) : (
          <div className="dayplan-header-top">
            <div>
              <div className="dayplan-header-range">
                {dayList.length > 0
                  ? `${formatShortDate(dayList[0])} – ${formatShortDate(dayList[dayList.length - 1])}`
                  : 'No days planned yet'}
              </div>
              <h2>{trip.name}</h2>
              {trip.destination && <div className="dayplan-destination">{trip.destination}</div>}
            </div>
            <div className="dayplan-header-actions">
              <button type="button" className="small" onClick={() => setEditingTrip(true)}>
                Edit trip
              </button>
              <button type="button" className="danger small" onClick={onDeleteTrip}>
                Delete trip
              </button>
            </div>
          </div>
        )}
        <div className="dayplan-stats">
          <div className="dayplan-stat">
            <strong>{dayList.length}</strong>
            <span>days</span>
          </div>
          <div className="dayplan-stat">
            <strong>{dayPlanItems.length}</strong>
            <span>items</span>
          </div>
          <div className="dayplan-stat">
            <strong>{locationsUsed}</strong>
            <span>locations</span>
          </div>
        </div>
      </div>

      <div className="journey-section">
        <h3>Your journey</h3>
        <JourneyMap stops={routeStops} />
      </div>

      {activeOverviewPin && (
        <div className="journey-section">
          {routeStops.length > 1 && (
            <div className="journey-city-tabs">
              {routeStops.map(({ pin }) => (
                <button
                  key={pin.id}
                  type="button"
                  className={`journey-city-tab ${activeOverviewPin.id === pin.id ? 'active' : ''}`}
                  onClick={() => setOverviewPinId(pin.id)}
                >
                  {pin.name}
                </button>
              ))}
            </div>
          )}
          <PlacesOverview pin={activeOverviewPin} activities={activities} updatePin={updatePin} />
        </div>
      )}

      <div className="dayplan-daylist">
        <h3>Day by day</h3>
        {dayList.length === 0 && (
          <p className="empty">Edit the trip to set a start and end date.</p>
        )}
        {dayList.map((date, i) => {
          const items = itemsByDate.get(date) ?? []
          const expanded = expandedDate === date
          const dayPinId = dayLocations[date] ?? ''
          return (
            <div key={date} className="dayplan-day-block">
              <div className="dayplan-day-row">
                <button
                  type="button"
                  className="dayplan-day-toggle"
                  onClick={() => toggleDay(date)}
                  aria-expanded={expanded}
                >
                  <span className="dayplan-day-num">{i + 1}</span>
                  <span className="dayplan-day-info">
                    <span className="dayplan-day-date">{formatDayLabel(date)}</span>
                    <span className="dayplan-day-summary">
                      {items.length === 0 ? 'nothing planned yet' : `${items.length} planned`}
                    </span>
                  </span>
                </button>
                <select
                  className="dayplan-day-location-select"
                  value={dayPinId}
                  onChange={(e) => setDayLocation(trip.id, date, e.target.value)}
                  aria-label="Day location"
                >
                  <option value="">No location</option>
                  {pins.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="dayplan-day-chevron"
                  onClick={() => toggleDay(date)}
                  aria-label={expanded ? 'Collapse day' : 'Expand day'}
                >
                  <span className={`chevron ${expanded ? '' : 'collapsed'}`}>▾</span>
                </button>
              </div>
              {expanded && (
                <DaySchedule
                  items={items}
                  onAdd={(data) => addDayPlanItem({ tripId: trip.id, date, ...data })}
                  onUpdate={updateDayPlanItem}
                  onDelete={deleteDayPlanItem}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function DayPlanningTab() {
  const pins = useTravelStore((s) => s.pins)
  const activities = useTravelStore((s) => s.activities)
  const trips = useTravelStore((s) => s.trips)
  const dayPlanItems = useTravelStore((s) => s.dayPlanItems)
  const dayLocations = useTravelStore((s) => s.dayLocations)
  const addTrip = useTravelStore((s) => s.addTrip)
  const updateTrip = useTravelStore((s) => s.updateTrip)
  const deleteTrip = useTravelStore((s) => s.deleteTrip)
  const addDayPlanItem = useTravelStore((s) => s.addDayPlanItem)
  const updateDayPlanItem = useTravelStore((s) => s.updateDayPlanItem)
  const deleteDayPlanItem = useTravelStore((s) => s.deleteDayPlanItem)
  const setDayLocation = useTravelStore((s) => s.setDayLocation)
  const updatePin = useTravelStore((s) => s.updatePin)

  const [selectedTripId, setSelectedTripId] = useState<string | null>(null)
  const [creatingTrip, setCreatingTrip] = useState(false)
  const [editingTripId, setEditingTripId] = useState<string | null>(null)

  const selectedTrip = trips.find((t) => t.id === selectedTripId) ?? null

  if (selectedTrip) {
    const tripItems = dayPlanItems.filter((d) => d.tripId === selectedTrip.id)
    const tripDayLocations = Object.fromEntries(
      Object.entries(dayLocations)
        .filter(([key]) => key.startsWith(`${selectedTrip.id}::`))
        .map(([key, pinId]) => [key.slice(selectedTrip.id.length + 2), pinId]),
    )
    return (
      <TripDetail
        trip={selectedTrip}
        pins={pins}
        activities={activities}
        dayPlanItems={tripItems}
        dayLocations={tripDayLocations}
        onBack={() => setSelectedTripId(null)}
        onUpdateTrip={(data) => updateTrip(selectedTrip.id, data)}
        onDeleteTrip={() => {
          deleteTrip(selectedTrip.id)
          setSelectedTripId(null)
        }}
        addDayPlanItem={addDayPlanItem}
        updateDayPlanItem={updateDayPlanItem}
        deleteDayPlanItem={deleteDayPlanItem}
        updatePin={updatePin}
        setDayLocation={setDayLocation}
      />
    )
  }

  return (
    <div className="trips-landing">
      <div className="trips-landing-label">Your trips</div>
      <h2>Where next?</h2>
      <div className="trips-grid">
        {trips.map((trip) =>
          editingTripId === trip.id ? (
            <TripForm
              key={trip.id}
              initial={trip}
              onSave={(data) => {
                updateTrip(trip.id, data)
                setEditingTripId(null)
              }}
              onCancel={() => setEditingTripId(null)}
            />
          ) : (
            <TripCard
              key={trip.id}
              trip={trip}
              dayItemCount={dayPlanItems.filter((d) => d.tripId === trip.id).length}
              onOpen={() => setSelectedTripId(trip.id)}
              onEdit={() => setEditingTripId(trip.id)}
              onDelete={() => deleteTrip(trip.id)}
            />
          ),
        )}
        {creatingTrip ? (
          <TripForm
            onSave={(data) => {
              const id = addTrip(data)
              setCreatingTrip(false)
              setSelectedTripId(id)
            }}
            onCancel={() => setCreatingTrip(false)}
          />
        ) : (
          <button
            type="button"
            className="trip-card trip-card-new"
            onClick={() => setCreatingTrip(true)}
          >
            + New trip
          </button>
        )}
      </div>
      {trips.length === 0 && !creatingTrip && (
        <p className="empty">Start your first trip to plan it day by day.</p>
      )}
    </div>
  )
}
