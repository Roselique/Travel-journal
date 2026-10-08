import { useState } from 'react'
import MapTab from './components/MapTab'
import ActivitiesTab from './components/ActivitiesTab'
import DayPlanningTab from './components/DayPlanningTab'

type Tab = 'map' | 'activities' | 'dayplan'

const TABS: { id: Tab; label: string }[] = [
  { id: 'map', label: '🌍 Map' },
  { id: 'activities', label: '🗓️ Activities' },
  { id: 'dayplan', label: '📅 Day Planning' },
]

function App() {
  const [tab, setTab] = useState<Tab>('map')

  return (
    <div className="app">
      <header className="app-header">
        <h1>Travel Journal</h1>
        <nav className="tab-nav">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab-btn ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="app-main">
        {tab === 'map' && <MapTab />}
        {tab === 'activities' && <ActivitiesTab />}
        {tab === 'dayplan' && <DayPlanningTab />}
      </main>
    </div>
  )
}

export default App
