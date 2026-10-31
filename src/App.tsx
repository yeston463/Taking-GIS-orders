/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar.tsx';
import { Footer } from './components/Footer.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { ServicesPage } from './pages/ServicesPage.tsx';
import { CasesPage } from './pages/CasesPage.tsx';
import { InquiryPage } from './pages/InquiryPage.tsx';
import { LookupPage } from './pages/LookupPage.tsx';
import { PrivacyPage } from './pages/PrivacyPage.tsx';
import { AdminPage } from './pages/AdminPage.tsx';
import { ServiceType } from './utils/order-utils.ts';

export default function App() {
  const [currentTab, setCurrentTab] = useState<string>('home');
  const [selectedService, setSelectedService] = useState<ServiceType | undefined>(undefined);
  // In-memory state only — queryToken is NEVER placed in URL query strings or hashes
  const [lookupPrefill, setLookupPrefill] = useState<{ orderNumber: string; queryToken: string }>({
    orderNumber: '',
    queryToken: '',
  });

  // Read initial route from URL hash if available
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace('#', '').trim();
      if (['home', 'services', 'cases', 'inquiry', 'lookup', 'privacy', 'admin'].includes(hash)) {
        setCurrentTab(hash);
      }
    };

    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const handleTabChange = (tab: string, serviceParam?: string) => {
    setCurrentTab(tab);
    window.location.hash = tab;
    if (serviceParam) {
      setSelectedService(serviceParam as ServiceType);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSelectServiceFromCard = (service: ServiceType) => {
    setSelectedService(service);
    setCurrentTab('inquiry');
    window.location.hash = 'inquiry';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleGoToLookup = (orderNumber: string, queryToken: string) => {
    setLookupPrefill({
      orderNumber,
      queryToken,
    });
    setCurrentTab('lookup');
    window.location.hash = 'lookup';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-800 font-sans">
      <Navbar currentTab={currentTab} onTabChange={handleTabChange} />

      <main className="flex-1">
        {currentTab === 'home' && <HomePage onTabChange={handleTabChange} />}
        {currentTab === 'services' && (
          <ServicesPage onSelectService={handleSelectServiceFromCard} />
        )}
        {currentTab === 'cases' && <CasesPage onSelectService={handleSelectServiceFromCard} />}
        {currentTab === 'inquiry' && (
          <InquiryPage
            initialService={selectedService}
            onGoToLookup={handleGoToLookup}
          />
        )}
        {currentTab === 'lookup' && (
          <LookupPage
            initialOrderNumber={lookupPrefill.orderNumber}
            initialQueryToken={lookupPrefill.queryToken}
          />
        )}
        {currentTab === 'privacy' && <PrivacyPage />}
        {currentTab === 'admin' && <AdminPage />}
      </main>

      <Footer onTabChange={handleTabChange} />
    </div>
  );
}
