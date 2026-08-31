import type { Tenant } from './types';

/**
 * SEEDED CRM DATA
 *
 * Generated FROM the tenant, so it always uses their city, their
 * service names, their neighbourhoods. "Kitchen fitting quote —
 * Caversham" rather than "Customer 1, Test Service". That single
 * detail carries most of the perceived personalisation.
 *
 * Two rules:
 *  - Never scraped from a real client. Always synthetic.
 *  - Dates generated relative to now, so a demo built in August
 *    doesn't show "upcoming" jobs that are three months past.
 */

const FIRST = ['Priya', 'Tom', 'Aisha', 'Gareth', 'Ellen', 'Marcus', 'Sofia', 'Dan', 'Ruth', 'Owen'];
const LAST = ['Nayar', 'Ellis', 'Rahman', 'Pryce', 'Whitfield', 'Oduya', 'Lindqvist', 'Brennan', 'Achebe', 'Marsh'];

export interface Seed {
  kpis: { label: string; value: string; unit: string }[];
  sequence: { t: string; l: string }[];
  dimAfter: number;
  dimLabel: string;
  sms: { side: 'us' | 'them'; t: string; text: string }[];
  pipeline: { stage: string; who: string; val: string; live?: boolean }[];
  jobs: { d: string; w: string; p: string }[];
  fallbackSlots: { day: string; date: string; time: string; iso: string }[];
}

export function seedFor(t: Tenant): Seed {
  const at = <T,>(a: T[], i: number) => a[i % a.length];
  const svc = (i: number) => t.services[i % t.services.length].name;
  const near = (i: number) => at(t.nearby, i);
  const who = (i: number) => `${at(FIRST, i)} ${at(LAST, i + 3)}`;

  // Dates relative to now so the demo never goes stale.
  const now = new Date();
  const plus = (days: number, hour: number, min = 0) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(hour, min, 0, 0);
    return d;
  };
  const dayName = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
  const dateStr = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const hhmm = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const weekday = (offset: number, hour: number, min = 0) => {
    const d = plus(offset, hour, min);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    d.setHours(hour, min, 0, 0);
    return d;
  };
  const slotDates = [
    weekday(1, 9), weekday(2, 14), weekday(3, 8, 30),
    weekday(4, 11), weekday(7, 15, 30), weekday(8, 10)
  ];

  return {
    kpis: [
      { label: 'Missed calls recovered', value: '14', unit: 'this month' },
      { label: 'Avg reply time', value: '11s', unit: 'was 2 days' },
      { label: 'Quotes out', value: '9', unit: '£23,400' },
      { label: 'Jobs won', value: '4', unit: '44% rate' }
    ],
    sequence: [
      { t: '14:22:06', l: 'Call came in and rang out — you were on site' },
      { t: '14:22:17', l: 'Text sent automatically, no action from you' },
      { t: '14:26:41', l: `${who(4)} replied — ${svc(0).toLowerCase()}` },
      { t: '14:27:02', l: 'Added to the board and a site visit offered' }
    ],
    dimAfter: 0,
    dimLabel: '11 sec',
    sms: [
      {
        side: 'us',
        t: '14:22 · sent automatically',
        text: `Sorry we missed you — this is ${t.short}, we're on site until 5. Reply here and we'll call you back, or book a free visit.`
      },
      {
        side: 'them',
        t: '14:26',
        text: `Hi, after a quote for ${svc(0).toLowerCase()} in ${near(1)}. Roughly 3m of wall.`
      },
      {
        side: 'us',
        t: '14:27 · sent automatically',
        text: `Thanks — ${dayName(slotDates[0])} 9am or ${dayName(slotDates[1])} 2pm work for a measure-up. Which suits?`
      },
      { side: 'them', t: '14:31', text: `${dayName(slotDates[0])} 9 is good.` }
    ],
    pipeline: [
      { stage: 'Enquiry', who: `${who(1)} — ${svc(1)}, ${near(0)}`, val: 'new' },
      { stage: 'Site visit booked', who: `${who(4)} — ${svc(0)}, ${near(1)}`, val: `${dayName(slotDates[0])} 09:00`, live: true },
      { stage: 'Quote sent', who: `${who(6)} — ${svc(2)}, ${near(2)}`, val: '£4,820 · 3d' },
      { stage: 'Won', who: `${who(8)} — ${svc(3 % t.services.length)}, ${near(3)}`, val: '£1,940' }
    ],
    jobs: [
      { d: dayName(plus(1, 8)), w: `${svc(0)} — ${near(0)}`, p: '2 days' },
      { d: dayName(plus(2, 8)), w: `Measure-up — ${near(1)}`, p: '45 min' },
      { d: dayName(plus(4, 8)), w: `${svc(1)} — ${near(1)}`, p: '1 day' },
      { d: dayName(plus(5, 8)), w: `${svc(2)} — ${near(2)}`, p: '1 day' }
    ],
    fallbackSlots: slotDates.map((d) => ({ day: dayName(d), date: dateStr(d), time: hhmm(d), iso: d.toISOString() }))
  };
}
