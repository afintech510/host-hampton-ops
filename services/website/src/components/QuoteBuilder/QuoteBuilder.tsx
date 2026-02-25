'use client'

import { useState, useMemo, useCallback } from 'react'
import { Check, Sparkles, RotateCcw } from 'lucide-react'
import Link from 'next/link'
import type { PricingItem, QuoteBuilderProps } from './types'

/* ── helpers ─────────────────────────────────────────── */

function fmt(cents: number, label?: string | null): string {
  if (label) return label
  if (cents === 0) return 'Included'
  const d = cents / 100
  return d % 1 === 0 ? `$${d.toLocaleString()}` : `$${d.toFixed(2)}`
}

/* ── sub-components ──────────────────────────────────── */

function StepBadge({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-hampton-navy text-white text-xs font-bold shrink-0">
      {n}
    </span>
  )
}

function SectionHeader({ step, title, subtitle }: { step: number; title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2.5 mb-1">
        <StepBadge n={step} />
        <h3 className="font-serif text-xl font-bold text-hampton-navy">{title}</h3>
      </div>
      {subtitle && <p className="text-hampton-navy/50 text-sm ml-[38px]">{subtitle}</p>}
    </div>
  )
}

function ThemeCard({ item, selected, onClick }: { item: PricingItem; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative text-left p-4 rounded-xl border-2 transition-all duration-200 ${
        selected
          ? 'border-hampton-navy bg-hampton-navy/5 shadow-md ring-1 ring-hampton-navy/10'
          : 'border-hampton-mauve/25 bg-white hover:border-hampton-blue hover:shadow-sm'
      }`}
    >
      {item.is_popular && (
        <span className="absolute -top-2.5 right-3 bg-hampton-pink text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1">
          <Sparkles size={10} /> Popular
        </span>
      )}
      {selected && (
        <span className="absolute top-3 right-3 w-5 h-5 bg-hampton-navy rounded-full flex items-center justify-center">
          <Check size={12} className="text-white" />
        </span>
      )}
      <p className="font-serif font-bold text-hampton-navy text-sm pr-6">{item.name}</p>
      {item.description && (
        <p className="text-hampton-navy/50 text-xs mt-1 line-clamp-2">{item.description}</p>
      )}
      <p className="font-bold text-hampton-navy mt-2">{fmt(item.price_cents, item.price_label)}</p>
    </button>
  )
}

function QuickChoice({ label, options, value, onChange }: {
  label: string
  options: { value: string; label: string; emoji: string }[]
  value: string | null
  onChange: (v: string) => void
}) {
  return (
    <div>
      <p className="form-label mb-2">{label}</p>
      <div className="flex gap-3">
        {options.map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`flex-1 py-3.5 px-4 rounded-xl border-2 font-semibold text-sm transition-all duration-200 ${
              value === opt.value
                ? 'border-hampton-navy bg-hampton-navy text-white shadow-sm'
                : 'border-hampton-mauve/30 bg-white text-hampton-navy hover:border-hampton-blue'
            }`}
          >
            <span className="text-lg mr-1.5">{opt.emoji}</span>
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function ActivityChip({ item, selected, onClick }: { item: PricingItem; selected: boolean; onClick: () => void }) {
  const hasPrice = item.price_cents > 0
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full border-2 text-xs font-semibold transition-all duration-200 ${
        selected
          ? 'border-hampton-navy bg-hampton-navy text-white'
          : 'border-hampton-mauve/30 bg-white text-hampton-navy hover:border-hampton-blue'
      }`}
    >
      {selected && <Check size={12} className="shrink-0" />}
      {item.name}
      {hasPrice && <span className="opacity-70 ml-0.5">+{fmt(item.price_cents)}</span>}
    </button>
  )
}

function AddOnCard({ item, selected, onClick }: { item: PricingItem; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-3.5 rounded-xl border-2 transition-all duration-200 flex items-center justify-between gap-3 ${
        selected
          ? 'border-hampton-navy bg-hampton-navy/5 shadow-sm'
          : 'border-hampton-mauve/20 bg-white hover:border-hampton-blue'
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-hampton-navy text-sm">{item.name}</p>
        {item.description && (
          <p className="text-hampton-navy/50 text-xs mt-0.5 truncate">{item.description}</p>
        )}
      </div>
      <div className="flex items-center gap-2.5 shrink-0">
        <span className="text-hampton-navy font-bold text-sm whitespace-nowrap">
          {fmt(item.price_cents, item.price_label)}
        </span>
        <span
          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all duration-200 ${
            selected ? 'border-hampton-navy bg-hampton-navy' : 'border-hampton-mauve/40'
          }`}
        >
          {selected && <Check size={12} className="text-white" />}
        </span>
      </div>
    </button>
  )
}

function AddOnSection({ title, step, items, selected, onToggle }: {
  title: string
  step: number
  items: PricingItem[]
  selected: Set<string>
  onToggle: (id: string) => void
}) {
  if (items.length === 0) return null
  return (
    <div>
      <SectionHeader step={step} title={title} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {items.map(i => (
          <AddOnCard
            key={i.id}
            item={i}
            selected={selected.has(i.id)}
            onClick={() => onToggle(i.id)}
          />
        ))}
      </div>
    </div>
  )
}

/* ── main component ──────────────────────────────────── */

export default function QuoteBuilder({
  themes, activities, food, desserts, decor, entertainment, beverages, extras,
}: QuoteBuilderProps) {
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null)
  const [foodChoice, setFoodChoice] = useState<string | null>(null)
  const [cupcakeFlavor, setCupcakeFlavor] = useState<string | null>(null)
  const [selectedActivities, setSelectedActivities] = useState<Set<string>>(new Set())
  const [selectedFood, setSelectedFood] = useState<Set<string>>(new Set())
  const [selectedDesserts, setSelectedDesserts] = useState<Set<string>>(new Set())
  const [selectedDecor, setSelectedDecor] = useState<Set<string>>(new Set())
  const [selectedEntertainment, setSelectedEntertainment] = useState<Set<string>>(new Set())
  const [selectedBeverages, setSelectedBeverages] = useState<Set<string>>(new Set())
  const [selectedExtras, setSelectedExtras] = useState<Set<string>>(new Set())

  const toggle = useCallback((set: Set<string>, setFn: (s: Set<string>) => void, id: string) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setFn(next)
  }, [])

  /* item lookup map */
  const allItems = useMemo(
    () => [...themes, ...activities, ...food, ...desserts, ...decor, ...entertainment, ...beverages, ...extras],
    [themes, activities, food, desserts, decor, entertainment, beverages, extras],
  )
  const itemMap = useMemo(() => {
    const m = new Map<string, PricingItem>()
    for (const i of allItems) m.set(i.id, i)
    return m
  }, [allItems])

  /* running total */
  const total = useMemo(() => {
    let sum = 0
    if (selectedTheme) sum += itemMap.get(selectedTheme)?.price_cents ?? 0
    const allSelected = [
      ...Array.from(selectedActivities), ...Array.from(selectedFood), ...Array.from(selectedDesserts),
      ...Array.from(selectedDecor), ...Array.from(selectedEntertainment), ...Array.from(selectedBeverages), ...Array.from(selectedExtras),
    ]
    for (const id of allSelected) {
      sum += itemMap.get(id)?.price_cents ?? 0
    }
    return sum
  }, [selectedTheme, selectedActivities, selectedFood, selectedDesserts, selectedDecor, selectedEntertainment, selectedBeverages, selectedExtras, itemMap])

  const addOnCount =
    selectedActivities.size + selectedFood.size + selectedDesserts.size +
    selectedDecor.size + selectedEntertainment.size + selectedBeverages.size + selectedExtras.size

  const themeItem = selectedTheme ? itemMap.get(selectedTheme) : null

  const handleReset = () => {
    setSelectedTheme(null)
    setFoodChoice(null)
    setCupcakeFlavor(null)
    setSelectedActivities(new Set())
    setSelectedFood(new Set())
    setSelectedDesserts(new Set())
    setSelectedDecor(new Set())
    setSelectedEntertainment(new Set())
    setSelectedBeverages(new Set())
    setSelectedExtras(new Set())
  }

  /* build query string for booking page */
  const bookingHref = useMemo(() => {
    const params = new URLSearchParams({ event_type: 'kids-party' })
    if (themeItem) params.set('theme', themeItem.name)
    return `/book?${params.toString()}`
  }, [themeItem])

  return (
    <div className="pb-36">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 space-y-10">

        {/* ── Step 1: Select Theme ── */}
        <section>
          <SectionHeader step={1} title="Select Your Theme" subtitle="Choose a party theme to get started" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {themes.map(t => (
              <ThemeCard
                key={t.id}
                item={t}
                selected={selectedTheme === t.id}
                onClick={() => setSelectedTheme(selectedTheme === t.id ? null : t.id)}
              />
            ))}
          </div>
        </section>

        {/* ── Step 2: Included Choices ── */}
        <section>
          <SectionHeader step={2} title="Included With Your Party" subtitle="These are part of every theme package" />
          <div className="bg-white rounded-2xl border-2 border-hampton-mauve/15 p-5 sm:p-6 space-y-5">
            <QuickChoice
              label="Food Choice"
              options={[
                { value: 'pizza', label: 'Pizza', emoji: '\uD83C\uDF55' },
                { value: 'bagels', label: 'Bagels', emoji: '\uD83E\uDD6F' },
              ]}
              value={foodChoice}
              onChange={setFoodChoice}
            />
            <QuickChoice
              label="Cupcake Flavor"
              options={[
                { value: 'chocolate', label: 'Chocolate', emoji: '\uD83C\uDF6B' },
                { value: 'vanilla', label: 'Vanilla', emoji: '\uD83E\uDDC1' },
              ]}
              value={cupcakeFlavor}
              onChange={setCupcakeFlavor}
            />
          </div>
        </section>

        {/* ── Step 3: Activities ── */}
        <section>
          <SectionHeader
            step={3}
            title="Choose Activities"
            subtitle="Most activities are included. Premium add-ons show their price."
          />
          <div className="flex flex-wrap gap-2">
            {activities.map(a => (
              <ActivityChip
                key={a.id}
                item={a}
                selected={selectedActivities.has(a.id)}
                onClick={() => toggle(selectedActivities, setSelectedActivities, a.id)}
              />
            ))}
          </div>
        </section>

        {/* ── Divider ── */}
        <div className="flex items-center gap-4">
          <div className="flex-1 border-t border-hampton-mauve/20" />
          <span className="text-hampton-mauve text-xs font-semibold tracking-widest uppercase">
            Customize Your Party
          </span>
          <div className="flex-1 border-t border-hampton-mauve/20" />
        </div>

        {/* ── Steps 4–9: Add-on Categories ── */}
        <AddOnSection
          title="Additional Food"
          step={4}
          items={food}
          selected={selectedFood}
          onToggle={id => toggle(selectedFood, setSelectedFood, id)}
        />
        <AddOnSection
          title="Desserts"
          step={5}
          items={desserts}
          selected={selectedDesserts}
          onToggle={id => toggle(selectedDesserts, setSelectedDesserts, id)}
        />
        <AddOnSection
          title="Decor"
          step={6}
          items={decor}
          selected={selectedDecor}
          onToggle={id => toggle(selectedDecor, setSelectedDecor, id)}
        />
        <AddOnSection
          title="Entertainment"
          step={7}
          items={entertainment}
          selected={selectedEntertainment}
          onToggle={id => toggle(selectedEntertainment, setSelectedEntertainment, id)}
        />
        <AddOnSection
          title="Beverages"
          step={8}
          items={beverages}
          selected={selectedBeverages}
          onToggle={id => toggle(selectedBeverages, setSelectedBeverages, id)}
        />
        <AddOnSection
          title="Party Extras & Services"
          step={9}
          items={extras}
          selected={selectedExtras}
          onToggle={id => toggle(selectedExtras, setSelectedExtras, id)}
        />
      </div>

      {/* ── Sticky Summary Bar ── */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-xl border-t-2 border-hampton-mauve/20 shadow-[0_-4px_24px_rgba(0,0,0,0.08)] z-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] text-hampton-navy/40 font-semibold uppercase tracking-widest">
              Estimated Total
            </p>
            <p className="text-2xl font-bold text-hampton-navy leading-tight">
              {total > 0 ? fmt(total) : '\u2014'}
            </p>
            <p className="text-xs text-hampton-navy/50 truncate">
              {themeItem
                ? `${themeItem.name}${addOnCount > 0 ? ` + ${addOnCount} add-on${addOnCount > 1 ? 's' : ''}` : ''}`
                : 'Select a theme to begin'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {(selectedTheme || addOnCount > 0) && (
              <button
                type="button"
                onClick={handleReset}
                className="p-2.5 rounded-xl border border-hampton-mauve/30 text-hampton-navy/50 hover:text-hampton-navy hover:border-hampton-navy/30 transition-colors"
                title="Start over"
              >
                <RotateCcw size={16} />
              </button>
            )}
            <Link
              href={bookingHref}
              className="btn-primary px-5 py-3 text-center whitespace-nowrap"
            >
              Reserve Your Date
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
