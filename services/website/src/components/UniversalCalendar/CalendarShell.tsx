'use client'

import { useState } from 'react'
import { Calendar, ChevronDown } from 'lucide-react'

interface Props {
  expandable: boolean
  initialExpanded: boolean
  children: React.ReactNode
}

export default function CalendarShell({ expandable, initialExpanded, children }: Props) {
  const [expanded, setExpanded] = useState(initialExpanded)

  if (!expandable) {
    return <div>{children}</div>
  }

  return (
    <div className="bg-white/80 backdrop-blur-md border border-hampton-blue/20 rounded-2xl shadow-sm overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-hampton-ivory/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Calendar size={18} className="text-hampton-pink" />
          <span className="font-serif text-hampton-navy font-semibold">
            Check Availability
          </span>
        </div>
        <ChevronDown
          size={18}
          className={`text-hampton-mauve transition-transform duration-300 ${
            expanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      <div
        className={`transition-all duration-300 ease-in-out ${
          expanded ? 'max-h-[800px] opacity-100' : 'max-h-0 opacity-0'
        } overflow-hidden`}
      >
        <div className="px-5 pb-5">
          {children}
        </div>
      </div>
    </div>
  )
}
