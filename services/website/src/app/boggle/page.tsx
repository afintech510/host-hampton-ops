'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

/* ── Trie ── */
class TrieNode {
  children: Record<string, TrieNode> = {}
  isWord = false
}

function buildTrie(words: string[]) {
  const root = new TrieNode()
  for (const word of words) {
    let node = root
    for (const ch of word) {
      if (!node.children[ch]) node.children[ch] = new TrieNode()
      node = node.children[ch]
    }
    node.isWord = true
  }
  return root
}

/* ── DFS Solver ── */
type SolveResult = { word: string; path: [number, number][] }

function solveBoggle(grid: string[][], trie: TrieNode): SolveResult[] {
  const rows = grid.length
  const cols = grid[0].length
  const found = new Map<string, [number, number][]>()
  const dirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]

  function dfs(r: number, c: number, node: TrieNode, path: [number,number][], word: string, visited: Set<number>) {
    const ch = grid[r][c].toLowerCase()
    if (!node.children[ch]) return
    const next = node.children[ch]
    const newWord = word + ch
    path.push([r, c])
    if (next.isWord && !found.has(newWord)) found.set(newWord, [...path])
    for (const [dr, dc] of dirs) {
      const nr = r + dr, nc = c + dc
      const key = nr * cols + nc
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !visited.has(key)) {
        visited.add(key)
        dfs(nr, nc, next, path, newWord, visited)
        visited.delete(key)
      }
    }
    path.pop()
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const visited = new Set([r * cols + c])
      dfs(r, c, trie, [], '', visited)
    }
  }

  return Array.from(found.entries())
    .map(([word, path]) => ({ word, path }))
    .sort((a, b) => b.word.length - a.word.length || a.word.localeCompare(b.word))
}

/* ── Parse grid text ── */
function parseGrid(text: string): string[][] | null {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0)
  const g = lines.map(line =>
    line.toUpperCase().split(/[\s,;|]+/).filter(c => /^[A-Z]$/.test(c))
  )
  const maxCols = Math.max(...g.map(r => r.length))
  if (g.length >= 2 && maxCols >= 2 && g.every(r => r.length === maxCols)) return g
  return null
}

/* ── Component ── */
export default function BoggleSolver() {
  const [grid, setGrid] = useState<string[][] | null>(null)
  const [gridText, setGridText] = useState('')
  const [results, setResults] = useState<SolveResult[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [ocrLoading, setOcrLoading] = useState(false)
  const [dictStatus, setDictStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [dictCount, setDictCount] = useState(0)
  const [solveTime, setSolveTime] = useState(0)
  const [hoveredWord, setHoveredWord] = useState<SolveResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [minLen, setMinLen] = useState(3)
  const [filterText, setFilterText] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const trieRef = useRef<TrieNode | null>(null)

  // Load dictionary
  useEffect(() => {
    async function loadDict() {
      try {
        setDictStatus('loading')
        const res = await fetch('https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt')
        const text = await res.text()
        const words = text.split('\n').map(w => w.trim().toLowerCase()).filter(w => w.length >= 3 && w.length <= 12 && /^[a-z]+$/.test(w))
        setDictCount(words.length)
        trieRef.current = buildTrie(words)
        setDictStatus('ready')
      } catch {
        setDictStatus('error')
        setError('Failed to load dictionary. Check your connection.')
      }
    }
    loadDict()
  }, [])

  // OCR via API route
  const handleImageUpload = useCallback(async (file: File) => {
    setError(null)
    setResults(null)
    const reader = new FileReader()
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string
      setImagePreview(dataUrl)
      const base64 = dataUrl.split(',')[1]
      const mimeMatch = dataUrl.match(/data:(.*?);/)
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/png'

      setOcrLoading(true)
      try {
        const res = await fetch('/api/boggle-ocr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64, mimeType }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'OCR failed')
        const text = data.grid as string
        setGridText(text)
        const parsed = parseGrid(text)
        if (parsed) {
          setGrid(parsed)
        } else {
          setError('Could not parse grid from OCR. Edit the text below.')
        }
      } catch (e: unknown) {
        setError('OCR failed: ' + (e instanceof Error ? e.message : 'Unknown error'))
      } finally {
        setOcrLoading(false)
      }
    }
    reader.readAsDataURL(file)
  }, [])

  // Solve
  const handleSolve = useCallback(() => {
    if (!grid || !trieRef.current) return
    setLoading(true)
    setHoveredWord(null)
    setTimeout(() => {
      const t0 = performance.now()
      const res = solveBoggle(grid, trieRef.current!)
      const elapsed = performance.now() - t0
      setSolveTime(elapsed)
      setResults(res)
      setLoading(false)
    }, 10)
  }, [grid])

  // Grid text change
  const handleGridTextChange = useCallback((text: string) => {
    setGridText(text)
    const parsed = parseGrid(text)
    if (parsed) { setGrid(parsed); setError(null) }
  }, [])

  // Drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith('image/')) handleImageUpload(file)
  }, [handleImageUpload])

  // Highlighted cells
  const highlightedCells = hoveredWord
    ? new Map(hoveredWord.path.map(([r, c], i) => [`${r},${c}`, i]))
    : null

  // Filtered & grouped
  const filtered = results?.filter(r =>
    r.word.length >= minLen && (filterText === '' || r.word.includes(filterText.toLowerCase()))
  ) ?? null

  const grouped = filtered?.reduce<Record<number, SolveResult[]>>((acc, r) => {
    const len = r.word.length
    if (!acc[len]) acc[len] = []
    acc[len].push(r)
    return acc
  }, {}) ?? null

  const groupKeys = grouped ? Object.keys(grouped).map(Number).sort((a, b) => b - a) : []

  return (
    <div style={{ minHeight: '100vh', background: '#0a0e1a', color: '#e2e8f0', fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', ui-monospace, monospace", padding: 20 }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 28, borderBottom: '1px solid #1e293b', paddingBottom: 16 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: 6, margin: 0, background: 'linear-gradient(135deg, #38bdf8, #818cf8, #c084fc)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          BOGGLE SOLVER
        </h1>
        <p style={{ fontSize: 12, color: '#64748b', margin: '6px 0 10px', letterSpacing: 1 }}>
          Upload a screenshot or type your grid manually
        </p>
        <span style={{ display: 'inline-block', fontSize: 11, padding: '3px 10px', borderRadius: 20, background: '#1e293b', color: '#94a3b8' }}>
          {dictStatus === 'loading' && 'Loading dictionary...'}
          {dictStatus === 'ready' && `\u2713 ${dictCount.toLocaleString()} words loaded`}
          {dictStatus === 'error' && '\u2717 Dictionary failed'}
        </span>
      </div>

      {/* Body */}
      <div style={{ display: 'flex', gap: 20, maxWidth: 1100, margin: '0 auto', flexWrap: 'wrap' as const }}>
        {/* Left Panel */}
        <div style={{ flex: '1 1 340px', minWidth: 300 }}>
          {/* Upload zone */}
          <div
            style={{ border: '2px dashed #334155', borderRadius: 12, padding: 20, textAlign: 'center', cursor: 'pointer', marginBottom: 14, minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', transition: 'border-color 0.2s' }}
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
          >
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { if (e.target.files?.[0]) handleImageUpload(e.target.files[0]) }} />
            {ocrLoading ? (
              <div style={{ color: '#818cf8', fontSize: 14, padding: 20 }}>Reading grid...</div>
            ) : imagePreview ? (
              <img src={imagePreview} alt="Grid screenshot" style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 8, objectFit: 'contain' }} />
            ) : (
              <div style={{ padding: 10 }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>&#128247;</div>
                <div style={{ fontSize: 13, color: '#64748b' }}>Drop screenshot here or tap to upload</div>
              </div>
            )}
          </div>

          {/* Grid text editor */}
          <label style={labelStyle}>Grid (edit if OCR is wrong)</label>
          <textarea
            style={{ width: '100%', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, color: '#e2e8f0', fontFamily: "'JetBrains Mono', monospace", fontSize: 15, padding: 12, resize: 'vertical' as const, letterSpacing: 3, lineHeight: 1.8, boxSizing: 'border-box' as const, outline: 'none' }}
            rows={7}
            value={gridText}
            onChange={e => handleGridTextChange(e.target.value)}
            placeholder={'A M K U G S\nR X I Y R O\nK O R I T E\nD E D E S I\nI N N N L G\nN R A S O H'}
            spellCheck={false}
          />

          {error && (
            <div style={{ background: '#7f1d1d33', border: '1px solid #991b1b', color: '#fca5a5', borderRadius: 8, padding: '8px 12px', fontSize: 12, marginTop: 8 }}>
              {error}
            </div>
          )}

          {/* Grid preview */}
          {grid && (
            <div style={{ marginTop: 16 }}>
              <label style={labelStyle}>Grid Preview ({grid.length}&times;{grid[0].length})</label>
              <div style={{ display: 'inline-flex', flexDirection: 'column' as const, gap: 4, background: '#1e293b', padding: 8, borderRadius: 10 }}>
                {grid.map((row, r) => (
                  <div key={r} style={{ display: 'flex', gap: 4 }}>
                    {row.map((cell, c) => {
                      const hlIndex = highlightedCells?.get(`${r},${c}`)
                      const isHighlighted = hlIndex !== undefined
                      const isStart = hlIndex === 0
                      const isEnd = hlIndex === (hoveredWord?.path.length ?? 0) - 1
                      return (
                        <div key={c} style={{
                          width: 42, height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          borderRadius: 6, background: isStart ? '#22c55e' : isEnd ? '#f43f5e' : isHighlighted ? '#818cf8' : '#334155',
                          fontSize: 16, fontWeight: 700, position: 'relative' as const, transition: 'all 0.15s', flexDirection: 'column' as const,
                          color: isHighlighted ? '#fff' : '#e2e8f0',
                          transform: isHighlighted ? 'scale(1.08)' : 'none',
                          boxShadow: isStart ? '0 0 12px #22c55e55' : isEnd ? '0 0 12px #f43f5e55' : isHighlighted ? '0 0 12px #818cf855' : 'none',
                        }}>
                          <span style={{ fontSize: 16, lineHeight: 1 }}>{cell}</span>
                          {isHighlighted && <span style={{ fontSize: 8, position: 'absolute' as const, bottom: 2, right: 4, opacity: 0.7 }}>{hlIndex! + 1}</span>}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            style={{ width: '100%', padding: '14px 0', marginTop: 16, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, letterSpacing: 3, cursor: 'pointer', fontFamily: "'JetBrains Mono', monospace", opacity: !grid || dictStatus !== 'ready' ? 0.4 : 1 }}
            disabled={!grid || dictStatus !== 'ready' || loading}
            onClick={handleSolve}
          >
            {loading ? 'Solving...' : 'FIND WORDS'}
          </button>
        </div>

        {/* Right Panel */}
        <div style={{ flex: '1 1 500px', minWidth: 300 }}>
          {results && filtered ? (
            <>
              {/* Stats */}
              <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' as const }}>
                {[
                  { num: results.length, label: 'words found' },
                  { num: `${solveTime.toFixed(0)}ms`, label: 'solve time' },
                  { num: results.length > 0 ? results[0].word.length : 0, label: 'longest' },
                ].map(s => (
                  <div key={s.label} style={{ flex: 1, background: '#1e293b', borderRadius: 10, padding: '14px 16px', textAlign: 'center', minWidth: 90 }}>
                    <span style={{ display: 'block', fontSize: 26, fontWeight: 800, color: '#818cf8' }}>{s.num}</span>
                    <span style={{ fontSize: 10, color: '#64748b', letterSpacing: 1, textTransform: 'uppercase' as const }}>{s.label}</span>
                  </div>
                ))}
              </div>

              {/* Filters */}
              <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' as const, alignItems: 'flex-end' }}>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <label style={{ display: 'block', fontSize: 10, color: '#64748b', marginBottom: 4, letterSpacing: 1, textTransform: 'uppercase' as const }}>Min length</label>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[3,4,5,6,7].map(n => (
                      <button key={n} onClick={() => setMinLen(n)} style={{
                        padding: '6px 10px', background: minLen === n ? '#6366f1' : '#1e293b',
                        border: `1px solid ${minLen === n ? '#6366f1' : '#334155'}`, borderRadius: 6,
                        color: minLen === n ? '#fff' : '#94a3b8', fontSize: 12, cursor: 'pointer',
                        fontFamily: "'JetBrains Mono', monospace",
                      }}>{n}+</button>
                    ))}
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <label style={{ display: 'block', fontSize: 10, color: '#64748b', marginBottom: 4, letterSpacing: 1, textTransform: 'uppercase' as const }}>Filter</label>
                  <input
                    style={{ width: '100%', padding: '6px 10px', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 13, fontFamily: "'JetBrains Mono', monospace", outline: 'none', boxSizing: 'border-box' as const }}
                    value={filterText}
                    onChange={e => setFilterText(e.target.value)}
                    placeholder="type to filter..."
                  />
                </div>
              </div>

              <div style={{ fontSize: 11, color: '#475569', marginBottom: 12 }}>
                Showing {filtered.length} of {results.length}
              </div>

              {/* Word list */}
              <div style={{ maxHeight: '60vh', overflowY: 'auto' as const, paddingRight: 4 }}>
                {groupKeys.map(len => (
                  <div key={len} style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, borderBottom: '1px solid #1e293b', paddingBottom: 4 }}>
                      <span style={{ fontSize: 20, fontWeight: 800, color: '#c084fc' }}>{len}</span>
                      <span style={{ fontSize: 11, color: '#64748b', letterSpacing: 1 }}>letter{len > 1 ? 's' : ''} ({grouped![len].length})</span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6 }}>
                      {grouped![len].map(r => (
                        <span
                          key={r.word}
                          style={{
                            padding: '5px 10px', background: hoveredWord?.word === r.word ? '#818cf833' : '#1e293b',
                            borderRadius: 6, fontSize: 13, cursor: 'pointer', transition: 'all 0.12s',
                            border: hoveredWord?.word === r.word ? '1px solid #818cf8' : '1px solid transparent',
                            color: hoveredWord?.word === r.word ? '#c4b5fd' : '#e2e8f0', userSelect: 'none' as const,
                          }}
                          onMouseEnter={() => setHoveredWord(r)}
                          onMouseLeave={() => setHoveredWord(null)}
                          onTouchStart={() => setHoveredWord(r)}
                          onTouchEnd={() => setHoveredWord(null)}
                        >
                          {r.word}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#475569' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>&#127919;</div>
              <p style={{ fontSize: 14, lineHeight: 1.6, maxWidth: 280, margin: '0 auto' }}>
                Upload a grid screenshot or type letters manually, then hit Find Words
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, color: '#64748b', letterSpacing: 1.5,
  textTransform: 'uppercase', marginBottom: 6, fontWeight: 600,
}
