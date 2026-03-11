'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Upload, Copy, Check, Trash2, Loader2, Search, Image, X } from 'lucide-react'

interface MediaFile {
  name: string
  url: string
  size: number
  type: string
  created_at: string
}

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function MediaTab({ headers, onLogout }: { headers: Record<string, string>; onLogout: () => void }) {
  const [files, setFiles] = useState<MediaFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [uploading, setUploading] = useState(false)
  const [convertWebp, setConvertWebp] = useState(true)
  const [uploadMsg, setUploadMsg] = useState('')
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)
  const [previewFile, setPreviewFile] = useState<MediaFile | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const fetchFiles = useCallback(async () => {
    setLoading(true)
    setError('')
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    const res = await fetch(`/api/admin/media?${params}`, { headers })
    if (res.status === 401) { onLogout(); return }
    if (res.ok) {
      const d = await res.json()
      setFiles(d.files || [])
    } else {
      setError('Failed to load media')
    }
    setLoading(false)
  }, [headers.Authorization, search])

  useEffect(() => { fetchFiles() }, [fetchFiles])

  async function handleUpload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    setUploading(true)
    setUploadMsg('')
    setError('')

    let uploaded = 0
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i]
      const formData = new FormData()
      formData.append('file', file)
      formData.append('convert_webp', convertWebp ? 'true' : 'false')

      const res = await fetch('/api/admin/media', {
        method: 'POST',
        headers: { Authorization: headers.Authorization },
        body: formData,
      })

      if (res.ok) {
        uploaded++
      } else {
        const d = await res.json()
        setError(d.error || `Failed to upload ${file.name}`)
      }
    }

    setUploading(false)
    if (uploaded > 0) {
      setUploadMsg(`${uploaded} file${uploaded > 1 ? 's' : ''} uploaded`)
      fetchFiles()
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleDelete(name: string) {
    if (!confirm(`Delete ${name}?`)) return
    const res = await fetch('/api/admin/media', {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ name }),
    })
    if (res.ok) {
      setFiles(prev => prev.filter(f => f.name !== name))
      if (previewFile?.name === name) setPreviewFile(null)
    }
  }

  function copyUrl(url: string) {
    navigator.clipboard.writeText(url)
    setCopiedUrl(url)
    setTimeout(() => setCopiedUrl(null), 2000)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    handleUpload(e.dataTransfer.files)
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
      {/* Upload zone */}
      <div
        className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
          dragOver ? 'border-hampton-blue bg-hampton-blue/5' : 'border-gray-200 bg-white hover:border-hampton-blue/40'
        }`}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={e => handleUpload(e.target.files)}
          className="hidden"
          id="media-upload"
        />
        <Upload className="w-8 h-8 text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-500 mb-3">
          Drag & drop images here, or{' '}
          <label htmlFor="media-upload" className="text-hampton-blue cursor-pointer hover:underline font-medium">
            browse files
          </label>
        </p>
        <p className="text-xs text-gray-400 mb-3">JPG, PNG, WebP, GIF, HEIC — max 15MB each</p>

        <div className="flex items-center justify-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={convertWebp}
              onChange={e => setConvertWebp(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-hampton-blue focus:ring-hampton-blue"
            />
            <span className="text-xs text-gray-600">Convert to WebP (smaller file size)</span>
          </label>
        </div>

        {uploading && (
          <div className="flex items-center justify-center gap-2 mt-3 text-sm text-hampton-blue">
            <Loader2 className="w-4 h-4 animate-spin" /> Uploading...
          </div>
        )}
      </div>

      {uploadMsg && (
        <div className="text-sm px-3 py-2 rounded bg-emerald-50 text-emerald-700">{uploadMsg}</div>
      )}
      {error && (
        <div className="text-sm px-3 py-2 rounded bg-red-50 text-red-700">{error}</div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search files..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full text-sm border border-gray-200 rounded-lg pl-9 pr-3 py-2 bg-white"
        />
      </div>

      {/* Stats */}
      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>{files.length} file{files.length !== 1 ? 's' : ''}</span>
        <span>Total: {formatBytes(files.reduce((sum, f) => sum + f.size, 0))}</span>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-hampton-navy" />
        </div>
      )}

      {/* File Grid */}
      {!loading && files.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <Image className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p>No media files yet. Upload your first image above.</p>
        </div>
      )}

      {!loading && files.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {files.map(file => (
            <div
              key={file.name}
              className="group bg-white rounded-xl border border-gray-100 overflow-hidden hover:shadow-md transition-shadow"
            >
              {/* Thumbnail */}
              <button
                onClick={() => setPreviewFile(file)}
                className="w-full aspect-square bg-gray-50 flex items-center justify-center overflow-hidden"
              >
                <img
                  src={file.url}
                  alt={file.name}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </button>

              {/* Info */}
              <div className="p-2 space-y-1">
                <p className="text-[11px] text-gray-700 font-medium truncate" title={file.name}>
                  {file.name}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-gray-400">{formatBytes(file.size)}</span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => copyUrl(file.url)}
                      className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-hampton-blue transition-colors"
                      title="Copy URL"
                    >
                      {copiedUrl === file.url ? (
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      onClick={() => handleDelete(file.name)}
                      className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Preview Modal */}
      {previewFile && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setPreviewFile(null)}>
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <div className="min-w-0">
                <p className="text-sm font-medium text-hampton-navy truncate">{previewFile.name}</p>
                <p className="text-xs text-gray-400">{formatBytes(previewFile.size)} &middot; {previewFile.type || 'image'}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-4">
                <button
                  onClick={() => copyUrl(previewFile.url)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-hampton-navy text-white rounded-lg hover:bg-hampton-navy/90 transition-colors"
                >
                  {copiedUrl === previewFile.url ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedUrl === previewFile.url ? 'Copied!' : 'Copy URL'}
                </button>
                <button onClick={() => setPreviewFile(null)} className="p-1.5 text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="p-4 flex items-center justify-center bg-gray-50 max-h-[70vh] overflow-auto">
              <img
                src={previewFile.url}
                alt={previewFile.name}
                className="max-w-full max-h-[65vh] object-contain rounded"
              />
            </div>
            <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={previewFile.url}
                  readOnly
                  className="flex-1 text-xs bg-white border border-gray-200 rounded px-2 py-1.5 text-gray-500 select-all"
                  onClick={e => (e.target as HTMLInputElement).select()}
                />
                <button
                  onClick={() => copyUrl(previewFile.url)}
                  className="text-xs text-hampton-blue hover:text-hampton-navy font-medium shrink-0"
                >
                  {copiedUrl === previewFile.url ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
