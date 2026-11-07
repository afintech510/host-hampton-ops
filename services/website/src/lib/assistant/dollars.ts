const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

/** 102000 -> "$1,020.00". Client-safe (the party card's view imports this, not the server-side builder). */
export const dollars = (cents: number): string => usd.format((Number(cents) || 0) / 100)
