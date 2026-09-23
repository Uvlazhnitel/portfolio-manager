# Personal CFO integration API

Portfolio Manager exposes a small, read-only HTTP contract for a Personal CFO provider adapter. Portfolio Manager remains authoritative for investment bookkeeping. The downstream system remains authoritative for bank-transfer matching, whole-life net worth, recommendations, and other Personal CFO decisions.

The integration does not expose Prisma tables, UI presentation models, Assistant tools, transaction notes, stored provider credentials, or environment configuration. It should normally be reachable only through a trusted private network or local Docker network.

## Configuration and authentication

Both server-only environment variables are required:

```dotenv
PERSONAL_CFO_API_TOKEN="replace-with-a-long-random-secret"
PORTFOLIO_INTEGRATION_INSTANCE_ID="primary-household-portfolio"
```

If either is absent or blank, every integration route returns `503 INTEGRATION_DISABLED`. Send the token only in an HTTP header:

```http
Authorization: Bearer replace-with-a-long-random-secret
```

Query-string credentials are not accepted. Missing, malformed, and invalid credentials all return `401 UNAUTHORIZED`. Tokens are SHA-256 hashed before timing-safe comparison and are never logged or returned. Every response, including errors, uses `Cache-Control: no-store`, `Vary: Authorization`, and `X-Content-Type-Options: nosniff`.

The provider identity is stable and explicit:

```json
{
  "contractVersion": "portfolio-manager-personal-cfo-v1",
  "provider": "portfolio-manager",
  "providerInstanceId": "primary-household-portfolio",
  "portfolioId": "primary-household-portfolio"
}
```

The two IDs are identical in v1 because one Portfolio Manager installation represents one portfolio. Neither value is derived from database connection details or process state.

## Routes

All routes support `GET` only:

- `/api/integrations/personal-cfo/v1/capabilities`
- `/api/integrations/personal-cfo/v1/snapshot`
- `/api/integrations/personal-cfo/v1/capital-flows?limit=100&cursor=...`

Unexpected server failures return a generic `500 INTERNAL_ERROR`. Invalid capital-flow limits or cursors return `400 INVALID_LIMIT` or `400 INVALID_CURSOR` without querying or changing financial state.

## Capabilities

The capabilities endpoint describes only semantics present in this HTTP contract. It reports support for total market value, holdings and holding values, cash inclusion, reporting currency, freshness timestamps, contribution/withdrawal evidence, deterministic incremental cursors, and corrections. P&L, historical valuations, distributions, fees, and FX details are explicitly unsupported in v1 even where internal tables or engines contain related data.

## Snapshot contract

Example, with identifiers and values redacted:

```json
{
  "contractVersion": "portfolio-manager-personal-cfo-v1",
  "provider": "portfolio-manager",
  "providerInstanceId": "portfolio-redacted",
  "portfolioId": "portfolio-redacted",
  "generatedAt": "2026-09-23T12:00:00.000Z",
  "reportingCurrency": "USD",
  "valuation": {
    "status": "complete",
    "totalValue": "151.673829414",
    "knownValuedSubtotal": "151.673829414",
    "missingPriceSymbols": [],
    "hasStalePrices": false,
    "sourceAsOf": "2026-09-23T11:58:00.000Z",
    "sourceAsOfSemantics": "oldest_component_quote"
  },
  "cash": {
    "treatment": "included_in_total",
    "amount": "25.125",
    "currency": "USD"
  },
  "holdings": {
    "completeness": "complete",
    "items": [
      {
        "providerHoldingId": "account-redacted:asset-redacted",
        "accountId": "account-redacted",
        "assetId": "asset-redacted",
        "symbol": "BTC",
        "name": "Bitcoin",
        "assetClass": "CRYPTO",
        "assetType": "CRYPTO",
        "quantity": "0.00178",
        "currentMarketValue": "151.673829414",
        "price": "85210.0165258427",
        "priceCurrency": "USD",
        "priceSource": "COINGECKO",
        "priceTimestamp": "2026-09-23T11:58:00.000Z",
        "isPriceStale": false
      }
    ]
  }
}
```

All financial numbers are canonical, non-exponential Decimal strings. No JavaScript `Number`, currency display formatter, `toFixed(2)`, or compact quantity is used. Insignificant trailing zeros are not preserved; numeric precision is.

`generatedAt` is when this snapshot was assembled and is not market-data freshness. `sourceAsOf` is the oldest timestamp among priced, held components. Synthetic `BASE_CURRENCY` identity prices have a null component timestamp and do not influence it. Per-holding timestamps remain authoritative for individual components. Staleness and `sourceAsOf` ignore assets that are not held.

### Partial valuation and cash

If any positive held asset lacks a current price, `valuation.status` and `holdings.completeness` are `partial`, `totalValue` is `null`, and `knownValuedSubtotal` remains the exact sum of priced holdings. `missingPriceSymbols` identifies the gap. A stale but present quote does not make the total partial; it sets the relevant stale fields.

An empty portfolio is complete with value `"0"`. The `unavailable` enum value is reserved for future additive use; v1 returns an HTTP error when a snapshot cannot be assembled.

CASH-class holdings already participate in portfolio valuation. `cash.treatment` is therefore always `included_in_total`, and consumers must not add it again. `cash.amount` is the exact aggregate in reporting currency, including `"0"` when no cash is held. It is `null` if any held cash component lacks a price.

Snapshot reads use Portfolio Manager's existing current-price service. That service may refresh its quote cache, but the integration never writes assets, accounts, transactions, strategies, or Personal CFO state.

## Capital-flow evidence

Only `DEPOSIT` and `WITHDRAWAL` rows are evidence:

- `DEPOSIT` becomes `direction: "contribution"`.
- `WITHDRAWAL` becomes `direction: "withdrawal"`.
- BUY, SELL, TRADE, TRANSFER, GIFT, and INITIAL_BALANCE never become capital-flow evidence.

Example:

```json
{
  "contractVersion": "portfolio-manager-personal-cfo-v1",
  "provider": "portfolio-manager",
  "providerInstanceId": "portfolio-redacted",
  "portfolioId": "portfolio-redacted",
  "items": [
    {
      "eventId": "transaction-root-redacted",
      "revisionId": "transaction-revision-redacted",
      "sourceTransactionId": "transaction-revision-redacted",
      "status": "ACTIVE",
      "direction": "contribution",
      "accountId": "account-redacted",
      "assetId": "asset-redacted",
      "amount": "1000",
      "amountUnavailableReason": null,
      "currency": "EUR",
      "effectiveAt": "2026-09-01T08:00:00.000Z",
      "changedAt": "2026-09-01T08:00:01.000Z",
      "replacesRevisionId": null,
      "replacementRevisionIds": [],
      "revisionFingerprint": "sha256:redacted"
    }
  ],
  "hasMore": false,
  "nextCursor": "redacted"
}
```

Amounts are positive original-currency gross magnitudes: exact `quantity × pricePerUnit`, with no conversion to the portfolio reporting currency. Same-currency FIAT rows may infer a unit price of one. A legacy row whose positive original amount cannot be established uses `amount: null` and `MISSING_OR_NON_POSITIVE_ORIGINAL_AMOUNT`; consumers must not match it by amount.

### Corrections, fingerprints, and cursors

`eventId` is the root transaction ID in a `replacesTransactionId` chain. Each database transaction is a revision with its own `revisionId`. `ACTIVE`, `REPLACED`, and `VOIDED` are exported explicitly; disappearance from a page never means deletion. Replacement links contain revision IDs only, and notes/status reasons are not exported.

`revisionFingerprint` is lowercase SHA-256 prefixed by `sha256:`. Its input is a JSON array in this fixed order:

1. `portfolio-manager-capital-flow-revision-v1`
2. event ID
3. revision ID
4. status
5. direction
6. canonical amount or null
7. amount-unavailable reason or null
8. original currency
9. account ID
10. asset ID
11. effective timestamp
12. changed timestamp
13. replaced revision ID or null
14. sorted replacement revision IDs

Rows are ordered by durable `(updatedAt, transaction ID)` and exposed as `(changedAt, revisionId)`. The opaque base64url cursor owns that tuple and is strictly validated. Page size defaults to 100 and accepts 1–500.

`nextCursor` advances to the last returned revision even when `hasMore` is false, so it can be retained as the next polling checkpoint. An empty poll echoes its supplied cursor. Repeating a cursor is replay-safe; consumers should deduplicate by revision ID plus fingerprint. Because corrections update `updatedAt`, revisions of historical economic events become visible after an earlier checkpoint.

## Versioning

V1 may gain backward-compatible optional fields or capabilities. Renaming fields, changing meanings, changing fingerprint input, or removing fields requires a new route namespace and `contractVersion`. Personal CFO should bind to both the namespace and contract version and reject unknown breaking versions.
