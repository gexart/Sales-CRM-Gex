/**
 * CRM rules shared by the API and the app: pipeline stages, win probabilities, weighted forecast,
 * support ticket priorities and their response deadlines (SLA).
 */

export const DEAL_STAGES = [
  { id: 'LEAD_IN', label: 'New', probability: 10 },
  { id: 'CONTACT_MADE', label: 'Contacted', probability: 25 },
  { id: 'DEMO_SCHEDULED', label: 'Meeting / Demo', probability: 40 },
  { id: 'PROPOSAL_SENT', label: 'Quotation sent', probability: 60 },
  { id: 'NEGOTIATION', label: 'Negotiation', probability: 80 },
  { id: 'WON', label: 'Won', probability: 100 },
  { id: 'LOST', label: 'Lost', probability: 0 },
] as const;

export type DealStage = (typeof DEAL_STAGES)[number]['id'];
export const DEAL_STAGE_IDS = DEAL_STAGES.map((s) => s.id) as [DealStage, ...DealStage[]];
export const OPEN_DEAL_STAGES: DealStage[] = ['LEAD_IN', 'CONTACT_MADE', 'DEMO_SCHEDULED', 'PROPOSAL_SENT', 'NEGOTIATION'];

export function isDealStage(v: unknown): v is DealStage {
  return typeof v === 'string' && (DEAL_STAGE_IDS as string[]).includes(v);
}

export function stageProbability(stage: DealStage): number {
  return DEAL_STAGES.find((s) => s.id === stage)?.probability ?? 0;
}

export function stageLabel(stage: string): string {
  return DEAL_STAGES.find((s) => s.id === stage)?.label ?? stage;
}

export const LEAD_SOURCES = ['WALK_IN', 'WEBSITE', 'WHATSAPP', 'META_ADS', 'INDIAMART', 'JUSTDIAL', 'REFERRAL', 'MANUAL', 'IMPORT'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];
export const LEAD_SOURCE_LABEL: Record<LeadSource, string> = {
  WALK_IN: 'Walk-in',
  WEBSITE: 'Website',
  WHATSAPP: 'WhatsApp',
  META_ADS: 'Facebook / Instagram ads',
  INDIAMART: 'IndiaMART',
  JUSTDIAL: 'Justdial',
  REFERRAL: 'Referral',
  MANUAL: 'Manual',
  IMPORT: 'Import',
};

export interface ForecastDeal {
  stage: string;
  valuePaise: number;
  probabilityPercent: number;
  expectedCloseDate?: string | null;
}

export interface ForecastMonth {
  /** YYYY-MM, or 'NO_DATE' for open deals without an expected close date */
  month: string;
  openCount: number;
  pipelinePaise: number;
  /** value × probability — what you can realistically expect */
  weightedPaise: number;
  wonPaise: number;
}

/** Weighted sales forecast by expected close month (open deals) plus won value in that month. */
export function forecastByMonth(deals: ForecastDeal[]): ForecastMonth[] {
  const map = new Map<string, ForecastMonth>();
  const bucket = (m: string) => {
    let b = map.get(m);
    if (!b) {
      b = { month: m, openCount: 0, pipelinePaise: 0, weightedPaise: 0, wonPaise: 0 };
      map.set(m, b);
    }
    return b;
  };
  for (const d of deals) {
    const month = d.expectedCloseDate && /^\d{4}-\d{2}/.test(d.expectedCloseDate) ? d.expectedCloseDate.slice(0, 7) : 'NO_DATE';
    if (d.stage === 'WON') {
      bucket(month).wonPaise += Math.trunc(d.valuePaise);
    } else if ((OPEN_DEAL_STAGES as string[]).includes(d.stage)) {
      const b = bucket(month);
      b.openCount += 1;
      b.pipelinePaise += Math.trunc(d.valuePaise);
      b.weightedPaise += Math.round((Math.trunc(d.valuePaise) * Math.min(100, Math.max(0, d.probabilityPercent))) / 100);
    }
  }
  return [...map.values()].sort((a, b) => (a.month === 'NO_DATE' ? 1 : b.month === 'NO_DATE' ? -1 : a.month.localeCompare(b.month)));
}

// ------------------------------------------------------------------ support tickets

export const TICKET_PRIORITIES = [
  { id: 'URGENT', label: 'Urgent', slaHours: 4 },
  { id: 'HIGH', label: 'High', slaHours: 24 },
  { id: 'MEDIUM', label: 'Medium', slaHours: 48 },
  { id: 'LOW', label: 'Low', slaHours: 96 },
] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number]['id'];
export const TICKET_PRIORITY_IDS = TICKET_PRIORITIES.map((p) => p.id) as [TicketPriority, ...TicketPriority[]];

export const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  WAITING_CUSTOMER: 'Waiting for customer',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

/** Response deadline for a ticket created at `createdAtIso` with this priority. */
export function ticketDueAt(createdAtIso: string, priority: TicketPriority): string {
  const hours = TICKET_PRIORITIES.find((p) => p.id === priority)?.slaHours ?? 48;
  return new Date(new Date(createdAtIso).getTime() + hours * 3600_000).toISOString();
}

export function isTicketOverdue(t: { status: string; dueAt?: string | null }, now: Date = new Date()): boolean {
  if (!t.dueAt || t.status === 'RESOLVED' || t.status === 'CLOSED') return false;
  return new Date(t.dueAt).getTime() < now.getTime();
}
