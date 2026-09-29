'use client'

import React, { useState } from 'react';
import { LayoutDashboard, Users, ClipboardCheck, UserCog, LogOut, ShieldCheck, Target, TrendingUp, Menu, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { logout } from '@/app/actions/auth-actions';
import type { PermissionSet, UserProfile } from '@/types';

interface SidebarProps {
  user: UserProfile;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  permissions: PermissionSet;
  pendingUsersCount: number;
  pendingApprovalsCount: number;
}

export default function Sidebar({ 
  user, 
  sidebarOpen, 
  setSidebarOpen,
  permissions,
  pendingUsersCount,
  pendingApprovalsCount
}: SidebarProps) {
  const isAdmin = user?.role === 'admin' || user?.role === 'lord';
  const [hoveredLabel, setHoveredLabel] = useState<{label: string, top: number} | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  const handleNavClick = (path: string) => {
    router.push(path);
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  };

  const handleMouseEnter = (e: React.MouseEvent, label: string) => {
    if (sidebarOpen || (typeof window !== 'undefined' && window.innerWidth < 768)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setHoveredLabel({ label, top: rect.top + rect.height / 2 });
  };

  const handleMouseLeave = () => {
    setHoveredLabel(null);
  };

  const isActive = (path: string) => {
    if (path === '/') return pathname === '/';
    return pathname?.startsWith(path);
  };

  const handleLogout = async () => {
    await logout();
    router.refresh();
  };

  return (
    <>
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm z-[40] md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={cn(
        "bg-slate-950 text-white flex flex-col transition-all duration-300 ease-in-out z-[50] overflow-hidden whitespace-nowrap shadow-2xl shrink-0 fixed md:relative top-0 left-0 bottom-0 border-r border-slate-800",
        sidebarOpen 
          ? "translate-x-0 w-[250px]" 
          : "-translate-x-full md:translate-x-0 md:w-[84px]"
      )}>
        {/* Header */}
        <div className="h-20 flex items-center px-5 relative justify-between bg-slate-950/50 backdrop-blur-xl border-b border-slate-800/50">
          <div className={cn("flex items-center gap-3 transition-opacity duration-300 cursor-pointer group", sidebarOpen ? "opacity-100" : "opacity-0 w-0 hidden")}>
             <img src="/logo-crm-tnt.png" alt="Logo" className="w-10 h-10 object-contain drop-shadow-lg group-hover:scale-110 transition-transform duration-300" />
             <div className="flex flex-col">
               <h2 className="text-xl font-black tracking-tighter text-white">CoreDesk</h2>
               <span className="text-[9px] font-black text-indigo-400 uppercase tracking-[0.2em] -mt-1">Sales TNT</span>
             </div>
          </div>
          <button 
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className={cn("text-slate-400 hover:text-white flex items-center justify-center transition-all cursor-pointer h-12 rounded-xl group", !sidebarOpen ? "w-full" : "w-10 ml-auto")}
          >
            <Menu className={cn("w-6 h-6 transition-transform group-hover:scale-110", sidebarOpen && "w-5 h-5")} />
          </button>
        </div>

        {/* Global Tooltip for collapsed mode */}
        {!sidebarOpen && hoveredLabel && (
          <div 
            className="fixed left-[98px] px-3 py-1.5 bg-slate-800 border border-slate-700 text-slate-100 text-sm font-bold rounded-lg opacity-100 visible whitespace-nowrap z-[1000] shadow-xl pointer-events-none transition-all duration-300 ease-in-out animate-in slide-in-from-left-2"
            style={{ top: hoveredLabel.top, transform: 'translateY(-50%)' }}
          >
            {hoveredLabel.label}
            <div className="absolute top-1/2 -left-1.5 -translate-y-1/2 w-3 h-3 bg-slate-800 border-l border-b border-slate-700 rotate-45 rounded-sm"></div>
          </div>
        )}

        {/* Search */}
        <div className="px-4 mb-4 mt-6">
          <div 
             className={cn(
               "flex items-center gap-4 bg-slate-900/50 border border-slate-800 rounded-2xl transition-all h-[50px] relative group",
               sidebarOpen ? "px-4 cursor-text" : "px-0 justify-center cursor-pointer hover:bg-slate-800/80"
             )}
             onMouseEnter={(e) => handleMouseEnter(e, "Search")}
             onMouseLeave={handleMouseLeave}
          >
            <Search className="w-5 h-5 text-slate-400 shrink-0 group-hover:text-slate-300 transition-colors" />
            <input 
               type="text" 
               placeholder="Search..." 
               className={cn(
                 "bg-transparent outline-none border-none text-white h-full w-full text-sm font-medium placeholder:text-slate-500", 
                 !sidebarOpen && "hidden"
               )}
            />
          </div>
        </div>

        {/* Navigation Layer */}
        <nav className="flex-1 px-4 space-y-1.5 overflow-y-auto overflow-x-hidden custom-scrollbar pb-6">
          <NavItem 
            active={isActive('/')} 
            onClick={() => handleNavClick('/')} 
            icon={<LayoutDashboard className="w-5 h-5" />} 
            label="Executive Dashboard" 
            sidebarOpen={sidebarOpen}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          />

          <NavItem 
            active={isActive('/leads') || isActive('/lead')} 
            onClick={() => handleNavClick('/leads')} 
            icon={<Users className="w-5 h-5" />} 
            label="Leads Database" 
            sidebarOpen={sidebarOpen}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          />

          <NavItem 
            active={isActive('/oi_forecast')} 
            onClick={() => handleNavClick('/oi_forecast')} 
            icon={<TrendingUp className="w-5 h-5" />} 
            label="OI Forecast" 
            sidebarOpen={sidebarOpen}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          />

          <NavItem 
            active={isActive('/tasks')} 
            onClick={() => handleNavClick('/tasks')} 
            icon={<ClipboardCheck className="w-5 h-5" />} 
            label="Sales Tasks" 
            sidebarOpen={sidebarOpen}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          />

          {isAdmin && (
            <>
              <div className="pt-6 pb-2">
                 {sidebarOpen ? (
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] px-3">Administration</p>
                 ) : (
                    <div className="w-6 h-[2px] bg-slate-800 rounded-full mx-auto"></div>
                 )}
              </div>
              
              <NavItem 
                active={isActive('/admin/approvals')} 
                onClick={() => handleNavClick('/admin/approvals')} 
                icon={<ClipboardCheck className="w-5 h-5" />} 
                label="Edit Approvals" 
                sidebarOpen={sidebarOpen} 
                badge={pendingApprovalsCount > 0 ? pendingApprovalsCount : undefined}
                badgeColor="bg-indigo-500"
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
              />

              <NavItem 
                active={isActive('/admin/users')} 
                onClick={() => handleNavClick('/admin/users')} 
                icon={<UserCog className="w-5 h-5" />} 
                label="User Management" 
                sidebarOpen={sidebarOpen} 
                badge={pendingUsersCount > 0 ? pendingUsersCount : undefined}
                badgeColor="bg-amber-500"
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
              />

              <NavItem 
                active={isActive('/admin/targets')} 
                onClick={() => handleNavClick('/admin/targets')} 
                icon={<Target className="w-5 h-5" />} 
                label="Set Targets" 
                sidebarOpen={sidebarOpen}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
              />

              {user?.role === 'lord' && (
                <NavItem 
                  active={isActive('/permissions')} 
                  onClick={() => handleNavClick('/permissions')} 
                  icon={<ShieldCheck className="w-5 h-5" />} 
                  label="Role Permissions" 
                  sidebarOpen={sidebarOpen}
                  onMouseEnter={handleMouseEnter}
                  onMouseLeave={handleMouseLeave}
                />
              )}
            </>
          )}
        </nav>

        {/* Profile Section */}
        <div className={cn(
          "bg-slate-900/50 border-t border-slate-800/50 mt-auto transition-all py-4 px-4 flex items-center relative gap-4", 
          !sidebarOpen && "justify-center px-0"
        )}>
          {sidebarOpen ? (
            <>
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-black shadow-xl shrink-0 border border-indigo-400/20">
                {user?.name?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <p className="text-sm font-black text-white truncate">{user?.name || 'User'}</p>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest truncate">
                   {user?.role === 'lord' ? 'The Lord' : user?.role === 'admin' ? 'Super Admin' : 'Sales Associate'}
                </p>
              </div>
              <button 
                 onClick={handleLogout}
                 className="text-slate-400 transition-all hover:text-red-400 p-2 shrink-0 group rounded-xl hover:bg-red-500/10 border border-transparent hover:border-red-500/20"
                 title="Logout"
              >
                 <LogOut className="w-4 h-4 transition-transform group-hover:scale-110" />
              </button>
            </>
          ) : (
            <button 
               onClick={handleLogout}
               className="group w-full h-10 flex items-center justify-center relative cursor-pointer text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all"
               onMouseEnter={(e) => handleMouseEnter(e, "Logout")}
               onMouseLeave={handleMouseLeave}
            >
              <LogOut className="w-5 h-5 transition-transform group-hover:scale-110" />
            </button>
          )}
        </div>
      </aside>
    </>
  );
}

function NavItem({ active, onClick, icon, label, sidebarOpen, badge, badgeColor = "bg-indigo-500", onMouseEnter, onMouseLeave }: any) {
  return (
    <button 
      onClick={onClick}
      onMouseEnter={(e) => onMouseEnter(e, label)}
      onMouseLeave={onMouseLeave}
      className={cn(
        "w-full flex items-center relative rounded-2xl transition-all duration-300 group h-[50px] overflow-hidden",
        active 
          ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20" 
          : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
      )}
    >
      <div className={cn(
        "h-full flex items-center justify-center shrink-0 transition-all duration-300",
        sidebarOpen ? "w-[50px]" : "w-full mx-auto"
      )}>
        <div className={cn("transition-transform duration-300", active ? "scale-110" : "group-hover:scale-110")}>
           {icon}
        </div>
      </div>
      
      <span className={cn(
        "text-sm font-bold whitespace-nowrap transition-all flex-1 text-left",
        sidebarOpen ? "opacity-100" : "opacity-0 w-0 hidden pointer-events-none",
        active ? "translate-x-1" : "group-hover:translate-x-1"
      )}>
        {label}
      </span>

      {badge && (
        <span className={cn(
          "text-[10px] font-black text-white px-2 py-0.5 rounded-full absolute shadow-sm z-10 transition-all duration-300",
          badgeColor,
          sidebarOpen ? "right-4" : "top-2 right-2 scale-75"
        )}>
          {badge}
        </span>
      )}
    </button>
  );
}
