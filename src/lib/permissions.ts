/**
 * Role-based permissions.
 *
 * This module is the single authority for authorization in the new stack.
 *
 * Under Supabase, Row Level Security was the only real boundary: every client
 * component talked to PostgREST with the anon key, and policies in
 * `next-crm/supabase/migrations/fix_rls.sql` were the thing standing between a
 * signed-in staff member and the whole dataset. The client-side
 * `user.role === 'lord'` checks were JSX render conditions, not protection.
 *
 * With a direct Postgres connection there is no RLS, so every mutation is a
 * server action that must call one of the `require*` guards below. Never trust a
 * role value that came from the client.
 */
import type { User } from '@/db/schema';

export type Role = User['role'];

export interface PermissionSet {
  canManageUsers: boolean;
  canSetTargets: boolean;
  canApproveEdits: boolean;
  canAssignPic: boolean;
  canDeleteLeads: boolean;
  canBulkDelete: boolean;
  canEditFunnelHistory: boolean;
  canDeleteFunnelHistory: boolean;
  canClearAllHistory: boolean;
  canDeleteNotes: boolean;
  canEditDealValue: boolean;
  canImportCsv: boolean;
}

export type RolePermissions = {
  lord: PermissionSet;
  admin: PermissionSet;
  staff: PermissionSet;
};

const DENY_ALL: PermissionSet = {
  canManageUsers: false,
  canSetTargets: false,
  canApproveEdits: false,
  canAssignPic: false,
  canDeleteLeads: false,
  canBulkDelete: false,
  canEditFunnelHistory: false,
  canDeleteFunnelHistory: false,
  canClearAllHistory: false,
  canDeleteNotes: false,
  canEditDealValue: false,
  canImportCsv: false,
};

export const ROLE_PERMISSIONS: RolePermissions = {
  // The Lord bypasses every individual permission check.
  lord: {
    canManageUsers: true,
    canSetTargets: true,
    canApproveEdits: true,
    canAssignPic: true,
    canDeleteLeads: true,
    canBulkDelete: true,
    canEditFunnelHistory: true,
    canDeleteFunnelHistory: true,
    canClearAllHistory: true,
    canDeleteNotes: true,
    canEditDealValue: true,
    canImportCsv: true,
  },
  admin: {
    canManageUsers: false,
    canSetTargets: false,
    canApproveEdits: true,
    canAssignPic: true,
    canDeleteLeads: true,
    canBulkDelete: true,
    canEditFunnelHistory: false,
    canDeleteFunnelHistory: false,
    canClearAllHistory: false,
    canDeleteNotes: false,
    canEditDealValue: true,
    canImportCsv: true,
  },
  staff: {
    canManageUsers: false,
    canSetTargets: false,
    canApproveEdits: false,
    canAssignPic: false,
    canDeleteLeads: false,
    canBulkDelete: false,
    canEditFunnelHistory: false,
    canDeleteFunnelHistory: false,
    canClearAllHistory: false,
    canDeleteNotes: false,
    canEditDealValue: false,
    canImportCsv: true,
  },
};

export function permissionsForRole(role: Role): PermissionSet {
  if (role === 'lord' || role === 'admin' || role === 'staff') {
    return ROLE_PERMISSIONS[role];
  }
  // `pending` accounts must not be able to do anything at all.
  return DENY_ALL;
}

export const PERMISSION_LABELS: Record<keyof PermissionSet, string> = {
  canManageUsers: 'Kelola Pengguna',
  canSetTargets: 'Atur Target',
  canApproveEdits: 'Setujui Edit',
  canAssignPic: 'Assign PIC',
  canDeleteLeads: 'Hapus Lead',
  canBulkDelete: 'Bulk Delete',
  canEditFunnelHistory: 'Edit Funnel History',
  canDeleteFunnelHistory: 'Hapus Funnel History',
  canClearAllHistory: 'Kosongkan Semua History',
  canDeleteNotes: 'Hapus Note',
  canEditDealValue: 'Edit Deal Value',
  canImportCsv: 'Import CSV',
};

export function isLord(role: Role): boolean {
  return role === 'lord';
}

export function isLordOrAdmin(role: Role): boolean {
  return role === 'lord' || role === 'admin';
}

export function can(role: Role, permission: keyof PermissionSet): boolean {
  return permissionsForRole(role)[permission];
}
