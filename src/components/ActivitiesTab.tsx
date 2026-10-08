import { useEffect, useMemo, useState } from 'react'
import { compareContinents, locateCountry } from '../lib/geo'
import { useTravelStore, type Activity, type ActivityStatus, type Pin } from '../store'

const STATUS_LABEL: Record<ActivityStatus, string> = {
  idea: 'Idea',
  planned: 'Planned',
  done: 'Done',
}

const STATUS_ORDER: ActivityStatus[] = ['planned', 'idea', 'done']

// Shared row content for an ungrouped/grouped activity. `compact` switches
// from the wide "content left, controls right" row (used for ungrouped
// activities and category headers) to a narrow stacked card (used for
// activities sitting side-by-side inside a category). Manages its own
// edit-mode state/fields, seeded fresh from `activity` each time editing
// starts, and calls onEdit with the saved patch.
function ActivityRow({
  activity,
  compact,
  categoryOptions,
  onStatusChange,
  onParentChange,
  onDelete,
  onEdit,
}: {
  activity: Activity
  compact: boolean
  categoryOptions: Activity[]
  onStatusChange: (status: ActivityStatus) => void
  onParentChange: (parentId: string) => void
  onDelete: () => void
  onEdit: (patch: {
    title: string
    notes: string
    date: string
    time: string
    endTime: string
    price: string
  }) => void
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(activity.title)
  const [notes, setNotes] = useState(activity.notes)
  const [date, setDate] = useState(activity.date)
  const [time, setTime] = useState(activity.time)
  const [endTime, setEndTime] = useState(activity.endTime)
  const [price, setPrice] = useState(activity.price)

  const startEdit = () => {
    setTitle(activity.title)
    setNotes(activity.notes)
    setDate(activity.date)
    setTime(activity.time)
    setEndTime(activity.endTime)
    setPrice(activity.price)
    setEditing(true)
  }

  if (editing) {
    return (
      <form
        className="activity-edit-fields"
        onSubmit={(e) => {
          e.preventDefault()
          if (!title.trim()) return
          onEdit({ title: title.trim(), notes, date, time, endTime, price: price.trim() })
          setEditing(false)
        }}
      >
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Activity title"
          maxLength={120}
        />
        <div className="activity-form-row">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <input
            placeholder="Price, e.g. $40"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            maxLength={20}
          />
        </div>
        <div className="activity-form-row">
          <label className="dayplan-time-field">
            Start
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
          <label className="dayplan-time-field">
            End
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </label>
        </div>
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
          <button type="button" className="small" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </form>
    )
  }

  const timeRange = activity.time
    ? `${activity.time}${activity.endTime ? ` – ${activity.endTime}` : ''}`
    : ''

  return (
    <>
      <div className="activity-main">
        <div className="activity-title">{activity.title}</div>
        {activity.notes && <div className="activity-notes">{activity.notes}</div>}
        {(activity.date || timeRange || activity.price) && (
          <div className="activity-date">
            {[activity.date, timeRange, activity.price].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>
      <div className={compact ? 'activity-controls compact' : 'activity-controls'}>
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
        {categoryOptions.length > 0 && (
          <select
            value={activity.parentId}
            onChange={(e) => onParentChange(e.target.value)}
          >
            <option value="">No category</option>
            {categoryOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        )}
        <button type="button" className="small" onClick={startEdit}>
          Edit
        </button>
        <button type="button" className="danger small" onClick={onDelete}>
          Delete
        </button>
      </div>
    </>
  )
}

// Minimal title+notes edit toggle for a category header (no date/price/
// status - those don't apply to a pure grouping header).
function CategoryEditFields({
  category,
  onSave,
  onCancel,
}: {
  category: Activity
  onSave: (patch: { title: string; notes: string }) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState(category.title)
  const [notes, setNotes] = useState(category.notes)

  return (
    <form
      className="activity-edit-fields"
      onSubmit={(e) => {
        e.preventDefault()
        if (!title.trim()) return
        onSave({ title: title.trim(), notes })
      }}
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Category title"
        maxLength={80}
      />
      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Note (optional)"
        maxLength={200}
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

export default function ActivitiesTab() {
  const pins = useTravelStore((s) => s.pins)
  const activities = useTravelStore((s) => s.activities)
  const addActivity = useTravelStore((s) => s.addActivity)
  const updateActivity = useTravelStore((s) => s.updateActivity)
  const deleteActivity = useTravelStore((s) => s.deleteActivity)
  const updatePin = useTravelStore((s) => s.updatePin)

  const [selectedPinId, setSelectedPinId] = useState<string | null>(
    pins[0]?.id ?? null,
  )
  const [locationSearch, setLocationSearch] = useState('')

  const [categoryTitle, setCategoryTitle] = useState('')
  const [categoryNotes, setCategoryNotes] = useState('')

  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [price, setPrice] = useState('')
  const [parentId, setParentId] = useState('')
  const [status, setStatus] = useState<ActivityStatus>('idea')

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(),
  )
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [addingStay, setAddingStay] = useState(false)
  const [stayName, setStayName] = useState('')
  const [stayNotes, setStayNotes] = useState('')

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

  useEffect(() => {
    setCategoryFilter('')
    setAddingStay(false)
  }, [selectedPinId])

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

  // Categories are pure grouping headers (made via the category form);
  // every other activity is either sitting under one (a child, shown
  // side-by-side in that category's row) or ungrouped (shown in the plain
  // stacked list below).
  const grouped = useMemo(() => {
    const categories = pinActivities.filter((a) => a.isCategory)
    const categoryIds = new Set(categories.map((c) => c.id))
    const childrenByCategory = new Map<string, Activity[]>()
    const ungrouped: Activity[] = []
    for (const a of pinActivities) {
      if (a.isCategory) continue
      if (a.parentId && categoryIds.has(a.parentId)) {
        const list = childrenByCategory.get(a.parentId)
        if (list) list.push(a)
        else childrenByCategory.set(a.parentId, [a])
      } else {
        ungrouped.push(a)
      }
    }
    return { categories, childrenByCategory, ungrouped }
  }, [pinActivities])

  const countFor = (pinId: string) =>
    activities.filter((a) => a.pinId === pinId).length

  const groupedLocations = useMemo(() => {
    const q = locationSearch.trim().toLowerCase()
    const filtered = q
      ? pins.filter((p) => p.name.toLowerCase().includes(q))
      : pins
    const byContinent = new Map<string, Pin[]>()
    for (const p of filtered) {
      const { continent } = locateCountry(p.lat, p.lng)
      const list = byContinent.get(continent)
      if (list) list.push(p)
      else byContinent.set(continent, [p])
    }
    return [...byContinent.entries()]
      .sort((a, b) => compareContinents(a[0], b[0]))
      .map(([continent, list]) => ({
        continent,
        pins: [...list].sort((a, b) => a.name.localeCompare(b.name)),
      }))
  }, [pins, locationSearch])

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
        <input
          className="search"
          placeholder="Search locations..."
          value={locationSearch}
          onChange={(e) => setLocationSearch(e.target.value)}
        />
        {groupedLocations.length === 0 && (
          <p className="empty">No matching locations.</p>
        )}
        {groupedLocations.map(({ continent, pins: group }) => (
          <div key={continent} className="location-group">
            <div className="location-group-heading">{continent}</div>
            <ul>
              {group.map((p) => (
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
          </div>
        ))}
      </aside>

      <section className="activities-panel">
        {selectedPin && (
          <>
            <h2>{selectedPin.name}</h2>

            <div className="stay-section">
              <div className="section-label">Stay</div>
              {addingStay ? (
                <form
                  className="stay-form"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (!stayName.trim()) return
                    updatePin(selectedPin.id, { stayName: stayName.trim(), stayNotes })
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
              ) : selectedPin.stayName ? (
                <div className="stay-card">
                  <div className="activity-main">
                    <div className="activity-title">{selectedPin.stayName}</div>
                    {selectedPin.stayNotes && (
                      <div className="activity-notes">{selectedPin.stayNotes}</div>
                    )}
                  </div>
                  <div className="activity-controls">
                    <button
                      type="button"
                      className="small"
                      onClick={() => {
                        setStayName(selectedPin.stayName)
                        setStayNotes(selectedPin.stayNotes)
                        setAddingStay(true)
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="danger small"
                      onClick={() => updatePin(selectedPin.id, { stayName: '', stayNotes: '' })}
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
                href={`https://www.google.com/search?q=${encodeURIComponent(
                  `hotels in ${selectedPin.name}`,
                )}`}
                target="_blank"
                rel="noreferrer"
              >
                Search hotels in {selectedPin.name} →
              </a>
            </div>

            <div className="places-overview">
              <div className="places-overview-top">
                <div className="section-label">Places in {selectedPin.name}</div>
                <div className="places-overview-stats">
                  {pinActivities.filter((a) => !a.isCategory).length} saved
                </div>
              </div>
              <div className="category-pills">
                <button
                  type="button"
                  className={`category-pill ${categoryFilter === '' ? 'active' : ''}`}
                  onClick={() => setCategoryFilter('')}
                >
                  All
                  <span className="pill-count">
                    {pinActivities.filter((a) => !a.isCategory).length}
                  </span>
                </button>
                {grouped.categories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`category-pill ${categoryFilter === c.id ? 'active' : ''}`}
                    onClick={() => setCategoryFilter(c.id)}
                  >
                    {c.title}
                    <span className="pill-count">
                      {(grouped.childrenByCategory.get(c.id) ?? []).length}
                    </span>
                  </button>
                ))}
                {grouped.ungrouped.length > 0 && (
                  <button
                    type="button"
                    className={`category-pill ${categoryFilter === '__ungrouped__' ? 'active' : ''}`}
                    onClick={() => setCategoryFilter('__ungrouped__')}
                  >
                    Other
                    <span className="pill-count">{grouped.ungrouped.length}</span>
                  </button>
                )}
              </div>
            </div>

            <form
              className="category-form"
              onSubmit={(e) => {
                e.preventDefault()
                if (!categoryTitle.trim()) return
                addActivity({
                  pinId: selectedPin.id,
                  title: categoryTitle.trim(),
                  notes: categoryNotes,
                  date: '',
                  time: '',
                  endTime: '',
                  price: '',
                  parentId: '',
                  isCategory: true,
                  status: 'idea',
                })
                setCategoryTitle('')
                setCategoryNotes('')
              }}
            >
              <input
                placeholder="New category, e.g. Museums"
                value={categoryTitle}
                onChange={(e) => setCategoryTitle(e.target.value)}
                maxLength={80}
              />
              <input
                placeholder="Note (optional)"
                value={categoryNotes}
                onChange={(e) => setCategoryNotes(e.target.value)}
                maxLength={200}
              />
              <button type="submit">Add category</button>
            </form>

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
                  time,
                  endTime,
                  price: price.trim(),
                  parentId,
                  isCategory: false,
                  status,
                })
                setTitle('')
                setNotes('')
                setDate('')
                setTime('')
                setEndTime('')
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
                  <option value="">No category</option>
                  {grouped.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
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

            {pinActivities.length === 0 && (
              <p className="empty">No activities planned yet.</p>
            )}

            {grouped.categories
              .filter((cat) => categoryFilter === '' || categoryFilter === cat.id)
              .map((cat) => {
              const children = grouped.childrenByCategory.get(cat.id) ?? []
              const collapsed = collapsedGroups.has(cat.id)
              return (
                <div key={cat.id} className="activity-category">
                  <div className="activity-item activity-category-header">
                    {children.length > 0 && (
                      <button
                        type="button"
                        className="chevron-btn"
                        onClick={() => toggleGroup(cat.id)}
                        aria-expanded={!collapsed}
                        aria-label={collapsed ? 'Expand category' : 'Collapse category'}
                      >
                        <span className={`chevron ${collapsed ? 'collapsed' : ''}`}>
                          ▾
                        </span>
                      </button>
                    )}
                    {editingCategoryId === cat.id ? (
                      <CategoryEditFields
                        category={cat}
                        onSave={(patch) => {
                          updateActivity(cat.id, patch)
                          setEditingCategoryId(null)
                        }}
                        onCancel={() => setEditingCategoryId(null)}
                      />
                    ) : (
                      <>
                        <div className="activity-main">
                          <div className="activity-title">{cat.title}</div>
                          {cat.notes && <div className="activity-notes">{cat.notes}</div>}
                        </div>
                        <div className="activity-controls">
                          <button
                            type="button"
                            className="small"
                            onClick={() => setEditingCategoryId(cat.id)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="danger small"
                            onClick={() => deleteActivity(cat.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                  {children.length > 0 && !collapsed && (
                    <div className="activity-grid">
                      {children.map((child) => (
                        <div
                          key={child.id}
                          className={`activity-card status-${child.status}`}
                        >
                          <ActivityRow
                            activity={child}
                            compact
                            categoryOptions={grouped.categories}
                            onStatusChange={(s) =>
                              updateActivity(child.id, { status: s })
                            }
                            onParentChange={(p) =>
                              updateActivity(child.id, { parentId: p })
                            }
                            onDelete={() => deleteActivity(child.id)}
                            onEdit={(patch) => updateActivity(child.id, patch)}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}

            <ul className="activity-list">
              {(categoryFilter === '' || categoryFilter === '__ungrouped__') &&
                grouped.ungrouped.map((a) => (
                <li key={a.id} className={`activity-item status-${a.status}`}>
                  <ActivityRow
                    activity={a}
                    compact={false}
                    categoryOptions={grouped.categories}
                    onStatusChange={(s) => updateActivity(a.id, { status: s })}
                    onParentChange={(p) => updateActivity(a.id, { parentId: p })}
                    onDelete={() => deleteActivity(a.id)}
                    onEdit={(patch) => updateActivity(a.id, patch)}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}
