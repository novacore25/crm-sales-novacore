import type { PermissionSet, Role } from '@/lib/permissions';

/**
 * Re-exported so client components can import types without pulling the
 * server-side permission helpers (and therefore `next/headers`) into the
 * client bundle.
 */
export type { PermissionSet, Role };
export type UserRole = Role;

export interface UserProfile {
  uid: string;
  id: string;
  email: string;
  name: string;
  role: Role;
  permissions: PermissionSet;
}

export type LeadStatus =
  | 'Leads'
  | 'Chated'
  | 'Responsed'
  | 'Set Meeting'
  | 'Hold'
  | 'Close Win'
  | 'Close Lost'
  | 'Failed';

export type InterestLevel = 'HOT' | 'WARM' | 'COLD' | '-';
export type ProductOffered = 'MCN' | 'TNT' | 'HYPE';

export const PRODUCTS: ProductOffered[] = ['MCN', 'TNT', 'HYPE'];

export const LEAD_SOURCES = [
  'Shopee',
  'Tokopedia',
  'TikTok Shop',
  'TikTok Partner Center',
  'Lainnya',
] as const;

export const STAGES: LeadStatus[] = [
  'Leads',
  'Chated',
  'Responsed',
  'Set Meeting',
  'Hold',
  'Close Win',
  'Close Lost',
  'Failed',
];

export const FALLBACK_CATEGORIES = ['Fashion', 'FMCG', 'Elektronik', 'Kuliner', 'Kecantikan'];

/** Row shape returned by getLeadsPage / getLeadById. */
export interface LeadDTO {
  id: string;
  dateInput: string | null;
  category: string;
  brandName: string;
  contact: string;
  leadSource: string | null;
  email: string | null;
  status: string;
  interestLevel: string;
  productOffered: string[];
  actionPlan: string | null;
  dateChated: string | null;
  dateResponsed: string | null;
  dateSetMeeting: string | null;
  dateClosed: string | null;
  dateFailed: string | null;
  dealValue: number;
  picName: string;
  isDeleted: boolean;
  deletedAt: string | null;
  autoDeleteAt: string | null;
  funnelHistory: FunnelHistoryDTO[];
  notes: NoteDTO[];
}

export interface FunnelHistoryDTO {
  id: string;
  leadId: string;
  stage: string;
  dateOccurred: string;
  byUserName: string;
  byUserId: string | null;
  note: string | null;
  assignedBy: string | null;
  dealValue: number | null;
  campaignNumber: number | null;
  createdAt: string;
}

export interface NoteDTO {
  id: string;
  leadId: string;
  text: string;
  authorId: string | null;
  authorName: string;
  isLog: boolean;
  noteType: string | null;
  createdAt: string;
}

export interface TaskDTO {
  id: string;
  title: string;
  description: string | null;
  dueDate: string;
  priority: string;
  status: string;
  assignedTo: string | null;
  assignedToName: string;
  createdBy: string | null;
  createdByName: string;
  createdAt: string;
  leadId: string | null;
  leadName: string;
}

export interface GlobalTargetDTO {
  id: string;
  monthYear: string;
  targetChat: number;
  targetMeeting: number;
  targetRevenue: number;
  updatedBy: string | null;
  updatedAt: string;
}

export interface IndividualTargetDTO {
  id: string;
  userId: string;
  userName: string;
  monthYear: string;
  targetChat: number;
  targetMeeting: number;
  targetRevenue: number;
  updatedBy: string | null;
  updatedAt: string;
}

/** One step in a lead's funnel trail, shown in the OI grid. */
export interface OIMilestoneDTO {
  stage: string;
  by: string | null;
  at: string | null;
  note: string | null;
}

export interface OIForecastDTO {
  id: string;
  leadId: string;
  brandName: string;
  monthYear: string;
  product: string;
  value: number;
  campaignNumber: number | null;
  budgetAds: number;
  budgetCreator: number;
  grossMargin: number;
  realMargin: number;
  realPayment: number;
  targetGmv: number | null;
  targetCreator: number | null;
  targetVideoAffiliate: number | null;
  targetVideoInternal: number | null;
  targetViews: number | null;
  successRate: number;
  status: string;
  tier: string;
  category: string | null;
  lastFollowUp: string | null;
  noteSales: string | null;
  dateQuotation: string | null;
  picQuotation: string | null;
  dateInvoice: string | null;
  picInvoice: string | null;
  isDeleted: boolean;
  createdAt: string;
  latestStage: string | null;
  latestPic: string | null;
  latestStageDate: string | null;
  /** Who last edited this row, and when - to the minute. */
  updatedAt: string | null;
  updatedBy: string | null;
  updatedByName: string | null;
  /** The full funnel trail for the lead behind this forecast. */
  milestones: OIMilestoneDTO[];
}

export interface OITargetDTO {
  id: string;
  monthYear: string;
  product: string;
  targetValue: number;
  updatedAt: string;
}

export interface EditRequestDTO {
  id: string;
  leadId: string;
  oldBrand: string | null;
  newBrand: string | null;
  oldContact: string | null;
  newContact: string | null;
  requestedById: string | null;
  requestedByName: string | null;
  status: string;
  createdAt: string;
}

export interface DashboardStatsDTO {
  totalLeads: number;
  totalChated: number;
  totalResponsed: number;
  totalSetMeeting: number;
  dealsWon: number;
  lostDeals: number;
  failedDeals: number;
  totalRevenue: number;
}

export interface ContributionDTO {
  adminName: string;
  totalChat: number;
  totalMeet: number;
  totalRevenue: number;
}

export interface GhostedLeadDTO {
  leadId: string;
  brandName: string;
  picName: string;
  category: string;
  status: string;
  lastStage: string | null;
  lastStageDate: string | null;
  daysPassed: number;
}

export interface AuditLogDTO {
  id: string;
  action: string;
  details: string;
  userId: string | null;
  userName: string;
  targetId: string | null;
  createdAt: string;
}

export interface LeadOption {
  id: string;
  brandName: string;
}
