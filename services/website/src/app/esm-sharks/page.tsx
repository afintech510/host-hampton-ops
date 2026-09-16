'use client'

import { useEffect } from 'react'
import Script from 'next/script'
import {
  isLoosePatchInput,
  patchOrderLine,
  patchPriceDollars,
  totalPatchQty,
  type PatchSelection,
} from '@/lib/fundraiserPatches'
import { FUNDRAISER_TEAMS } from '@/lib/fundraiserTeams'

/**
 * This page's team record — the one place the Venmo account is written.
 *
 * The handle used to be a literal in the markup AND a field in the module, and
 * the confirmation email read the module while the page read the literal. Two
 * copies of "where the money goes" is the bug that has already bitten CM Cheer,
 * whose page and email still name different accounts.
 */
const TEAM = FUNDRAISER_TEAMS['esm-sharks']
// Footer is rendered by root layout

/**
 * The ESM Sharks fundraiser order form — the second real storefront on
 * `cm_cheer_orders`, after CM Cheer.
 *
 * Structurally this is `/cm-cheer`, in navy and silver instead of black and red.
 * The one behavioural difference that matters is the `team: 'esm-sharks'` in the
 * posted payload: it is what the DB trigger reads to mint an `ESM-` order
 * number, and what keeps these orders out of the CM Cheer organizer dashboard.
 * See `lib/fundraiserTeams.ts` and migration 051.
 *
 * ── Every product is a COLOUR AND A PATCH ──────────────────────────────────
 *
 * The Eastport-Tuttle PTO chose two designs (2026-09-16): the circle crest and
 * the "Sharks" script wordmark. Either can go on any item, so a hat is no longer
 * one thing with a colour — it is one of four things. That choice is expressed
 * as FOUR QUANTITY BOXES per product rather than a toggle, and the reason is
 * worth keeping:
 *
 * The colour buttons on this page used to look like a chooser and were only a
 * picture-swapper — the real colour choice was always the quantity boxes below
 * them. Adding a patch toggle that looked identical but genuinely decided what
 * got stitched would have put two lookalike controls on one card, one cosmetic
 * and one binding. A box per combination has no hidden state at all: what is in
 * the boxes is what gets made, and the item name falls out of the row it came
 * from.
 *
 * The colour buttons are back by Adam's request (2026-09-16), joined by two for
 * the patch, and the trap above is answered by WIRING them to the rows instead
 * of leaving them floating: the buttons and the rows are one piece of state
 * (`syncCard`), so picking "Silver" + "Script" moves the highlight onto the
 * Silver-Script row. The buttons are a fast way to look; the highlighted row is
 * where that look lands; the box on it is still the only thing that orders
 * anything. A control whose effect you can see cannot be the silent kind.
 *
 * Product photography is real (`/images/esm-*.webp`, from `photos/source/`) and
 * named for its patch: `esm-tote-navy-circle.webp`, `esm-tote-navy-script.webp`.
 * All TWELVE combinations are shot as of 2026-09-16, so the picker can show any
 * of them. `shots` still allows a null and the card still renders an honest
 * "photo coming" tile for one — that path is what stops a future un-shot
 * combination illustrating itself with a neighbour's picture.
 *
 * Loose patches are still sold on their own, and their 3-for-$20 tier MIXES
 * across designs. That arithmetic lives in `lib/fundraiserPatches.ts`, where it
 * is tested — see the notes there for why it is not in this file.
 *
 * The Venmo account is the PTO's own as of 2026-09-16 and comes from
 * `lib/fundraiserTeams.ts` — the page holds no handle of its own.
 */

/** A patch design, as the buyer reads it and as the order book records it. */
const PATCHES = [
  { key: 'circle', label: 'Circle', art: '/images/esm-sharks-patch.webp', name: 'Circle Patch' },
  { key: 'script', label: 'Script', art: '/images/esm-patch-script.webp', name: 'Script Patch' },
] as const

const COLORS = [
  { key: 'navy', label: 'Navy', swatch: '#0C2340' },
  { key: 'silver', label: 'Silver', swatch: '#A2AAAD' },
] as const

/**
 * The catalogue. `img` is the photo of THAT exact combination, or null where we
 * have not shot it — a null renders an honest "photo coming" tile instead of a
 * neighbouring combination's picture.
 */
const PRODUCTS = [
  {
    key: 'hat',
    title: 'Trucker Hat',
    price: 25,
    cost: 20,
    blurb: 'Classic mesh-back snapback with your patch stitched on the front panel.',
    shots: {
      'navy-circle': '/images/esm-hat-navy-circle.webp',
      'navy-script': '/images/esm-hat-navy-script.webp',
      'silver-circle': '/images/esm-hat-silver-circle.webp',
      'silver-script': '/images/esm-hat-silver-script.webp',
    },
  },
  {
    key: 'tote',
    title: 'Canvas Tote',
    price: 40,
    cost: 30,
    blurb: 'Heavy-duty canvas tote with your patch on the front. Big enough for a game day.',
    shots: {
      'navy-circle': '/images/esm-tote-navy-circle.webp',
      'navy-script': '/images/esm-tote-navy-script.webp',
      'silver-circle': '/images/esm-tote-silver-circle.webp',
      'silver-script': '/images/esm-tote-silver-script.webp',
    },
  },
  {
    key: 'pouch',
    title: 'Zip Pouch',
    price: 25,
    cost: 20,
    blurb: 'Zippered canvas pouch with your patch. Mouthguards, tape, pencils, whatever.',
    shots: {
      'navy-circle': '/images/esm-pouch-navy-circle.webp',
      'navy-script': '/images/esm-pouch-navy-script.webp',
      'silver-circle': '/images/esm-pouch-silver-circle.webp',
      'silver-script': '/images/esm-pouch-silver-script.webp',
    },
  },
] as const

/** Every combination of one product, in the order the rows are drawn. */
function variantsOf(p: (typeof PRODUCTS)[number]) {
  return COLORS.flatMap((c) =>
    PATCHES.map((patch) => {
      const shotKey = `${c.key}-${patch.key}` as keyof typeof p.shots
      return {
        id: `qty-${p.key}-${c.key}-${patch.key}`,
        color: c,
        patch,
        /** What a human reads in the order book, the CSV and both emails. */
        name: `${c.label} ${p.title} — ${patch.name}`,
        img: p.shots[shotKey] as string | null,
      }
    }),
  )
}

export default function ESMSharksPage() {
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
     * Which combination each card is currently SHOWING.
     *
     * The colour and patch buttons and the twelve rows are two views of one
     * piece of state, held on the card as `data-color` / `data-patch`. Whichever
     * you touch, `syncCard` redraws both, so the buttons can never point at one
     * combination while a different row looks selected.
     *
     * This is a PREVIEW, not the order — the quantity boxes are still the only
     * thing that decides what gets made. That is why the highlighted row moves
     * with the buttons: it shows you which of the twelve boxes the picture on
     * screen belongs to, instead of leaving the buttons as a control whose
     * effect you cannot locate.
     */
    const ACTIVE = {
      navy: ['border-esmNavy', 'bg-esmNavy', 'text-white'],
      silver: ['border-esmSilver', 'bg-esmSilver', 'text-esmInk'],
      // Both patches are navy thread now, so a filled navy button would swallow
      // the thumbnail inside it. A light fill with a navy border reads as
      // "chosen" and keeps the artwork legible.
      patch: ['border-esmNavy', 'bg-esmMist', 'text-esmNavy'],
    }
    const IDLE = ['border-gray-200', 'bg-white', 'text-gray-500']
    const ALL_ACTIVE = [...ACTIVE.navy, ...ACTIVE.silver, ...ACTIVE.patch]

    function syncCard(key: string) {
      const card = document.getElementById(`card-${key}`)
      if (!card) return
      const color = card.dataset.color || 'navy'
      const patch = card.dataset.patch || 'circle'

      // The row for this combination is the source of truth for the photo: it
      // carries the one `data-src` we shot for it.
      const row = document.querySelector(
        `.variant-preview[data-product="${key}"][data-color="${color}"][data-patch="${patch}"]`,
      ) as HTMLElement | null
      if (!row) return

      const img = document.getElementById(`img-${key}`) as HTMLImageElement | null
      const ph = document.getElementById(`ph-${key}`)
      const src = row.getAttribute('data-src') || ''
      if (img && ph) {
        // `hidden` and `flex` are both display utilities of equal specificity,
        // so which one wins is decided by their order in the generated stylesheet.
        // Toggling both explicitly keeps that out of it.
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
        r.classList.remove('ring-2', 'ring-esmNavy', 'bg-esmMist/70')
        r.classList.add('bg-slate-50')
      })
      const rowEl = row.closest('.variant-row')
      if (rowEl) { rowEl.classList.remove('bg-slate-50'); rowEl.classList.add('ring-2', 'ring-esmNavy', 'bg-esmMist/70') }

      document.querySelectorAll(`.combo-btn[data-product="${key}"]`).forEach((b) => {
        const btn = b as HTMLElement
        const axis = btn.dataset.axis as 'color' | 'patch'
        const on = axis === 'color' ? btn.dataset.value === color : btn.dataset.value === patch
        btn.classList.remove(...ALL_ACTIVE, ...IDLE)
        if (!on) { btn.classList.add(...IDLE); return }
        btn.classList.add(...(axis === 'patch' ? ACTIVE.patch : ACTIVE[btn.dataset.value as 'navy' | 'silver']))
      })
    }

    /** Point a card at one combination, from a button or from a row. */
    function pickCombo(key: string, axis: string, value: string) {
      const card = document.getElementById(`card-${key}`)
      if (!card) return
      if (axis === 'color') card.dataset.color = value
      else card.dataset.patch = value
      syncCard(key)
    }

    function setupComboControls() {
      // The buttons carry an <img>, so a click can land on the child — read the
      // listener's own element rather than the event target.
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
          card.dataset.color = row.dataset.color || 'navy'
          card.dataset.patch = row.dataset.patch || 'circle'
          syncCard(row.dataset.product || '')
        })
      })
    }

    /** Point every card back at navy + circle — on load and after a reset. */
    function resetCombos() {
      document.querySelectorAll('[id^="card-"]').forEach((c) => {
        const card = c as HTMLElement
        card.dataset.color = 'navy'
        card.dataset.patch = 'circle'
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

    /**
     * The loose patches currently in the order, by design.
     *
     * Driven by `data-tier="patch"` — an explicit opt-in, NOT an id prefix. Every
     * product row is a patch choice now, so ids like `qty-hat-navy-circle` sit
     * in the same page; a prefix rule would be one rename away from charging a
     * $25 hat at the $6.65 patch tier. See `lib/fundraiserPatches.ts`.
     */
    function looseSelections(): PatchSelection[] {
      const out: PatchSelection[] = []
      document.querySelectorAll('.qty-input').forEach((input) => {
        const el = input as HTMLInputElement
        if (!isLoosePatchInput(el)) return
        out.push({ design: el.dataset.design || '', qty: parseInt(el.value) || 0 })
      })
      return out
    }

    /**
     * The home-delivery upcharge, in dollars.
     *
     * The server has its own copy in `lib/fundraiserDelivery.ts` and that one is
     * AUTHORITATIVE: the route throws away whatever delivery line this page
     * sends and substitutes its own. This constant exists so the number on
     * screen matches what will be charged — if the two ever drift, the customer
     * is quoted this and billed that, and the difference is written to the
     * order's status note rather than silently banked.
     */
    const HOME_DELIVERY_FEE = 7

    function isHomeDelivery(): boolean {
      const picked = document.querySelector('input[name="deliveryMethod"]:checked') as HTMLInputElement | null
      return picked?.value === 'home'
    }

    /**
     * Tell the buyer where they stand against the mix-and-match tier.
     *
     * "3 for $20" is only believable if the page shows it landing. Two patches
     * of different designs still count as two toward the same three, and this
     * line is what makes that visible before they reach the summary.
     */
    function updatePatchHint(qty: number) {
      const hint = document.getElementById('patchTierHint')
      if (!hint) return
      if (qty === 0) {
        hint.textContent = 'Mix and match — any 3 patches are $20.'
      } else if (qty < 3) {
        const more = 3 - qty
        const saving = qty * 8 + more * 8 - 20
        hint.textContent = `${qty} selected. Add ${more} more (either design) for the 3 for $20 price — saves $${saving.toFixed(2)}.`
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
      toast.className = 'fixed bottom-10 left-1/2 -translate-x-1/2 bg-esmNavy text-white px-8 py-4 rounded-full shadow-2xl z-[9999] font-bold text-sm uppercase tracking-widest'
      toast.innerText = msg; document.body.appendChild(toast); setTimeout(() => toast.remove(), 3000)
    }

    /**
     * Show the address box only when it is needed, and re-total on every change.
     *
     * The address field is `required` in the markup only while it is visible —
     * a hidden `required` input blocks form submission with a validation bubble
     * pointing at nothing the customer can see.
     */
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

        // Products first, one line per colour-and-patch combination. Each is a
        // plain qty × price; only the loose patches are tiered.
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

        // Then the loose patches, as ONE line across both designs — that is what
        // the shared 3-for-$20 tier prices, and splitting it would invent
        // per-design figures that do not exist.
        const patchLine = patchOrderLine(looseSelections())
        if (patchLine) pushLine(patchLine)

        if (!hasItems) { alertCustom('Please select at least one item.'); return }

        /**
         * Delivery is appended AFTER the product loop, not folded into it.
         *
         * The loop is driven by `.qty-input` elements, and making the fee one of
         * those would put it in the merchandise grid, in the patch-tier check
         * and in the "select at least one item" test — so a customer could order
         * nothing but a delivery. It is a charge ON an order; the server draws
         * the same line and rejects a delivery-only order outright.
         */
        const deliveryChosen = isHomeDelivery()
        const deliveryAddress = (document.getElementById('deliveryAddress') as HTMLTextAreaElement)?.value.trim() || ''
        if (deliveryChosen && !deliveryAddress) {
          alertCustom('Please enter the delivery address.')
          return
        }
        if (deliveryChosen) {
          orderListHTML += `<li class="flex justify-between gap-3 border-b border-gray-100 pb-1"><span>1x Home Delivery</span><span class="text-gray-500 whitespace-nowrap">$${HOME_DELIVERY_FEE.toFixed(2)}</span></li>`
          itemsArr.push('1x Home Delivery')
          // cost_per_unit is 0 — the whole fee is the PTO's, so it all counts
          // as raised rather than being netted off as a cost to us.
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
        if (el('sumParent')) el('sumParent')!.textContent = val('parentName')
        if (el('sumPayment')) el('sumPayment')!.textContent = paymentMethod
        if (el('sumDelivery')) {
          el('sumDelivery')!.textContent = deliveryChosen
            ? `Home delivery — ${deliveryAddress}`
            : 'Given to your child in class'
        }

        orderPayload = {
          // The team is what gives this order an ESM- number and keeps it out of
          // the CM Cheer order book. Do not drop it.
          team: 'esm-sharks',
          athleteName: val('athleteName'), parentName: val('parentName'),
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
        // `form.reset()` restores the 'classroom' radio's defaultChecked state
        // but not the class we toggled, so the address box would stay open over
        // a fresh order and quietly re-add $7.
        const addrBox = document.getElementById('deliveryAddressBox'); if (addrBox) addrBox.classList.add('hidden')
        const addrField = document.getElementById('deliveryAddress') as HTMLTextAreaElement | null
        if (addrField) addrField.required = false
        // Same reason: the highlighted row and the hero photo are classes and
        // `src`, neither of which `form.reset()` knows about.
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
        #esm-sharks-root input[type="number"]::-webkit-inner-spin-button,
        #esm-sharks-root input[type="number"]::-webkit-outer-spin-button { -webkit-appearance:none;margin:0 }
        #esm-sharks-root input[type="number"] { -moz-appearance:textfield }
        .varsity-outline { -webkit-text-stroke:1px #0C2340;text-shadow:3px 3px 0px rgba(12,35,64,0.45) }
        .loader { border:3px solid #E6E9EC;border-top:3px solid #0C2340;border-radius:50%;width:20px;height:20px;animation:spin 1s linear infinite;display:inline-block }
        @keyframes spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }
        /* Only the UNCHOSEN buttons get a hover cue — an active one is already
           filled, and re-colouring it on hover reads as a state change. */
        .combo-btn.bg-white:hover { border-color:#0C2340 !important; color:#0C2340 !important; }` }} />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;700&family=Bebas+Neue&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />

      <div id="esm-sharks-root" className="w-full flex justify-center bg-slate-100 py-4 sm:py-8 font-sans antialiased text-gray-900">
        <div className="w-full max-w-4xl mx-auto px-2 sm:px-4">

          {/* Header */}
          <header className="bg-esmInk text-white shadow-xl relative overflow-hidden rounded-t-2xl border-t-4 border-esmSilver">
            <div className="absolute top-0 right-0 w-64 h-full bg-esmSilver transform skew-x-[-20deg] opacity-15 translate-x-12"></div>
            <div className="absolute bottom-0 left-0 w-72 h-24 bg-esmNavy transform skew-x-[-20deg] opacity-40 -translate-x-16"></div>
            <div className="max-w-4xl mx-auto px-4 py-10 md:py-16 text-center relative z-10">
              <div className="mb-6 relative inline-block group hover:scale-105 transition-transform duration-300">
                <div className="absolute inset-0 bg-esmSilver rounded-full blur-xl opacity-30 group-hover:opacity-50 transition-opacity"></div>
                <div className="relative mx-auto w-32 h-32 md:w-48 md:h-48 bg-white rounded-full border-4 border-esmSilver shadow-2xl overflow-hidden flex items-center justify-center">
                  <img src="/images/esm-sharks-logo.webp" alt="ESM Sharks Logo" className="w-full h-full object-contain" />
                </div>
              </div>
              <h1 className="font-oswald text-xl md:text-3xl tracking-[0.2em] text-esmSilver mb-2 uppercase">Eastport-South Manor</h1>
              <p className="font-varsity text-6xl md:text-9xl text-white tracking-wider mb-2 leading-none varsity-outline">SHARKS</p>
              <div className="w-24 h-1.5 bg-esmSilver mx-auto mb-6 rounded-full"></div>
              <p className="text-xs md:text-sm text-white font-bold tracking-[0.3em] uppercase px-4 bg-esmSilver/20 inline-block py-1 rounded-full">Official Eastport Elementary - Tuttle Fundraiser</p>
            </div>
          </header>

          {/* Form */}
          <form id="orderForm" className="bg-white rounded-b-2xl shadow-2xl overflow-hidden border-x border-b border-gray-200">

            {/* Products */}
            <div className="p-4 md:p-8 border-b border-gray-100 bg-slate-50/60">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-esmNavy/10 rounded-lg text-esmNavy"><i data-lucide="shopping-bag" className="w-6 h-6"></i></div>
                <h2 className="text-xl sm:text-3xl font-bold text-esmInk font-oswald uppercase tracking-wide">The Merch</h2>
              </div>
              <p className="text-sm text-gray-600 mb-3 ml-1">Every piece comes in navy or silver, finished with the patch of your choice.</p>

              {/* The two designs, shown once up front so the rows below are
                  recognisable at thumbnail size. */}
              <div className="mb-7 ml-1 bg-white border border-slate-200 rounded-xl p-4 inline-block max-w-full">
                <p className="text-xs font-bold uppercase tracking-widest text-esmSilver mb-3">Two patch designs — either one on any item</p>
                <div className="flex flex-wrap items-center gap-5">
                  {PATCHES.map((p) => (
                    <div key={p.key} className="flex items-center gap-3">
                      <div className="w-16 h-16 bg-esmMist rounded-lg p-1.5 flex-none">
                        <img src={p.art} alt={`${p.label} patch`} className="w-full h-full object-contain" />
                      </div>
                      <span className="text-sm font-bold text-esmInk uppercase font-oswald tracking-wide">{p.label}</span>
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
                      data-color="navy"
                      data-patch="circle"
                      className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col h-full"
                    >
                      {/*
                        Two axes of two. These SHOW a combination; they do not
                        order one. Picking here moves the highlight onto the
                        matching row below, so the effect of the button is always
                        visible on the box that actually decides.
                      */}
                      <div className="space-y-2 mb-3">
                        <div className="flex gap-2">
                          {COLORS.map((c) => (
                            <button
                              key={c.key}
                              type="button"
                              className={`combo-btn flex-1 py-1.5 border-2 text-xs font-bold uppercase rounded-md transition-colors ${
                                c.key === 'navy'
                                  ? 'border-esmNavy bg-esmNavy text-white'
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
                        <div className="flex gap-2">
                          {PATCHES.map((p) => (
                            <button
                              key={p.key}
                              type="button"
                              className={`combo-btn flex-1 py-1.5 border-2 text-xs font-bold uppercase rounded-md transition-colors flex items-center justify-center gap-1.5 ${
                                p.key === 'circle'
                                  ? 'border-esmNavy bg-esmMist text-esmNavy'
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
                        {/*
                          Shown only for a combination we have not photographed.
                          It names the combination and shows the PATCH art, so it
                          never stands in for a picture of a different product.
                        */}
                        <div id={`ph-${product.key}`} className="hidden absolute inset-0 bg-esmMist flex-col items-center justify-center text-center p-5">
                          {/* src is set before this is ever shown; seeding it
                              with real art avoids an empty `src`, which some
                              browsers resolve against the page URL and re-fetch. */}
                          <img src={PATCHES[0].art} alt="" className="w-20 h-20 object-contain mb-3 opacity-80" />
                          <p data-cap className="text-xs font-bold uppercase tracking-wide text-esmInk leading-snug"></p>
                          <p className="text-[10px] uppercase tracking-widest text-slate-500 mt-2">Photo coming soon</p>
                        </div>
                      </div>
                      <div className="flex-grow">
                        <h3 className="text-xl font-bold text-gray-900 font-oswald uppercase">{product.title}</h3>
                        <p className="text-esmNavy font-black text-2xl mt-1 mb-2">${product.price}.00</p>
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
                              {/*
                                The row's own label is the preview control, so the
                                one thing that changes the picture is the same
                                thing that names what gets stitched.
                              */}
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
                                  {v.color.label} · {v.patch.label}
                                </span>
                              </button>
                              <div className="flex items-center border-2 border-slate-200 rounded-lg bg-white overflow-hidden flex-none">
                                <button type="button" className="px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 decrement-btn" data-target={v.id}>&minus;</button>
                                <input
                                  type="number"
                                  id={v.id}
                                  data-name={v.name}
                                  className="qty-input w-9 text-center font-bold text-esmNavy outline-none py-1 text-sm"
                                  data-price={product.price}
                                  data-cost={product.cost}
                                  min="0"
                                  defaultValue="0"
                                  aria-label={v.name}
                                />
                                <button type="button" className="px-3 py-1.5 bg-esmNavy text-white font-bold hover:bg-esmInk transition-colors increment-btn" data-target={v.id}>+</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )
                })}

                {/*
                  LOOSE PATCHES — a patch on its own, not the decoration on an
                  item above.

                  One card with a row per design, rather than a card per design,
                  because the 3-for-$20 tier is shared: two circles and a script
                  is three patches and therefore $20 (Adam, 2026-09-16). Two
                  cards each printing "3 for $20" would have said the tier was
                  per design, which is exactly the arithmetic this replaces.

                  `data-tier="patch"` is what puts these — and ONLY these — on the
                  tier. See `lib/fundraiserPatches.ts`.
                */}
                <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col h-full">
                  <div className="w-full aspect-square bg-slate-100 rounded-lg mb-4 overflow-hidden relative grid grid-cols-2 gap-2 p-4">
                    {PATCHES.map((p) => (
                      <div key={p.key} className="bg-white rounded-lg border border-slate-200 p-2 flex items-center justify-center">
                        <img src={p.art} alt={`${p.label} patch`} className="w-full h-full object-contain" />
                      </div>
                    ))}
                  </div>
                  <div className="flex-grow">
                    <h3 className="text-xl font-bold text-gray-900 font-oswald uppercase">Patches On Their Own</h3>
                    <p className="text-esmNavy font-black text-2xl mt-1 mb-2">$8.00 <span className="text-sm font-bold text-gray-500 tracking-normal normal-case">(any 3 for $20)</span></p>
                    <p className="text-sm text-gray-600 mb-3 leading-relaxed">Iron-on patches to put wherever you like. Mix the two designs however you want — three is three.</p>
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
                              className="qty-input w-9 text-center font-bold text-esmNavy outline-none py-1 text-sm"
                              data-price="8"
                              data-cost="5"
                              min="0"
                              defaultValue="0"
                              aria-label={`${p.name} quantity`}
                            />
                            <button type="button" className="px-3 py-1.5 bg-esmNavy text-white font-bold hover:bg-esmInk transition-colors increment-btn" data-target={`qty-loose-${p.key}`}>+</button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <p id="patchTierHint" className="text-[11px] text-esmNavy font-semibold mt-3 bg-esmMist/70 border border-slate-200 rounded-md px-2.5 py-1.5 leading-snug">
                      Mix and match — any 3 patches are $20.
                    </p>
                  </div>
                </div>

              </div>
            </div>

            {/* Customer Details */}
            <div className="p-6 md:p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-esmNavy/10 rounded-lg text-esmNavy"><i data-lucide="user" className="w-6 h-6"></i></div>
                <h2 className="text-xl sm:text-3xl font-bold text-esmInk font-oswald uppercase tracking-wide">Child / Parent Info</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  {/* The field id and the DB column stay `athlete*` — they are shared with
                      CM Cheer and the table. Only what the customer reads changes. */}
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Child Name</label>
                  <input type="text" id="athleteName" required placeholder="Child's Name" className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-esmNavy focus:ring-0 outline-none transition-all bg-slate-50" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Parent/Buyer Full Name</label>
                  <input type="text" id="parentName" required placeholder="Jane Doe" className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-esmNavy focus:ring-0 outline-none transition-all bg-slate-50" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Email</label>
                  <input type="email" id="email" required placeholder="jane@example.com" className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-esmNavy focus:ring-0 outline-none transition-all bg-slate-50" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Phone</label>
                  <input type="tel" id="phone" required placeholder="(555) 123-4567" className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-esmNavy focus:ring-0 outline-none transition-all bg-slate-50" />
                </div>
              </div>
            </div>

            {/* Fulfilment — how the order gets to the family */}
            <div className="p-6 md:p-8 border-t border-gray-200">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-esmNavy/10 rounded-lg text-esmNavy"><i data-lucide="package" className="w-6 h-6"></i></div>
                <h2 className="text-xl sm:text-3xl font-bold text-esmInk font-oswald uppercase tracking-wide">How Should We Get It To You?</h2>
              </div>
              <p className="text-sm text-gray-500 mb-5 ml-1">Pick one. Home delivery is an extra $7 — and every cent of it goes to the PTO.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="cursor-pointer group">
                  {/* Checked by default: this is how every order has worked so
                      far, and the free option should never be the one you have
                      to go looking for. */}
                  <input type="radio" name="deliveryMethod" value="classroom" className="peer sr-only" defaultChecked required />
                  <div className="h-full p-4 border-2 border-gray-200 bg-white rounded-xl peer-checked:border-esmNavy peer-checked:bg-esmMist transition-all group-hover:border-gray-300">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-bold text-esmInk uppercase tracking-wide">🎒 Give It To My Child</span>
                      <span className="text-sm font-black text-green-700">FREE</span>
                    </div>
                    <p className="text-xs text-gray-500 leading-snug">We hand the order to your child at school when it arrives.</p>
                  </div>
                </label>
                <label className="cursor-pointer group">
                  <input type="radio" name="deliveryMethod" value="home" className="peer sr-only" />
                  <div className="h-full p-4 border-2 border-gray-200 bg-white rounded-xl peer-checked:border-esmNavy peer-checked:bg-esmMist transition-all group-hover:border-gray-300">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-bold text-esmInk uppercase tracking-wide">🚚 Deliver To My Home</span>
                      <span className="text-sm font-black text-esmNavy">+$7.00</span>
                    </div>
                    <p className="text-xs text-gray-500 leading-snug">Dropped at your door. The $7 is <strong className="text-esmNavy">100% donated to the PTO</strong>.</p>
                  </div>
                </label>
              </div>
              <div id="deliveryAddressBox" className="hidden mt-5">
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Delivery Address</label>
                <textarea
                  id="deliveryAddress" rows={3}
                  placeholder="123 Main St, Eastport, NY 11941&#10;(apartment, gate code, or 'leave on side porch')"
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-esmNavy focus:ring-0 outline-none transition-all bg-slate-50 resize-none"
                ></textarea>
                <p className="text-xs text-gray-400 mt-1 ml-1">Include anything that helps us find the door.</p>
              </div>
            </div>

            {/* Payment */}
            <div className="p-6 md:p-8 bg-slate-50 border-y border-gray-200">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-esmNavy/10 rounded-lg text-esmNavy"><i data-lucide="credit-card" className="w-6 h-6"></i></div>
                <h2 className="text-xl sm:text-3xl font-bold text-esmInk font-oswald uppercase tracking-wide">Payment Method</h2>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-6">
                <label className="cursor-pointer group">
                  <input type="radio" name="paymentMethod" value="venmo" className="peer sr-only" required />
                  <div className="py-4 px-2 border-2 border-gray-200 bg-white rounded-xl text-center peer-checked:border-esmNavy peer-checked:text-esmNavy peer-checked:bg-esmMist transition-all text-sm font-bold text-gray-600 uppercase group-hover:border-gray-300">Venmo</div>
                </label>
                <label className="cursor-pointer group">
                  <input type="radio" name="paymentMethod" value="cash" className="peer sr-only" />
                  <div className="py-4 px-2 border-2 border-gray-200 bg-white rounded-xl text-center peer-checked:border-esmNavy peer-checked:text-esmNavy peer-checked:bg-esmMist transition-all text-sm font-bold text-gray-600 uppercase group-hover:border-gray-300">Cash (To Coach)</div>
                </label>
              </div>
              <div id="digitalPaymentInfo" className="hidden bg-white border border-gray-200 rounded-xl p-4 sm:p-6 shadow-sm mb-2 flex-col md:flex-row items-center gap-4 sm:gap-6">
                {/*
                  Both the QR and the handle come from `lib/fundraiserTeams.ts`,
                  never from a literal typed here.

                  A QR is unreadable to a human, so a copied or invented one is a
                  payment silently routed to the wrong account with nothing on
                  screen to give it away. The picture is generated from the same
                  string the text shows (`scripts/build-venmo-qr.mjs`), the
                  account name is printed UNDER it so a parent can see who they
                  are about to pay, and a test ties all three together.
                */}
                <a
                  href={TEAM.venmoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-32 h-32 flex-shrink-0 rounded-xl border border-slate-200 bg-white p-2 shadow-sm hover:shadow-md transition-shadow"
                >
                  <img src="/images/esm-venmo-qr.png" alt={`Venmo QR code for ${TEAM.venmoHandle}`} className="w-full h-full object-contain" />
                </a>
                <div className="text-center md:text-left">
                  <p className="text-esmInk font-oswald text-xl uppercase mb-1">Send Your Venmo Payment</p>
                  <p className="text-gray-500 text-sm mb-4">Please include the <strong className="text-esmNavy">child&apos;s name</strong> in the payment description/memo.</p>
                  <a href={TEAM.venmoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-3 sm:px-5 py-2 bg-esmInk text-white rounded-full font-mono text-xs sm:text-sm font-bold border border-slate-700 max-w-full hover:bg-esmNavy transition-colors">
                    <span className="truncate">{TEAM.venmoHandle}</span>
                  </a>
                  {/* The name the account answers to, so the handle can be
                      checked against something a parent recognises. */}
                  <p className="text-xs text-gray-500 mt-2">
                    This is <strong className="text-esmInk">{TEAM.organization}</strong> — the name shown in Venmo when you scan.
                  </p>
                </div>
              </div>
            </div>

            {/* Submit */}
            <div className="p-4 sm:p-6 md:p-10 bg-white">
              <div className="flex flex-col md:flex-row items-center justify-between gap-4 sm:gap-8">
                <div className="text-center md:text-left">
                  <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Total Due</p>
                  <p id="totalPriceDisplay" className="text-4xl sm:text-5xl font-black text-esmNavy">$0.00</p>
                </div>
                <button type="submit" className="w-full md:w-auto bg-esmInk hover:bg-esmNavy text-white font-oswald tracking-widest py-4 sm:py-5 px-8 sm:px-12 rounded-xl text-lg sm:text-xl transition-all shadow-xl hover:shadow-2xl flex items-center justify-center gap-3 group">
                  REVIEW ORDER
                  <i data-lucide="arrow-right" className="w-6 h-6 group-hover:translate-x-1 transition-transform"></i>
                </button>
              </div>
            </div>
          </form>

          <p className="text-center text-gray-400 text-xs mt-8 pb-10 uppercase font-bold tracking-widest">&copy; 2026 Eastport-Tuttle PTO</p>
        </div>

        {/* Summary Modal */}
        <div id="summaryModal" className="fixed inset-0 z-[9999] hidden items-center justify-center bg-black/90 backdrop-blur-md p-4 opacity-0 transition-opacity duration-300">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden transform scale-90 transition-transform duration-300 flex flex-col max-h-[90vh]">
            <div className="bg-esmInk text-white p-6 border-b-4 border-esmSilver flex justify-between items-center">
              <h3 className="font-oswald text-2xl uppercase tracking-wider">Order Summary</h3>
              <button type="button" id="closeSummaryBtn" className="text-slate-400 hover:text-white transition-colors"><i data-lucide="x" className="w-6 h-6"></i></button>
            </div>
            <div className="p-6 overflow-y-auto">
              <div className="bg-slate-50 rounded-lg p-4 mb-6 border border-slate-200">
                <h4 className="text-xs font-bold text-gray-500 uppercase mb-3">Items Ordered</h4>
                <ul id="summaryItemsList" className="space-y-2 text-sm font-medium text-gray-800"></ul>
                <div className="mt-4 pt-4 border-t border-slate-200 flex justify-between items-center font-bold">
                  <span className="uppercase text-gray-600">Total:</span>
                  <span id="summaryTotal" className="text-xl text-esmNavy">$0.00</span>
                </div>
              </div>
              <div className="mb-6">
                <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">Customer Details</h4>
                <p className="text-sm"><span className="text-gray-500">Child:</span> <span id="sumAthlete" className="font-medium"></span></p>
                <p className="text-sm"><span className="text-gray-500">Parent/Buyer:</span> <span id="sumParent" className="font-medium"></span></p>
                <p className="text-sm"><span className="text-gray-500">Payment:</span> <span id="sumPayment" className="font-medium uppercase"></span></p>
                {/* The last screen before money changes hands is the last chance
                    to catch a wrong address, so it is shown in full here. */}
                <p className="text-sm"><span className="text-gray-500">Delivery:</span> <span id="sumDelivery" className="font-medium"></span></p>
              </div>
              <label className="flex items-start gap-3 p-4 bg-esmMist border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-200 transition-colors">
                <input type="checkbox" id="confirmCheckbox" className="mt-1 w-5 h-5 text-esmNavy rounded border-gray-300 focus:ring-esmNavy" />
                <span className="text-sm text-gray-800 font-medium">
                  I confirm that the order details above are correct, and I will submit my payment of <strong id="summaryConfirmTotal" className="text-esmNavy"></strong> via the selected method.
                </span>
              </label>
            </div>
            <div className="p-6 bg-slate-50 border-t border-slate-200">
              <button id="finalSubmitBtn" className="w-full bg-esmNavy hover:bg-esmInk text-white font-oswald text-xl tracking-widest py-4 rounded-lg transition-colors shadow-lg flex justify-center items-center gap-2">
                CONFIRM &amp; SUBMIT
              </button>
            </div>
          </div>
        </div>

        {/* Success Modal */}
        <div id="successModal" className="fixed inset-0 z-[9999] hidden items-center justify-center bg-black/90 backdrop-blur-md p-4 opacity-0 transition-opacity duration-300">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-8 text-center transform scale-90 transition-transform duration-300 border-t-8 border-esmNavy">
            <div className="mx-auto w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-6">
              <i data-lucide="check" className="w-10 h-10 stroke-[3px]"></i>
            </div>
            <h3 className="font-oswald text-4xl text-esmInk mb-2 uppercase">Order Received!</h3>
            <p id="successOrderRef" className="text-esmNavy font-bold text-lg tracking-widest mb-3"></p>
            <p className="text-gray-500 mb-8 font-medium">Thank you for supporting the ESM Sharks! A confirmation has been sent to your email.</p>
            <button id="closeSuccessBtn" className="w-full bg-esmNavy hover:bg-esmInk text-white font-bold py-4 rounded-lg transition-colors shadow-lg uppercase tracking-wider">Done</button>
          </div>
        </div>
      </div>

    </>
  )
}
