'use client'

import { useEffect } from 'react'
import Script from 'next/script'
import Footer from '@/components/Footer'

export default function CMCheerPage() {
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
          if (input) { let val = parseInt(input.value) || 0; if (val > 0) { input.value = String(val - 1); calculateTotal() } }
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

    // --- Color toggles ---
    function setupColorToggles() {
      document.querySelectorAll('.color-toggle').forEach((toggle) => {
        toggle.addEventListener('click', (e) => {
          const btn = e.target as HTMLElement
          const targetImgId = btn.getAttribute('data-target-img')
          const newSrc = btn.getAttribute('data-src')
          if (targetImgId && newSrc) { const img = document.getElementById(targetImgId) as HTMLImageElement; if (img) img.src = newSrc }
          const siblings = btn.parentElement?.querySelectorAll('.color-toggle')
          siblings?.forEach((sib) => { sib.classList.remove('border-cmBlack','bg-cmBlack','text-white'); sib.classList.add('border-gray-200','bg-white','text-gray-500') })
          btn.classList.remove('border-gray-200','bg-white','text-gray-500')
          btn.classList.add('border-cmBlack','bg-cmBlack','text-white')
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

    // --- Patch pricing ---
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
      toast.className = 'fixed bottom-10 left-1/2 -translate-x-1/2 bg-cmRed text-white px-8 py-4 rounded-full shadow-2xl z-[9999] font-bold text-sm uppercase tracking-widest'
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
        document.querySelectorAll('.color-toggle').forEach((t) => { if (t.getAttribute('data-color') === 'black') (t as HTMLElement).click() })
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
      <Script src="https://cdn.tailwindcss.com" strategy="beforeInteractive" />
      <Script src="https://unpkg.com/lucide@latest" strategy="afterInteractive" onLoad={() => { if ((window as any).lucide) (window as any).lucide.createIcons() }} />
      <Script id="tw-config" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: `
        if (typeof tailwind !== 'undefined') {
          tailwind.config = { theme: { extend: { colors: { cmBlack: '#111111', cmRed: '#CE1126', cmGray: '#f4f4f5' }, fontFamily: { varsity: ['"Bebas Neue"','sans-serif'], oswald: ['"Oswald"','sans-serif'], sans: ['Inter','sans-serif'] } } } }
        }` }} />
      <style dangerouslySetInnerHTML={{ __html: `
        #cm-cheer-root input[type="number"]::-webkit-inner-spin-button,
        #cm-cheer-root input[type="number"]::-webkit-outer-spin-button { -webkit-appearance:none;margin:0 }
        #cm-cheer-root input[type="number"] { -moz-appearance:textfield }
        .varsity-outline { -webkit-text-stroke:1px white;text-shadow:2px 2px 0px rgba(0,0,0,0.5) }
        .loader { border:3px solid #f3f3f3;border-top:3px solid #CE1126;border-radius:50%;width:20px;height:20px;animation:spin 1s linear infinite;display:inline-block }
        @keyframes spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }` }} />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;700&family=Bebas+Neue&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />

      <div id="cm-cheer-root" className="w-full flex justify-center bg-zinc-100 py-4 sm:py-8 font-sans antialiased text-gray-900">
        <div className="w-full max-w-4xl mx-auto px-2 sm:px-4">

          {/* Header */}
          <header className="bg-cmBlack text-white shadow-xl relative overflow-hidden rounded-t-2xl border-t-4 border-cmRed">
            <div className="absolute top-0 right-0 w-64 h-full bg-cmRed transform skew-x-[-20deg] opacity-20 translate-x-12"></div>
            <div className="max-w-4xl mx-auto px-4 py-10 md:py-16 text-center relative z-10">
              <div className="mb-6 relative inline-block group hover:scale-105 transition-transform duration-300">
                <div className="absolute inset-0 bg-cmRed rounded-full blur-xl opacity-40 group-hover:opacity-60 transition-opacity"></div>
                <div className="relative mx-auto w-32 h-32 md:w-48 md:h-48 bg-white rounded-full border-4 border-cmRed shadow-2xl overflow-hidden flex items-center justify-center">
                  <img src="https://images.squarespace-cdn.com/content/66b583cc5e40c13a4c5600b6/beace53a-cee5-46ab-88dd-8db7abc9d773/logo_CM-cheer.png" alt="CM Cheer Logo" className="w-full h-full object-contain p-1" />
                </div>
              </div>
              <h1 className="font-oswald text-xl md:text-3xl tracking-[0.2em] text-gray-300 mb-2 uppercase">Center Moriches</h1>
              <p className="font-varsity text-6xl md:text-9xl text-cmRed tracking-wider mb-2 leading-none varsity-outline">CHEER</p>
              <div className="w-24 h-1.5 bg-cmRed mx-auto mb-6 rounded-full"></div>
              <p className="text-xs md:text-sm text-white font-bold tracking-[0.3em] uppercase px-4 bg-cmRed/20 inline-block py-1 rounded-full">Official Team Fundraiser</p>
            </div>
          </header>

          {/* Form */}
          <form id="orderForm" className="bg-white rounded-b-2xl shadow-2xl overflow-hidden border-x border-b border-gray-200">

            {/* Products */}
            <div className="p-4 md:p-8 border-b border-gray-100 bg-gray-50/50">
              <div className="flex items-center gap-3 mb-8">
                <div className="p-2 bg-cmRed/10 rounded-lg text-cmRed"><i data-lucide="shopping-bag" className="w-6 h-6"></i></div>
                <h2 className="text-3xl font-bold text-cmBlack font-oswald uppercase tracking-wide">Team Gear</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

                {/* Trucker Hat */}
                <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col h-full group">
                  <div className="flex gap-2 mb-3">
                    <button type="button" className="flex-1 py-1.5 border-2 border-cmBlack bg-cmBlack text-white text-xs font-bold uppercase rounded-md transition-colors color-toggle" data-target-img="img-hat" data-color="black" data-src="https://images.squarespace-cdn.com/content/66b583cc5e40c13a4c5600b6/9abbad29-aac7-4470-bcef-5a6474a455c9/cm-hat-black.png">Black</button>
                    <button type="button" className="flex-1 py-1.5 border-2 border-gray-200 bg-white text-gray-500 hover:border-cmRed hover:text-cmRed text-xs font-bold uppercase rounded-md transition-colors color-toggle" data-target-img="img-hat" data-color="red" data-src="https://images.squarespace-cdn.com/content/66b583cc5e40c13a4c5600b6/5ab83078-472a-4cae-8cae-0abc9ff77a06/cm-hat-red.png">Red</button>
                  </div>
                  <div className="w-full aspect-square bg-gray-100 rounded-lg mb-4 overflow-hidden relative">
                    <img id="img-hat" src="https://images.squarespace-cdn.com/content/66b583cc5e40c13a4c5600b6/9abbad29-aac7-4470-bcef-5a6474a455c9/cm-hat-black.png" alt="CM Cheer Trucker Hat" className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-500" />
                  </div>
                  <div className="flex-grow">
                    <h3 className="text-xl font-bold text-gray-900 font-oswald uppercase">Trucker Hat</h3>
                    <p className="text-cmRed font-black text-2xl mt-1 mb-2">$25.00</p>
                    <p className="text-sm text-gray-600 mb-4 leading-relaxed">Classic mesh back snapback featuring the CM Cheer devil logo.</p>
                  </div>
                  <div className="mt-auto pt-4 border-t border-gray-100 space-y-3">
                    <div className="flex items-center justify-between bg-gray-50 p-2 rounded-lg border border-gray-100">
                      <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">Black Qty</span>
                      <div className="flex items-center border-2 border-gray-200 rounded-lg bg-white overflow-hidden">
                        <button type="button" className="px-3 py-1 bg-gray-50 hover:bg-gray-100 text-gray-600 decrement-btn" data-target="qty-hat-black">&minus;</button>
                        <input type="number" id="qty-hat-black" data-name="Black Trucker Hat" className="qty-input w-10 text-center font-bold text-cmBlack outline-none py-1 text-sm" data-price="25" data-cost="20" min="0" defaultValue="0" />
                        <button type="button" className="px-3 py-1 bg-gray-200 hover:bg-gray-300 font-bold transition-colors increment-btn" data-target="qty-hat-black">+</button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between bg-red-50 p-2 rounded-lg border border-red-100">
                      <span className="text-xs font-bold text-cmRed uppercase tracking-wider">Red Qty</span>
                      <div className="flex items-center border-2 border-red-200 rounded-lg bg-white overflow-hidden">
                        <button type="button" className="px-3 py-1 bg-red-50 hover:bg-red-100 text-red-600 decrement-btn" data-target="qty-hat-red">&minus;</button>
                        <input type="number" id="qty-hat-red" data-name="Red Trucker Hat" className="qty-input w-10 text-center font-bold text-cmRed outline-none py-1 text-sm" data-price="25" data-cost="20" min="0" defaultValue="0" />
                        <button type="button" className="px-3 py-1 bg-cmRed text-white font-bold hover:bg-red-700 transition-colors increment-btn" data-target="qty-hat-red">+</button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Canvas Tote */}
                <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col h-full group">
                  <div className="flex gap-2 mb-3">
                    <button type="button" className="flex-1 py-1.5 border-2 border-cmBlack bg-cmBlack text-white text-xs font-bold uppercase rounded-md transition-colors color-toggle" data-target-img="img-tote" data-color="black" data-src="https://images.squarespace-cdn.com/content/66b583cc5e40c13a4c5600b6/bdb0b0d7-6b56-4704-b26d-0a414903e419/cm-tote-black.png">Black</button>
                    <button type="button" className="flex-1 py-1.5 border-2 border-gray-200 bg-white text-gray-500 hover:border-cmRed hover:text-cmRed text-xs font-bold uppercase rounded-md transition-colors color-toggle" data-target-img="img-tote" data-color="red" data-src="https://images.squarespace-cdn.com/content/66b583cc5e40c13a4c5600b6/f4d2ef08-6d54-4207-aeb4-30dd5cd628d6/cm-tote-red.png">Red</button>
                  </div>
                  <div className="w-full aspect-square bg-gray-100 rounded-lg mb-4 overflow-hidden relative">
                    <img id="img-tote" src="https://images.squarespace-cdn.com/content/66b583cc5e40c13a4c5600b6/bdb0b0d7-6b56-4704-b26d-0a414903e419/cm-tote-black.png" alt="CM Cheer Canvas Tote" className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-500" />
                  </div>
                  <div className="flex-grow">
                    <h3 className="text-xl font-bold text-gray-900 font-oswald uppercase">Canvas Tote</h3>
                    <p className="text-cmRed font-black text-2xl mt-1 mb-2">$40.00</p>
                    <p className="text-sm text-gray-600 mb-4 leading-relaxed">Heavy-duty canvas tote with official cheer embroidery.</p>
                  </div>
                  <div className="mt-auto pt-4 border-t border-gray-100 space-y-3">
                    <div className="flex items-center justify-between bg-gray-50 p-2 rounded-lg border border-gray-100">
                      <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">Black Qty</span>
                      <div className="flex items-center border-2 border-gray-200 rounded-lg bg-white overflow-hidden">
                        <button type="button" className="px-3 py-1 bg-gray-50 hover:bg-gray-100 text-gray-600 decrement-btn" data-target="qty-tote-black">&minus;</button>
                        <input type="number" id="qty-tote-black" data-name="Black Canvas Tote" className="qty-input w-10 text-center font-bold text-cmBlack outline-none py-1 text-sm" data-price="40" data-cost="30" min="0" defaultValue="0" />
                        <button type="button" className="px-3 py-1 bg-gray-200 hover:bg-gray-300 font-bold transition-colors increment-btn" data-target="qty-tote-black">+</button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between bg-red-50 p-2 rounded-lg border border-red-100">
                      <span className="text-xs font-bold text-cmRed uppercase tracking-wider">Red Qty</span>
                      <div className="flex items-center border-2 border-red-200 rounded-lg bg-white overflow-hidden">
                        <button type="button" className="px-3 py-1 bg-red-50 hover:bg-red-100 text-red-600 decrement-btn" data-target="qty-tote-red">&minus;</button>
                        <input type="number" id="qty-tote-red" data-name="Red Canvas Tote" className="qty-input w-10 text-center font-bold text-cmRed outline-none py-1 text-sm" data-price="40" data-cost="30" min="0" defaultValue="0" />
                        <button type="button" className="px-3 py-1 bg-cmRed text-white font-bold hover:bg-red-700 transition-colors increment-btn" data-target="qty-tote-red">+</button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Accessory Pouch */}
                <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col h-full group">
                  <div className="flex gap-2 mb-3">
                    <button type="button" className="flex-1 py-1.5 border-2 border-cmBlack bg-cmBlack text-white text-xs font-bold uppercase rounded-md transition-colors color-toggle" data-target-img="img-pouch" data-color="black" data-src="https://images.squarespace-cdn.com/content/66b583cc5e40c13a4c5600b6/30250ed3-ab27-4d3c-8496-0c36119d3dcd/cm-pouch-black.png">Black</button>
                    <button type="button" className="flex-1 py-1.5 border-2 border-gray-200 bg-white text-gray-500 hover:border-cmRed hover:text-cmRed text-xs font-bold uppercase rounded-md transition-colors color-toggle" data-target-img="img-pouch" data-color="red" data-src="https://images.squarespace-cdn.com/content/66b583cc5e40c13a4c5600b6/d51aa39c-df6f-43e0-9ef4-082e67cc566e/cm-pouch-red.png">Red</button>
                  </div>
                  <div className="w-full aspect-square bg-gray-100 rounded-lg mb-4 overflow-hidden relative">
                    <img id="img-pouch" src="https://images.squarespace-cdn.com/content/66b583cc5e40c13a4c5600b6/30250ed3-ab27-4d3c-8496-0c36119d3dcd/cm-pouch-black.png" alt="CM Cheer Canvas Pouch" className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-500" />
                  </div>
                  <div className="flex-grow">
                    <h3 className="text-xl font-bold text-gray-900 font-oswald uppercase">Accessory Pouch</h3>
                    <p className="text-cmRed font-black text-2xl mt-1 mb-2">$25.00</p>
                    <p className="text-sm text-gray-600 mb-4 leading-relaxed">Zippered pouch. Perfect for bows and makeup.</p>
                  </div>
                  <div className="mt-auto pt-4 border-t border-gray-100 space-y-3">
                    <div className="flex items-center justify-between bg-gray-50 p-2 rounded-lg border border-gray-100">
                      <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">Black Qty</span>
                      <div className="flex items-center border-2 border-gray-200 rounded-lg bg-white overflow-hidden">
                        <button type="button" className="px-3 py-1 bg-gray-50 hover:bg-gray-100 text-gray-600 decrement-btn" data-target="qty-pouch-black">&minus;</button>
                        <input type="number" id="qty-pouch-black" data-name="Black Canvas Pouch" className="qty-input w-10 text-center font-bold text-cmBlack outline-none py-1 text-sm" data-price="25" data-cost="20" min="0" defaultValue="0" />
                        <button type="button" className="px-3 py-1 bg-gray-200 hover:bg-gray-300 font-bold transition-colors increment-btn" data-target="qty-pouch-black">+</button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between bg-red-50 p-2 rounded-lg border border-red-100">
                      <span className="text-xs font-bold text-cmRed uppercase tracking-wider">Red Qty</span>
                      <div className="flex items-center border-2 border-red-200 rounded-lg bg-white overflow-hidden">
                        <button type="button" className="px-3 py-1 bg-red-50 hover:bg-red-100 text-red-600 decrement-btn" data-target="qty-pouch-red">&minus;</button>
                        <input type="number" id="qty-pouch-red" data-name="Red Canvas Pouch" className="qty-input w-10 text-center font-bold text-cmRed outline-none py-1 text-sm" data-price="25" data-cost="20" min="0" defaultValue="0" />
                        <button type="button" className="px-3 py-1 bg-cmRed text-white font-bold hover:bg-red-700 transition-colors increment-btn" data-target="qty-pouch-red">+</button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Team Patch */}
                <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col h-full group">
                  <div className="h-[34px] mb-3"></div>
                  <div className="w-full aspect-square bg-gray-100 rounded-lg mb-4 overflow-hidden relative p-8">
                    <img src="https://images.squarespace-cdn.com/content/66b583cc5e40c13a4c5600b6/80d55d7b-9151-47b7-aff9-e17d4203bb7b/CM-cheer-patch_sample.png" alt="CM Cheer Patch" className="w-full h-full object-contain transform group-hover:scale-105 transition-transform duration-500" />
                  </div>
                  <div className="flex-grow">
                    <h3 className="text-xl font-bold text-gray-900 font-oswald uppercase">Team Patch</h3>
                    <p className="text-cmRed font-black text-2xl mt-1 mb-2">$8.00 <span className="text-sm font-bold text-gray-500 tracking-normal normal-case">(3 for $20)</span></p>
                    <p className="text-sm text-gray-600 mb-4 leading-relaxed">Official CM Cheer embroidered patch. Perfect for jackets or bags.</p>
                  </div>
                  <div className="mt-auto pt-4 border-t border-gray-100 space-y-3">
                    <div className="flex items-center justify-between bg-gray-50 p-2 rounded-lg border border-gray-100">
                      <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">Quantity</span>
                      <div className="flex items-center border-2 border-gray-200 rounded-lg bg-white overflow-hidden">
                        <button type="button" className="px-3 py-1 bg-gray-50 hover:bg-gray-100 text-gray-600 decrement-btn" data-target="qty-patch">&minus;</button>
                        <input type="number" id="qty-patch" data-name="Team Patch" className="qty-input w-10 text-center font-bold text-cmBlack outline-none py-1 text-sm" data-price="8" data-cost="5" min="0" defaultValue="0" />
                        <button type="button" className="px-3 py-1 bg-gray-200 hover:bg-gray-300 font-bold transition-colors increment-btn" data-target="qty-patch">+</button>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            </div>

            {/* Customer Details */}
            <div className="p-6 md:p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-cmRed/10 rounded-lg text-cmRed"><i data-lucide="user" className="w-6 h-6"></i></div>
                <h2 className="text-3xl font-bold text-cmBlack font-oswald uppercase tracking-wide">Athlete / Parent Info</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Athlete Name</label>
                  <input type="text" id="athleteName" required placeholder="Cheerleader's Name" className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-cmRed focus:ring-0 outline-none transition-all bg-gray-50" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Parent/Buyer Full Name</label>
                  <input type="text" id="parentName" required placeholder="Jane Doe" className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-cmRed focus:ring-0 outline-none transition-all bg-gray-50" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Email</label>
                  <input type="email" id="email" required placeholder="jane@example.com" className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-cmRed focus:ring-0 outline-none transition-all bg-gray-50" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Phone</label>
                  <input type="tel" id="phone" required placeholder="(555) 123-4567" className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-cmRed focus:ring-0 outline-none transition-all bg-gray-50" />
                </div>
              </div>
            </div>

            {/* Payment */}
            <div className="p-6 md:p-8 bg-gray-50 border-y border-gray-200">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-cmRed/10 rounded-lg text-cmRed"><i data-lucide="credit-card" className="w-6 h-6"></i></div>
                <h2 className="text-3xl font-bold text-cmBlack font-oswald uppercase tracking-wide">Payment Method</h2>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-6">
                <label className="cursor-pointer group">
                  <input type="radio" name="paymentMethod" value="venmo" className="peer sr-only" required />
                  <div className="py-4 px-2 border-2 border-gray-200 bg-white rounded-xl text-center peer-checked:border-cmRed peer-checked:text-cmRed peer-checked:bg-red-50 transition-all text-sm font-bold text-gray-600 uppercase group-hover:border-gray-300">Venmo</div>
                </label>
                <label className="cursor-pointer group">
                  <input type="radio" name="paymentMethod" value="cash" className="peer sr-only" />
                  <div className="py-4 px-2 border-2 border-gray-200 bg-white rounded-xl text-center peer-checked:border-cmRed peer-checked:text-cmRed peer-checked:bg-red-50 transition-all text-sm font-bold text-gray-600 uppercase group-hover:border-gray-300">Cash (To Coach)</div>
                </label>
              </div>
              <div id="digitalPaymentInfo" className="hidden bg-white border border-gray-200 rounded-xl p-6 shadow-sm mb-2 flex flex-col md:flex-row items-center gap-6">
                <div className="p-2 bg-white rounded-xl border border-gray-100 shadow-sm flex-shrink-0">
                  <img src="https://images.squarespace-cdn.com/content/66b583cc5e40c13a4c5600b6/b4432485-82d3-4dae-8420-f8563d93a755/qrcode-cm-cheer-venmo_red.png" alt="Venmo QR Code" className="w-32 h-32 object-contain" />
                </div>
                <div className="text-center md:text-left">
                  <p className="text-cmBlack font-oswald text-xl uppercase mb-1">Scan to Complete Payment</p>
                  <p className="text-gray-500 text-sm mb-4">Please include the <strong className="text-cmRed">athlete&apos;s name</strong> in the payment description/memo.</p>
                  <div className="inline-flex items-center gap-2 px-5 py-2 bg-black text-white rounded-full font-mono text-sm font-bold border border-gray-800">
                    <span>@CM-PAL-Red-Devils-Football</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Submit */}
            <div className="p-6 md:p-10 bg-white">
              <div className="flex flex-col md:flex-row items-center justify-between gap-8">
                <div className="text-center md:text-left">
                  <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Total Due</p>
                  <p id="totalPriceDisplay" className="text-5xl font-black text-cmRed">$0.00</p>
                </div>
                <button type="submit" className="w-full md:w-auto bg-cmBlack hover:bg-cmRed text-white font-oswald tracking-widest py-5 px-12 rounded-xl text-xl transition-all shadow-xl hover:shadow-2xl flex items-center justify-center gap-3 group">
                  REVIEW ORDER
                  <i data-lucide="arrow-right" className="w-6 h-6 group-hover:translate-x-1 transition-transform"></i>
                </button>
              </div>
            </div>
          </form>

          <p className="text-center text-gray-400 text-xs mt-8 pb-10 uppercase font-bold tracking-widest">&copy; 2026 Center Moriches Cheerleading Boosters</p>
        </div>

        {/* Summary Modal */}
        <div id="summaryModal" className="fixed inset-0 z-[9999] hidden items-center justify-center bg-black/90 backdrop-blur-md p-4 opacity-0 transition-opacity duration-300">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden transform scale-90 transition-transform duration-300 flex flex-col max-h-[90vh]">
            <div className="bg-cmBlack text-white p-6 border-b-4 border-cmRed flex justify-between items-center">
              <h3 className="font-oswald text-2xl uppercase tracking-wider">Order Summary</h3>
              <button type="button" id="closeSummaryBtn" className="text-gray-400 hover:text-white transition-colors"><i data-lucide="x" className="w-6 h-6"></i></button>
            </div>
            <div className="p-6 overflow-y-auto">
              <div className="bg-gray-50 rounded-lg p-4 mb-6 border border-gray-200">
                <h4 className="text-xs font-bold text-gray-500 uppercase mb-3">Items Ordered</h4>
                <ul id="summaryItemsList" className="space-y-2 text-sm font-medium text-gray-800"></ul>
                <div className="mt-4 pt-4 border-t border-gray-200 flex justify-between items-center font-bold">
                  <span className="uppercase text-gray-600">Total:</span>
                  <span id="summaryTotal" className="text-xl text-cmRed">$0.00</span>
                </div>
              </div>
              <div className="mb-6">
                <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">Customer Details</h4>
                <p className="text-sm"><span className="text-gray-500">Athlete:</span> <span id="sumAthlete" className="font-medium"></span></p>
                <p className="text-sm"><span className="text-gray-500">Parent/Buyer:</span> <span id="sumParent" className="font-medium"></span></p>
                <p className="text-sm"><span className="text-gray-500">Payment:</span> <span id="sumPayment" className="font-medium uppercase"></span></p>
              </div>
              <label className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg cursor-pointer hover:bg-red-100 transition-colors">
                <input type="checkbox" id="confirmCheckbox" className="mt-1 w-5 h-5 text-cmRed rounded border-gray-300 focus:ring-cmRed" />
                <span className="text-sm text-gray-800 font-medium">
                  I confirm that the order details above are correct, and I will submit my payment of <strong id="summaryConfirmTotal" className="text-cmRed"></strong> via the selected method.
                </span>
              </label>
            </div>
            <div className="p-6 bg-gray-50 border-t border-gray-200">
              <button id="finalSubmitBtn" className="w-full bg-cmRed hover:bg-red-700 text-white font-oswald text-xl tracking-widest py-4 rounded-lg transition-colors shadow-lg flex justify-center items-center gap-2">
                CONFIRM &amp; SUBMIT
              </button>
            </div>
          </div>
        </div>

        {/* Success Modal */}
        <div id="successModal" className="fixed inset-0 z-[9999] hidden items-center justify-center bg-black/90 backdrop-blur-md p-4 opacity-0 transition-opacity duration-300">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-8 text-center transform scale-90 transition-transform duration-300 border-t-8 border-cmRed">
            <div className="mx-auto w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-6">
              <i data-lucide="check" className="w-10 h-10 stroke-[3px]"></i>
            </div>
            <h3 className="font-oswald text-4xl text-cmBlack mb-2 uppercase">Order Received!</h3>
            <p id="successOrderRef" className="text-cmRed font-bold text-lg tracking-widest mb-3"></p>
            <p className="text-gray-500 mb-8 font-medium">Thank you for supporting CM Cheer! A confirmation has been sent to your email.</p>
            <button id="closeSuccessBtn" className="w-full bg-cmRed hover:bg-red-700 text-white font-bold py-4 rounded-lg transition-colors shadow-lg uppercase tracking-wider">Done</button>
          </div>
        </div>
      </div>

      <Footer />
    </>
  )
}
