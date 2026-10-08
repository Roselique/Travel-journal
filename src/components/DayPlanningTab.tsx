import { useMemo, useState } from 'react'
import { useTravelStore, type DayPlanItem, type Pin } from '../store'

// Schedule grid spans 6 AM to 10 PM - covers a normal waking day without
// making the grid absurdly long; anything outside that (or without a time)
// goes in the "Anytime" section instead.
const HOURS = Array.from({ length: 17 }, (_, i) => i + 6)

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function formatHour(h: number): string {
  const period = h < 12 ? 'AM' : 'PM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12} ${period}`
}

function formatShortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatDayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

type ItemDraft = { time: string; title: string; notes: string; pinId: string }

function ItemForm({
  initial,
  defaultTime,
  pins,
  onSave,
  onCancel,
}: {
  initial?: DayPlanItem
  defaultTime?: string
  pins: Pin[]
  onSave: (data: ItemDraft) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [pinId, setPinId] = useState(initial?.pinId ?? '')
  const [time, setTime] = useState(initial?.time ?? defaultTime ?? '')

  return (
    <form
      className="dayplan-item-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (!title.trim()) return
        onSave({ time, title: title.trim(), notes, pinId })
      }}
    >
      <div className="activity-form-row">
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What's planned?"
          maxLength={120}
        />
      </div>
      <select value={pinId} onChange={(e) => setPinId(e.target.value)}>
        <option value="">No location</option>
        {pins.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional)"
        rows={2}
      />
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

function ItemCard({
  item,
  pins,
  onEdit,
  onDelete,
}: {
  item: DayPlanItem
  pins: Pin[]
  onEdit: () => void
  onDelete: () => void
}) {
  const linkedPin = pins.find((p) => p.id === item.pinId)
  return (
    <div className="dayplan-item-card">
      <div className="dayplan-item-main">
        <div className="dayplan-title">{item.title}</div>
        {linkedPin && (
          <div className="dayplan-place">
            <span className="dot" style={{ background: linkedPin.color }} />
            {linkedPin.name}
          </div>
        )}
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
  pins,
  onAdd,
  onUpdate,
  onDelete,
}: {
  items: DayPlanItem[]
  pins: Pin[]
  onAdd: (data: ItemDraft) => void
  onUpdate: (id: string, patch: ItemDraft) => void
  onDelete: (id: string) => void
}) {
  const [addingHour, setAddingHour] = useState<number | null>(null)
  const [addingAnytime, setAddingAnytime] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const untimed = items.filter((i) => !i.time)
  const hourOf = (t: string) => Number.parseInt(t.slice(0, 2), 10)
  const itemsInHour = (h: number) =>
    items.filter((i) => i.time && hourOf(i.time) === h)

  const renderItem = (item: DayPlanItem) =>
    editingId === item.id ? (
      <ItemForm
        key={item.id}
        initial={item}
        pins={pins}
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
        pins={pins}
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
              pins={pins}
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
                  pins={pins}
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

export default function DayPlanningTab() {
  const pins = useTravelStore((s) => s.pins)
  const dayPlanItems = useTravelStore((s) => s.dayPlanItems)
  const addDayPlanItem = useTravelStore((s) => s.addDayPlanItem)
  const updateDayPlanItem = useTravelStore((s) => s.updateDayPlanItem)
  const deleteDayPlanItem = useTravelStore((s) => s.deleteDayPlanItem)

  const [expandedDate, setExpandedDate] = useState<string | null>(null)
  const [jumpDate, setJumpDate] = useState('')

  // Shows every day between the earliest and latest planned date (filling
  // gaps, so a quiet middle day still shows as "nothing planned yet"
  // instead of disappearing), plus whatever date was last jumped to even
  // before it has any items of its own.
  const dayList = useMemo(() => {
    const dates = new Set(dayPlanItems.map((d) => d.date))
    if (jumpDate) dates.add(jumpDate)
    if (dates.size === 0) return []
    const sorted = [...dates].sort()
    const start = sorted[0]
    const end = sorted[sorted.length - 1]
    const out: string[] = []
    let cur = start
    let guard = 0
    while (cur <= end && guard < 400) {
      out.push(cur)
      cur = addDaysIso(cur, 1)
      guard++
    }
    return out
  }, [dayPlanItems, jumpDate])

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
    () => new Set(dayPlanItems.filter((d) => d.pinId).map((d) => d.pinId)).size,
    [dayPlanItems],
  )

  const toggleDay = (date: string) => {
    setExpandedDate((prev) => (prev === date ? null : date))
  }

  return (
    <div className="dayplan-tab">
      <div className="dayplan-header">
        <div className="dayplan-header-top">
          <div>
            <div className="dayplan-header-range">
              {dayList.length > 0
                ? `${formatShortDate(dayList[0])} – ${formatShortDate(dayList[dayList.length - 1])}`
                : 'No days planned yet'}
            </div>
            <h2>Day Planning</h2>
          </div>
          <input
            type="date"
            className="dayplan-jump"
            value={jumpDate || todayIso()}
            onChange={(e) => {
              setJumpDate(e.target.value)
              setExpandedDate(e.target.value)
            }}
          />
        </div>
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

      <div className="dayplan-daylist">
        <h3>Day by day</h3>
        {dayList.length === 0 && (
          <p className="empty">Pick a date above to start planning your first day.</p>
        )}
        {dayList.map((date, i) => {
          const items = itemsByDate.get(date) ?? []
          const expanded = expandedDate === date
          return (
            <div key={date} className="dayplan-day-block">
              <button
                type="button"
                className="dayplan-day-row"
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
                <span className={`chevron ${expanded ? '' : 'collapsed'}`}>▾</span>
              </button>
              {expanded && (
                <DaySchedule
                  items={items}
                  pins={pins}
                  onAdd={(data) => addDayPlanItem({ date, ...data })}
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
