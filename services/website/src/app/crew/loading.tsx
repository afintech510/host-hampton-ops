/**
 * Shown the instant a crew page is being fetched that is not already in hand, so a tab
 * change never stares at the old page. Tabs and party cards are prefetched links, so
 * this is the rare cold case; it uses the app's own card styling and the theme's
 * colours, so it reads as the page arriving rather than a spinner.
 */
export default function CrewLoading() {
  const bar = (w: string, h = '.9rem'): React.CSSProperties => ({ width: w, height: h, borderRadius: '.5rem', background: 'var(--c-surface2)', opacity: 0.8 })
  return (
    <div className="crew-wrap" aria-busy="true" aria-label="Loading">
      <div style={{ ...bar('45%', '1.6rem'), marginBottom: '1rem' }} />
      {[0, 1, 2].map(i => (
        <div key={i} className="crew-card">
          <div style={{ ...bar('60%', '1.1rem'), marginBottom: '.6rem' }} />
          <div style={{ ...bar('85%'), marginBottom: '.45rem' }} />
          <div style={bar('40%')} />
        </div>
      ))}
    </div>
  )
}
