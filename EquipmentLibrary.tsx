import type { FormEvent } from 'react'
import { useRef, useState } from 'react'
import type { WorkoutStore } from '../hooks/useWorkoutStore'
import { EmptyState } from './EmptyState'
import { SiriShortcutHelp } from './SiriShortcutHelp'

type Props = {
  store: WorkoutStore
  onLogEquipment: (id: string) => void
}

export function EquipmentLibrary({ store, onLogEquipment }: Props) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  function add(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      store.addEquipment(name)
      setName('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add')
    }
  }

  function startRename(id: string, current: string) {
    setRenamingId(id)
    setRenameValue(current)
    setError(null)
  }

  function commitRename(e: FormEvent) {
    e.preventDefault()
    if (!renamingId) return
    try {
      store.renameEquipment(renamingId, renameValue)
      setRenamingId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename')
    }
  }

  async function onImportFile(file: File | null) {
    if (!file) return
    try {
      const text = await file.text()
      store.importData(text)
      setError(null)
      alert('Import complete. Your library and history were replaced.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="panel">
      <header className="panel-header">
        <h1>Equipment</h1>
        <p className="muted">Saved names for quick pick and autocomplete.</p>
      </header>

      <form className="form inline-form" onSubmit={add}>
        <label className="field grow">
          <span>Add equipment</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Dumbbell bench…"
            required
          />
        </label>
        <button type="submit" className="btn btn-primary">
          Add
        </button>
      </form>
      {error ? <p className="form-error">{error}</p> : null}

      {store.equipmentSorted.length === 0 ? (
        <EmptyState
          icon="📋"
          title="Build your library"
          body="Add machines and free weights you use. Logging a new name also saves it here automatically."
        />
      ) : (
        <ul className="equip-list">
          {store.equipmentSorted.map((eq) => (
            <li key={eq.id} className="card equip-card">
              {renamingId === eq.id ? (
                <form className="form inline-form" onSubmit={commitRename}>
                  <input
                    className="input grow"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    autoFocus
                  />
                  <button type="submit" className="btn btn-primary btn-sm">
                    Save
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setRenamingId(null)}
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <div className="equip-name">{eq.name}</div>
                  <div className="row-actions wrap">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => onLogEquipment(eq.id)}
                    >
                      Log
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => startRename(eq.id, eq.name)}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger-ghost btn-sm"
                      onClick={() => {
                        if (
                          confirm(
                            `Remove “${eq.name}” from the library? Past sets keep the name.`,
                          )
                        ) {
                          store.removeEquipment(eq.id)
                        }
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <SiriShortcutHelp />

      <section className="card data-card">
        <h2>Data</h2>
        <p className="muted">
          Everything is stored in this browser (localStorage). Export a backup or import a previous JSON file.
        </p>
        <div className="row-actions wrap">
          <button type="button" className="btn btn-secondary" onClick={() => store.exportData()}>
            Export JSON
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => fileRef.current?.click()}
          >
            Import JSON
          </button>
          <button
            type="button"
            className="btn btn-danger-ghost"
            onClick={() => {
              if (
                confirm(
                  'Clear all workouts and equipment on this device? This cannot be undone.',
                )
              ) {
                store.clearAll()
              }
            }}
          >
            Clear all
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => onImportFile(e.target.files?.[0] ?? null)}
        />
      </section>
    </div>
  )
}
