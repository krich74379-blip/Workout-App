import { useMemo, useState } from 'react'
import { exampleDeepLinkUrl } from '../lib/deepLinkLog'

export function SiriShortcutHelp() {
  const [copied, setCopied] = useState(false)
  const example = useMemo(() => exampleDeepLinkUrl(), [])
  const origin = useMemo(
    () =>
      typeof window !== 'undefined' ? window.location.origin : 'https://YOUR_ORIGIN',
    [],
  )
  const pattern = `${origin}/?log=`

  async function copyPattern() {
    try {
      await navigator.clipboard.writeText(pattern)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      /* ignore */
    }
  }

  return (
    <section className="card siri-help" aria-label="Siri Shortcut">
      <h2>Siri Shortcut</h2>
      <p className="muted">
        PWAs can’t register with Siri directly. Use an iOS Shortcut that opens this
        app with your spoken set in the URL — it saves into this phone’s local
        storage.
      </p>
      <p className="siri-pattern">
        <code>{pattern}</code>
        <em>Dictated Text</em>
      </p>
      <p className="muted small">
        Example:{' '}
        <code className="wrap-code">{example}</code>
      </p>
      <div className="row-actions wrap">
        <button type="button" className="btn btn-secondary" onClick={copyPattern}>
          {copied ? 'Copied' : 'Copy URL prefix'}
        </button>
      </div>
      <ol className="siri-steps muted">
        <li>Shortcuts app → <strong>+</strong> → New Shortcut</li>
        <li>Add <strong>Dictate Text</strong> (or Ask for Input)</li>
        <li>
          Add <strong>Open URLs</strong>: <code>{pattern}</code> + Dictated Text
          (Shortcuts encodes spaces)
        </li>
        <li>
          Shortcut details → <strong>Add to Siri</strong> → phrase e.g. “Log my
          set”
        </li>
      </ol>
      <p className="muted small">
        Phone must reach this same HTTPS origin (your Cloudflare tunnel URL while
        tunneling).
      </p>
    </section>
  )
}
