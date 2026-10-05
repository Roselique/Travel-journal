import { useEffect, useMemo, useState } from 'react'
import { useTravelStore, type Activity, type ActivityStatus } from '../store'

const STATUS_LABEL: Record<ActivityStatus, string> = {
  idea: 'Idea',
  planned: 'Planned',
  done: 'Done',
}

const STATUS_ORDER: ActivityStatus[] = ['planned', 'idea', 'done']

// Shared row content for both a top-level activity and a grouped child -
// the wrapping element (a <li> or a <div>) differs by context, so this
// only renders what goes inside it.
function ActivityRow({
  activity,
  canReparent,
  parentOptions,
  onStatusChange,
  onParentChange,
  onDelete,
}: {
  activity: Activity
  canReparent: boolean
  parentOptions: Activity[]
  onStatusChange: (status: ActivityStatus) => void
  onParentChange: (parentId: string) => void
  onDelete: () => void
}) {
  return (
    <>
      <div className="activity-main">
        <div className="activity-title">{activity.title}</div>
        {activity.notes && <div className="activity-notes">{activity.notes}</div>}
        {(activity.date || activity.price) && (
          <div className="activity-date">
            {[activity.date, activity.price].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>
      <div className="activity-controls">
        <select
          value={activity.status}
          onChange={(e) => onStatusChange(e.target.value as ActivityStatus)}
        >
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        {canReparent && parentOptions.length > 0 && (
          <select
            value={activity.parentId}
            onChange={(e) => onParentChange(e.target.value)}
          >
            <option value="">No group</option>
            {parentOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        )}
        <button type="button" className="danger small" onClick={onDelete}>
          Delete
        </button>
      </div>
    </>
  )
}

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
  const [price, setPrice] = useState('')
  const [parentId, setParentId] = useState('')
  const [status, setStatus] = useState<ActivityStatus>('idea')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(),
  )

  const toggleGroup = (id: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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

  // Two levels only: a "top" activity (no parent, or a parent that isn't
  // one of this pin's own activities) can have other activities grouped
  // under it as children, e.g. "Museums" with "Van Gogh Museum" beneath.
  const grouped = useMemo(() => {
    const ids = new Set(pinActivities.map((a) => a.id))
    const tops: Activity[] = []
    const childrenByParent = new Map<string, Activity[]>()
    for (const a of pinActivities) {
      if (a.parentId && ids.has(a.parentId)) {
        const list = childrenByParent.get(a.parentId)
        if (list) list.push(a)
        else childrenByParent.set(a.parentId, [a])
      } else {
        tops.push(a)
      }
    }
    return { tops, childrenByParent }
  }, [pinActivities])

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
                  price: price.trim(),
                  parentId,
                  status,
                })
                setTitle('')
                setNotes('')
                setDate('')
                setPrice('')
                setParentId('')
                setStatus('idea')
              }}
            >
              <input
                placeholder="Activity, e.g. Fushimi Inari hike"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
              />
              <div className="activity-form-row">
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
                <input
                  placeholder="Price, e.g. $40"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  maxLength={20}
                />
              </div>
              <div className="activity-form-row">
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
                <select
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                >
                  <option value="">No group (top-level)</option>
                  {grouped.tops.map((t) => (
                    <option key={t.id} value={t.id}>
                      Under &ldquo;{t.title}&rdquo;
                    </option>
                  ))}
                </select>
              </div>
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
              {grouped.tops.map((top) => {
                const children = grouped.childrenByParent.get(top.id) ?? []
                const collapsed = collapsedGroups.has(top.id)
                const parentOptions = grouped.tops.filter((t) => t.id !== top.id)
                return (
                  <li key={top.id} className="activity-group">
                    <div className={`activity-item status-${top.status} activity-group-header`}>
                      {children.length > 0 && (
                        <button
                          type="button"
                          className="chevron-btn"
                          onClick={() => toggleGroup(top.id)}
                          aria-expanded={!collapsed}
                          aria-label={collapsed ? 'Expand group' : 'Collapse group'}
                        >
                          <span className={`chevron ${collapsed ? 'collapsed' : ''}`}>
                            ▾
                          </span>
                        </button>
                      )}
                      <ActivityRow
                        activity={top}
                        canReparent={children.length === 0}
                        parentOptions={parentOptions}
                        onStatusChange={(s) => updateActivity(top.id, { status: s })}
                        onParentChange={(p) => updateActivity(top.id, { parentId: p })}
                        onDelete={() => deleteActivity(top.id)}
                      />
                    </div>
                    {children.length > 0 && !collapsed && (
                      <ul className="activity-sublist">
                        {children.map((child) => (
                          <li
                            key={child.id}
                            className={`activity-item status-${child.status}`}
                          >
                            <ActivityRow
                              activity={child}
                              canReparent
                              parentOptions={grouped.tops.filter((t) => t.id !== child.id)}
                              onStatusChange={(s) =>
                                updateActivity(child.id, { status: s })
                              }
                              onParentChange={(p) =>
                                updateActivity(child.id, { parentId: p })
                              }
                              onDelete={() => deleteActivity(child.id)}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}
