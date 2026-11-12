import { describe, expect, it } from 'vitest';
import { HttpError } from '../src/utils/httpError';
import { assertApprovalAllowed } from '../src/modules/approvals/policy';

const base = {
  actorUserId: 2,
  requesterUserId: 9,
  actorIsTechnicalAdmin: false,
  actorCanApproveExpenditure: true,
  actorHasFinalBusinessAuthority: true,
  transactionKind: 'expenditure' as const,
  isFinalBusinessStep: true,
};

describe('approval policy', () => {
  it('rejects self-approval', () => {
    expect(() => assertApprovalAllowed({ ...base, actorUserId: 9, requesterUserId: 9, isFinalBusinessStep: false, transactionKind: 'general', actorCanApproveExpenditure: false, actorHasFinalBusinessAuthority: false })).toThrow(HttpError);
  });

  it('rejects expenditure approval by a system administrator', () => {
    expect(() => assertApprovalAllowed({ ...base, actorIsTechnicalAdmin: true, actorCanApproveExpenditure: true })).toThrow(/expenditure/);
  });

  it('rejects expenditure approval by an accounts role without expenditure authority', () => {
    expect(() => assertApprovalAllowed({ ...base, actorCanApproveExpenditure: false, isFinalBusinessStep: false })).toThrow(/expenditure/);
  });

  it('keeps final business approval with the CEO authority flag', () => {
    expect(() => assertApprovalAllowed({ ...base, actorHasFinalBusinessAuthority: false })).toThrow(/CEO/);
    expect(() => assertApprovalAllowed(base)).not.toThrow();
  });
});
