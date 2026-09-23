export const PERSONAL_CFO_PROVIDER = "portfolio-manager" as const;
export const PERSONAL_CFO_CONTRACT_VERSION = "portfolio-manager-personal-cfo-v1" as const;
export const PERSONAL_CFO_FINGERPRINT_VERSION = "portfolio-manager-capital-flow-revision-v1" as const;

export type PersonalCfoIdentity = {
  contractVersion: typeof PERSONAL_CFO_CONTRACT_VERSION;
  provider: typeof PERSONAL_CFO_PROVIDER;
  providerInstanceId: string;
  portfolioId: string;
};

export function personalCfoIdentity(instanceId: string): PersonalCfoIdentity {
  return {
    contractVersion: PERSONAL_CFO_CONTRACT_VERSION,
    provider: PERSONAL_CFO_PROVIDER,
    providerInstanceId: instanceId,
    portfolioId: instanceId,
  };
}

export function personalCfoCapabilities(identity: PersonalCfoIdentity) {
  return {
    ...identity,
    capabilities: {
      totalMarketValue: true,
      holdings: true,
      holdingMarketValues: true,
      cashIncludedInValuation: true,
      contributionWithdrawalHistory: true,
      reportingCurrency: true,
      sourceFreshnessTimestamps: true,
      deterministicIncrementalCapitalFlowCursor: true,
      revisionsCorrections: true,
      pnl: false,
      historicalValuations: false,
      distributions: false,
      fees: false,
      fxInformation: false,
    },
  };
}
