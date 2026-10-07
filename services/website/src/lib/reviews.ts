/**
 * Real Google reviews — the ONE source for every review the site shows or
 * marks up.
 *
 * WHY. Until 2026-10-07 the homepage and /party-packages showed seven
 * testimonials ("Jessica M.", "Sarah K.", "Amanda R.", "Maria L.", "Ashley R.")
 * that traced to no review anywhere, under a heading promising "Real reviews
 * from real Host Hampton families", and the homepage published three of them as
 * schema.org Review nodes. Answer engines asked about "Host Hampton reviews"
 * built their answer from exactly those. Google's review policy requires
 * marked-up reviews to be genuine, and an assistant repeating an invented quote
 * is a worse problem than having none.
 *
 * Every entry below is copied VERBATIM from the Google Business Profile (Adam,
 * 2026-10-07), shown as first name + last initial. `occasion` is our own short
 * label taken from what the review itself says — never put words in a review.
 * One review (John L., "Always Fun Events!…") is left out because only a
 * truncated copy was available; it still counts toward RATING.
 *
 * To add one: paste it verbatim from Google, then bump RATING.reviewCount.
 */

export interface GoogleReview {
  name: string
  text: string
  /** Our label, from the review's own content. Shown small, never as a quote. */
  occasion?: string
  stars: number
}

/** Google Maps listing — "read all reviews". */
export const GOOGLE_REVIEWS_URL = 'https://www.google.com/maps?cid=4493062172389948796'

export const GOOGLE_REVIEWS: GoogleReview[] = [
  { name: 'Jessica E.', stars: 5, occasion: 'Unicorn party · 4th birthday', text: `I cannot say enough amazing things about Host Hampton. They made my daughter's 4th birthday so special. She brought her "unicorn party" dreams to life. The staff running the party was timely, knowledgeable, and efficient. Everything was perfect! I would 10/10 recommend Host Hampton to any person and plan to use them again in the future.` },
  { name: 'Jessica B.', stars: 5, occasion: 'Cowgirl disco party · 8th birthday', text: `We had the absolute BEST experience celebrating my daughter's 8th birthday with a cowgirl disco party! 🤠✨💖 From start to finish, everything was absolutely amazing. The staff was so helpful, attentive, and genuinely went above and beyond to make sure everything was perfect. Allie took my vision for the party and truly brought it to life — even better than I could have imagined! Every detail was so beautifully done, and my daughter and all of her friends had the BEST time. It was such a fun, unique, and memorable birthday celebration, and I'm so grateful to the entire team for making her 8th birthday so special. If you're looking for a place that will make your child's celebration unforgettable, I cannot recommend them enough! We are beyond happy with how everything turned out and would absolutely celebrate here again! 🤠💃✨` },
  { name: 'Kristin S.', stars: 5, occasion: 'Birthday party', text: `Allie was wonderful to work with planning my daughter's birthday! There was so much thought put into every detail! Every guest commented on what a great party it was! We will be back for sure!` },
  { name: 'Jessica H.', stars: 5, occasion: 'Craft class', text: `My daughter had the best time!! Loves the little dumpling she made with her friends.` },
  { name: 'Jennifer L.', stars: 5, occasion: 'Two birthday parties & classes', text: `Host Hampton is such a special place, and you can really tell how much care and creativity goes into everything Allie and her staff do. My daughter always comes home with the cutest things she's made, and she has an absolute blast every time. They've also hosted two of her birthday parties now, and both were executed perfectly from start to finish. Highly recommend for kids' parties, adult events, or any fun and memorable experience!!` },
  { name: 'Maggie B.', stars: 5, occasion: 'At-home party · fifteen 7-year-olds', text: `I cannot express how amazing Host Hampton is at what they do! Allie and Kirra showed up ready to take on fifteen 7 year olds and succeeded in the mission! The kids loved the spread of hats, bags, patches, hair glitter and glitter tattoos they set up beautifully in our home. The following school day, there were about 7 kids wearing the hats they made at the party and 2 parents! I have already booked another party for my 5 year old's party and a bunch of the parents asked for Host Hampton's contact information. I HIGHLY recommend this wonderful company to anyone that wants a guaranteed great party!` },
  { name: 'Christianne J.', stars: 5, text: `Such a great party spot!! Allie and team are fantastic!!` },
  { name: 'Reyne D.', stars: 5, occasion: 'Birthday party', text: `My daughter had such a great time at her birthday party! Everyone loved it! What a wonderful place! Thank you!` },
  { name: 'Casey M.', stars: 5, occasion: 'Grand opening · patch bar', text: `Went for the grand opening and absolutely love what they did with this space, looks fabulous and love my trucker hat and pouch I made at their fun patch bar!! Perfect place for a party and def worth checking out!` },
  { name: 'Manana I.', stars: 5, occasion: 'Kids party', text: `Fantastic kids party place. Clean, fun, and well organized. Friendly staff and happy kids. Highly recommended this place for an unforgettable kid's party!` },
  { name: 'Kyle L.', stars: 5, occasion: 'Birthday party & K-Pop pop-up', text: `I attended at children's birthday party and a recent pop up event featuring K-pop deamon hunters. Kids love staff and events` },
  { name: 'Irina O.', stars: 5, occasion: 'Holiday Market', text: `Loved coming here for the Holiday Market! Lots of cute businesses all under one roof. We enjoyed spending time here and look forward to attending other events in this bright, clean and fun space!` },
  { name: 'Sami R.', stars: 5, text: `Host Hampton is THE spot to host your next party. They offer so many fun themes whether it be for a kids party, a bachelorette party, a work party, or anything you can think of. The space is beautiful and there is nothing else like it in the area. It is truly one of a kind! I can't wait to host a custom trucker hat party with my friends!` },
  { name: 'Sarah B.', stars: 5, occasion: 'Grand opening', text: `I attended the grand opening of Host Hampton this weekend and was so impressed with the space! It's a beautifully renovated, clean and welcoming shop. The owner, Allie, was so friendly, knowledgeable and answered all of my questions. I was so impressed with the party packages, that I instantly booked my daughters 1st birthday there. Host Hampton is going to be a great addition to the Speonk community, and I can't wait to watch their success unfold!` },
  { name: 'Theresa T.', stars: 5, occasion: 'Ladies’ night', text: `The best in the business, I highly recommend host hampton to do your next party.any idea you may have she will make it beyond your expectations!! So much fun for a ladies night out or to do a little shopping Allie has the cutest gift ideas for any occasion.` },
  { name: 'Manischa V.', stars: 5, occasion: '6th birthday', text: `Allie went above and beyond for our daughter's 6th birthday party. Such an amazing place, they had so many fun activities for the kids. Highly recommend for any event. She is the best! Thank you for an unforgettable 6th birthday!` },
  { name: 'Aimee D.', stars: 5, occasion: 'Pink Pony Club slime party · 7th birthday', text: `I had my 7 year old daughters birthday here it was a "pink pony club slime party" and the kids had a BLAST! Ali is fantastic and handled everything from setting up cleaning up to musical chairs and simon says. This was the least stressful party ive ever done for my kids and I very HIGHLY recomend Host Hampton not only for parties but they also have really cute clothes :)` },
  { name: 'Mariana N.', stars: 5, occasion: 'Son’s birthday', text: `Host Hampton absolutely knocked it out of the park for my son's birthday! Every detail was thoughtfully planned, completely stress free, and handled entirely by Allie and her team - I didn't have to lift a finger. The whole experience was executed flawlessly from setup to cleanup. My son was over the moon and hasn't stopped talking about it; it truly made his day unforgettable. Worth every penny and then some - couldn't recommend them more highly!` },
  { name: 'Jaclyn R.', stars: 5, occasion: 'Bluey party', text: `What a great place! Our first experience there was for the Bluey party. It was perfect! All different areas for crafts and activities, a soft play set up, and a visit from the character Bluey. Allie and her staff were great. The space itself is clean and bright and perfect for hosting a party or attending an event.` },
  { name: 'Moira R.', stars: 5, occasion: 'Slime Care Bear party · 7th birthday', text: `Had my daughter's 7th birthday party here—theme was a slime Care Bear party. Everything was absolutely perfect!! Allie took care of everything, decor, invite, paper goods, food, etc. Best of all the slime wasn't too sticky….iykyk Highly recommend!!!` },
  { name: 'Olivia H.', stars: 5, occasion: '1st birthday', text: `We hosted my son's 1st birthday party and Host Hampton was the best! So accommodating. Always available when I had questions. My guests loved the space too! My guess is we will be back!` },
  { name: 'Gabriella R.', stars: 5, occasion: 'Craft nights', text: `Such a cute spot that's offering lots of fun and affordable craft nights. Allie is super nice and her spot is a great addition to the community. Check out the events page for lots of different options for all ages!` },
  { name: 'Samantha C.', stars: 5, occasion: 'Glow party · 5th birthday', text: `Host Hampton is the perfect space to host your child's bday - we had our daughter's 5th birthday party. She wanted a "glow" theme and HH handled everything from the food to the decorations. Really nice space and so easy to work with all of the staff there.` },
  { name: 'Beatriz M.', stars: 5, occasion: '5th birthday', text: `We had our daughter's 5th birthday party there and it was amazing!! When we arrived, everything was already set up, beautifully decorated, and all the activities I had picked for the kids were ready to go plus more. I didn't have to worry about a thing! Allie and her staff were so kind, welcoming, and organized throughout the whole party. We received so many compliments from our guests, and everyone had such a great time. We couldn't have asked for a better experience for our daughter's special day!` },
  { name: 'Alexandra A.', stars: 5, occasion: 'Barbie party · 5th & 3rd birthdays', text: `We had my daughter's 5th and 3rd Barbie birthday party at Host Hampton over the weekend and it was absolutely AMAZING! Every detail was perfect and the entire experience felt so special for the kids. From the Barbie head hair styling station to manicures, hair tinsel, and adorable tattoos, there were so many fun activities that kept all the girls entertained and excited the entire time. Everything was set up beautifully and Allie and the staff were incredible with the kids. They were so patient, organized, and made each child feel like a little Barbie. It truly felt like a dream party and made the whole day completely stress-free for us as parents. My daughter and all of her friends are still talking about it! If you're looking for the perfect place to host a magical, fun, and memorable birthday party, I highly recommend Host Hampton. It was the best celebration!` },
  { name: 'Jessica V.', stars: 5, occasion: 'K-Pop party', text: `Every detail was taken care of! Allie and her team handled it all, from the custom invitations, party supplies, activities, cupcakes and pizza! My daughter and her friends had a blast dancing to kpop music, getting hair tinsel and decorating their own microphones and glasses. I am so glad I was able to enjoy the party along with the kids and not have to worry about making sure everyone was entertained. Thanks Host Hampton!` },
  { name: 'Crispino P.', stars: 5, occasion: '6th birthday', text: `I cannot say enough about how amazing Allie is and her girls. I was overwhelmed with happiness on how great she made my daughter 6th bday ! It was top-notch, she thought of everything ! It was absolute perfection. I had mother's reach out to me after the party to tell me how much fun they had and how much fun their children had. Most of all. My daughter had a blast and she will never forget it. This is a stressfree venue she did everything for me I did not have to do anything except tell her what I wanted. She took care of everything from beginning to end. I've never been so happy with a party and I have always given my daughter her party. Allie is outstanding!!! Struggle Thank you for making my daughter's birthday so special Love Love Anne !` },
  { name: 'Kristina M.', stars: 5, occasion: 'Sleep Under party · 10th birthday', text: `I cannot say enough about Allie and her staff at Host Hampton! My daughter celebrated her 10th birthday with a "sleep under" themed party yesterday and in her words "it was the best birthday party ever!" Allie made this so easy, the space was beautiful and most importantly the kids had so much fun! Check out all of the different themes they offer! And if you prefer, they will come to you! Host Hampton is a gem in our community! P.S. check out the Mat Pilates class offered there too! Chelsea is an incredible instructor! @themaningomethod on IG for dates/times. Host Hampton has it all! 💕💕` },
]

const byName = (n: string) => {
  const r = GOOGLE_REVIEWS.find(x => x.name === n)
  if (!r) throw new Error(`reviews: no Google review by ${n}`)
  return r
}

/**
 * The three on the homepage. Chosen to cover what ChatGPT is asked about most:
 * an at-home party (most AI leads are mobile), a themed studio party, and a
 * slime party. The homepage is the page ChatGPT-User fetches most (52 of ~70
 * fetches in the week to 2026-10-07).
 */
export const HOMEPAGE_REVIEWS: GoogleReview[] = ['Maggie B.', 'Jessica V.', 'Moira R.'].map(byName)

/** The two on /custom-accessories — both about the hat and patch bar. */
export const ACCESSORIES_REVIEWS: GoogleReview[] = ['Casey M.', 'Sami R.'].map(byName)

/** The four on /party-packages — one per themed party. */
export const PACKAGES_REVIEWS: GoogleReview[] = ['Jessica B.', 'Alexandra A.', 'Samantha C.', 'Aimee D.'].map(byName)

/**
 * Aggregate rating for LocalBusiness schema — the live Google Business Profile.
 * 2026-10-07: 29 reviews, all five stars (25 confirmed by Adam 2026-09-04, plus
 * four five-star reviews Google notified us of on 9/13, 10/4 and 10/5 — the
 * same 29 Adam pasted from the profile). Update when the profile changes; never
 * inflate the count.
 */
export const RATING = {
  ratingValue: '5.0',
  reviewCount: 29,
  bestRating: '5',
  worstRating: '1',
}
