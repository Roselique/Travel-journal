import { useState } from 'react'
import { useTravelStore } from '../store'

export default function WishlistTab() {
  const pins = useTravelStore((s) => s.pins)
  const wishes = useTravelStore((s) => s.wishes)
  const addWish = useTravelStore((s) => s.addWish)
  const deleteWish = useTravelStore((s) => s.deleteWish)

  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [pinId, setPinId] = useState('')
  const [placeName, setPlaceName] = useState('')
  const [tags, setTags] = useState('')

  const sorted = [...wishes].sort((a, b) => b.createdAt - a.createdAt)

  return (
    <div className="wishlist-tab">
      <section className="wishlist-form-panel">
        <h2>Speculations &amp; wishes</h2>
        <p className="hint">
          Dream destinations, bucket-list ideas, or things to maybe do
          someday &mdash; linked to a pin or just a place name.
        </p>
        <form
          className="wish-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (!title.trim()) return
            addWish({
              title: title.trim(),
              notes,
              pinId,
              placeName: pinId ? '' : placeName.trim(),
              tags,
            })
            setTitle('')
            setNotes('')
            setPinId('')
            setPlaceName('')
            setTags('')
          }}
        >
          <input
            placeholder="Wish, e.g. See the northern lights"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
          />
          <select value={pinId} onChange={(e) => setPinId(e.target.value)}>
            <option value="">No linked pin (freeform place)</option>
            {pins.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {!pinId && (
            <input
              placeholder="Place name (optional, e.g. Iceland)"
              value={placeName}
              onChange={(e) => setPlaceName(e.target.value)}
              maxLength={80}
            />
          )}
          <input
            placeholder="Tags (comma separated, optional)"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
          <textarea
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
          <button type="submit" className="primary">
            Add to wishlist
          </button>
        </form>
      </section>

      <section className="wishlist-items">
        {sorted.length === 0 && (
          <div className="empty-state small">
            <p>No wishes yet &mdash; add a dream destination above.</p>
          </div>
        )}
        <ul>
          {sorted.map((w) => {
            const linkedPin = pins.find((p) => p.id === w.pinId)
            const place = linkedPin?.name || w.placeName
            return (
              <li key={w.id} className="wish-item">
                <div className="wish-main">
                  <div className="wish-title">{w.title}</div>
                  {place && (
                    <div className="wish-place">
                      {linkedPin && (
                        <span
                          className="dot"
                          style={{ background: linkedPin.color }}
                        />
                      )}
                      {place}
                    </div>
                  )}
                  {w.notes && <div className="wish-notes">{w.notes}</div>}
                  {w.tags && (
                    <div className="wish-tags">
                      {w.tags
                        .split(',')
                        .map((t) => t.trim())
                        .filter(Boolean)
                        .map((t) => (
                          <span key={t} className="tag">
                            {t}
                          </span>
                        ))}
                    </div>
                  )}
                </div>
                <div className="wish-controls">
                  <button
                    type="button"
                    className="danger small"
                    onClick={() => deleteWish(w.id)}
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
