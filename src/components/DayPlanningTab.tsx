import { useMemo, useState } from 'react'
import { useTravelStore, type DayPlanItem, type Pin } from '../store'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function formatDayHeading(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function DayPlanEditForm({
  item,
  pins,
  onSave,
  onCancel,
}: {
  item: DayPlanItem
  pins: Pin[]
  onSave: (patch: { time: string; title: string; notes: string; pinId: string }) => void
  onCancel: () => void
}) {
  const [time, setTime] = useState(item.time)
  const [title, setTitle] = useState(item.title)
  const [notes, setNotes] = useState(item.notes)
  const [pinId, setPinId] = useState(item.pinId)

  return (
    <form
      className="activity-edit-fields"
      onSubmit={(e) => {
        e.preventDefault()
        if (!title.trim()) return
        onSave({ time, title: title.trim(), notes, pinId })
      }}
    >
      <div className="activity-form-row">
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
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

export default function DayPlanningTab() {
  const pins = useTravelStore((s) => s.pins)
  const dayPlanItems = useTravelStore((s) => s.dayPlanItems)
  const addDayPlanItem = useTravelStore((s) => s.addDayPlanItem)
  const updateDayPlanItem = useTravelStore((s) => s.updateDayPlanItem)
  const deleteDayPlanItem = useTravelStore((s) => s.deleteDayPlanItem)

  const [selectedDate, setSelectedDate] = useState(todayIso())
  const [time, setTime] = useState('')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [pinId, setPinId] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)

  const days = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of dayPlanItems) {
      counts.set(item.date, (counts.get(item.date) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, count]) => ({ date, count }))
  }, [dayPlanItems])

  const itemsForSelectedDay = useMemo(
    () =>
      dayPlanItems
        .filter((d) => d.date === selectedDate)
        .sort((a, b) => {
          if (a.time && b.time) return a.time.localeCompare(b.time)
          if (a.time) return -1
          if (b.time) return 1
          return a.createdAt - b.createdAt
        }),
    [dayPlanItems, selectedDate],
  )

  return (
    <div className="dayplan-tab">
      <aside className="dayplan-sidebar">
        <h3>Days</h3>
        <input
          type="date"
          className="dayplan-date-picker"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
        />
        {days.length === 0 && <p className="empty">No days planned yet.</p>}
        <ul>
          {days.map(({ date, count }) => (
            <li
              key={date}
              className={`dayplan-day-item ${
                date === selectedDate ? 'active' : ''
              }`}
              onClick={() => setSelectedDate(date)}
            >
              <span className="dayplan-day-name">{formatDayHeading(date)}</span>
              <span className="count">{count}</span>
            </li>
          ))}
        </ul>
      </aside>

      <section className="dayplan-panel">
        <h2>{formatDayHeading(selectedDate)}</h2>

        <form
          className="dayplan-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (!title.trim()) return
            addDayPlanItem({
              date: selectedDate,
              time,
              title: title.trim(),
              notes,
              pinId,
            })
            setTime('')
            setTitle('')
            setNotes('')
            setPinId('')
          }}
        >
          <div className="activity-form-row">
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
            <input
              placeholder="What's planned?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
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
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
          <button type="submit" className="primary">
            Add to day
          </button>
        </form>

        {itemsForSelectedDay.length === 0 && (
          <p className="empty">Nothing planned for this day yet.</p>
        )}

        <ul className="dayplan-list">
          {itemsForSelectedDay.map((item) => {
            if (editingId === item.id) {
              return (
                <li key={item.id} className="dayplan-item">
                  <DayPlanEditForm
                    item={item}
                    pins={pins}
                    onSave={(patch) => {
                      updateDayPlanItem(item.id, patch)
                      setEditingId(null)
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                </li>
              )
            }
            const linkedPin = pins.find((p) => p.id === item.pinId)
            return (
              <li key={item.id} className="dayplan-item">
                <div className="dayplan-main">
                  {item.time && (
                    <span className="dayplan-time">{item.time}</span>
                  )}
                  <div>
                    <div className="dayplan-title">{item.title}</div>
                    {linkedPin && (
                      <div className="dayplan-place">
                        <span
                          className="dot"
                          style={{ background: linkedPin.color }}
                        />
                        {linkedPin.name}
                      </div>
                    )}
                    {item.notes && (
                      <div className="dayplan-notes">{item.notes}</div>
                    )}
                  </div>
                </div>
                <div className="dayplan-controls">
                  <button
                    type="button"
                    className="small"
                    onClick={() => setEditingId(item.id)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="danger small"
                    onClick={() => deleteDayPlanItem(item.id)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
