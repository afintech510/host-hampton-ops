'use client'

import { useMemo, useRef } from 'react'
import { Download, ExternalLink } from 'lucide-react'
import { REVENUE_REPORT_HTML_B64 } from './revenueReportHtml'

/* ─── Revenue Report Tab ──────────────────────────────
   Renders the self-contained Host Hampton revenue report
   (charts + tables) inside a sandboxed iframe via srcDoc,
   so the customer names / revenue figures stay behind the
   admin login gate rather than at a public static URL. */

// Decode the base64 report once. atob handles the ASCII base64 fine here.
function decodeReport(): string {
  try {
    return decodeURIComponent(escape(atob(REVENUE_REPORT_HTML_B64)))
  } catch {
    return atob(REVENUE_REPORT_HTML_B64)
  }
}

export default function RevenueTab({ headers, onLogout }: { headers: Record<string, string>; onLogout: () => void }) {
  const html = useMemo(decodeReport, [])
  const iframeRef = useRef<HTMLIFrameElement>(null)

  function download() {
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'Host_Hampton_Revenue_Report.html'
    a.click()
    URL.revokeObjectURL(url)
  }

  function openInNewTab() {
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank')
    // Give the new tab time to load before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-end gap-2 mb-4">
        <button
          onClick={openInNewTab}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-600 hover:text-hampton-navy hover:bg-gray-50 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Open full screen
        </button>
        <button
          onClick={download}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-600 hover:text-hampton-navy hover:bg-gray-50 transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Download HTML
        </button>
      </div>

      <div className="rounded-2xl border border-gray-200/70 overflow-hidden bg-white shadow-sm">
        <iframe
          ref={iframeRef}
          title="Host Hampton Revenue Report"
          srcDoc={html}
          className="w-full block"
          style={{ height: 'calc(100vh - 160px)', minHeight: 640, border: 'none' }}
          // Allow-scripts is required for the Chart.js rendering; the same-origin
          // grant lets the report's inline script read its own CSS variables.
          sandbox="allow-scripts allow-same-origin allow-popups allow-downloads"
        />
      </div>
    </div>
  )
}
