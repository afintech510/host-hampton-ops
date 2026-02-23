import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Party Add-Ons | Host Hampton',
  description: 'Customize your Host Hampton party with premium add-ons — balloon arches, character visits, photographers, custom cakes, and more. Available for all party packages.',
}

const addons = [
  { cat: '🎈 Decor Upgrades',     items: [
      { name: 'Balloon Arch',            price: 175, desc: 'Full doorway or backdrop arch in your colors' },
      { name: 'Balloon Tower',           price: 95,  desc: '5-foot tower, any color combo' },
      { name: 'Linen Upgrade',           price: 75,  desc: 'Satin table linens in your party colors' },
      { name: 'Custom Backdrop',         price: 125, desc: 'Personalized name or theme banner' },
    ]},
  { cat: '🎭 Entertainment',      items: [
      { name: 'Character Visit',         price: 395, desc: '30-minute visit from a costumed character' },
      { name: 'Face Painter',            price: 295, desc: 'Professional face painter for all guests' },
      { name: 'Photo Booth',            price: 200, desc: 'Digital props + unlimited prints for 1 hour' },
      { name: 'Cake Smash Photos',       price: 250, desc: 'Professional photographer, 30 min + edited gallery' },
    ]},
  { cat: '🍕 Food & Catering',    items: [
      { name: 'Coffee Bar',              price: 75,  desc: 'Hot coffee, creamer, cups — perfect for parents' },
      { name: 'Soda Package',            price: 100, desc: 'Assorted sodas and juices for guests' },
      { name: 'Extra Pizzas',            price: 25,  desc: 'Per large cheese pizza (specialty +$10)' },
      { name: 'Sheet Cake',             price: 110, desc: 'Custom sheet cake (flavors available)' },
      { name: 'Antipasto Platter',       price: 85,  desc: 'Meats, cheeses, olives, and crackers' },
      { name: 'Fruit Platter',           price: 75,  desc: 'Seasonal fresh fruit display' },
    ]},
  { cat: '🎁 Favors & Extras',    items: [
      { name: 'Premium Goody Bags',      price: 200, desc: 'Themed bags with treats and small gifts (up to 10)' },
      { name: 'Curated Gift Baskets',    price: 195, desc: 'Premium take-home basket for birthday child' },
      { name: 'Mommy & Me Jewelry',      price: 100, desc: 'Permanent bracelets for mom and birthday child' },
      { name: 'Extra Party Helper',      price: 25,  desc: 'Per guest (for larger groups)' },
    ]},
]

export default function PartyAddOns() {
  return (
    <div className="bg-hampton-ivory">
      <section className="py-16 text-center px-4">
        <h1 className="font-serif text-4xl text-hampton-navy mb-4">Party Add-Ons</h1>
        <p className="text-hampton-navy text-lg max-w-xl mx-auto">
          Every party is magical. These extras make it unforgettable.
        </p>
      </section>

      <section className="py-16 max-w-5xl mx-auto px-4 sm:px-6">
        <div className="space-y-12">
          {addons.map(cat => (
            <div key={cat.cat}>
              <h2 className="font-semibold text-xl text-hampton-navy mb-5 border-b border-hampton-pink/20 pb-2">{cat.cat}</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {cat.items.map(item => (
                  <div key={item.name} className="bg-white border border-hampton-pink/20 rounded-xl p-4 flex justify-between items-start gap-4">
                    <div>
                      <h3 className="font-semibold text-hampton-navy text-sm tracking-wide mb-0.5">{item.name}</h3>
                      <p className="text-hampton-navy text-xs leading-relaxed">{item.desc}</p>
                    </div>
                    <span className="text-hampton-navy font-bold text-base shrink-0">${item.price}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-hampton-pink/10 py-14 text-center px-4">
        <h2 className="section-heading mb-3">Add These to Your Package</h2>
        <p className="text-hampton-navy mb-7">Add-ons are selected during the planning process — after you reserve your date.</p>
        <Link href="/book" className="btn-primary px-10 py-4 text-base">Reserve Your Date First — $250</Link>
      </section>
    </div>
  )
}
