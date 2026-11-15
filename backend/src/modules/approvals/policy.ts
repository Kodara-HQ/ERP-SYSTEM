import { HttpError } from '../../utils/httpError';

export type ApprovalTransactionKind = 'expenditure' | 'organisational' | 'general';

export interface ApprovalDecisionInput {
  actorUserId: number;
  requesterUserId: number;
  actorIsTechnicalAdmin: boolean;
  actorCanApproveExpenditure: boolean;
  actorHasFinalBusinessAuthority: boolean;
  transactionKind: ApprovalTransactionKind;
  isFinalBusinessStep: boolean;
  /**
   * Set when this approval is the last spending authority on the request (no executive step follows).
   * The approver's configured financial limit must cover the amount. `null` limit means unlimited.
   */
  authorityCheck?: { amount: number; limit: number | null } | null;
}

/**
 * Central approval rules. The workflow engine calls this before every decision.
 * Pass transactionKind 'expenditure' only for a step that requires expenditure
 * authority. Verification steps stay 'general' so a control role can verify
 * without gaining authority to approve the spend. Technical administration
 * never confers expenditure authority, and nobody can approve their own request.
 * A manager who gives the last spending approval must hold a limit that covers the amount.
 */
export function assertApprovalAllowed(input: ApprovalDecisionInput): void {
  if (input.actorUserId === input.requesterUserId) {
    throw new HttpError(403, 'You cannot approve your own request.', 'SELF_APPROVAL_DENIED');
  }

  if (input.transactionKind === 'expenditure') {
    if (input.actorIsTechnicalAdmin || !input.actorCanApproveExpenditure) {
      throw new HttpError(
        403,
        'You are not authorised to approve company expenditure.',
        'EXPENDITURE_APPROVAL_DENIED',
      );
    }
  }

  if (input.isFinalBusinessStep && !input.actorHasFinalBusinessAuthority) {
    throw new HttpError(403, 'Only the CEO can give final business approval.', 'FINAL_APPROVAL_DENIED');
  }

  if (input.authorityCheck) {
    if (input.actorIsTechnicalAdmin) {
      throw new HttpError(403, 'You are not authorised to approve company expenditure.', 'EXPENDITURE_APPROVAL_DENIED');
    }
    const { amount, limit } = input.authorityCheck;
    if (limit !== null && Math.round(amount * 100) > Math.round(limit * 100)) {
      throw new HttpError(
        403,
        `This amount is above your approval limit of ${limit.toFixed(2)}. It must be escalated to the CEO.`,
        'AUTHORITY_LIMIT_EXCEEDED',
        { limit, amount },
      );
    }
  }
}
