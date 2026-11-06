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
    for (const fact of ['when.day', 'when.time', 'p.title', 'p.staffed', 'p.needed', 'p.guestCount', 'p.available', 'p.unconfirmed', 'crewNames(p)', 'p.status', '<PartyBits p={p} />', 'No Lead']) {
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

  it('shows every member as a card below md, and the table only from md up', () => {
    expect(page).toMatch(/<div className="md:hidden[^"]*">\s*\{members\.map\(m => \(\s*<MemberCard/)
    expect(page).toMatch(/<div className="hidden md:block[^"]*overflow-x-auto">\s*<table/)
    expect(page.match(/<table/g)).toHaveLength(1)
  })

  it('the editor under a member is one component used by both layouts', () => {
    expect(page.match(/<MemberPanel /g)).toHaveLength(2)
    expect(page.match(/<MemberForm /g)!.length).toBeGreaterThanOrEqual(2)
  })

  it('a card is a real button that says whether it is open', () => {
    const card = page.slice(page.indexOf('function MemberCard'), page.indexOf('function MemberForm'))
    expect(card).toMatch(/<button type="button" onClick=\{onToggle\} aria-expanded=\{open\}/)
  })
})
