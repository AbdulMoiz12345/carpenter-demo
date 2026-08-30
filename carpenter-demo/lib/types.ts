/**
 * THE CONFIG CONTRACT
 *
 * Both extraction paths must produce exactly this shape:
 *   - Path A: website scrape (logo chain + colour sampling + Claude)
 *   - Path B: Google Places (no website exists)
 *
 * The renderer never knows which path produced a tenant.
 * Get this right once and the two extractors become interchangeable.
 */

export type TenantSource = 'website' | 'places';

export interface Service {
  name: string;
  tag: string;
}

export interface WorkItem {
  title: string;
  where: string;
}

export interface Testimonial {
  quote: string;
  author: string;
}

export type Logo =
  | { type: 'wordmark' }
  | { type: 'image'; url: string; from: LogoSource };

/** Which step of the fallback chain produced the logo. Useful for QA. */
export type LogoSource =
  | 'apple-touch-icon'
  | 'og-image'
  | 'header-img'
  | 'inline-svg'
  | 'favicon';

export interface GhlBinding {
  /** Sub-account this demo reads from. Required only for LIVE data. */
  locationId?: string;
  /** Inbound-webhook trigger URL. Write-only. No API key needed. */
  enquiryHook?: string;
  /** Separate hook for bookings, if you want a different workflow. */
  bookingHook?: string;
  /** Calendar to pull real availability from. Needs GHL_TOKEN. */
  calendarId?: string;
}

export interface Tenant {
  slug: string;
  /** Full hostname this tenant answers on. The trust anchor. */
  domain: string;
  status: 'ACTIVE' | 'DISABLED';
  source: TenantSource;

  company: string;
  /** Short form for nav, SMS copy, tight spaces. */
  short: string;
  headline: [string, string];
  tagline: string;

  city: string;
  /** Neighbourhoods — makes seeded CRM data feel local. */
  nearby: string[];
  phone: string;
  since: number;
  rating: string;
  reviews: number;

  logo: Logo;
  colors: { primary: string };

  services: Service[];
  work: WorkItem[];

  /**
   * Real project photos lifted from their own site. Hotlinked, not
   * copied — this is their imagery shown back to them, which is the
   * single strongest signal that the page was built for them.
   * Empty is normal and handled: the proof band adapts.
   */
  images: string[];

  /** Real review text from their site. Fills the space photos would. */
  testimonials: Testimonial[];

  /** "Licensed & insured", "Since 1994", "Free estimates". */
  credentials: string[];

  email: string;

  ghl: GhlBinding;
}
