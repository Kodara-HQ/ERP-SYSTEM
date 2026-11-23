/**
 * Opening text for the public website. The seed writes it, and refreshes any row an editor has not
 * yet changed. Once staff edit a row in Website management, their wording is kept.
 *
 * Wording rules: no invented figures, dates, certifications, customers, or licences. Commodity
 * parameters are the ranges buyers commonly specify in the trade, and every page says that the
 * final terms are agreed per contract.
 */

export interface BlockText {
  key: string;
  title: string;
  summary?: string | null;
  body?: string | null;
  content?: Record<string, string | null>;
  image?: string;
  metaTitle?: string | null;
  metaDescription?: string | null;
}

export interface ItemText {
  type: 'division' | 'strength' | 'highlight' | 'leader' | 'service' | 'value';
  title: string;
  summary: string;
  body?: string | null;
  groupKey?: string | null;
  image?: string;
}

export interface ProductText {
  slug: string;
  name: string;
  category: string;
  image: string;
  summary: string;
  description: string;
  specifications: string;
  gradeInformation: string;
  packaging: string;
  metaDescription: string;
}

export const imageAlt: Record<string, string> = {
  hero: 'Warehouse, stored commodity sacks, and bowls of agricultural produce',
  about: 'A trader seated among stacked sacks of produce in a storage room',
  gold: 'Gold nuggets on a dark wooden surface',
  haulage: 'A cargo truck travelling on a rural highway between green fields',
  'division-agriculture': 'A farmer tending a green crop field',
  'division-gold': 'Gold nuggets on a dark wooden surface',
  'division-haulage': 'A cargo truck travelling on a rural highway between green fields',
  'product-cashew-nuts': 'A pile of cashew nuts',
  'product-soybeans': 'Dried yellow soybeans',
  'product-shea-nuts': 'Hands holding dried shea nuts in West Africa',
  'product-powdered-cassava': 'Freshly harvested cassava roots',
  'product-cocoa-beans': 'Hands holding dried cocoa beans',
  'product-ginger': 'Fresh ginger roots',
  'gallery-cashew-1': 'A yellow cashew apple with its nut attached',
  'gallery-cashew-2': 'A bowl of cashew kernels',
  'gallery-soybean-1': 'Dried soybeans, close up',
  'gallery-shea-1': 'Shea nuts spread out to dry in the sun',
  'gallery-shea-2': 'Close-up of dried shea nuts from the Upper West Region of Ghana',
  'gallery-cassava-1':'Hand touching the leaves of a cassava plant',
  'gallery-cassava-2': 'Freshly harvested cassava roots, cut to show the white flesh',
  'gallery-cocoa-1': 'Red cocoa pods hanging from a cocoa tree',
  'gallery-cocoa-2': 'Ripe yellow and orange cocoa pods',
  'gallery-ginger-1': 'A pile of fresh ginger roots',
  'gallery-ginger-2': 'A ginger root with sliced pieces',
};

export interface GalleryText {
  image: string;
  category: 'cashew' | 'soybean' | 'shea' | 'cassava' | 'cocoa' | 'ginger' | 'warehouses' | 'haulage' | 'gold' | 'activities';
  caption: string;
  featured?: boolean;
}

/**
 * Commodity photographs only. They show the crops, not company premises, vehicles or staff, so captions
 * name the commodity and never claim the scene as the company's own. Company photographs are added by staff.
 */
export const gallery: GalleryText[] = [
  { image: 'gallery-cashew-1', category: 'cashew', caption: 'Cashew apple with its nut', featured: true },
  { image: 'gallery-cashew-2', category: 'cashew', caption: 'Cashew kernels' },
  { image: 'gallery-soybean-1', category: 'soybean', caption: 'Dried soybeans', featured: true },
  { image: 'product-shea-nuts', category: 'shea', caption: 'Shea nuts collected in West Africa', featured: true },
  { image: 'gallery-shea-1', category: 'shea', caption: 'Shea nuts drying in the sun, Ghana. Photo: Suglo20, CC BY-SA 4.0' },
  { image: 'gallery-shea-2', category: 'shea', caption: 'Shea nuts, Upper West Region, Ghana. Photo: Abdul-Rauf Moshie, CC BY-SA 4.0' },
  { image: 'gallery-cassava-1', category: 'cassava', caption: 'Cassava plant' },
  { image: 'gallery-cassava-2', category: 'cassava', caption: 'Freshly harvested cassava roots', featured: true },
  { image: 'gallery-cocoa-1', category: 'cocoa', caption: 'Cocoa pods on the tree', featured: true },
  { image: 'gallery-cocoa-2', category: 'cocoa', caption: 'Ripe cocoa pods' },
  { image: 'gallery-ginger-1', category: 'ginger', caption: 'Fresh ginger roots', featured: true },
  { image: 'gallery-ginger-2', category: 'ginger', caption: 'Ginger root, whole and sliced' },
];

export const blocks: BlockText[] = [
  {
    key: 'home.hero',
    title: 'BAJOGO ENTERPRISE',
    summary: 'Your partner in agricultural commodities, gold trading and logistics.',
    content: {
      heading: 'Connecting Commodities, Markets and Opportunities.',
      supporting: 'A Ghanaian enterprise sourcing quality agricultural commodities, trading gold within its licence, and moving goods safely from farm gate to market.',
      primaryLabel: 'Explore Our Business',
      primaryHref: '/#divisions',
      secondaryLabel: 'Contact Us',
      secondaryHref: '/contact',
    },
    image: 'hero',
    metaTitle: 'BAJOGO ENTERPRISE | Agricultural Commodities, Gold and Logistics in Ghana',
    metaDescription: 'BAJOGO ENTERPRISE sources and supplies cashew, soybeans, shea, cassava, cocoa and ginger, trades gold within its licence, and provides haulage and logistics in Ghana.',
  },
  {
    key: 'home.about',
    title: 'A Ghanaian partner from farm gate to market',
    summary: 'BAJOGO ENTERPRISE brings three connected businesses under one roof: agricultural commodity trading, licensed gold activity, and haulage and logistics.',
    body: 'We work with farmers, aggregators, processors and buyers to move produce through a supply chain that is documented, inspected and delivered as agreed. Because sourcing, storage and transport sit inside one company, our customers deal with a single accountable partner rather than a chain of intermediaries.',
    content: {
      mission: 'To connect Ghanaian producers with reliable markets by trading quality commodities honestly and delivering them safely and on time.',
      vision: 'To be the most trusted Ghanaian partner for commodity trade and logistics, known for integrity, quality and dependable delivery.',
    },
    image: 'about',
  },
  {
    key: 'home.cta',
    title: "Let's Grow Together.",
    summary: 'Tell us what you need to buy, sell or move. Our team will reply with the next steps.',
    content: { buttonLabel: 'Start an enquiry', buttonHref: '/contact' },
  },
  {
    key: 'about.profile',
    title: 'About BAJOGO ENTERPRISE',
    summary: 'A Ghanaian enterprise in agricultural commodities, gold and logistics, built on integrity and dependable delivery.',
    body: 'BAJOGO ENTERPRISE is a Ghanaian company working across three connected lines of business: the sourcing and supply of agricultural commodities, gold buying carried out within the company’s licence, and haulage and logistics.\n\nOur commodity business covers cashew, soybeans, shea, cassava products, cocoa through the regulated channel, and ginger. We buy from farmers and aggregators, check and grade what we buy, store it with care, and deliver it to processors, exporters and other buyers on agreed terms.\n\nOur haulage and logistics business supports that trade and serves outside customers too, moving bagged and bulk produce from collection points to warehouses, factories and ports.',
    content: {
      who: 'We are traders, logistics coordinators and support staff who know Ghana’s growing regions and the standards buyers expect. We run our operations on a single business system, so purchasing, stock, transport, finance and approvals are recorded and checked rather than handled informally.',
      history: null,
      mission: 'To connect Ghanaian producers with reliable markets by trading quality commodities honestly and delivering them safely and on time.',
      vision: 'To be the most trusted Ghanaian partner for commodity trade and logistics, known for integrity, quality and dependable delivery.',
      approach: 'Every lot we buy is weighed, inspected and recorded before it is stored. Every consignment we carry is documented from loading to delivery. Prices, specifications and quantities are confirmed in writing before goods move.',
      community: 'Our business depends on the farming communities we buy from. We pay promptly for what we buy, explain the quality standards we apply, and treat suppliers as long-term partners.',
    },
    image: 'about',
    metaTitle: 'About Us | BAJOGO ENTERPRISE',
    metaDescription: 'BAJOGO ENTERPRISE is a Ghanaian company in agricultural commodities, licensed gold activity, and haulage and logistics.',
  },
  {
    key: 'commodities.page',
    title: 'Agricultural Commodities',
    summary: 'Quality Ghanaian produce, sourced from farmers and aggregators, checked and graded, and supplied on agreed terms.',
    body: 'BAJOGO ENTERPRISE buys agricultural commodities in Ghana’s growing regions and supplies them to processors, exporters, manufacturers and wholesale buyers. We focus on crops where quality control and reliable logistics make a real difference to the buyer.\n\nEach commodity page sets out the parameters buyers in that trade usually specify. Final specification, grade, packaging, quantity, price and delivery terms are confirmed in writing for each contract.',
    content: {
      buyers: 'Processors, exporters, food and cosmetics manufacturers, feed millers, and wholesale buyers.',
      suppliers: 'Farmers, farmer groups and aggregators who can supply clean, dry, well-graded produce are welcome to contact us.',
    },
    image: 'division-agriculture',
    metaTitle: 'Agricultural Commodities | BAJOGO ENTERPRISE',
    metaDescription: 'Cashew nuts, soybeans, shea nuts, cassava flour, cocoa and ginger sourced and supplied by BAJOGO ENTERPRISE in Ghana.',
  },
  {
    key: 'gold.page',
    title: 'Gold Buying',
    summary: 'Gold activity conducted strictly within our licence, with every transaction identified, weighed, assayed and recorded.',
    body: 'Gold is one of Ghana’s most important resources and one of its most regulated. BAJOGO ENTERPRISE carries out gold buying only within the scope of the licence the company holds, and in line with the requirements of Ghana’s gold-sector regulators.\n\nWe deal only with identified sellers who can show that their gold was lawfully produced. Every transaction is weighed and assayed openly, paid for through traceable means, and recorded in full. We do not buy gold from unidentified sources or from illegal mining, and we will decline any transaction that does not meet these standards.\n\nLicence details are published on this page once they are recorded by the company. To discuss a transaction, send a business enquiry below.',
    content: { licenceName: null, licenceNumber: null, licenceAuthority: null, licenceExpiry: null },
    image: 'gold',
    metaTitle: 'Gold Buying | BAJOGO ENTERPRISE',
    metaDescription: 'Licensed gold buying by BAJOGO ENTERPRISE: identified sellers, lawful origin, open weighing and assay, and full records.',
  },
  {
    key: 'haulage.page',
    title: 'Haulage & Logistics',
    summary: 'Safe, documented transport for agricultural produce and general cargo, from collection point to final destination.',
    body: 'Our haulage and logistics service grew out of our own commodity trade, where produce has to move from scattered farming communities to warehouses, factories and ports in good condition and on schedule. We now offer the same service to other businesses.\n\nWe plan each consignment before it moves: the route, the loading, the documents, and who signs for the goods at the other end. Customers receive updates while their cargo is in transit and a signed proof of delivery when it arrives.',
    content: {
      fleetNote: 'Vehicle capacity, routes and rates are confirmed for each consignment. Tell us what you need to move, from where, to where, and by when.',
      coverage: 'Routes across Ghana between farming regions, warehouses, processing plants and the ports of Tema and Takoradi, by agreement.',
    },
    image: 'haulage',
    metaTitle: 'Haulage and Logistics | BAJOGO ENTERPRISE',
    metaDescription: 'Commodity haulage, farm-gate collection, warehouse and port transfers, and logistics coordination in Ghana by BAJOGO ENTERPRISE.',
  },
  {
    key: 'gallery.page',
    title: 'Gallery',
    summary: 'A closer look at the commodities we trade, from the farm to the bag.',
    body: 'Browse by commodity, or open any photograph to see it full size. Photographs of our operations are added as they are approved.',
    image: 'gallery-cocoa-1',
    metaTitle: 'Gallery | BAJOGO ENTERPRISE',
    metaDescription: 'Photographs of cashew, soybeans, shea, cassava, cocoa and ginger, the commodities BAJOGO ENTERPRISE trades.',
  },
  {
    key: 'careers.page',
    title: 'Careers',
    summary: 'Build your career in a growing Ghanaian business that spans agriculture, gold and logistics.',
    body: 'BAJOGO ENTERPRISE employs people in commodity buying and quality control, warehousing, transport and logistics, finance and accounts, administration, and human resources. We look for people who are honest, careful and dependable, and who take pride in doing the job properly.\n\nOpen positions are listed below. Each listing explains the role, the requirements, and how to apply. Applications are handled confidentially by our human resources team.',
    content: {
      noVacancies: 'There are no open positions at the moment. New vacancies are posted on this page as soon as they are approved, so please check back.',
    },
    metaTitle: 'Careers | BAJOGO ENTERPRISE',
    metaDescription: 'Job vacancies at BAJOGO ENTERPRISE in commodities, logistics, finance and administration.',
  },
  {
    key: 'contact.page',
    title: 'Contact Us',
    summary: 'Whether you want to buy, sell, move goods or join our team, we will direct your message to the right people.',
    body: 'Use the form to send us a message. Choose the category that fits your enquiry so it reaches the right team, and include as much detail as you can: the commodity or service, the quantity, the location, and your timing.\n\nFor safety, never send passwords, bank details or payment information through this form. BAJOGO ENTERPRISE will never ask for them by email.',
    content: {
      response: 'Enquiries are read by our staff during business days. We reply by email or telephone using the details you provide.',
    },
    metaTitle: 'Contact Us | BAJOGO ENTERPRISE',
    metaDescription: 'Contact BAJOGO ENTERPRISE about agricultural commodities, gold, haulage and logistics, supply partnerships or careers.',
  },
  {
    key: 'legal.privacy',
    title: 'Privacy Policy',
    summary: 'How BAJOGO ENTERPRISE collects, uses and protects the information you give us through this website.',
    body: 'BAJOGO ENTERPRISE respects your privacy and handles personal information in line with Ghana’s Data Protection Act, 2012 (Act 843).\n\nWhat we collect. When you send an enquiry we collect your name, company, email address, telephone number and message. When you apply for a job we collect your name, contact details, covering note and any CV you attach. We do not use advertising trackers on this website.\n\nHow we use it. We use enquiry details only to reply to you and to handle the business you have asked about. We use application details only to assess your application and to contact you about it.\n\nWho can see it. Enquiries are available to authorised staff who deal with them. Job applications are available only to authorised human resources staff. We do not sell your information or share it with third parties for marketing.\n\nHow long we keep it. We keep enquiries and applications for as long as they are needed for the purpose they were sent, and for any period the law requires.\n\nYour rights. You may ask to see the personal information we hold about you, to have it corrected, or to have it deleted where the law allows. Send that request through the contact page.\n\nSecurity. Information is stored in the company’s business system, which is protected by access controls and audit records. Please do not send passwords, bank details or payment information through this website.',
    metaTitle: 'Privacy Policy | BAJOGO ENTERPRISE',
    metaDescription: 'How BAJOGO ENTERPRISE handles personal information from website enquiries and job applications.',
  },
  {
    key: 'legal.terms',
    title: 'Terms of Service',
    summary: 'The terms that apply when you use the BAJOGO ENTERPRISE website.',
    body: 'About this website. This website is operated by BAJOGO ENTERPRISE, a company in Ghana. By using it you accept these terms.\n\nInformation on this site. We describe our products and services in good faith. Commodity parameters are the ranges commonly specified in the trade and are given for guidance. Specification, grade, packaging, quantity, price and delivery terms apply only when they are confirmed in a written contract.\n\nRegulated activities. Gold-related and cocoa-related activities are carried out only within the licences and channels the company holds. Nothing on this website is an offer to carry out a regulated activity outside them.\n\nEnquiries and applications. Sending an enquiry or a job application does not create a contract or an offer of employment.\n\nIntellectual property. The BAJOGO ENTERPRISE name, logo and website content belong to the company, except where another source is credited. Do not copy them for commercial use without written permission.\n\nLiability. We take care to keep this website accurate and available, but we do not guarantee that it is free from errors or interruption. We are not liable for losses arising from reliance on the website alone.\n\nGoverning law. These terms are governed by the laws of the Republic of Ghana.',
    metaTitle: 'Terms of Service | BAJOGO ENTERPRISE',
    metaDescription: 'Terms for the use of the BAJOGO ENTERPRISE website.',
  },
];

export const items: ItemText[] = [
  // Business areas
  { type: 'division', title: 'AGRICULTURAL COMMODITIES', summary: 'Cashew, soybeans, shea, cassava, cocoa and ginger, sourced from Ghanaian producers, graded and supplied on agreed terms.', body: '/commodities', image: 'division-agriculture' },
  { type: 'division', title: 'GOLD BUYING', summary: 'Gold buying within our licence, with identified sellers, lawful origin, open assay and full records.', body: '/gold-buying', image: 'division-gold' },
  { type: 'division', title: 'HAULAGE & LOGISTICS', summary: 'Documented transport for produce and general cargo, from farm gate to warehouse, factory or port.', body: '/haulage', image: 'division-haulage' },

  // Home: why choose us
  { type: 'strength', title: 'Quality you can verify', summary: 'Every lot is weighed, inspected and graded against the agreed specification before it is stored or shipped.' },
  { type: 'strength', title: 'Sourcing, storage and transport in one company', summary: 'One accountable partner from the farm gate to your door, without a chain of intermediaries.' },
  { type: 'strength', title: 'Written terms, every time', summary: 'Specification, quantity, price and delivery are confirmed in writing before goods move.' },
  { type: 'strength', title: 'Records behind every transaction', summary: 'Purchases, stock, transport and payments are recorded in our business system and approved by the right people.' },
  { type: 'strength', title: 'Compliance first', summary: 'Regulated activities such as gold and cocoa are handled only within the licences and channels the company holds.' },
  { type: 'strength', title: 'Fair to farmers and suppliers', summary: 'Clear quality standards, honest weights and prompt payment build supply relationships that last.' },

  // Values
  { type: 'value', title: 'Integrity', summary: 'We deal honestly, keep accurate records, and say no to business that does not meet our standards.' },
  { type: 'value', title: 'Quality', summary: 'We handle every commodity with care and deliver what was agreed.' },
  { type: 'value', title: 'Reliability', summary: 'We keep our commitments on quantity, timing and price.' },
  { type: 'value', title: 'Respect', summary: 'We treat customers, suppliers, employees and communities fairly.' },
  { type: 'value', title: 'Compliance', summary: 'We work within the law and within the licences we hold.' },
  { type: 'value', title: 'Safety', summary: 'We protect our people, our cargo and the public on every journey.' },

  // Commodities: how we work
  { type: 'service', groupKey: 'commodities-process', title: 'Sourcing', summary: 'We buy from farmers, farmer groups and aggregators in the main growing regions during each crop’s season.' },
  { type: 'service', groupKey: 'commodities-process', title: 'Inspection and grading', summary: 'Each lot is weighed and checked for moisture, cleanliness and defects, then graded against the buyer’s specification.' },
  { type: 'service', groupKey: 'commodities-process', title: 'Storage', summary: 'Produce is bagged, labelled and stored off the ground in dry, ventilated conditions, with stock recorded by lot.' },
  { type: 'service', groupKey: 'commodities-process', title: 'Delivery', summary: 'We load, document and deliver to the buyer’s warehouse, factory or port, with a signed proof of delivery.' },

  // Haulage services and process
  { type: 'service', groupKey: 'haulage', title: 'Commodity haulage', summary: 'Transport of bagged and bulk agricultural produce between farming areas, warehouses and processing plants.' },
  { type: 'service', groupKey: 'haulage', title: 'Farm-gate collection', summary: 'Collection from aggregation points and farming communities, coordinated with the supplier’s harvest and bagging.' },
  { type: 'service', groupKey: 'haulage', title: 'Warehouse and port transfers', summary: 'Movement of goods between warehouses, factories and the ports of Tema and Takoradi, by agreement.' },
  { type: 'service', groupKey: 'haulage', title: 'Logistics coordination', summary: 'Planning of loading, routing, documentation and hand-over so each consignment arrives as agreed.' },
  { type: 'service', groupKey: 'haulage-process', title: 'Request', summary: 'Tell us the cargo, quantity, pickup and delivery points, and your dates.' },
  { type: 'service', groupKey: 'haulage-process', title: 'Quote and agreement', summary: 'We confirm vehicle, route, schedule and rate in writing.' },
  { type: 'service', groupKey: 'haulage-process', title: 'Loading and documents', summary: 'Goods are counted, loaded securely and documented before departure.' },
  { type: 'service', groupKey: 'haulage-process', title: 'Transit updates', summary: 'We keep you informed while your cargo is on the road.' },
  { type: 'service', groupKey: 'haulage-process', title: 'Delivery and sign-off', summary: 'The receiver checks and signs for the goods, and you receive proof of delivery.' },

  // Gold standards and process
  { type: 'service', groupKey: 'gold-standard', title: 'Licensed activity only', summary: 'We buy gold only within the scope of the licence the company holds.' },
  { type: 'service', groupKey: 'gold-standard', title: 'Know your seller', summary: 'Every seller is identified, and their documents are checked and kept on record.' },
  { type: 'service', groupKey: 'gold-standard', title: 'Lawful origin', summary: 'Sellers must show that their gold was lawfully produced. We do not buy from illegal mining.' },
  { type: 'service', groupKey: 'gold-standard', title: 'Open weighing and assay', summary: 'Weight and purity are measured in the seller’s presence, and the results are recorded.' },
  { type: 'service', groupKey: 'gold-standard', title: 'Traceable payment', summary: 'Payments are made through traceable channels and matched to a written record of the transaction.' },
  { type: 'service', groupKey: 'gold-process', title: 'Enquiry', summary: 'Contact us with the nature and approximate size of the transaction.' },
  { type: 'service', groupKey: 'gold-process', title: 'Verification', summary: 'We confirm the seller’s identity and the documents showing lawful origin.' },
  { type: 'service', groupKey: 'gold-process', title: 'Assay and valuation', summary: 'The gold is weighed and assayed, and a price is agreed on the result.' },
  { type: 'service', groupKey: 'gold-process', title: 'Settlement and records', summary: 'Payment is made through a traceable channel, and the transaction is recorded in full.' },

  // Careers
  { type: 'service', groupKey: 'careers-benefit', title: 'Work that matters', summary: 'Help move Ghanaian produce to market and support the farming communities behind it.' },
  { type: 'service', groupKey: 'careers-benefit', title: 'Learn across industries', summary: 'Gain experience in agriculture, trade, logistics and finance within one company.' },
  { type: 'service', groupKey: 'careers-benefit', title: 'Safety and respect', summary: 'A workplace where safety comes first and everyone is treated fairly.' },
  { type: 'service', groupKey: 'careers-benefit', title: 'Clear processes', summary: 'Modern systems and clear approvals, so you know what is expected and how to get things done.' },
  { type: 'service', groupKey: 'careers-process', title: 'Apply online', summary: 'Choose an open position and send your application and CV through this website.' },
  { type: 'service', groupKey: 'careers-process', title: 'Review', summary: 'Our human resources team reviews every application against the role requirements.' },
  { type: 'service', groupKey: 'careers-process', title: 'Interview', summary: 'Shortlisted candidates are invited to an interview with the hiring manager.' },
  { type: 'service', groupKey: 'careers-process', title: 'Checks and offer', summary: 'We complete reference and document checks, then make a written offer.' },

  // Contact topics
  { type: 'service', groupKey: 'contact-topic', title: 'Buying commodities', summary: 'Specifications, quantities, prices and delivery for cashew, soybeans, shea, cassava, cocoa or ginger.' },
  { type: 'service', groupKey: 'contact-topic', title: 'Supplying produce', summary: 'Farmers, farmer groups and aggregators who want to sell to us.' },
  { type: 'service', groupKey: 'contact-topic', title: 'Haulage and logistics', summary: 'Quotes and bookings for transport of produce and general cargo.' },
  { type: 'service', groupKey: 'contact-topic', title: 'Gold', summary: 'Transactions within the company’s licence.' },
  { type: 'service', groupKey: 'contact-topic', title: 'Careers', summary: 'Questions about open positions. Apply through the Careers page.' },
];

export const products: ProductText[] = [
  {
    slug: 'cashew-nuts',
    name: 'Cashew Nuts',
    category: 'cashew',
    image: 'product-cashew-nuts',
    summary: 'Raw cashew nuts from Ghana’s cashew belt, dried, cleaned and graded for processors and exporters.',
    description: 'Ghana produces raw cashew nuts across its middle and northern belt, with the main harvest from February to May. BAJOGO ENTERPRISE buys in-shell raw cashew nuts (RCN) from farmers and aggregators during the season, dries and cleans them, and grades each lot before storage.\n\nWe supply processors and exporters who need consistent nut size, good kernel outturn and low moisture. Each lot can be sampled and tested before contract.',
    specifications: 'Parameters buyers commonly specify for raw cashew nuts:\n• Kernel outturn (KOR): typically 46–50 lbs per 80 kg bag\n• Nut count: typically 170–210 nuts per kg\n• Moisture: 10% maximum\n• Defective nuts: agreed per contract\n• Foreign matter: 1% maximum\nFinal specification is confirmed in each contract.',
    gradeInformation: 'Lots are graded on outturn, nut count, moisture and defects after a cutting test on a representative sample. Results are shared with the buyer before shipment.',
    packaging: '80 kg jute bags, or other packaging by agreement. Delivered by truck to the buyer’s warehouse or port.',
    metaDescription: 'Raw cashew nuts from Ghana, graded on outturn, nut count and moisture, supplied by BAJOGO ENTERPRISE.',
  },
  {
    slug: 'soybeans',
    name: 'Soybeans',
    category: 'soybean',
    image: 'product-soybeans',
    summary: 'Clean, dry soybeans from northern Ghana for feed millers, oil processors and food manufacturers.',
    description: 'Soybeans are grown mainly in Ghana’s Northern, Upper West and Upper East regions and harvested from October to December. BAJOGO ENTERPRISE buys from farmers and aggregators, cleans and dries the grain, and stores it by lot.\n\nOur soybeans suit poultry and livestock feed milling, oil extraction, and food processing.',
    specifications: 'Parameters buyers commonly specify for soybeans:\n• Moisture: 13% maximum\n• Foreign matter: 2% maximum\n• Split and broken beans: agreed per contract\n• Damaged and discoloured beans: agreed per contract\n• Free from live insects\nFinal specification is confirmed in each contract.',
    gradeInformation: 'Lots are checked for moisture, foreign matter and damaged beans on a representative sample. Grain is cleaned to the agreed standard before bagging.',
    packaging: '50 kg polypropylene bags, or bulk by agreement.',
    metaDescription: 'Clean, dry soybeans from northern Ghana for feed, oil and food processing, supplied by BAJOGO ENTERPRISE.',
  },
  {
    slug: 'shea-nuts',
    name: 'Shea Nuts',
    category: 'shea',
    image: 'product-shea-nuts',
    summary: 'Dried shea kernels from Ghana’s northern savannah for shea butter and cosmetics producers.',
    description: 'Shea trees grow wild across the savannah of northern Ghana. The nuts are collected, largely by women’s groups, from about May to August, then boiled and dried to produce shea kernels. BAJOGO ENTERPRISE buys dried kernels from collectors and aggregators and checks them before storage.\n\nShea kernels are processed into shea butter for the food, confectionery and cosmetics industries.',
    specifications: 'Parameters buyers commonly specify for shea kernels:\n• Moisture: 7% maximum\n• Free fatty acid (FFA): agreed per contract, typically up to 6%\n• Fat content: typically 45% or more\n• Foreign matter: 1% maximum\n• Mouldy, germinated or broken kernels: agreed per contract\nFinal specification is confirmed in each contract.',
    gradeInformation: 'Kernels are checked for moisture, foreign matter and defects. Laboratory results for FFA and fat content can be arranged on request.',
    packaging: '85 kg jute bags or 50 kg polypropylene bags, by agreement.',
    metaDescription: 'Dried shea kernels from northern Ghana for shea butter production, supplied by BAJOGO ENTERPRISE.',
  },
  {
    slug: 'powdered-cassava',
    name: 'Powdered Cassava',
    category: 'cassava',
    image: 'product-powdered-cassava',
    summary: 'Cassava flour milled from fresh roots, for bakeries, food manufacturers and industrial users.',
    description: 'Cassava is one of Ghana’s most widely grown crops. Powdered cassava, or cassava flour, is made by peeling, washing, grating, pressing, drying and milling fresh roots within a short time of harvest, which keeps the flour white and clean-tasting.\n\nBAJOGO ENTERPRISE supplies cassava flour for baking and confectionery, food processing, and industrial uses such as adhesives and starch applications.',
    specifications: 'Parameters buyers commonly specify for cassava flour:\n• Moisture: 12% maximum\n• Colour: white to off-white\n• Particle size: fine, agreed per contract\n• Ash content: agreed per contract\n• Free from foreign matter and off-odours\nFinal specification is confirmed in each contract.',
    gradeInformation: 'Batches are checked for moisture, colour, fineness and cleanliness before bagging.',
    packaging: '25 kg or 50 kg bags, by agreement.',
    metaDescription: 'Cassava flour milled from fresh Ghanaian cassava for food and industrial use, supplied by BAJOGO ENTERPRISE.',
  },
  {
    slug: 'cocoa-beans',
    name: 'Cocoa Beans',
    category: 'cocoa',
    image: 'product-cocoa-beans',
    summary: 'Cocoa handled only through Ghana’s regulated cocoa marketing channel.',
    description: 'Ghana is one of the world’s leading producers of high-quality cocoa. The purchase, grading and export of cocoa beans in Ghana is regulated by the Ghana Cocoa Board (COCOBOD), and beans are graded and sealed under its quality control system.\n\nBAJOGO ENTERPRISE takes part in the cocoa trade only through the channels and registrations the company holds. Please contact us to discuss what we can offer.',
    specifications: 'Cocoa beans in Ghana are graded under COCOBOD quality control standards, covering moisture, bean count, mouldy, slaty and insect-damaged beans. Specifications apply as set by the regulator.',
    gradeInformation: 'Grades are those assigned under the Ghana Cocoa Board quality control system.',
    packaging: 'As required by the regulated marketing channel.',
    metaDescription: 'Cocoa handled by BAJOGO ENTERPRISE through Ghana’s regulated cocoa marketing channel.',
  },
  {
    slug: 'ginger',
    name: 'Ginger',
    category: 'ginger',
    image: 'product-ginger',
    summary: 'Fresh and dried ginger for spice, beverage and food processors.',
    description: 'Ginger is valued for its strong aroma and pungency and is used in spices, beverages, food processing and extraction. BAJOGO ENTERPRISE buys ginger from farmers and aggregators and supplies it fresh or dried, depending on the buyer’s needs.\n\nDried ginger is washed, sliced or split, and sun- or machine-dried to a low moisture level for storage and transport.',
    specifications: 'Parameters buyers commonly specify for dried ginger:\n• Moisture: 10% maximum\n• Form: whole, split or sliced, by agreement\n• Foreign matter: 1% maximum\n• Free from mould and insect damage\nFor fresh ginger: firm, clean rhizomes, free from rot and sprouting.\nFinal specification is confirmed in each contract.',
    gradeInformation: 'Lots are checked for moisture, cleanliness, mould and insect damage before bagging.',
    packaging: 'Dried ginger in 25 kg or 50 kg bags; fresh ginger in ventilated bags or crates, by agreement.',
    metaDescription: 'Fresh and dried ginger supplied by BAJOGO ENTERPRISE for spice, beverage and food processors.',
  },
];

export const launchArticle = {
  slug: 'bajogo-enterprise-launches-new-website',
  title: 'BAJOGO ENTERPRISE launches its new website',
  summary: 'Customers, suppliers and job seekers can now explore our commodities, haulage services and vacancies, and contact the right team online.',
  body: 'BAJOGO ENTERPRISE has launched its new company website, bringing information about all three of its businesses together in one place.\n\nVisitors can browse the agricultural commodities we supply, with the parameters buyers commonly specify for each one, learn how our haulage and logistics service works, and read about the standards we apply to gold transactions.\n\nEnquiries sent through the website go directly into the company’s business system, so they reach the right team quickly. Job seekers can view open positions on the Careers page and apply online, with their applications handled confidentially by human resources.\n\nWe will use this page to share company news and updates.',
  category: 'company',
  image: 'hero',
};
