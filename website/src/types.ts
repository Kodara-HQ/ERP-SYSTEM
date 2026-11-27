export interface Picture {
  id: number;
  url: string;
  alt: string;
}

export interface Settings {
  legalName: string;
  tradingName: string;
  phone: string | null;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  country: string | null;
  mapUrl: string | null;
  facebookUrl: string | null;
  twitterUrl: string | null;
  linkedinUrl: string | null;
  instagramUrl: string | null;
  footerText: string | null;
  seoTitle: string;
  seoDescription: string | null;
  staffLoginUrl: string;
}

export interface Block {
  id: number;
  key: string;
  title: string;
  summary: string | null;
  body: string | null;
  content: Record<string, string | null>;
  image: Picture | null;
  metaTitle: string | null;
  metaDescription: string | null;
}

export interface Item {
  id: number;
  title: string;
  summary: string | null;
  body: string | null;
  href: string | null;
  metricValue: string | null;
  metricNote: string | null;
  groupKey: string | null;
  image: Picture | null;
}

export interface ProductCard {
  slug: string;
  name: string;
  summary: string;
  description?: string | null;
  category: string;
  specifications: string | null;
  gradeInformation: string | null;
  packaging: string | null;
  availabilityStatus: string;
  image: Picture | null;
  images?: Array<Picture & { isPrimary?: boolean }>;
  video?: { url: string; poster: string | null } | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  related?: ProductCard[];
}

export interface ArticleCard {
  slug: string;
  title: string;
  summary: string;
  category: string;
  publishedOn: string | null;
  image: Picture | null;
  body?: string;
  metaTitle?: string | null;
  metaDescription?: string | null;
  related?: ArticleCard[];
}

export interface GalleryCard {
  id: number;
  category: string;
  caption: string | null;
  image: Picture | null;
}

export interface Vacancy {
  slug: string;
  title: string;
  locationLabel: string | null;
  summary: string;
  description?: string;
  requirements?: string | null;
  applicationsEnabled?: boolean;
  metaTitle?: string | null;
  metaDescription?: string | null;
}

export interface Bootstrap {
  settings: Settings;
  commodities: Array<{ slug: string; name: string; category: string }>;
}

export interface HomeData {
  settings: Settings;
  hero: Block | null;
  about: Block | null;
  cta: Block | null;
  divisions: Item[];
  strengths: Item[];
  values: Item[];
  highlights: Item[];
  products: ProductCard[];
  articles: ArticleCard[];
  gallery: GalleryCard[];
}

export const categoryLabels: Record<string, string> = {
  cashew: 'Cashew Nuts',
  soybean: 'Soybeans',
  shea: 'Shea Nuts',
  cassava: 'Powdered Cassava',
  cocoa: 'Cocoa Beans',
  ginger: 'Ginger',
  other: 'Other Commodities',
  warehouses: 'Warehouses',
  haulage: 'Haulage',
  gold: 'Gold Buying',
  activities: 'Company Activities',
};

export const availabilityLabels: Record<string, string> = {
  unspecified: 'Confirmed on enquiry',
  available: 'Available',
  limited: 'Limited availability',
  unavailable: 'Currently unavailable',
};

/** The phone field can hold several numbers separated by "/", "," or ";". Each gets its own tel: link. */
export function phoneNumbers(phone: string | null | undefined): Array<{ label: string; href: string }> {
  return (phone ?? '')
    .split(/[\/,;]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((label) => ({ label, href: `tel:${label.replace(/\(0\)/g, '').replace(/[^\d+]/g, '')}` }));
}
