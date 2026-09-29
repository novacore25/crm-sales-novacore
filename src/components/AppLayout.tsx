'use client';

import { useState } from 'react';
import { Toaster } from 'sonner';

import Sidebar from './Sidebar';
import type { UserProfile } from '@/types';

export default function AppLayout({
  children,
  user,
  pendingUsersCount = 0,
}: {
  children: React.ReactNode;
  user?: UserProfile;
  pendingUsersCount?: number;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      {user && (
        <Sidebar
          user={user}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          permissions={user.permissions}
          pendingUsersCount={pendingUsersCount}
          pendingApprovalsCount={0}
        />
      )}

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <div className="flex-1 overflow-y-auto overflow-x-hidden relative custom-scrollbar">
          {children}
        </div>
      </main>

      <Toaster position="top-right" richColors />
    </div>
  );
}
