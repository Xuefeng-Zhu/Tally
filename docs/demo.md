# Tally product walkthrough

Run `npm install` and `npm run dev`, then open http://127.0.0.1:5173. The main workspace has Overview, Documents, Opportunity and Settings. Existing `.data/state.json` is preserved.

1. From Overview, choose **Set up business details**, or open **Settings → Business profile**. The sample bakery identity is fixed. Expand People & health benefits or Tax & ownership to edit context, then save. Unsaved edits remain in memory across workspace navigation.
2. Open **Settings → Sample workspace** using the quiet **Sample data** control. Add the **Payment & payroll sample**. These controls use local reconstructed records; they do not upload files or call Box or a model provider.
3. Return to **Overview**. One current priority explains the next step. Open **Documents** to search/filter records, inspect their recorded information and open their actual source PDFs. Processing, retry and attention states reflect current records, not historical failed jobs.
4. Open **Opportunity**. The Overview tab shows the validated summary, next action and document checks. **Evidence** keeps source links, excerpts, dates and verification together. **Annual review** keeps the eight full-year questions separate.
5. Add the **Coverage statement sample** from Settings. The same opportunity updates. The monthly statement's $1,200 employer contribution / $1,500 total premium yields a stated 80% share. It does not establish that the ledger payment settled with the insurer or resolve annual contribution rules.
6. Inspect all eight annual unknowns. There is no credit estimate or definitive eligibility result. If records or context change, the prior assessment is hidden until an updated review is ready.
7. Refresh: the same profile and opportunity persist. Repeated samples remain idempotent. A fresh isolated B-before-A run converges after both records arrive.

In configured Box modes, Documents opens the actual configured inbox and exposes the existing Analyze inbox and recheck actions. The interface does not invent a working upload, sign-in or connection-health control. Connections in Settings show what is configured and what has actually run. Credentials are never entered here.

## Verification and provenance

`npm test` covers backend behavior and presentation guards. `npm run test:browser` requires a fresh isolated `TALLY_DATA_PATH`; it exercises navigation, samples, source links, same-card updates, annual unknowns, persistence, mobile layout and mocked error/loading states. It never uses your working state. Review captures and video live under ignored `.artifacts/` directories.

The original handoff ZIP/contracts/PDFs remain unavailable. Interim records are clearly reconstructed synthetic samples. Original parity, live Box/Bedrock access, cloud delivery and deployment remain separate unverified gates. The product redesign does not grant cloud access or perform paid calls.
