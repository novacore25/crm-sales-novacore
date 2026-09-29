import { notFound, redirect } from 'next/navigation';

import LeadDetailClient from '@/components/LeadDetailClient';
import { getLeadById } from '@/app/actions/lead-actions';
import { getLeadOptions, getPendingEditRequestsForLead, getTasks } from '@/app/actions/task-actions';
import { getUsers } from '@/app/actions/user-actions';
import { requireUser } from '@/lib/auth';

/**
 * Lead detail: funnel history, notes, tasks.
 *
 * The legacy page rendered `JSON.stringify(error)` and the signed-in user's
 * email into the not-found state. Supabase/PostgREST error payloads leak table
 * and constraint names, and the route was reachable by guessing ids. This
 * version returns a plain 404 with no internals.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lead = await getLeadById(id);
  return { title: lead ? `${lead.brandName} - CoreDesk` : 'Lead tidak ditemukan' };
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();

  const [lead, allTasks, users, leadOptions, approvals] = await Promise.all([
    getLeadById(id),
    getTasks(),
    getUsers(),
    getLeadOptions(),
    getPendingEditRequestsForLead(id),
  ]);

  if (!lead) notFound();

  // A lead that is in the trash should not be reachable from the normal
  // navigation; /leads has a dedicated tab for it.
  if (lead.isDeleted) {
    redirect('/leads?view=trash');
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <LeadDetailClient
        lead={lead}
        allTasks={allTasks.filter((t: { leadId: string | null }) => t.leadId === id)}
        user={user}
        users={users}
        leadOptions={leadOptions}
        approvals={approvals}
      />
    </div>
  );
}
