import { PortfolioRepository } from "@/features/portfolio/repository";

export async function getCustodySettingsReadModel(repository = new PortfolioRepository()) {
  const [custodians, accounts] = await Promise.all([repository.listCustodians(), repository.listAccounts()]);
  return {
    custodians: custodians.map((item) => ({ id: item.id, name: item.name, category: item.category, description: item.description, accounts: item.accounts.map((account) => ({ id: account.id, name: account.name })) })),
    accounts: accounts.map((item) => ({ id: item.id, name: item.name, type: item.type, custodianId: item.custodianId })),
  };
}
