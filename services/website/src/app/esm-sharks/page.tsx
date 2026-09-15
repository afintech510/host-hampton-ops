'use client'

import { useEffect } from 'react'
import Script from 'next/script'
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
 * Product photography is PLACEHOLDER (`/images/esm-*.svg`, each one labelled
 * with what belongs there). Prices and costs match CM Cheer's by Adam's choice.
 */
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

    // --- Color toggles (navy / silver) ---
    function setupColorToggles() {
      document.querySelectorAll('.color-toggle').forEach((toggle) => {
        toggle.addEventListener('click', (e) => {
          const btn = e.target as HTMLElement
          const targetImgId = btn.getAttribute('data-target-img')
          const newSrc = btn.getAttribute('data-src')
          if (targetImgId && newSrc) { const img = document.getElementById(targetImgId) as HTMLImageElement; if (img) img.src = newSrc }
          const siblings = btn.parentElement?.querySelectorAll('.color-toggle')
          siblings?.forEach((sib) => {
            sib.classList.remove('border-esmNavy', 'bg-esmNavy', 'border-esmSilver', 'bg-esmSilver', 'text-white', 'text-esmInk')
            sib.classList.add('border-gray-200', 'bg-white', 'text-gray-500')
          })
          btn.classList.remove('border-gray-200', 'bg-white', 'text-gray-500')
          const isSilver = btn.getAttribute('data-color') === 'silver'
          // Silver is a light fill, so it takes dark ink; navy takes white.
          btn.classList.add(
            isSilver ? 'border-esmSilver' : 'border-esmNavy',
            isSilver ? 'bg-esmSilver' : 'bg-esmNavy',
            isSilver ? 'text-esmInk' : 'text-white',
          )
        })
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

    // --- Patch pricing (3 for $20, then $6.65 each) ---
    function calculatePatchPrice(qty: number): number {
      if (qty <= 0) return 0
      if (qty >= 3) return 20 + (qty - 3) * 6.65
      return qty * 8
    }

    // --- Total ---
    function calculateTotal(): number {
      let total = 0
      document.querySelectorAll('.qty-input').forEach((input) => {
        const el = input as HTMLInputElement
        const qty = parseInt(el.value) || 0
        total += el.id === 'qty-patch' ? calculatePatchPrice(qty) : qty * parseFloat(el.dataset.price || '0')
      })
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

        document.querySelectorAll('.qty-input').forEach((input) => {
          const el = input as HTMLInputElement
          const qty = parseInt(el.value)
          if (qty > 0) {
            hasItems = true
            const itemName = el.getAttribute('data-name') || ''
            const unitPrice = parseFloat(el.dataset.price || '0')
            const costPerUnit = parseFloat(el.dataset.cost || '0')
            const lineTotal = el.id === 'qty-patch' ? calculatePatchPrice(qty) : qty * unitPrice
            totalCost += qty * costPerUnit
            orderListHTML += `<li class="flex justify-between border-b border-gray-100 pb-1"><span>${qty}x ${itemName}</span><span class="text-gray-500">$${lineTotal.toFixed(2)}</span></li>`
            itemsArr.push(`${qty}x ${itemName}`)
            itemsData.push({ name: itemName, qty, unit_price: unitPrice, line_total: lineTotal, cost_per_unit: costPerUnit })
          }
        })

        if (!hasItems) { alertCustom('Please select at least one item.'); return }

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

        orderPayload = {
          // The team is what gives this order an ESM- number and keeps it out of
          // the CM Cheer order book. Do not drop it.
          team: 'esm-sharks',
          athleteName: val('athleteName'), parentName: val('parentName'),
          email: val('email'), phone: val('phone'), paymentMethod,
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
        calculateTotal()
        finalSubmitBtn.innerHTML = 'CONFIRM & SUBMIT'
        finalSubmitBtn.disabled = false
        document.querySelectorAll('.color-toggle').forEach((t) => { if (t.getAttribute('data-color') === 'navy') (t as HTMLElement).click() })
      })
    }

    setupQuantityButtons()
    setupColorToggles()
    setupPaymentRadios()
    setupFormSubmit()
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
        .color-toggle.bg-white:hover { border-color:#0C2340 !important; color:#0C2340 !important; }` }} />
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
                  <img src="/images/esm-sharks-logo.svg" alt="ESM Sharks Logo" className="w-full h-full object-contain" />
                </div>
              </div>
              <h1 className="font-oswald text-xl md:text-3xl tracking-[0.2em] text-esmSilver mb-2 uppercase">Eastport-South Manor</h1>
              <p className="font-varsity text-6xl md:text-9xl text-white tracking-wider mb-2 leading-none varsity-outline">SHARKS</p>
              <div className="w-24 h-1.5 bg-esmSilver mx-auto mb-6 rounded-full"></div>
              <p className="text-xs md:text-sm text-white font-bold tracking-[0.3em] uppercase px-4 bg-esmSilver/20 inline-block py-1 rounded-full">Official Team Fundraiser</p>
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
              <p className="text-sm text-gray-600 mb-8 ml-1">Navy and silver, every piece finished with the embroidered Sharks patch.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

                {/* Trucker Hat */}
                <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col h-full group">
                  <div className="flex gap-2 mb-3">
                    <button type="button" className="flex-1 py-1.5 border-2 border-esmNavy bg-esmNavy text-white text-xs font-bold uppercase rounded-md transition-colors color-toggle" data-target-img="img-hat" data-color="navy" data-src="/images/esm-hat-navy.svg">Navy</button>
                    <button type="button" className="flex-1 py-1.5 border-2 border-gray-200 bg-white text-gray-500 text-xs font-bold uppercase rounded-md transition-colors color-toggle" data-target-img="img-hat" data-color="silver" data-src="/images/esm-hat-silver.svg">Silver</button>
                  </div>
                  <div className="w-full aspect-square bg-slate-100 rounded-lg mb-4 overflow-hidden relative">
                    <img id="img-hat" src="/images/esm-hat-navy.svg" alt="ESM Sharks Trucker Hat" className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-500" />
                  </div>
                  <div className="flex-grow">
                    <h3 className="text-xl font-bold text-gray-900 font-oswald uppercase">Trucker Hat</h3>
                    <p className="text-esmNavy font-black text-2xl mt-1 mb-2">$25.00</p>
                    <p className="text-sm text-gray-600 mb-4 leading-relaxed">Classic mesh-back snapback with the Sharks patch stitched on the front panel.</p>
                  </div>
                  <div className="mt-auto pt-4 border-t border-gray-100 space-y-3">
                    <div className="flex items-center justify-between bg-slate-50 p-2 rounded-lg border border-slate-100">
                      <span className="text-xs font-bold text-esmNavy uppercase tracking-wider">Navy Qty</span>
                      <div className="flex items-center border-2 border-slate-200 rounded-lg bg-white overflow-hidden">
                        <button type="button" className="px-3 py-1 bg-slate-50 hover:bg-slate-100 text-slate-600 decrement-btn" data-target="qty-hat-navy">&minus;</button>
                        <input type="number" id="qty-hat-navy" data-name="Navy Trucker Hat" className="qty-input w-10 text-center font-bold text-esmNavy outline-none py-1 text-sm" data-price="25" data-cost="20" min="0" defaultValue="0" />
                        <button type="button" className="px-3 py-1 bg-esmNavy text-white font-bold hover:bg-esmInk transition-colors increment-btn" data-target="qty-hat-navy">+</button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between bg-esmMist/60 p-2 rounded-lg border border-slate-200">
                      <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Silver Qty</span>
                      <div className="flex items-center border-2 border-slate-300 rounded-lg bg-white overflow-hidden">
                        <button type="button" className="px-3 py-1 bg-slate-50 hover:bg-slate-100 text-slate-600 decrement-btn" data-target="qty-hat-silver">&minus;</button>
                        <input type="number" id="qty-hat-silver" data-name="Silver Trucker Hat" className="qty-input w-10 text-center font-bold text-slate-700 outline-none py-1 text-sm" data-price="25" data-cost="20" min="0" defaultValue="0" />
                        <button type="button" className="px-3 py-1 bg-esmSilver text-esmInk font-bold hover:bg-slate-400 transition-colors increment-btn" data-target="qty-hat-silver">+</button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Canvas Tote */}
                <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col h-full group">
                  <div className="flex gap-2 mb-3">
                    <button type="button" className="flex-1 py-1.5 border-2 border-esmNavy bg-esmNavy text-white text-xs font-bold uppercase rounded-md transition-colors color-toggle" data-target-img="img-tote" data-color="navy" data-src="/images/esm-tote-navy.svg">Navy</button>
                    <button type="button" className="flex-1 py-1.5 border-2 border-gray-200 bg-white text-gray-500 text-xs font-bold uppercase rounded-md transition-colors color-toggle" data-target-img="img-tote" data-color="silver" data-src="/images/esm-tote-silver.svg">Silver</button>
                  </div>
                  <div className="w-full aspect-square bg-slate-100 rounded-lg mb-4 overflow-hidden relative">
                    <img id="img-tote" src="/images/esm-tote-navy.svg" alt="ESM Sharks Canvas Tote" className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-500" />
                  </div>
                  <div className="flex-grow">
                    <h3 className="text-xl font-bold text-gray-900 font-oswald uppercase">Canvas Tote</h3>
                    <p className="text-esmNavy font-black text-2xl mt-1 mb-2">$40.00</p>
                    <p className="text-sm text-gray-600 mb-4 leading-relaxed">Heavy-duty canvas tote with the Sharks patch on the front. Big enough for a game day.</p>
                  </div>
                  <div className="mt-auto pt-4 border-t border-gray-100 space-y-3">
                    <div className="flex items-center justify-between bg-slate-50 p-2 rounded-lg border border-slate-100">
                      <span className="text-xs font-bold text-esmNavy uppercase tracking-wider">Navy Qty</span>
                      <div className="flex items-center border-2 border-slate-200 rounded-lg bg-white overflow-hidden">
                        <button type="button" className="px-3 py-1 bg-slate-50 hover:bg-slate-100 text-slate-600 decrement-btn" data-target="qty-tote-navy">&minus;</button>
                        <input type="number" id="qty-tote-navy" data-name="Navy Canvas Tote" className="qty-input w-10 text-center font-bold text-esmNavy outline-none py-1 text-sm" data-price="40" data-cost="30" min="0" defaultValue="0" />
                        <button type="button" className="px-3 py-1 bg-esmNavy text-white font-bold hover:bg-esmInk transition-colors increment-btn" data-target="qty-tote-navy">+</button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between bg-esmMist/60 p-2 rounded-lg border border-slate-200">
                      <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Silver Qty</span>
                      <div className="flex items-center border-2 border-slate-300 rounded-lg bg-white overflow-hidden">
                        <button type="button" className="px-3 py-1 bg-slate-50 hover:bg-slate-100 text-slate-600 decrement-btn" data-target="qty-tote-silver">&minus;</button>
                        <input type="number" id="qty-tote-silver" data-name="Silver Canvas Tote" className="qty-input w-10 text-center font-bold text-slate-700 outline-none py-1 text-sm" data-price="40" data-cost="30" min="0" defaultValue="0" />
                        <button type="button" className="px-3 py-1 bg-esmSilver text-esmInk font-bold hover:bg-slate-400 transition-colors increment-btn" data-target="qty-tote-silver">+</button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Zip Pouch */}
                <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col h-full group">
                  <div className="flex gap-2 mb-3">
                    <button type="button" className="flex-1 py-1.5 border-2 border-esmNavy bg-esmNavy text-white text-xs font-bold uppercase rounded-md transition-colors color-toggle" data-target-img="img-pouch" data-color="navy" data-src="/images/esm-pouch-navy.svg">Navy</button>
                    <button type="button" className="flex-1 py-1.5 border-2 border-gray-200 bg-white text-gray-500 text-xs font-bold uppercase rounded-md transition-colors color-toggle" data-target-img="img-pouch" data-color="silver" data-src="/images/esm-pouch-silver.svg">Silver</button>
                  </div>
                  <div className="w-full aspect-square bg-slate-100 rounded-lg mb-4 overflow-hidden relative">
                    <img id="img-pouch" src="/images/esm-pouch-navy.svg" alt="ESM Sharks Zip Pouch" className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-500" />
                  </div>
                  <div className="flex-grow">
                    <h3 className="text-xl font-bold text-gray-900 font-oswald uppercase">Zip Pouch</h3>
                    <p className="text-esmNavy font-black text-2xl mt-1 mb-2">$25.00</p>
                    <p className="text-sm text-gray-600 mb-4 leading-relaxed">Zippered canvas pouch with the Sharks patch. Mouthguards, tape, pencils, whatever.</p>
                  </div>
                  <div className="mt-auto pt-4 border-t border-gray-100 space-y-3">
                    <div className="flex items-center justify-between bg-slate-50 p-2 rounded-lg border border-slate-100">
                      <span className="text-xs font-bold text-esmNavy uppercase tracking-wider">Navy Qty</span>
                      <div className="flex items-center border-2 border-slate-200 rounded-lg bg-white overflow-hidden">
                        <button type="button" className="px-3 py-1 bg-slate-50 hover:bg-slate-100 text-slate-600 decrement-btn" data-target="qty-pouch-navy">&minus;</button>
                        <input type="number" id="qty-pouch-navy" data-name="Navy Zip Pouch" className="qty-input w-10 text-center font-bold text-esmNavy outline-none py-1 text-sm" data-price="25" data-cost="20" min="0" defaultValue="0" />
                        <button type="button" className="px-3 py-1 bg-esmNavy text-white font-bold hover:bg-esmInk transition-colors increment-btn" data-target="qty-pouch-navy">+</button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between bg-esmMist/60 p-2 rounded-lg border border-slate-200">
                      <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Silver Qty</span>
                      <div className="flex items-center border-2 border-slate-300 rounded-lg bg-white overflow-hidden">
                        <button type="button" className="px-3 py-1 bg-slate-50 hover:bg-slate-100 text-slate-600 decrement-btn" data-target="qty-pouch-silver">&minus;</button>
                        <input type="number" id="qty-pouch-silver" data-name="Silver Zip Pouch" className="qty-input w-10 text-center font-bold text-slate-700 outline-none py-1 text-sm" data-price="25" data-cost="20" min="0" defaultValue="0" />
                        <button type="button" className="px-3 py-1 bg-esmSilver text-esmInk font-bold hover:bg-slate-400 transition-colors increment-btn" data-target="qty-pouch-silver">+</button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sharks Patch */}
                <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col h-full group">
                  <div className="h-[34px] mb-3"></div>
                  <div className="w-full aspect-square bg-slate-100 rounded-lg mb-4 overflow-hidden relative p-8">
                    <img src="/images/esm-sharks-patch.svg" alt="ESM Sharks Patch" className="w-full h-full object-contain transform group-hover:scale-105 transition-transform duration-500" />
                  </div>
                  <div className="flex-grow">
                    <h3 className="text-xl font-bold text-gray-900 font-oswald uppercase">Sharks Patch</h3>
                    <p className="text-esmNavy font-black text-2xl mt-1 mb-2">$8.00 <span className="text-sm font-bold text-gray-500 tracking-normal normal-case">(3 for $20)</span></p>
                    <p className="text-sm text-gray-600 mb-4 leading-relaxed">The embroidered Sharks patch on its own. Iron it onto a jacket, a bag, anything.</p>
                  </div>
                  <div className="mt-auto pt-4 border-t border-gray-100 space-y-3">
                    <div className="flex items-center justify-between bg-slate-50 p-2 rounded-lg border border-slate-100">
                      <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Quantity</span>
                      <div className="flex items-center border-2 border-slate-200 rounded-lg bg-white overflow-hidden">
                        <button type="button" className="px-3 py-1 bg-slate-50 hover:bg-slate-100 text-slate-600 decrement-btn" data-target="qty-patch">&minus;</button>
                        <input type="number" id="qty-patch" data-name="Sharks Patch" className="qty-input w-10 text-center font-bold text-esmNavy outline-none py-1 text-sm" data-price="8" data-cost="5" min="0" defaultValue="0" />
                        <button type="button" className="px-3 py-1 bg-esmNavy text-white font-bold hover:bg-esmInk transition-colors increment-btn" data-target="qty-patch">+</button>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            </div>

            {/* Customer Details */}
            <div className="p-6 md:p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-esmNavy/10 rounded-lg text-esmNavy"><i data-lucide="user" className="w-6 h-6"></i></div>
                <h2 className="text-xl sm:text-3xl font-bold text-esmInk font-oswald uppercase tracking-wide">Athlete / Parent Info</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Athlete Name</label>
                  <input type="text" id="athleteName" required placeholder="Athlete's Name" className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-esmNavy focus:ring-0 outline-none transition-all bg-slate-50" />
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
                  No QR code here yet, ON PURPOSE. The CM Cheer page embeds a QR
                  that encodes THAT booster club's Venmo. A QR is unreadable to a
                  human, so a copied or invented one is a payment silently routed
                  to the wrong account with nothing on screen to give it away.
                  When Adam supplies the Sharks' Venmo, generate the QR from that
                  handle and drop it in here.
                */}
                <div className="w-32 h-32 flex-shrink-0 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 flex flex-col items-center justify-center text-center p-2">
                  <i data-lucide="qr-code" className="w-8 h-8 text-slate-400"></i>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-2 leading-tight">QR code<br />coming soon</span>
                </div>
                <div className="text-center md:text-left">
                  <p className="text-esmInk font-oswald text-xl uppercase mb-1">Send Your Venmo Payment</p>
                  <p className="text-gray-500 text-sm mb-4">Please include the <strong className="text-esmNavy">athlete&apos;s name</strong> in the payment description/memo.</p>
                  <a href="https://www.venmo.com/u/hostHampton" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-3 sm:px-5 py-2 bg-esmInk text-white rounded-full font-mono text-xs sm:text-sm font-bold border border-slate-700 max-w-full hover:bg-esmNavy transition-colors">
                    <span className="truncate">@hostHampton</span>
                  </a>
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
                <p className="text-sm"><span className="text-gray-500">Athlete:</span> <span id="sumAthlete" className="font-medium"></span></p>
                <p className="text-sm"><span className="text-gray-500">Parent/Buyer:</span> <span id="sumParent" className="font-medium"></span></p>
                <p className="text-sm"><span className="text-gray-500">Payment:</span> <span id="sumPayment" className="font-medium uppercase"></span></p>
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
