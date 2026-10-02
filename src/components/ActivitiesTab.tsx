import { useEffect, useMemo, useState } from 'react'
import { useTravelStore, type ActivityStatus } from '../store'

const STATUS_LABEL: Record<ActivityStatus, string> = {
  idea: 'Idea',
  planned: 'Planned',
  done: 'Done',
}

const STATUS_ORDER: ActivityStatus[] = ['planned', 'idea', 'done']

export default function ActivitiesTab() {
  const pins = useTravelStore((s) => s.pins)
  const activities = useTravelStore((s) => s.activities)
  const addActivity = useTravelStore((s) => s.addActivity)
  const updateActivity = useTravelStore((s) => s.updateActivity)
  const deleteActivity = useTravelStore((s) => s.deleteActivity)

  const [selectedPinId, setSelectedPinId] = useState<string | null>(
    pins[0]?.id ?? null,
  )
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [date, setDate] = useState('')
  const [status, setStatus] = useState<ActivityStatus>('idea')

  const selectedPin = pins.find((p) => p.id === selectedPinId) ?? null

  useEffect(() => {
    if (!selectedPin && pins.length > 0) {
      setSelectedPinId(pins[0].id)
    }
  }, [selectedPin, pins])

  const pinActivities = useMemo(
    () =>
      activities
        .filter((a) => a.pinId === selectedPinId)
        .sort((a, b) => {
          if (a.date && b.date) return a.date.localeCompare(b.date)
          if (a.date) return -1
          if (b.date) return 1
          return a.createdAt - b.createdAt
        }),
    [activities, selectedPinId],
  )

  const countFor = (pinId: string) =>
    activities.filter((a) => a.pinId === pinId).length

  if (pins.length === 0) {
    return (
      <div className="empty-state">
        <h2>No pinned places yet</h2>
        <p>Drop a pin on the Map tab first, then plan activities for it here.</p>
      </div>
    )
  }

  return (
    <div className="activities-tab">
      <aside className="location-list">
        <h3>Locations</h3>
        <ul>
          {pins.map((p) => (
            <li
              key={p.id}
              className={`location-item ${
                p.id === selectedPinId ? 'active' : ''
              }`}
              onClick={() => setSelectedPinId(p.id)}
            >
              <span className="dot" style={{ background: p.color }} />
              <span className="location-name">{p.name}</span>
              <span className="count">{countFor(p.id)}</span>
            </li>
          ))}
        </ul>
      </aside>

      <section className="activities-panel">
        {selectedPin && (
          <>
            <h2>{selectedPin.name}</h2>
            <form
              className="activity-form"
              onSubmit={(e) => {
                e.preventDefault()
                if (!title.trim()) return
                addActivity({
                  pinId: selectedPin.id,
                  title: title.trim(),
                  notes,
                  date,
                  status,
                })
                setTitle('')
                setNotes('')
                setDate('')
                setStatus('idea')
              }}
            >
              <input
                placeholder="Activity, e.g. Fushimi Inari hike"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
              />
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as ActivityStatus)}
              >
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
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
                Add activity
              </button>
            </form>

            <ul className="activity-list">
              {pinActivities.length === 0 && (
                <li className="empty">No activities planned yet.</li>
              )}
              {pinActivities.map((a) => (
                <li key={a.id} className={`activity-item status-${a.status}`}>
                  <div className="activity-main">
                    <div className="activity-title">{a.title}</div>
                    {a.notes && <div className="activity-notes">{a.notes}</div>}
                    {a.date && <div className="activity-date">{a.date}</div>}
                  </div>
                  <div className="activity-controls">
                    <select
                      value={a.status}
                      onChange={(e) =>
                        updateActivity(a.id, {
                          status: e.target.value as ActivityStatus,
                        })
                      }
                    >
                      {STATUS_ORDER.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="danger small"
                      onClick={() => deleteActivity(a.id)}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}
