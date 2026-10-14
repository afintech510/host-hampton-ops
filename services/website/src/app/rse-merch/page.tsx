'use client'

import { useEffect } from 'react'
import Script from 'next/script'
import {
  isLoosePatchInput,
  PATCH_EXTRA_PRICE_CENTS,
  patchOrderLine,
  patchPriceDollars,
  totalPatchQty,
  type PatchSelection,
} from '@/lib/fundraiserPatches'
import { FUNDRAISER_TEAMS, MAX_TEACHER_NAME_LENGTH, teamTakesVenmo } from '@/lib/fundraiserTeams'
import { HOME_DELIVERY_FEE_CENTS } from '@/lib/fundraiserDelivery'

/**
 * This page's team record — the one place the payment account is written.
 * See `/esm-sharks` for why the page holds no handle of its own.
 */
const TEAM = FUNDRAISER_TEAMS['rse']

/**
 * RSE has no verified Venmo account yet, so the page is CASH ONLY until one is
 * set in `lib/fundraiserTeams.ts`. The order route refuses `venmo` for the same
 * reason, so a hand-built request cannot get around a hidden radio button.
 */
const TAKES_VENMO = teamTakesVenmo(TEAM)

/** The delivery fee as the customer reads it, derived from the server's cents. */
const DELIVERY_FEE_LABEL = `$${(HOME_DELIVERY_FEE_CENTS / 100).toFixed(2)}`
const DELIVERY_FEE_SHORT = `$${HOME_DELIVERY_FEE_CENTS / 100}`
// Footer is rendered by root layout

/**
 * The RSE merch order form — Remsenburg-Speonk Elementary, the third storefront
 * on `cm_cheer_orders` after CM Cheer and the ESM Sharks (migration 072).
 *
 * Structurally this is `/esm-sharks` in royal blue and butter yellow: every
 * product is a COLOUR AND A PATCH, chosen by one quantity box per combination,
 * with the colour and patch buttons wired to the rows as a preview (see the
 * long note at the top of `/esm-sharks/page.tsx` for why it is built that way).
 * The behavioural difference that matters is `team: 'rse'` in the posted
 * payload — the DB trigger reads it to mint an `RSE-` order number, and it keeps
 * these orders in `/rse-merch/orders` and out of the other two order books.
 *
 * RSE's own patch designs (Helen Schulz and Rebecca Sieger, 2026-10-12): the
 * rooster, the varsity letters, Reggie on his skateboard, and the heart.
 *
 * The product photos are MOCKUPS, not photography: the real blanks from
 * cbstation.com with each patch rendered as embroidery (Replicate
 * flux-kontext-pro, background removed) and placed on them. Every combination
 * is rendered, so `img` is never null here, but the "photo coming" path is kept
 * so a future un-rendered combination cannot borrow a neighbour's picture.
 *
 * Loose patches mix across all four designs on the shared 3-for-$20 tier, from
 * `lib/fundraiserPatches.ts`.
 */

/** A patch design, as the buyer reads it and as the order book records it. */
const PATCHES = [
  { key: 'rooster', label: 'Rooster', art: '/images/rse-patch-rooster.webp', name: 'Rooster Patch' },
  { key: 'varsity', label: 'Varsity', art: '/images/rse-patch-varsity.webp', name: 'Varsity RSE Patch' },
  { key: 'reggie', label: 'Reggie', art: '/images/rse-patch-reggie.webp', name: 'Reggie Patch' },
  { key: 'heart', label: 'Heart', art: '/images/rse-patch-heart.webp', name: 'Heart Patch' },
] as const

const COLORS = [
  // `short` is the row label: "Royal Blue · Rooster" truncates on a phone.
  { key: 'blue', label: 'Royal Blue', short: 'Blue', swatch: '#1E40C8' },
  { key: 'yellow', label: 'Yellow', short: 'Yellow', swatch: '#F9D71C' },
] as const

const DEFAULT_COLOR = COLORS[0].key
const DEFAULT_PATCH = PATCHES[0].key

/** Every combination is rendered: `/images/rse-<product>-<colour>-<patch>.webp`. */
function shotsFor(product: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of COLORS) for (const p of PATCHES) out[`${c.key}-${p.key}`] = `/images/rse-${product}-${c.key}-${p.key}.webp`
  return out
}

const PRODUCTS = [
  {
    key: 'tote',
    title: 'Medium Canvas Tote',
    price: 40,
    cost: 30,
    blurb: 'Heavy cotton canvas boat tote with colour handles and base, finished with your patch on the front.',
    shots: shotsFor('tote'),
  },
  {
    key: 'bag',
    title: 'Canvas Makeup Bag',
    price: 25,
    cost: 18.75,
    blurb: 'Zippered canvas pouch with a colour base and wrist loop. Pencils, snacks, hair ties — whatever.',
    shots: shotsFor('bag'),
  },
  {
    key: 'hat',
    title: 'Trucker Hat',
    price: 25,
    cost: 18.75,
    blurb: 'Foam-front mesh-back snapback with your patch stitched on the front panel.',
    shots: shotsFor('hat'),
  },
] as const

/** Every combination of one product, in the order the rows are drawn. */
function variantsOf(p: (typeof PRODUCTS)[number]) {
  return COLORS.flatMap((c) =>
    PATCHES.map((patch) => ({
      id: `qty-${p.key}-${c.key}-${patch.key}`,
      color: c,
      patch,
      /** What a human reads in the order book, the CSV and both emails. */
      name: `${c.label} ${p.title} — ${patch.name}`,
      img: (p.shots[`${c.key}-${patch.key}`] ?? null) as string | null,
    })),
  )
}

export default function RSEMerchPage() {
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).lucide) {
      (window as any).lucide.createIcons()
    }
  })

  useEffect(() => {
    // --- Quantity buttons ---
    function setupQuantityButtons() {
      document.querySelectorAll('.increment-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const target = btn.getAttribute('data-target')
          if (!target) return
          const input = document.getElementById(target) as HTMLInputElement
          if (input) { input.value = String((parseInt(input.value) || 0) + 1); calculateTotal() }
        })
      })
      document.querySelectorAll('.decrement-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const target = btn.getAttribute('data-target')
          if (!target) return
          const input = document.getElementById(target) as HTMLInputElement
          if (input) { const val = parseInt(input.value) || 0; if (val > 0) { input.value = String(val - 1); calculateTotal() } }
        })
      })
      document.querySelectorAll('.qty-input').forEach((input) => {
        input.addEventListener('input', (e) => {
          const el = e.target as HTMLInputElement
          if (parseInt(el.value) < 0 || el.value === '') el.value = '0'
          calculateTotal()
        })
      })
    }

    /**
     * Which combination each card is SHOWING — held on the card as
     * `data-color` / `data-patch`, redrawn into the buttons, the highlighted
     * row and the photo together by `syncCard`. A preview, never the order:
     * only the quantity boxes decide what gets made.
     */
    const ACTIVE = {
      blue: ['border-rseBlue', 'bg-rseBlue', 'text-white'],
      yellow: ['border-rseYellow', 'bg-rseYellow', 'text-rseInk'],
      // The patches are full-colour art, so a filled button would swallow the
      // thumbnail. A cream fill with a blue border reads as "chosen".
      patch: ['border-rseBlue', 'bg-rseCream', 'text-rseBlue'],
    }
    const IDLE = ['border-gray-200', 'bg-white', 'text-gray-500']
    const ALL_ACTIVE = [...ACTIVE.blue, ...ACTIVE.yellow, ...ACTIVE.patch]

    function syncCard(key: string) {
      const card = document.getElementById(`card-${key}`)
      if (!card) return
      const color = card.dataset.color || DEFAULT_COLOR
      const patch = card.dataset.patch || DEFAULT_PATCH

      const row = document.querySelector(
        `.variant-preview[data-product="${key}"][data-color="${color}"][data-patch="${patch}"]`,
      ) as HTMLElement | null
      if (!row) return

      const img = document.getElementById(`img-${key}`) as HTMLImageElement | null
      const ph = document.getElementById(`ph-${key}`)
      const src = row.getAttribute('data-src') || ''
      if (img && ph) {
        if (src) {
          img.src = src
          img.alt = row.getAttribute('data-combo') || ''
          img.classList.remove('hidden')
          ph.classList.add('hidden')
          ph.classList.remove('flex')
        } else {
          img.classList.add('hidden')
          ph.classList.remove('hidden')
          ph.classList.add('flex')
          const art = ph.querySelector('img') as HTMLImageElement | null
          if (art) art.src = row.getAttribute('data-patch-art') || ''
          const cap = ph.querySelector('[data-cap]')
          if (cap) cap.textContent = row.getAttribute('data-combo') || ''
        }
      }

      document.querySelectorAll(`.variant-row[data-product="${key}"]`).forEach((r) => {
        r.classList.remove('ring-2', 'ring-rseBlue', 'bg-rseCream/70')
        r.classList.add('bg-slate-50')
      })
      const rowEl = row.closest('.variant-row')
      if (rowEl) { rowEl.classList.remove('bg-slate-50'); rowEl.classList.add('ring-2', 'ring-rseBlue', 'bg-rseCream/70') }

      document.querySelectorAll(`.combo-btn[data-product="${key}"]`).forEach((b) => {
        const btn = b as HTMLElement
        const axis = btn.dataset.axis as 'color' | 'patch'
        const on = axis === 'color' ? btn.dataset.value === color : btn.dataset.value === patch
        btn.classList.remove(...ALL_ACTIVE, ...IDLE)
        if (!on) { btn.classList.add(...IDLE); return }
        btn.classList.add(...(axis === 'patch' ? ACTIVE.patch : ACTIVE[btn.dataset.value as 'blue' | 'yellow']))
      })
    }

    function pickCombo(key: string, axis: string, value: string) {
      const card = document.getElementById(`card-${key}`)
      if (!card) return
      if (axis === 'color') card.dataset.color = value
      else card.dataset.patch = value
      syncCard(key)
    }

    function setupComboControls() {
      // The buttons carry an <img>, so read the listener's own element.
      document.querySelectorAll('.combo-btn').forEach((b) => {
        const btn = b as HTMLElement
        btn.addEventListener('click', () =>
          pickCombo(btn.dataset.product || '', btn.dataset.axis || '', btn.dataset.value || ''))
      })
      document.querySelectorAll('.variant-preview').forEach((r) => {
        const row = r as HTMLElement
        row.addEventListener('click', () => {
          const card = document.getElementById(`card-${row.dataset.product}`)
          if (!card) return
          card.dataset.color = row.dataset.color || DEFAULT_COLOR
          card.dataset.patch = row.dataset.patch || DEFAULT_PATCH
          syncCard(row.dataset.product || '')
        })
      })
    }

    /** Point every card back at the default combination — on load and after a reset. */
    function resetCombos() {
      document.querySelectorAll('[id^="card-"]').forEach((c) => {
        const card = c as HTMLElement
        card.dataset.color = DEFAULT_COLOR
        card.dataset.patch = DEFAULT_PATCH
        syncCard(card.id.replace(/^card-/, ''))
      })
    }

    // --- Payment radios ---
    function setupPaymentRadios() {
      document.querySelectorAll('input[name="paymentMethod"]').forEach((radio) => {
        radio.addEventListener('change', (e) => {
          const el = e.target as HTMLInputElement
          const info = document.getElementById('digitalPaymentInfo')
          if (!info) return
          if (el.value === 'venmo') info.classList.remove('hidden'); else info.classList.add('hidden')
        })
      })
    }

    /** The loose patches in the order, by design — `data-tier="patch"` only. */
    function looseSelections(): PatchSelection[] {
      const out: PatchSelection[] = []
      document.querySelectorAll('.qty-input').forEach((input) => {
        const el = input as HTMLInputElement
        if (!isLoosePatchInput(el)) return
        out.push({ design: el.dataset.design || '', qty: parseInt(el.value) || 0 })
      })
      return out
    }

    /** Derived from the server's cents — `lib/fundraiserDelivery.ts` is authoritative. */
    const HOME_DELIVERY_FEE = HOME_DELIVERY_FEE_CENTS / 100

    function isHomeDelivery(): boolean {
      const picked = document.querySelector('input[name="deliveryMethod"]:checked') as HTMLInputElement | null
      return picked?.value === 'home'
    }

    function updatePatchHint(qty: number) {
      const hint = document.getElementById('patchTierHint')
      if (!hint) return
      if (qty === 0) {
        hint.textContent = 'Mix and match — any 3 patches are $20.'
      } else if (qty < 3) {
        const more = 3 - qty
        const saving = qty * 8 + more * 8 - 20
        hint.textContent = `${qty} selected. Add ${more} more (any design) for the 3 for $20 price — saves $${saving.toFixed(2)}.`
      } else {
        hint.textContent = `${qty} patches — $${patchPriceDollars(qty).toFixed(2)}. The 3 for $20 price is applied.`
      }
    }

    // --- Total ---
    function calculateTotal(): number {
      let total = 0
      document.querySelectorAll('.qty-input').forEach((input) => {
        const el = input as HTMLInputElement
        if (isLoosePatchInput(el)) return
        total += (parseInt(el.value) || 0) * parseFloat(el.dataset.price || '0')
      })

      const patchQty = totalPatchQty(looseSelections())
      total += patchPriceDollars(patchQty)
      updatePatchHint(patchQty)

      if (isHomeDelivery()) total += HOME_DELIVERY_FEE
      const display = document.getElementById('totalPriceDisplay')
      if (display) display.textContent = `$${total.toFixed(2)}`
      return total
    }

    // --- Modals ---
    function hideModal(modal: HTMLElement) {
      modal.classList.add('opacity-0')
      const inner = modal.querySelector('div'); if (inner) inner.classList.add('scale-90')
      setTimeout(() => { modal.classList.add('hidden'); modal.classList.remove('flex') }, 300)
    }
    function showModal(modal: HTMLElement) {
      modal.classList.remove('hidden'); modal.classList.add('flex')
      setTimeout(() => { modal.classList.remove('opacity-0'); const inner = modal.querySelector('div'); if (inner) inner.classList.remove('scale-90') }, 10)
    }
    function alertCustom(msg: string) {
      const toast = document.createElement('div')
      toast.className = 'fixed bottom-10 left-1/2 -translate-x-1/2 bg-rseBlue text-white px-8 py-4 rounded-full shadow-2xl z-[9999] font-bold text-sm uppercase tracking-widest'
      toast.innerText = msg; document.body.appendChild(toast); setTimeout(() => toast.remove(), 3000)
    }

    /** Show the address box only when needed; `required` only while visible. */
    function setupDeliveryRadios() {
      const box = document.getElementById('deliveryAddressBox')
      const field = document.getElementById('deliveryAddress') as HTMLTextAreaElement | null
      document.querySelectorAll('input[name="deliveryMethod"]').forEach((input) => {
        input.addEventListener('change', () => {
          const home = isHomeDelivery()
          if (box) box.classList.toggle('hidden', !home)
          if (field) {
            field.required = home
            if (!home) field.value = ''
          }
          calculateTotal()
        })
      })
    }

    let orderPayload: Record<string, any> = {}

    function setupFormSubmit() {
      const orderForm = document.getElementById('orderForm') as HTMLFormElement
      const summaryModal = document.getElementById('summaryModal')
      const successModal = document.getElementById('successModal')
      const closeSummaryBtn = document.getElementById('closeSummaryBtn')
      const finalSubmitBtn = document.getElementById('finalSubmitBtn') as HTMLButtonElement
      const confirmCheckbox = document.getElementById('confirmCheckbox') as HTMLInputElement
      const closeSuccessBtn = document.getElementById('closeSuccessBtn')
      if (!orderForm || !summaryModal || !successModal) return

      orderForm.addEventListener('submit', (e) => {
        e.preventDefault()
        let hasItems = false
        let orderListHTML = ''
        const itemsArr: string[] = []
        const itemsData: Array<{name:string;qty:number;unit_price:number;line_total:number;cost_per_unit:number}> = []
        let totalCost = 0

        const pushLine = (line: {name:string;qty:number;unit_price:number;line_total:number;cost_per_unit:number}) => {
          hasItems = true
          totalCost += line.qty * line.cost_per_unit
          orderListHTML += `<li class="flex justify-between gap-3 border-b border-gray-100 pb-1"><span>${line.qty}x ${line.name}</span><span class="text-gray-500 whitespace-nowrap">$${line.line_total.toFixed(2)}</span></li>`
          itemsArr.push(`${line.qty}x ${line.name}`)
          itemsData.push(line)
        }

        // Products first, one line per colour-and-patch combination.
        document.querySelectorAll('.qty-input').forEach((input) => {
          const el = input as HTMLInputElement
          if (isLoosePatchInput(el)) return
          const qty = parseInt(el.value)
          if (!(qty > 0)) return
          const unitPrice = parseFloat(el.dataset.price || '0')
          pushLine({
            name: el.getAttribute('data-name') || '',
            qty,
            unit_price: unitPrice,
            line_total: qty * unitPrice,
            cost_per_unit: parseFloat(el.dataset.cost || '0'),
          })
        })

        // Then the loose patches, as ONE line across every design — that is
        // what the shared 3-for-$20 tier prices.
        const patchLine = patchOrderLine(looseSelections())
        if (patchLine) pushLine(patchLine)

        if (!hasItems) { alertCustom('Please select at least one item.'); return }

        // Delivery is a charge ON an order, appended after the product loop so
        // it can never be the only thing in one.
        const deliveryChosen = isHomeDelivery()
        const deliveryAddress = (document.getElementById('deliveryAddress') as HTMLTextAreaElement)?.value.trim() || ''
        if (deliveryChosen && !deliveryAddress) {
          alertCustom('Please enter the delivery address.')
          return
        }
        if (deliveryChosen) {
          orderListHTML += `<li class="flex justify-between gap-3 border-b border-gray-100 pb-1"><span>1x Home Delivery</span><span class="text-gray-500 whitespace-nowrap">$${HOME_DELIVERY_FEE.toFixed(2)}</span></li>`
          itemsArr.push('1x Home Delivery')
          itemsData.push({ name: 'Home Delivery', qty: 1, unit_price: HOME_DELIVERY_FEE, line_total: HOME_DELIVERY_FEE, cost_per_unit: 0 })
        }

        const totalAmount = calculateTotal()
        const paymentRadio = document.querySelector('input[name="paymentMethod"]:checked') as HTMLInputElement
        const paymentMethod = paymentRadio?.value || ''

        const el = (id: string) => document.getElementById(id)
        const val = (id: string) => (document.getElementById(id) as HTMLInputElement)?.value || ''
        if (el('summaryItemsList')) el('summaryItemsList')!.innerHTML = orderListHTML
        if (el('summaryTotal')) el('summaryTotal')!.textContent = `$${totalAmount.toFixed(2)}`
        if (el('summaryConfirmTotal')) el('summaryConfirmTotal')!.textContent = `$${totalAmount.toFixed(2)}`
        if (el('sumAthlete')) el('sumAthlete')!.textContent = val('athleteName')
        if (el('sumTeacher')) el('sumTeacher')!.textContent = val('teacherName').trim()
        if (el('sumParent')) el('sumParent')!.textContent = val('parentName')
        if (el('sumPayment')) el('sumPayment')!.textContent = paymentMethod
        if (el('sumDelivery')) {
          el('sumDelivery')!.textContent = deliveryChosen
            ? `Home delivery — ${deliveryAddress}`
            : 'Given to your child in class'
        }

        orderPayload = {
          // The team is what gives this order an RSE- number and keeps it out
          // of the other fundraisers' order books. Do not drop it.
          team: 'rse',
          athleteName: val('athleteName'), teacherName: val('teacherName').trim(),
          parentName: val('parentName'),
          email: val('email'), phone: val('phone'), paymentMethod,
          deliveryMethod: deliveryChosen ? 'home' : 'classroom',
          deliveryAddress: deliveryChosen ? deliveryAddress : null,
          total: totalAmount, totalCost, totalProfit: totalAmount - totalCost,
          items: itemsArr.join(', '), itemsData, date: new Date().toISOString(),
        }

        if (confirmCheckbox) confirmCheckbox.checked = false
        showModal(summaryModal)
      })

      closeSummaryBtn?.addEventListener('click', () => hideModal(summaryModal))

      finalSubmitBtn?.addEventListener('click', async () => {
        if (confirmCheckbox && !confirmCheckbox.checked) { alertCustom('Please check the confirmation box to proceed.'); return }
        finalSubmitBtn.innerHTML = '<div class="loader"></div> PROCESSING...'
        finalSubmitBtn.disabled = true
        try {
          const res = await fetch('/api/cm-cheer-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(orderPayload),
          })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error || 'Submission failed')
          const orderRefEl = document.getElementById('successOrderRef')
          if (orderRefEl && data.order_ref) orderRefEl.textContent = data.order_ref
          hideModal(summaryModal)
          showModal(successModal)
        } catch {
          alertCustom('Error submitting. Please try again.')
          finalSubmitBtn.innerHTML = 'CONFIRM & SUBMIT'
          finalSubmitBtn.disabled = false
        }
      })

      closeSuccessBtn?.addEventListener('click', () => {
        hideModal(successModal)
        orderForm.reset()
        const info = document.getElementById('digitalPaymentInfo'); if (info) info.classList.add('hidden')
        // `form.reset()` knows nothing about classes we toggled or image srcs.
        const addrBox = document.getElementById('deliveryAddressBox'); if (addrBox) addrBox.classList.add('hidden')
        const addrField = document.getElementById('deliveryAddress') as HTMLTextAreaElement | null
        if (addrField) addrField.required = false
        resetCombos()
        calculateTotal()
        finalSubmitBtn.innerHTML = 'CONFIRM & SUBMIT'
        finalSubmitBtn.disabled = false
      })
    }

    setupQuantityButtons()
    setupComboControls()
    setupPaymentRadios()
    setupDeliveryRadios()
    setupFormSubmit()
    resetCombos()
    calculateTotal()
  }, [])

  return (
    <>
      <Script src="https://unpkg.com/lucide@latest" strategy="afterInteractive" onLoad={() => { if ((window as any).lucide) (window as any).lucide.createIcons() }} />
      <style dangerouslySetInnerHTML={{ __html: `
        #rse-merch-root input[type="number"]::-webkit-inner-spin-button,
        #rse-merch-root input[type="number"]::-webkit-outer-spin-button { -webkit-appearance:none;margin:0 }
        #rse-merch-root input[type="number"] { -moz-appearance:textfield }
        .loader { border:3px solid #FFF7D6;border-top:3px solid #004AAD;border-radius:50%;width:20px;height:20px;animation:spin 1s linear infinite;display:inline-block }
        @keyframes spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }
        /* Only the UNCHOSEN buttons get a hover cue. */
        .combo-btn.bg-white:hover { border-color:#004AAD !important; color:#004AAD !important; }` }} />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />

      <div id="rse-merch-root" className="w-full flex justify-center bg-slate-100 py-4 sm:py-8 font-sans antialiased text-gray-900">
        <div className="w-full max-w-4xl mx-auto px-2 sm:px-4">

          {/* Header */}
          <header className="bg-rseBlue text-white shadow-xl relative overflow-hidden rounded-t-2xl border-t-4 border-rseYellow">
            <div className="absolute top-0 right-0 w-64 h-full bg-rseYellow transform skew-x-[-20deg] opacity-20 translate-x-12"></div>
            <div className="absolute bottom-0 left-0 w-72 h-24 bg-rseInk transform skew-x-[-20deg] opacity-40 -translate-x-16"></div>
            <div className="max-w-4xl mx-auto px-4 py-10 md:py-14 text-center relative z-10">
              <div className="mb-6 relative inline-block group hover:scale-105 transition-transform duration-300">
                <div className="absolute inset-0 bg-rseYellow rounded-full blur-xl opacity-40 group-hover:opacity-60 transition-opacity"></div>
                <div className="relative mx-auto w-32 h-32 md:w-44 md:h-44 bg-white rounded-full border-4 border-rseYellow shadow-2xl overflow-hidden flex items-center justify-center p-4">
                  <img src="/images/rse-logo-rooster.webp" alt="RSE rooster" className="w-full h-full object-contain" />
                </div>
              </div>
              {/* The PTO's own bubble wordmark rather than a web font, so the
                  page looks like the merch. The h1 carries the words. */}
              <h1 className="sr-only">Remsenburg-Speonk Elementary — RSE Merch</h1>
              <img src="/images/rse-wordmark.webp" alt="Remsenburg Speonk" className="mx-auto w-full max-w-md md:max-w-xl mb-4 drop-shadow-[0_4px_0_rgba(10,31,79,0.45)]" />
              <div className="w-24 h-1.5 bg-rseYellow mx-auto mb-6 rounded-full"></div>
              <p className="text-xs md:text-sm text-rseInk font-bold tracking-[0.3em] uppercase px-4 bg-rseYellow inline-block py-1 rounded-full">Official RSE Merch</p>
            </div>
          </header>

          {/* Form */}
          <form id="orderForm" className="bg-white rounded-b-2xl shadow-2xl overflow-hidden border-x border-b border-gray-200">

            {/* Products */}
            <div className="p-4 md:p-8 border-b border-gray-100 bg-slate-50/60">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-rseBlue/10 rounded-lg text-rseBlue"><i data-lucide="shopping-bag" className="w-6 h-6"></i></div>
                <h2 className="text-xl sm:text-3xl font-bold text-rseInk font-oswald uppercase tracking-wide">The Merch</h2>
              </div>
              <p className="text-sm text-gray-600 mb-3 ml-1">Every piece comes in royal blue or yellow, finished with the patch of your choice.</p>

              {/* The four designs, shown once up front so the rows below are
                  recognisable at thumbnail size. */}
              <div className="mb-7 ml-1 bg-white border border-slate-200 rounded-xl p-4 max-w-full">
                <p className="text-xs font-bold uppercase tracking-widest text-rseBlue mb-3">Four patch designs — any one on any item</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {PATCHES.map((p) => (
                    <div key={p.key} className="flex items-center gap-3">
                      <div className="w-16 h-16 bg-rseCream rounded-lg p-1.5 flex-none">
                        <img src={p.art} alt={`${p.label} patch`} className="w-full h-full object-contain" />
                      </div>
                      <span className="text-sm font-bold text-rseInk uppercase font-oswald tracking-wide">{p.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

                {PRODUCTS.map((product) => {
                  const variants = variantsOf(product)
                  return (
                    <div
                      key={product.key}
                      id={`card-${product.key}`}
                      data-color={DEFAULT_COLOR}
                      data-patch={DEFAULT_PATCH}
                      className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col h-full"
                    >
                      {/* These SHOW a combination; the matching row below is
                          highlighted so the effect is always visible on the box
                          that actually orders. */}
                      <div className="space-y-2 mb-3">
                        <div className="flex gap-2">
                          {COLORS.map((c) => (
                            <button
                              key={c.key}
                              type="button"
                              className={`combo-btn flex-1 py-1.5 border-2 text-xs font-bold uppercase rounded-md transition-colors ${
                                c.key === DEFAULT_COLOR
                                  ? 'border-rseBlue bg-rseBlue text-white'
                                  : 'border-gray-200 bg-white text-gray-500'
                              }`}
                              data-product={product.key}
                              data-axis="color"
                              data-value={c.key}
                            >
                              {c.label}
                            </button>
                          ))}
                        </div>
                        <div className="grid grid-cols-4 gap-1.5">
                          {PATCHES.map((p) => (
                            <button
                              key={p.key}
                              type="button"
                              className={`combo-btn py-1.5 border-2 text-[10px] font-bold uppercase rounded-md transition-colors flex items-center justify-center gap-1 ${
                                p.key === DEFAULT_PATCH
                                  ? 'border-rseBlue bg-rseCream text-rseBlue'
                                  : 'border-gray-200 bg-white text-gray-500'
                              }`}
                              data-product={product.key}
                              data-axis="patch"
                              data-value={p.key}
                            >
                              <img src={p.art} alt="" className="w-4 h-4 object-contain pointer-events-none" />
                              {p.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="w-full aspect-square bg-slate-100 rounded-lg mb-4 overflow-hidden relative">
                        <img id={`img-${product.key}`} src={variants[0].img || ''} alt={variants[0].name} className="w-full h-full object-cover" />
                        {/* Shown only for a combination with no picture: names it
                            and shows the PATCH art, never a different product. */}
                        <div id={`ph-${product.key}`} className="hidden absolute inset-0 bg-rseCream flex-col items-center justify-center text-center p-5">
                          <img src={PATCHES[0].art} alt="" className="w-20 h-20 object-contain mb-3 opacity-80" />
                          <p data-cap className="text-xs font-bold uppercase tracking-wide text-rseInk leading-snug"></p>
                          <p className="text-[10px] uppercase tracking-widest text-slate-500 mt-2">Photo coming soon</p>
                        </div>
                      </div>
                      <div className="flex-grow">
                        <h3 className="text-xl font-bold text-gray-900 font-oswald uppercase">{product.title}</h3>
                        <p className="text-rseBlue font-black text-2xl mt-1 mb-2">${product.price}.00</p>
                        <p className="text-sm text-gray-600 mb-4 leading-relaxed">{product.blurb}</p>
                      </div>
                      <div className="mt-auto pt-4 border-t border-gray-100">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Pick your colour and patch</p>
                        <div className="space-y-2">
                          {variants.map((v) => (
                            <div
                              key={v.id}
                              className="variant-row flex items-center gap-2 bg-slate-50 rounded-lg p-1.5 transition-all"
                              data-product={product.key}
                            >
                              <button
                                type="button"
                                className="variant-preview flex items-center gap-2 flex-1 min-w-0 text-left"
                                data-product={product.key}
                                data-color={v.color.key}
                                data-patch={v.patch.key}
                                data-src={v.img || ''}
                                data-patch-art={v.patch.art}
                                data-combo={v.name}
                                title={`Show ${v.name}`}
                              >
                                <span className="w-3 h-3 rounded-full flex-none border border-black/20" style={{ background: v.color.swatch }}></span>
                                <span className="w-7 h-7 flex-none bg-white rounded border border-slate-200 p-0.5">
                                  <img src={v.patch.art} alt="" className="w-full h-full object-contain" />
                                </span>
                                <span className="text-[11px] font-bold uppercase tracking-wide text-gray-700 truncate">
                                  {v.color.short} · {v.patch.label}
                                </span>
                              </button>
                              <div className="flex items-center border-2 border-slate-200 rounded-lg bg-white overflow-hidden flex-none">
                                <button type="button" className="px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 decrement-btn" data-target={v.id}>&minus;</button>
                                <input
                                  type="number"
                                  id={v.id}
                                  data-name={v.name}
                                  className="qty-input w-9 text-center font-bold text-rseBlue outline-none py-1 text-sm"
                                  data-price={product.price}
                                  data-cost={product.cost}
                                  min="0"
                                  defaultValue="0"
                                  aria-label={v.name}
                                />
                                <button type="button" className="px-3 py-1.5 bg-rseBlue text-white font-bold hover:bg-rseInk transition-colors increment-btn" data-target={v.id}>+</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )
                })}

                {/*
                  LOOSE PATCHES — one card with a row per design, because the
                  3-for-$20 tier is SHARED across designs. `data-tier="patch"`
                  puts these, and only these, on it (`lib/fundraiserPatches.ts`).
                */}
                <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col h-full">
                  <div className="w-full aspect-square bg-rseCream rounded-lg mb-4 overflow-hidden relative grid grid-cols-2 gap-2 p-4">
                    {PATCHES.map((p) => (
                      <div key={p.key} className="bg-white rounded-lg border border-slate-200 p-2 flex items-center justify-center">
                        <img src={p.art} alt={`${p.label} patch`} className="w-full h-full object-contain" />
                      </div>
                    ))}
                  </div>
                  <div className="flex-grow">
                    <h3 className="text-xl font-bold text-gray-900 font-oswald uppercase">Patches On Their Own</h3>
                    <p className="text-rseBlue font-black text-2xl mt-1 mb-2">$8.00 <span className="text-sm font-bold text-gray-500 tracking-normal normal-case">(any 3 for $20)</span></p>
                    <p className="text-sm text-gray-600 mb-3 leading-relaxed">Iron-on patches to put wherever you like. Mix the designs however you want — three is three. Each patch after the third is ${PATCH_EXTRA_PRICE_CENTS / 100}.</p>
                  </div>
                  <div className="mt-auto pt-4 border-t border-gray-100">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">How many of each</p>
                    <div className="space-y-2">
                      {PATCHES.map((p) => (
                        <div key={p.key} className="flex items-center gap-2 bg-slate-50 rounded-lg p-1.5">
                          <span className="flex items-center gap-2 flex-1 min-w-0">
                            <span className="w-7 h-7 flex-none bg-white rounded border border-slate-200 p-0.5">
                              <img src={p.art} alt="" className="w-full h-full object-contain" />
                            </span>
                            <span className="text-[11px] font-bold uppercase tracking-wide text-gray-700 truncate">{p.label}</span>
                          </span>
                          <div className="flex items-center border-2 border-slate-200 rounded-lg bg-white overflow-hidden flex-none">
                            <button type="button" className="px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 decrement-btn" data-target={`qty-loose-${p.key}`}>&minus;</button>
                            <input
                              type="number"
                              id={`qty-loose-${p.key}`}
                              data-name={p.name}
                              data-tier="patch"
                              data-design={p.label}
                              className="qty-input w-9 text-center font-bold text-rseBlue outline-none py-1 text-sm"
                              data-price="8"
                              data-cost="5"
                              min="0"
                              defaultValue="0"
                              aria-label={`${p.name} quantity`}
                            />
                            <button type="button" className="px-3 py-1.5 bg-rseBlue text-white font-bold hover:bg-rseInk transition-colors increment-btn" data-target={`qty-loose-${p.key}`}>+</button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <p id="patchTierHint" className="text-[11px] text-rseBlue font-semibold mt-3 bg-rseCream/70 border border-slate-200 rounded-md px-2.5 py-1.5 leading-snug">
                      Mix and match — any 3 patches are $20.
                    </p>
                  </div>
                </div>

              </div>
            </div>

            {/* Customer Details */}
            <div className="p-6 md:p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-rseBlue/10 rounded-lg text-rseBlue"><i data-lucide="user" className="w-6 h-6"></i></div>
                <h2 className="text-xl sm:text-3xl font-bold text-rseInk font-oswald uppercase tracking-wide">Child / Parent Info</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  {/* The field id and the DB column stay `athlete*` — shared with
                      CM Cheer and the table. Only the label changes. */}
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Child Name</label>
                  <input type="text" id="athleteName" required placeholder="Child's Name" className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-rseBlue focus:ring-0 outline-none transition-all bg-slate-50" />
                </div>
                <div>
                  {/* In-class orders are sorted by room. Required by the API too. */}
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Child&apos;s Teacher</label>
                  <input type="text" id="teacherName" required maxLength={MAX_TEACHER_NAME_LENGTH} placeholder="Mrs. Smith" className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-rseBlue focus:ring-0 outline-none transition-all bg-slate-50" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Parent/Buyer Full Name</label>
                  <input type="text" id="parentName" required placeholder="Jane Doe" className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-rseBlue focus:ring-0 outline-none transition-all bg-slate-50" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Email</label>
                  <input type="email" id="email" required placeholder="jane@example.com" className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-rseBlue focus:ring-0 outline-none transition-all bg-slate-50" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Phone</label>
                  <input type="tel" id="phone" required placeholder="(555) 123-4567" className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-rseBlue focus:ring-0 outline-none transition-all bg-slate-50" />
                </div>
              </div>
            </div>

            {/* Fulfilment */}
            <div className="p-6 md:p-8 border-t border-gray-200">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-rseBlue/10 rounded-lg text-rseBlue"><i data-lucide="package" className="w-6 h-6"></i></div>
                <h2 className="text-xl sm:text-3xl font-bold text-rseInk font-oswald uppercase tracking-wide">How Should We Get It To You?</h2>
              </div>
              <p className="text-sm text-gray-500 mb-5 ml-1">Pick one. Home delivery is an extra {DELIVERY_FEE_SHORT} — and every cent of it goes to the PTO.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="cursor-pointer group">
                  <input type="radio" name="deliveryMethod" value="classroom" className="peer sr-only" defaultChecked required />
                  <div className="h-full p-4 border-2 border-gray-200 bg-white rounded-xl peer-checked:border-rseBlue peer-checked:bg-rseCream transition-all group-hover:border-gray-300">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-bold text-rseInk uppercase tracking-wide">🎒 Give It To My Child</span>
                      <span className="text-sm font-black text-green-700">FREE</span>
                    </div>
                    <p className="text-xs text-gray-500 leading-snug">We hand the order to your child at school when it arrives.</p>
                  </div>
                </label>
                <label className="cursor-pointer group">
                  <input type="radio" name="deliveryMethod" value="home" className="peer sr-only" />
                  <div className="h-full p-4 border-2 border-gray-200 bg-white rounded-xl peer-checked:border-rseBlue peer-checked:bg-rseCream transition-all group-hover:border-gray-300">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-bold text-rseInk uppercase tracking-wide">🚚 Deliver To My Home</span>
                      <span className="text-sm font-black text-rseBlue">+{DELIVERY_FEE_LABEL}</span>
                    </div>
                    <p className="text-xs text-gray-500 leading-snug">Dropped at your door. The {DELIVERY_FEE_SHORT} is <strong className="text-rseBlue">100% donated to the PTO</strong>.</p>
                  </div>
                </label>
              </div>
              <div id="deliveryAddressBox" className="hidden mt-5">
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Delivery Address</label>
                <textarea
                  id="deliveryAddress" rows={3}
                  placeholder="123 Main St, Remsenburg, NY 11960&#10;(apartment, gate code, or 'leave on side porch')"
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-rseBlue focus:ring-0 outline-none transition-all bg-slate-50 resize-none"
                ></textarea>
                <p className="text-xs text-gray-400 mt-1 ml-1">Include anything that helps us find the door.</p>
              </div>
            </div>

            {/* Payment */}
            <div className="p-6 md:p-8 bg-slate-50 border-y border-gray-200">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-rseBlue/10 rounded-lg text-rseBlue"><i data-lucide="credit-card" className="w-6 h-6"></i></div>
                <h2 className="text-xl sm:text-3xl font-bold text-rseInk font-oswald uppercase tracking-wide">Payment Method</h2>
              </div>
              <div className={`grid ${TAKES_VENMO ? 'grid-cols-2' : 'grid-cols-1 max-w-xs'} gap-3 mb-6`}>
                {TAKES_VENMO && (
                  <label className="cursor-pointer group">
                    <input type="radio" name="paymentMethod" value="venmo" className="peer sr-only" required />
                    <div className="py-4 px-2 border-2 border-gray-200 bg-white rounded-xl text-center peer-checked:border-rseBlue peer-checked:text-rseBlue peer-checked:bg-rseCream transition-all text-sm font-bold text-gray-600 uppercase group-hover:border-gray-300">Venmo</div>
                  </label>
                )}
                <label className="cursor-pointer group">
                  {/* With no Venmo, cash is the only option — so it starts chosen
                      rather than leaving a one-item radio group to be clicked. */}
                  <input type="radio" name="paymentMethod" value="cash" className="peer sr-only" required defaultChecked={!TAKES_VENMO} />
                  <div className="py-4 px-2 border-2 border-gray-200 bg-white rounded-xl text-center peer-checked:border-rseBlue peer-checked:text-rseBlue peer-checked:bg-rseCream transition-all text-sm font-bold text-gray-600 uppercase group-hover:border-gray-300">Cash To PTO</div>
                </label>
              </div>
              {!TAKES_VENMO && (
                <p className="text-xs text-gray-500 -mt-3 mb-2 ml-1">Send cash in an envelope with your child&apos;s name and order number. Online payment is coming soon.</p>
              )}
              {TAKES_VENMO && (
                <div id="digitalPaymentInfo" className="hidden bg-white border border-gray-200 rounded-xl p-4 sm:p-6 shadow-sm mb-2">
                  {/* Handle and link come from `lib/fundraiserTeams.ts`. There is
                      deliberately no QR here until one is generated from that
                      same string (`scripts/build-venmo-qr.mjs`) — an invented QR
                      is a payment routed somewhere nobody can read. */}
                  <p className="text-rseInk font-oswald text-xl uppercase mb-1">Send Your Venmo Payment</p>
                  <p className="text-gray-500 text-sm mb-4">Please include the <strong className="text-rseBlue">child&apos;s name</strong> in the payment description/memo.</p>
                  <a href={TEAM.venmoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-3 sm:px-5 py-2 bg-rseInk text-white rounded-full font-mono text-xs sm:text-sm font-bold max-w-full hover:bg-rseBlue transition-colors">
                    <span className="truncate">{TEAM.venmoHandle}</span>
                  </a>
                  <p className="text-xs text-gray-500 mt-2">
                    This is <strong className="text-rseInk">{TEAM.organization}</strong> — the name shown in Venmo.
                  </p>
                </div>
              )}
            </div>

            {/* Submit */}
            <div className="p-4 sm:p-6 md:p-10 bg-white">
              <div className="flex flex-col md:flex-row items-center justify-between gap-4 sm:gap-8">
                <div className="text-center md:text-left">
                  <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Total Due</p>
                  <p id="totalPriceDisplay" className="text-4xl sm:text-5xl font-black text-rseBlue">$0.00</p>
                </div>
                <button type="submit" className="w-full md:w-auto bg-rseInk hover:bg-rseBlue text-white font-oswald tracking-widest py-4 sm:py-5 px-8 sm:px-12 rounded-xl text-lg sm:text-xl transition-all shadow-xl hover:shadow-2xl flex items-center justify-center gap-3 group">
                  REVIEW ORDER
                  <i data-lucide="arrow-right" className="w-6 h-6 group-hover:translate-x-1 transition-transform"></i>
                </button>
              </div>
            </div>
          </form>

          <p className="text-center text-gray-400 text-xs mt-8 pb-10 uppercase font-bold tracking-widest">&copy; 2026 {TEAM.organization}</p>
        </div>

        {/* Summary Modal */}
        <div id="summaryModal" className="fixed inset-0 z-[9999] hidden items-center justify-center bg-black/90 backdrop-blur-md p-4 opacity-0 transition-opacity duration-300">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden transform scale-90 transition-transform duration-300 flex flex-col max-h-[90vh]">
            <div className="bg-rseBlue text-white p-6 border-b-4 border-rseYellow flex justify-between items-center">
              <h3 className="font-oswald text-2xl uppercase tracking-wider">Order Summary</h3>
              <button type="button" id="closeSummaryBtn" className="text-white/70 hover:text-white transition-colors"><i data-lucide="x" className="w-6 h-6"></i></button>
            </div>
            <div className="p-6 overflow-y-auto">
              <div className="bg-slate-50 rounded-lg p-4 mb-6 border border-slate-200">
                <h4 className="text-xs font-bold text-gray-500 uppercase mb-3">Items Ordered</h4>
                <ul id="summaryItemsList" className="space-y-2 text-sm font-medium text-gray-800"></ul>
                <div className="mt-4 pt-4 border-t border-slate-200 flex justify-between items-center font-bold">
                  <span className="uppercase text-gray-600">Total:</span>
                  <span id="summaryTotal" className="text-xl text-rseBlue">$0.00</span>
                </div>
              </div>
              <div className="mb-6">
                <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">Customer Details</h4>
                <p className="text-sm"><span className="text-gray-500">Child:</span> <span id="sumAthlete" className="font-medium"></span></p>
                <p className="text-sm"><span className="text-gray-500">Teacher:</span> <span id="sumTeacher" className="font-medium"></span></p>
                <p className="text-sm"><span className="text-gray-500">Parent/Buyer:</span> <span id="sumParent" className="font-medium"></span></p>
                <p className="text-sm"><span className="text-gray-500">Payment:</span> <span id="sumPayment" className="font-medium uppercase"></span></p>
                <p className="text-sm"><span className="text-gray-500">Delivery:</span> <span id="sumDelivery" className="font-medium"></span></p>
              </div>
              <label className="flex items-start gap-3 p-4 bg-rseCream border border-slate-200 rounded-lg cursor-pointer hover:bg-yellow-100 transition-colors">
                <input type="checkbox" id="confirmCheckbox" className="mt-1 w-5 h-5 text-rseBlue rounded border-gray-300 focus:ring-rseBlue" />
                <span className="text-sm text-gray-800 font-medium">
                  I confirm that the order details above are correct, and I will submit my payment of <strong id="summaryConfirmTotal" className="text-rseBlue"></strong> via the selected method.
                </span>
              </label>
            </div>
            <div className="p-6 bg-slate-50 border-t border-slate-200">
              <button id="finalSubmitBtn" className="w-full bg-rseBlue hover:bg-rseInk text-white font-oswald text-xl tracking-widest py-4 rounded-lg transition-colors shadow-lg flex justify-center items-center gap-2">
                CONFIRM &amp; SUBMIT
              </button>
            </div>
          </div>
        </div>

        {/* Success Modal */}
        <div id="successModal" className="fixed inset-0 z-[9999] hidden items-center justify-center bg-black/90 backdrop-blur-md p-4 opacity-0 transition-opacity duration-300">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-8 text-center transform scale-90 transition-transform duration-300 border-t-8 border-rseYellow">
            <div className="mx-auto w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-6">
              <i data-lucide="check" className="w-10 h-10 stroke-[3px]"></i>
            </div>
            <h3 className="font-oswald text-4xl text-rseInk mb-2 uppercase">Order Received!</h3>
            <p id="successOrderRef" className="text-rseBlue font-bold text-lg tracking-widest mb-3"></p>
            <p className="text-gray-500 mb-8 font-medium">Thank you for supporting RSE! A confirmation has been sent to your email.</p>
            <button id="closeSuccessBtn" className="w-full bg-rseBlue hover:bg-rseInk text-white font-bold py-4 rounded-lg transition-colors shadow-lg uppercase tracking-wider">Done</button>
          </div>
        </div>
      </div>

    </>
  )
}
