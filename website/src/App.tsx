import { useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { api } from './api';
import { AboutPage, ArticlePage, CareersPage, CommoditiesPage, ContactPage, GalleryPage, HomePage, JobPage, LegalPage, NewsPage, NotFoundPage, ProductPage, StoryPage } from './pages';
import { SiteFrame } from './Site';
import type { Bootstrap } from './types';

export function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<{ data: Bootstrap }>('/v1/public/website/bootstrap')
      .then((payload) => setBoot(payload.data))
      .catch(() => setError('The website could not reach the BAJOGO ERP. Start the API, then refresh this page.'));
  }, []);
  if (error) return <p className="grid min-h-screen place-items-center px-6 text-center text-sm">{error}</p>;
  if (!boot) return <p className="grid min-h-screen place-items-center text-sm text-ink/60">Loading BAJOGO ENTERPRISE…</p>;
  return (
    <SiteFrame boot={boot}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/commodities" element={<CommoditiesPage />} />
        <Route path="/commodities/:slug" element={<ProductPage />} />
        <Route path="/gold-buying" element={<StoryPage pageKey="gold.page" pathEnquiry="gold" />} />
        <Route path="/haulage" element={<StoryPage pageKey="haulage.page" pathEnquiry="haulage" />} />
        <Route path="/news" element={<NewsPage />} />
        <Route path="/news/:slug" element={<ArticlePage />} />
        <Route path="/gallery" element={<GalleryPage />} />
        <Route path="/careers" element={<CareersPage />} />
        <Route path="/careers/:slug" element={<JobPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/privacy" element={<LegalPage pageKey="legal.privacy" />} />
        <Route path="/terms" element={<LegalPage pageKey="legal.terms" />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </SiteFrame>
  );
}
