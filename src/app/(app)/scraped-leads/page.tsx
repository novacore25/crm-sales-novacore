import { requireUser } from '@/lib/auth';
import { getScrapedLeads } from '@/app/actions/scraped-lead-actions';
import { getUsers } from '@/app/actions/user-actions';
import { getStoredCategories } from '@/app/actions/category-actions';
import ScrapedLeadsClient from '@/components/ScrapedLeadsClient';
import { FALLBACK_CATEGORIES } from '@/types';

export const metadata = {
  title: 'Penampungan Leads | CRM Sales TNT',
};

export default async function ScrapedLeadsPage() {
  await requireUser();

  const [leads, users, storedCategories] = await Promise.all([
    getScrapedLeads({ status: 'all', limit: 1000 }),
    getUsers(),
    getStoredCategories(),
  ]);

  const categories = storedCategories.length > 0 ? storedCategories : [...FALLBACK_CATEGORIES];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <ScrapedLeadsClient
        initialLeads={leads}
        users={users}
        categories={categories}
      />
    </div>
  );
}
