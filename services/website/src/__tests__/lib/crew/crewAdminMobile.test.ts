/**
 * The manager's crew screens on a phone: a party (and a crew member) is a card, not a row in a table
 * seven columns wide. The table stays for screens that can hold it. These read the source, because a
 * layout is a class name: the rule is that a table is never the only thing on a phone.
 */
import fs from 'fs'
import path from 'path'

const read = (f: string) => fs.readFileSync(path.join(__dirname, '../../../', f), 'utf8').replace(/\r\n/g, '\n')

describe('the schedule on a phone', () => {
  const page = read('app/admin/crew/page.tsx')

  it('shows every party as a card below md, and the table only from md up', () => {
    expect(page).toMatch(/<ul className="md:hidden[^"]*"[^>]*>\s*\{parties\.map\(p => <li key=\{p\.id\}><PartyCardMobile p=\{p\} \/><\/li>\)\}/)
    expect(page).toMatch(/<div className="hidden md:block[^"]*overflow-x-auto">\s*<table/)
    // The one table on the page is inside that wrapper: nothing renders it on a phone.
    expect(page.match(/<table/g)).toHaveLength(1)
  })

  it('the whole card opens the party, and carries the same facts as the table row', () => {
    const card = page.slice(page.indexOf('function PartyCardMobile'), page.indexOf('export default function CrewSchedulePage'))
    expect(card).toContain('href={`/admin/crew/parties/${p.id}`}')
    for (const fact of ['when.day', 'when.time', 'p.title', 'p.staffed', 'p.needed', 'p.guestCount', 'p.available', 'crewNames(p)', 'p.status', '<PartyBits p={p} />', 'No Lead']) {
      expect(card).toContain(fact)
    }
  })

  it('the child, parent, menu, picks and flags come from ONE place, so the card and the table cannot disagree', () => {
    expect(page.match(/<PartyBits p=\{p\} \/>/g)).toHaveLength(2)
    const bits = page.slice(page.indexOf('function PartyBits'), page.indexOf('const crewNames'))
    for (const fact of ['childName', 'parentName', 'p.pick', 'p.food', 'p.cupcake', 'FLAG_TEXT']) expect(bits).toContain(fact)
  })
})

describe('the roster on a phone', () => {
  const page = read('app/admin/crew/members/page.tsx')

  it('shows every member as a card at every width: mobile first, no desktop table', () => {
    expect(page).toMatch(/<div className="space-y-3 max-w-3xl mx-auto">\s*\{members\.map\(m => \(\s*<MemberCard/)
    expect(page).not.toMatch(/<table/)
    expect(page).not.toMatch(/function MemberRow/)
  })

  it('the editor under a member is one component', () => {
    expect(page.match(/<MemberPanel /g)).toHaveLength(1)
    expect(page.match(/<MemberForm /g)!.length).toBeGreaterThanOrEqual(2)
  })

  it('each card lists the parties the person is working, one link each to its party-staff page', () => {
    const card = page.slice(page.indexOf('function WorkingParties'), page.indexOf('function MemberForm'))
    expect(card).toMatch(/href=\{`\/admin\/crew\/parties\/\$\{p\.partyId\}`\}/)
    expect(card).toMatch(/<WorkingParties parties=\{m\.parties \?\? \[\]\} \/>/)
    // The lines sit OUTSIDE the card's toggle button (a link inside a button is invalid and swallows the tap).
    const toggle = card.slice(card.indexOf('<button type="button" onClick={onToggle}'), card.indexOf('</button>'))
    expect(toggle).not.toContain('<WorkingParties')
    expect(toggle).not.toContain('<Link')
    // And no pay is read: the lines are a title, a time and a role.
    expect(card).not.toMatch(/pay|rate|steps|tip/i)
  })

  it('a card is a real button that says whether it is open', () => {
    const card = page.slice(page.indexOf('function MemberCard'), page.indexOf('function MemberForm'))
    expect(card).toMatch(/<button type="button" onClick=\{onToggle\} aria-expanded=\{open\}/)
  })
})
