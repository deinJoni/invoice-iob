# France (FR) — research & implementation plan

> Ground truth for the `@invoice-iob/format-facturx-fr` provider. Researched **2026-06-19** against
> current sources (impots.gouv.fr, FNFE-MPE, Légifrance, CEF/Peppol code lists) — see the per-section
> Sources. The thesis this provider proves: **a new country is a plugin against the `FormatProvider`
> interface, not a fork of the core pipeline.**

## 0. The key insight — France needs no new engine

**Factur-X _is_ the French national e-invoice standard, and it is the same Franco-German standard as
the German ZUGFeRD** (Factur-X published by FNFE-MPE, ZUGFeRD by FeRD; current Factur-X 1.0.x ≡
ZUGFeRD 2.x). `@e-invoice-eu/core` already produces it — we ship it today as the German `zugferd`
hybrid. So France is mostly **localization + French identifiers + French business rules + a French
template**, reusing the engine's `generateFacturX()`. The FR provider clones `format-zugferd`, swaps
the locale to `fr`, and layers French rules.

## 0a. E-invoicing reform — timeline & model (2026 reality)

- **Receiving** e-invoices (réception): **mandatory for ALL French VAT-registered businesses from
  1 September 2026** (no staggering).
- **Issuing / transmitting** (émission) + e-reporting, staggered by size: **grandes entreprises +
  ETI from 1 September 2026**; **PME / TPE / micro from 1 September 2027**.
- **PPF / PDP model (post-Oct-2024 reorientation):** the _Portail Public de Facturation_ (PPF) was
  cut back — no longer a free universal exchange portal. It now does only the **annuaire** (central
  SIREN→platform directory for routing) and the **concentrateur** (forwards extracted fiscal data to
  the DGFiP). Actual exchange goes through private state-approved **Plateformes de Dématérialisation
  Partenaires (PDP / "Plateformes Agréées")**. Every company must use at least one.
- **The "socle" (minimum accepted formats):** **Factur-X** (hybrid PDF/A-3 + CII), **UBL**, **CII**.
  Basis: AFNOR XP Z12-012 + DGFiP _spécifications externes B2B_ (v3.2, 2026-04-30). invoice-iob emits
  all three today.

## 0b. Factur-X profiles & the recommended French default

Five cumulative data profiles + reference profiles:

| Profile                     | Lines? | EN 16931-compliant? | Our use                                      |
| --------------------------- | ------ | ------------------- | -------------------------------------------- |
| MINIMUM                     | no     | **no**              | not offered                                  |
| BASIC WL                    | no     | **no**              | not offered                                  |
| BASIC                       | yes    | subset only         | offered (`BASIC`)                            |
| **EN 16931 (Comfort)**      | yes    | **yes (full)**      | **default** (`EN16931`)                      |
| EXTENDED                    | yes    | yes (superset)      | offered (`EXTENDED`)                         |
| XRECHNUNG / EXTENDED-CTC-FR | —      | reference profiles  | German / FR-CTC specific — not offered by FR |

**Recommended default = EN 16931 (Comfort)** — the lowest profile that fully covers the European
semantic norm. MINIMUM / BASIC WL are **not** standalone EN 16931-compliant (no line detail), so they
are not offered (same policy as the German hybrid; PRD §14 decision #5).

## 0c. FR CIUS — rules beyond generic EN 16931

A Factur-X EN 16931 invoice valid against _generic_ EN 16931 can still be non-compliant in France.
The French layer (DGFiP _spécifications externes_; CIUS-FR; EXT-FR-FE) adds: mandatory **SIREN/SIRET**
for both parties + the buyer's SIREN (reform), the **nature de l'opération**, the **option TVA d'après
les débits**, and Code de commerce / CGI mandatory mentions on the visible document. The provider's
`validate()` enforces the high-value subset (SIREN/SIRET presence + checksum, French TVA rates, FR
VAT-number shape) and renders the mandatory mentions onto the PDF; the long tail is the Mustang/veraPDF
CI gate, per the `validate()` contract. Full detail in §A–G below.

## 0d. Implementation plan → what shipped

A new country is **additive only** (no fork of `core` / `mapper` / `registry` / `server`). The one
**generic** core change France genuinely needed (a GENERIC improvement that helps every country):

> **Smallest core change:** the canonical→UBL-JSON serializer (`engine-e-invoice-eu/serialize.ts`)
> emits `cac:PartyIdentification` (BT-29 seller / BT-46 buyer), carrying any party identifier with an
> `@schemeID` (ICD code). France uses it for the **SIRET** (schemeID `0009`); the **SIREN** rides the
> already-existing legal-registration id (BT-30/BT-47, schemeID `0002`). Generic: GLN, DUNS, any
> country's establishment id flows through the same path. **Cardinality the engine schema enforces:**
> seller identifier is repeatable (array), **buyer is 0..1 (single object)** — honour it per side.

Everything else is plugin-local or additive-generic:

1. **Generic (helps every country):** `Party.identifiers` (BT-29/46) on the model + input + mapper;
   the `cac:PartyIdentification` emitter; wire the dormant `FormatProvider.mapExtensions` hook in the
   server; a `language` field on `create_invoice` (was hardcoded `de-de`) defaulting from seller country.
2. **Renderer:** the `fr` locale (LABELS.fr, UNIT_LABELS.fr, `Intl` `fr-FR`, `DD/MM/YYYY`), a generic
   identifier-scheme → label map (0002→SIREN, 0009→SIRET, …), a `legalNotes` channel for mandatory
   fine print, and **normalization of the U+202F narrow no-break space** that `fr-FR` `Intl` uses for
   thousands grouping (outside the embedded font → would render as `?`; see §F).
3. **Plugin `@invoice-iob/format-facturx-fr`:** id `factur-x-fr` (alias `facturx-fr`), country FR,
   EN 16931 Factur-X hybrid; `render()` = French PDF → `generateFacturX()`; `validate()` =
   `baseEn16931Issues` + French rules (SIREN/SIRET Luhn incl. the La Poste exception, TVA rates, FR
   VAT-number shape, mandatory mentions); `mapExtensions()` folds `extensions.fr` (legal form, share
   capital, RCS city, operation type) for the PDF mentions.
4. **CI:** `examples/invoice-fr.json` + a `factur-x-fr` row in the validation matrix → the existing
   `pdfa-hybrid` job (Mustang + embedded veraPDF) validates it. **No standalone CLI FR validator
   exists**; Mustang's `--action validate` runs the same CEN EN 16931 Schematron + veraPDF PDF/A-3b and
   covers Factur-X profiles, so the existing gate is **sufficient** (the genuinely French CTC/PDP layer
   is platform-enforced at submission, not a CI-runnable Schematron; see §G).

---

## Research: French business identifiers (SIREN/SIRET/TVA) + EN 16931 EAS scheme codes + UBL/CII element paths

**Topic:** How to carry French party identifiers (SIREN, SIRET, RCS, TVA intracommunautaire) in EN 16931 e-invoices — exact ISO 6523 ICD / EAS scheme codes, the precise checksum algorithms, and the exact UBL/CII element paths (plus the e-invoice-eu JSON serialization shape) for seller and buyer.

## Summary

A **SIREN** is the 9-digit identifier of a French legal entity (the company); a **SIRET** is the 14-digit identifier of one of its establishments = SIREN (9) + NIC (5, a 4-digit establishment sequence + 1 check digit). Both are validated with the **Luhn (mod-10)** algorithm over all their digits. The well-known exception is **La Poste (SIREN 356 000 000)**: its SIRETs do NOT satisfy Luhn — for them the rule is "sum of the 14 digits ≡ 0 (mod 5)" (the head-office SIRET `356 000 000 00048` happens to still pass Luhn). The French **TVA intracommunautaire** number is `FR` + a 2-digit key + the 9-digit SIREN, where key = `(12 + 3 × (SIREN mod 97)) mod 97`.

For EN 16931, the scheme codes come from the **ISO 6523 ICD code list** (used for `@schemeID` on party/legal/identifier elements) and the **EAS — Electronic Address Scheme code list** (used for `@schemeID` on the endpoint, BT-34/BT-49). The relevant codes are confirmed: **0002 = "System Information et Repertoire des Entreprise et des Etablissements: SIRENE"** (used for SIREN), **0009 = "SIRET-CODE"** (used for SIRET), **0088 = EAN/GLN (GS1 Global Location Number)**, **0060 = DUNS**, plus France-specific EAS entries **9957 = "French VAT number"**, **0240 = "Register of legal persons (Répertoire des personnes morales)"**, **0225 = "FRCTC ELECTRONIC ADDRESS"**.

Placement convention (FNFE-MPE / Factur-X practice): **SIREN → legal registration identifier** (BT-30 seller / BT-47 buyer = `PartyLegalEntity/CompanyID` in UBL, `SpecifiedLegalOrganization/ID` in CII) with `@schemeID="0002"`. **SIRET → seller/buyer identifier** (BT-29/BT-46 = `PartyIdentification/cbc:ID` in UBL, `GlobalID` in CII) with `@schemeID="0009"`, and/or the routing **endpoint** (BT-34/BT-49 = `EndpointID` in UBL, `URIUniversalCommunication/URIID` in CII) with `@schemeID="0009"`. VAT (BT-31/BT-48) goes in `PartyTaxScheme/CompanyID` (UBL) / `SpecifiedTaxRegistration/ID @schemeID="VA"` (CII).

In **e-invoice-eu** (gflohr/e-invoice-eu) the UBL JSON serializes an element-with-attribute as two sibling keys: `"cbc:ID": "<value>"` and `"cbc:ID@schemeID": "<code>"`; repeatable elements (`cac:PartyIdentification`) are **always arrays** even with a single entry.

---

## 1. French identifiers

### 1.1 SIREN vs SIRET (relationship)

- **SIREN** = 9 digits. Identifies the **legal entity / enterprise** (the company itself). Assigned by INSEE. Used as the basis for the official Trade Register registration.
- **SIRET** = 14 digits = **SIREN (9) + NIC (5)**. Identifies a specific **établissement** (establishment / site) of that enterprise.
  - **NIC** ("Numéro Interne de Classement") = 5 digits = a 4-digit sequential establishment number + a 1-digit check digit.
  - Example: `732 829 320 00074` = the 7th establishment ("00074", where the trailing digit is the establishment check digit) of company SIREN `732 829 320`.
- One SIREN ↔ many SIRETs (one per establishment); the principal establishment is the "siège".

### 1.2 SIREN / SIRET checksum — Luhn (mod 10)

**Confirmed:** both SIREN (9 digits) and SIRET (14 digits) are validated with the **Luhn algorithm** over **all** of their digits (the last digit is the Luhn check digit). [Verified — see Sources: Wikipedia SIRET, e-invoice.be SIRET validator, swapn/superindep.]

Exact algorithm (right-to-left):

1. Process digits from the rightmost (the check digit) leftward.
2. Starting with the **second digit from the right**, double every other digit's value.
3. If a doubled value exceeds 9, subtract 9 (equivalently, sum its two digits).
4. Sum all the resulting values (doubled-and-adjusted + untouched).
5. The number is **valid iff the total ≡ 0 (mod 10)** (divisible by 10).

(For SIREN the positions doubled are digits 2,4,6,8 from the right; for SIRET, 2,4,…,14 from the right.)

**La Poste exception [explicitly noted]:** All La Poste establishments share **SIREN `356 000 000`**. Because the number of establishments exceeds what Luhn-valid NICs allow, La Poste SIRETs do **NOT** satisfy the Luhn check. INSEE's official alternative rule: a `356 000 000 XXXXX` SIRET is valid iff the **simple sum of its 14 digits is a multiple of 5** (sum ≡ 0 mod 5). Practical validation: apply standard Luhn first; if it fails AND the SIREN is `356000000`, fall back to the "sum-of-digits divisible by 5" rule. Note the head-office SIRET `356 000 000 00048` still passes standard Luhn. (The SIREN `356000000` itself also fails the plain 9-digit Luhn check.)

### 1.3 RCS registration & TVA intracommunautaire

- **RCS** (Registre du Commerce et des Sociétés): the commercial register. A company's RCS registration is expressed as `RCS <Ville> <SIREN>` (e.g. `RCS Paris 732 829 320`) — i.e. the SIREN is the registration number, qualified by the registry city. There is no separate "RCS number" distinct from the SIREN; the SIREN is the legal registration identifier (BT-30) and in the ISO 6523 world is also reachable via the France-specific EAS code **0240 = "Register of legal persons (Répertoire des personnes morales)"**.
- **TVA intracommunautaire (French VAT number):** format `FR` + **2-character key** + **9-digit SIREN** (13 characters total).
  - **Key computation (numeric key):** `key = (12 + 3 × (SIREN mod 97)) mod 97`, formatted as 2 digits.
  - Each SIREN yields exactly one key. Example: SIREN `775670417` → `(12 + 3 × (775670417 mod 97)) mod 97 = (12 + 3×81) mod 97 = 255 mod 97 = 61` → **`FR61775670417`**. [Verified — swapn, superindep, l-expert-comptable.]
  - Note: the key may also be alphanumeric in some old/edge cases (the "ancienne clé" allowing letters), but the standard computed key for current SIRENs is the numeric modulo-97 formula above.

---

## 2. EAS / ISO 6523 ICD scheme codes

Two distinct code lists both use the same 4-digit ICD values for these schemes:

- **ISO 6523 ICD code list** — used for `@schemeID` on **party identification** and **legal organisation** elements (BT-29/30/46/47). (Peppol publishes the operational copy.)
- **EAS — Electronic Address Scheme code list** (managed by the EU eInvoicing building block under the Digital Europe programme, formerly CEF) — used for `@schemeID` on the **endpoint** (BT-34 / BT-49). The EAS list is a curated subset/overlay of ICD plus a few non-ICD entries (e.g. `EM` for email).

| Code     | Official name (as published)                                                                                  | Use                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **0002** | **"System Information et Repertoire des Entreprise et des Etablissements: SIRENE"** — issued by INSEE, France | **SIREN** (9-digit legal entity)                                          |
| **0009** | **"SIRET-CODE"**                                                                                              | **SIRET** (14-digit establishment)                                        |
| **0060** | "Data Universal Numbering System (D-U-N-S Number)"                                                            | DUNS                                                                      |
| **0088** | "EAN Location Code"                                                                                           | **GLN / GS1 Global Location Number**                                      |
| **9957** | "French VAT number"                                                                                           | French TVA (EAS list, France-specific)                                    |
| **0240** | "Register of legal persons (Répertoire des personnes morales)"                                                | French RCS/RNE legal-person register (EAS)                                |
| **0225** | "FRCTC ELECTRONIC ADDRESS"                                                                                    | French CTC (Chorus Pro / facturation électronique routing) endpoint (EAS) |

**Confirmed:** `0002` = SIRENE (used for SIREN), `0009` = SIRET, `0088` = GLN. [Verified against the Peppol ICD list and Peppol EAS list, which mirror the EN 16931 code lists.] The official up-to-date master is the EU "Registry of supporting artefacts to implement EN 16931" (EAS code list spreadsheet) on the europa.eu digital-building-blocks site; the europa.eu overview page does not inline the codes, so the Peppol-published mirror is the practical source. [The exact wording "SIRENE"/"SIRET-CODE" is verified; the historical ICD-list issuing-agency note for 0009 lists "DuPont de Nemours (France) S.A." as the original 1980s registrant — historical, not relevant to usage.]

---

## 3. EN 16931 business terms → UBL & CII element paths

All UBL paths are under `/Invoice` (or `/CreditNote`); CII under `/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement`. Seller party = UBL `cac:AccountingSupplierParty/cac:Party` / CII `ram:SellerTradeParty`. Buyer party = UBL `cac:AccountingCustomerParty/cac:Party` / CII `ram:BuyerTradeParty`.

### 3.1 Seller

| BT        | Meaning                                                 | UBL path                                                                                          | CII path                                                                                          |
| --------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **BT-29** | Seller identifier (+ BT-29-1 scheme)                    | `…/cac:Party/cac:PartyIdentification/cbc:ID` (`@schemeID`)                                        | `…/ram:SellerTradeParty/ram:ID` and `ram:GlobalID` (`@schemeID`)                                  |
| **BT-30** | Seller legal registration identifier (+ BT-30-1 scheme) | `…/cac:Party/cac:PartyLegalEntity/cbc:CompanyID` (`@schemeID`)                                    | `…/ram:SellerTradeParty/ram:SpecifiedLegalOrganization/ram:ID` (`@schemeID`)                      |
| **BT-31** | Seller VAT identifier                                   | `…/cac:Party/cac:PartyTaxScheme/cbc:CompanyID` with `cac:TaxScheme/cbc:ID = VAT`                  | `…/ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID` with `@schemeID="VA"`                |
| **BT-32** | Seller tax registration identifier                      | `…/cac:Party/cac:PartyTaxScheme/cbc:CompanyID` with `cac:TaxScheme/cbc:ID = TAX` (non-VAT scheme) | `…/ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID` with `@schemeID="FC"`                |
| **BT-34** | Seller electronic address (+ BT-34-1 scheme)            | `…/cac:AccountingSupplierParty/cac:Party/cbc:EndpointID` (`@schemeID`, from **EAS** list)         | `…/ram:SellerTradeParty/ram:URIUniversalCommunication/ram:URIID` (`@schemeID`, from **EAS** list) |

### 3.2 Buyer

| BT        | Meaning                                                | UBL path                                                                                  | CII path                                                                                         |
| --------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **BT-46** | Buyer identifier (+ BT-46-1 scheme)                    | `…/cac:Party/cac:PartyIdentification/cbc:ID` (`@schemeID`)                                | `…/ram:BuyerTradeParty/ram:ID` and `ram:GlobalID` (`@schemeID`)                                  |
| **BT-47** | Buyer legal registration identifier (+ BT-47-1 scheme) | `…/cac:Party/cac:PartyLegalEntity/cbc:CompanyID` (`@schemeID`)                            | `…/ram:BuyerTradeParty/ram:SpecifiedLegalOrganization/ram:ID` (`@schemeID`)                      |
| **BT-48** | Buyer VAT identifier                                   | `…/cac:Party/cac:PartyTaxScheme/cbc:CompanyID` with `cac:TaxScheme/cbc:ID = VAT`          | `…/ram:BuyerTradeParty/ram:SpecifiedTaxRegistration/ram:ID` with `@schemeID="VA"`                |
| **BT-49** | Buyer electronic address (+ BT-49-1 scheme)            | `…/cac:AccountingCustomerParty/cac:Party/cbc:EndpointID` (`@schemeID`, from **EAS** list) | `…/ram:BuyerTradeParty/ram:URIUniversalCommunication/ram:URIID` (`@schemeID`, from **EAS** list) |

Notes:

- The **scheme attribute** in UBL is `@schemeID`; in CII the identifier elements use `@schemeID` for ICD/EAS codes. For the VAT identifier the CII convention is the literal `@schemeID="VA"` (and `"FC"` for the non-VAT tax-registration BT-32); in UBL the VAT vs non-VAT distinction is carried by the child `cac:TaxScheme/cbc:ID` (`VAT` vs `TAX`/`FC`), not by `@schemeID`.
- BT-34/BT-49 (endpoint) `@schemeID` values come from the **EAS** code list (a CII historical wart: an old mapping used `GlobalID` for the endpoint; the corrected EN 16931 binding uses `URIUniversalCommunication/URIID`).

---

## 4. Carrying SIREN / SIRET — placement + JSON serialization

### 4.1 Where SIREN vs SIRET belong (FNFE-MPE / Factur-X guidance)

- **SIREN → legal registration identifier**, `@schemeID="0002"`:
  - UBL: `cac:PartyLegalEntity/cbc:CompanyID` with `@schemeID="0002"` (BT-30 seller / BT-47 buyer).
  - CII: `ram:SpecifiedLegalOrganization/ram:ID` with `@schemeID="0002"`.
- **SIRET → party identifier**, `@schemeID="0009"`:
  - UBL: `cac:PartyIdentification/cbc:ID` with `@schemeID="0009"` (BT-29 seller / BT-46 buyer).
  - CII: `ram:GlobalID` with `@schemeID="0009"`.
  - And/or the **routing endpoint** (BT-34/BT-49): SIRET is the typical French CTC endpoint value → `cbc:EndpointID`/`URIID` with `@schemeID="0009"`. (For Chorus Pro / the French CTC platform, the endpoint scheme may instead be `0225` "FRCTC ELECTRONIC ADDRESS" depending on the routing model — verify per platform.)
- **TVA** → `PartyTaxScheme/CompanyID` (UBL, with `TaxScheme/ID=VAT`) / `SpecifiedTaxRegistration/ID @schemeID="VA"` (CII), value `FR<key><SIREN>`.
- **Never invent custom codes** like `FR-SIRET`/`FR-SIREN`; only canonical ISO 6523 ICD / EAS codes are valid and pass Schematron. [Confirmed by facturxapi guidance.]

> [PARTIALLY UNVERIFIED] The strict normative anchor is the FNFE-MPE Factur-X spec PDF; the placement above is confirmed by the FacturX-API implementation guidance and matches the EN 16931 semantic model, but the exact FNFE-MPE clause numbers were not pulled from the spec PDF in this pass.

### 4.2 e-invoice-eu (gflohr/e-invoice-eu) UBL JSON shape — CONFIRMED

The internal JSON mirrors UBL element names. An element carrying both text and an attribute becomes **two sibling keys**: the element name → text value, and `<elementName>@<attrName>` → attribute value. Repeatable elements are **always arrays** (even for a single entry). All values are strings.

SIREN as a seller party identification (BT-29-style / SIRET in PartyIdentification):

```json
"cac:PartyIdentification": [
  { "cbc:ID": "73282932000074", "cbc:ID@schemeID": "0009" }
]
```

SIREN as legal registration (BT-30):

```json
"cac:PartyLegalEntity": [
  {
    "cbc:RegistrationName": "ACME SARL",
    "cbc:CompanyID": "732829320",
    "cbc:CompanyID@schemeID": "0002"
  }
]
```

Endpoint (BT-34), scheme from EAS list:

```json
"cbc:EndpointID": "73282932000074",
"cbc:EndpointID@schemeID": "0009"
```

VAT (BT-31):

```json
"cac:PartyTaxScheme": [
  {
    "cbc:CompanyID": "FR61775670417",
    "cac:TaxScheme": { "cbc:ID": "VAT" }
  }
]
```

So: **SIRET with `@schemeID="0009"` typically goes in `cac:PartyIdentification/cbc:ID` (and/or `cbc:EndpointID`); SIREN with `@schemeID="0002"` goes in `cac:PartyLegalEntity/cbc:CompanyID`.** [The JSON two-key/`@`-attribute + always-array conventions are verified from the e-invoice-eu internal-format docs; the specific French example values are illustrative.]

---

## Sources

- ISO 6523 ICD code list (Peppol mirror of EN 16931 list) — 0002 SIRENE, 0009 SIRET-CODE, 0088 EAN Location Code, 0060 DUNS: https://docs.peppol.eu/poacc/billing/3.0/codelist/ICD/ (fetched 2026-06-19)
- EAS Electronic Address Scheme code list (Peppol mirror) — 0002, 0009, 0060, 0088, 9957 "French VAT number", 0225 "FRCTC ELECTRONIC ADDRESS", 0240 "Register of legal persons": https://docs.peppol.eu/poacc/billing/3.0/codelist/eas/ (fetched 2026-06-19)
- EU eInvoicing — EAS code list (official managing authority overview, CEF/Digital Europe): https://ec.europa.eu/digital-building-blocks/sites/plugins/viewsource/viewpagesrc.action?pageId=704839714 (fetched 2026-06-19); CEF EAS update notices: https://ec.europa.eu/digital-building-blocks/wikis/display/CEFDIGITAL/2020/05/25/CEF+eInvoicing+EAS+Code+List+Update+May+2020 (fetched 2026-06-19)
- ISO/IEC 6523 ICD registration authority list (PDF): http://iso6523.info/icd_list.pdf (referenced 2026-06-19)
- SIRET structure + Luhn + La Poste exception — Wikipedia (FR): https://fr.wikipedia.org/wiki/Syst%C3%A8me_d'identification_du_r%C3%A9pertoire_des_%C3%A9tablissements (fetched 2026-06-19)
- Luhn formula — Wikipedia (FR): https://fr.wikipedia.org/wiki/Formule_de_Luhn (referenced 2026-06-19)
- La Poste SIRET non-Luhn / sum-mod-5 rule: https://blog.pagesd.info/2012/09/05/verifier-numero-siret-poste/ (referenced 2026-06-19)
- SIREN/SIRET Luhn validator (algorithm steps + La Poste note): https://e-invoice.be/siret-validator (fetched 2026-06-19)
- TVA intracommunautaire key formula `(12 + 3 × (SIREN mod 97)) mod 97`: https://www.swapn.fr/simulateurs/numero-de-tva-intracommunautaire (fetched 2026-06-19); https://www.superindep.fr/blog/2021/trouver-numero-tva-intracommunautaire/ (referenced 2026-06-19); https://www.l-expert-comptable.com/calculateurs/trouver-le-numero-de-tva-intracommunautaire-partir-de-votre-numero-de-siren.html (referenced 2026-06-19)
- EN 16931 BT → UBL/CII element-path mapping (BT-29/30/31/32/34, BT-46/47/48/49): https://e-invoice.be/en16931-mapper (fetched 2026-06-19)
- BT-34 Seller electronic address semantics: https://www.invoicenavigator.eu/glossary/bt-34-seller-electronic-address (referenced 2026-06-19)
- FNFE-MPE / Factur-X schemeID placement guidance (SIREN 0002 in SpecifiedLegalOrganization, SIRET 0009 in GlobalID; never custom codes): https://facturxapi.com/blog/erreur-schemeid-organisation-siren-siret-gln-duns (fetched 2026-06-19); https://facturxapi.com/blog/champs-obligatoires-en16931-facturx-mapping-erp (referenced 2026-06-19)
- SIREN / SIRET e-invoicing glossary: https://www.invoicenavigator.eu/glossary/siren , https://www.invoicenavigator.eu/glossary/siret (referenced 2026-06-19)
- e-invoice-eu (gflohr) internal JSON format — `@`-attribute keys, always-array repeatables, string values: https://gflohr.github.io/e-invoice-eu/en/docs/details/internal-format/ (fetched 2026-06-19); repo: https://github.com/gflohr/e-invoice-eu (referenced 2026-06-19)

---

---

## Research: French invoicing law, mandatory mentions & fr-FR document conventions

> Compiled **2026-06-19**. Every factual claim is cited inline with a source key `[n]` resolving to the **Sources (mentions/labels/validators)** section (URL + access date).
> Items not verified against an authoritative source are marked **[UNVERIFIED]**.
> Primary legal sources: Légifrance (CGI art. 242 nonies A, Code de commerce art. L441-9), BOFiP, service-public.gouv.fr / entreprendre.service-public.gouv.fr, economie.gouv.fr.

## A. Legally-mandatory invoice fields (mentions obligatoires) — B2B

The mandatory mentions on a B2B invoice come from **two** complementary legal bases:

- **CGI annexe II, art. 242 nonies A** — the **fiscal/VAT** mentions (transposes EU VAT Directive 2006/112/CE). [A1]
- **Code de commerce, art. L441-9** — the **commercial** mentions (payment terms, penalties, recovery indemnity). [A2]

Plus seller-identity mentions (forme juridique, capital social, RCS/RM, SIREN) from the Code de commerce business-document rules. [A3][A4]

### A.1 Fiscal mentions — CGI art. 242 nonies A (version **en vigueur depuis le 01/01/2025**) [A1]

The _bis_ items were added/renumbered for the e-invoicing reform (see §B).

| #      | French wording (verbatim from Légifrance)                                                                                                                           | Plain meaning                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1      | « Le nom complet, le numéro d'identification mentionné au premier alinéa de l'article R. 123-221 du code de commerce et l'adresse de l'assujetti et de son client » | Seller **and buyer** full name, **SIREN/SIRET**, address                                  |
| 2      | « Le numéro individuel d'identification attribué à l'assujetti en application de l'article 286 ter »                                                                | Seller's **intra-EU VAT number**                                                          |
| 3      | « Les numéros d'identification à la TVA du vendeur et de l'acquéreur pour les livraisons désignées au I de l'article 262 ter »                                      | Both VAT numbers for **intra-EU supplies**                                                |
| 4      | « Le numéro d'identification à la TVA du prestataire ainsi que celui fourni par le preneur »                                                                        | Provider & recipient VAT numbers (cross-border services)                                  |
| 5      | « Lorsque le redevable de la taxe est un représentant fiscal, le numéro individuel d'identification attribué à ce représentant fiscal »                             | Fiscal representative's VAT number                                                        |
| 5 bis  | « … la mention « Membre d'un assujetti unique » »                                                                                                                   | VAT-group member mention                                                                  |
| 6      | « Sa date d'émission »                                                                                                                                              | **Invoice date**                                                                          |
| 7      | « Un numéro unique basé sur une séquence chronologique et continue »                                                                                                | **Sequential invoice number**                                                             |
| 7 bis  | « L'adresse de livraison des biens si elle est différente de l'adresse du client »                                                                                  | **Delivery address** if different (NEW — reform)                                          |
| 8      | « Pour chacun des biens livrés ou des services rendus, la quantité, la dénomination précise, le prix unitaire hors taxes et le taux [de TVA] »                      | Per line: **quantity, precise designation, unit price HT, VAT rate**                      |
| 8 bis  | « L'information selon laquelle les opérations sont constituées exclusivement de livraisons ou exclusivement de prestations ou des deux »                            | **Nature de l'opération**: goods / services / mixed (NEW — reform)                        |
| 9      | « Tous rabais, remises, ristournes ou escomptes acquis et chiffrables lors de l'opération »                                                                         | All **discounts** (rabais/remise/ristourne/escompte)                                      |
| 10     | « La date à laquelle est effectuée ou achevée la livraison de biens ou la prestation de services »                                                                  | **Date of sale / completion of service**                                                  |
| 11     | « Le montant de la taxe à payer et, par taux d'imposition, le total hors taxe et la taxe correspondante »                                                           | **Total HT and VAT per rate** (per-rate breakdown)                                        |
| 11 bis | « Lorsque le prestataire a opté pour le paiement de la taxe d'après les débits, la mention correspondante »                                                         | **« Option pour le paiement de la TVA d'après les débits »** if applicable (NEW — reform) |
| 12     | « En cas d'exonération, la référence à la disposition pertinente du CGI ou de la directive 2006/112/CE »                                                            | Exemption reference (see §D)                                                              |
| 13     | « Lorsque l'acquéreur ou le preneur est redevable de la taxe, la mention « Autoliquidation » »                                                                      | **« Autoliquidation »** (reverse charge)                                                  |
| 14     | « … la mention « Autofacturation » »                                                                                                                                | **« Autofacturation »** (self-billing)                                                    |
| 15     | régime particulier des agences de voyage                                                                                                                            | Travel-agent margin scheme                                                                |
| 16     | régime prévu par l'article 297 A                                                                                                                                    | Margin scheme (second-hand/art)                                                           |
| 17     | caractéristiques du moyen de transport neuf (298 sexies)                                                                                                            | New means of transport                                                                    |
| 18     | prix d'adjudication … ventes aux enchères                                                                                                                           | Public-auction breakdown                                                                  |

Note: **total TTC** is not enumerated word-for-word (242 nonies A mandates total HT + VAT per rate), but TTC is required in practice and is the basis for "Net à payer"; service-public/economie.gouv.fr list montant total HT, montant de la TVA and prix TTC. [A3][A4]

### A.2 Commercial mentions — Code de commerce art. L441-9 (version **du 26 avr. 2019 → 1er sept. 2026**) [A2]

| French wording                                                                                                     | Meaning                                                |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| « le nom des parties ainsi que leur adresse et leur adresse de facturation si elle est différente »                | Parties' names/addresses, billing address if different |
| « la date à laquelle le règlement doit intervenir »                                                                | **Date de règlement** (payment due date)               |
| « les conditions d'escompte applicables en cas de paiement à une date antérieure »                                 | **Conditions d'escompte**                              |
| « le taux des pénalités exigibles le jour suivant la date de règlement inscrite sur la facture »                   | **Taux des pénalités de retard**                       |
| « le montant de l'indemnité forfaitaire pour frais de recouvrement due au créancier en cas de retard de paiement » | **Indemnité forfaitaire pour frais de recouvrement**   |
| « le numéro du bon de commande s'il a été préalablement établi par l'acheteur »                                    | PO number if one exists                                |

- **Indemnité forfaitaire = 40 € — CONFIRMED.** Amount fixed by decree (**art. D441-5** Code de commerce), due automatically per late invoice regardless of amount/delay, **only when the debtor is a professional**, cumulative with late-payment penalties. [A2][A5][A6]
- **Late-payment penalty rate:** legal minimum = **ECB main refinancing rate + 10 points** (≈ **12,15 % p.a.** in H1 2026 [A6]), « sans qu'un rappel soit nécessaire ».
- **Sanction for omission:** up to **75 000 €** (personne physique) / **375 000 €** (personne morale), doubled on repeat within 2 years. [A2]

### A.3 Seller-identity mentions (companies/sociétés) [A3][A4]

Dénomination · **forme juridique + montant du capital social** (e.g. « SAS au capital de 10 000 € ») · adresse du siège social · **SIREN/SIRET** · **ville du greffe + n° RCS** (commerçants) **or n° RM** (artisans) · seller **N° TVA intracommunautaire** (mandatory above 150 € HT and always intra-EU).

### A.4 Conditional special mentions

- **Micro-entreprise / franchise en base:** « **TVA non applicable, art. 293 B du CGI** » (see §D). [A4]
- **Membre d'une association/organisme de gestion agréé (AGA/OGA):** canonical wording « **Membre d'une association agréée par l'administration fiscale acceptant à ce titre le règlement des honoraires par carte bancaire ou par chèque(s) libellé(s) à son nom** » [A7]; short form « Membre d'une association agréée, le règlement par chèque et carte bancaire est accepté ». [A4]
- **EI (entrepreneur individuel)** since 2022: name preceded/followed by « EI » — **[UNVERIFIED]** in this pass.

## B. New e-invoicing-reform mandatory mentions

Four new mentions; legal source = **CGI annexe II art. 242 nonies A** as amended (the _bis_ items, in force since 01/01/2025). [A1][A3]

| New mention                                | French                                                                             | Source                       | When                            |
| ------------------------------------------ | ---------------------------------------------------------------------------------- | ---------------------------- | ------------------------------- |
| **Buyer SIREN/SIRET**                      | n° d'identification du client (R.123-221 C. com.)                                  | 242 nonies A-1               | B2B, emphasized since 2024 [A3] |
| **Delivery address if different**          | « L'adresse de livraison des biens si elle est différente de l'adresse du client » | 242 nonies A-**7 bis** [A1]  | reform                          |
| **Nature de l'opération**                  | livraison de biens / prestation de services / mixte                                | 242 nonies A-**8 bis** [A1]  | reform                          |
| **Option paiement TVA d'après les débits** | mention correspondante                                                             | 242 nonies A-**11 bis** [A1] | reform                          |

**Reform timeline:** receipt + large/medium issuance **1 Sept 2026**; small enterprises **1 Sept 2027**; B2B flows via accredited **PDP** (PPF exchange-portal role dropped Oct 2024). [A3][A8][V8]

## C. French TVA rates (2026) — unchanged values [C9][C10]

| Rate      | Name                            | Examples                                              |
| --------- | ------------------------------- | ----------------------------------------------------- |
| **20 %**  | taux normal                     | default                                               |
| **10 %**  | taux intermédiaire              | restauration, certain renovation, passenger transport |
| **5,5 %** | taux réduit                     | basic foodstuffs, books, energy-improvement works     |
| **2,1 %** | taux particulier / super-réduit | reimbursable medicines, press                         |

- **Corse:** **0,9 / 2,1 / 10 / 13 %** (+ 20 % for uncovered), per BOFiP. [C11] "8 %" in some tables **[UNVERIFIED]** / outdated.
- **DOM (Guadeloupe, Martinique, Réunion):** normal **8,5 %**, reduced **2,1 %** (narrow 1,75 % / 1,05 %). [C9][C10]
- **Guyane & Mayotte:** **no TVA**. [C10] — verbatim official exclusion **[partially verified]**.
- 2025/26 scope tweaks (not rate values): gas/oil boilers → 20 % from 1 Mar 2025; LF 2026 extends 5,5 % to some heat pumps / network refrigeration / margarines. [C9] — secondary sources.

## D. VAT exemption / special mentions — exact wording + EN 16931 / VATEX mapping

CGI art. 242 nonies A-12 requires citing the **relevant CGI provision or Directive 2006/112/CE article**; BOFiP confirms the citation **or « toute autre mention équivalente »**. [D12]

| Case                                                             | Exact canonical French mention                                                                                                             | CGI / source             | EN 16931 category (BT-118)         | VATEX (BT-121)                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ | ---------------------------------- | --------------------------------- |
| **Franchise en base** (micro)                                    | « **TVA non applicable, art. 293 B du CGI** » (or ref. art. 284 dir. 2006/112/CE)                                                          | art. **293 B** [A4][D13] | **E** (Exempt) 0 %                 | **VATEX-FR-FRANCHISE** [D15][D13] |
| **Autoliquidation** (reverse charge)                             | « **Autoliquidation** » (often w/ basis: « Autoliquidation – article 283-1 du CGI » EU services; « … article 283-2 / sous-traitance BTP ») | art. **283** [D12][D16]  | **AE** (Reverse Charge) 0 %        | **VATEX-EU-AE** [D15]             |
| **Livraison intracommunautaire** (intra-EU goods, both VAT nos.) | « **Exonération de TVA, article 262 ter, I du CGI** »                                                                                      | art. **262 ter I** [D12] | **K** (intra-community supply) 0 % | **VATEX-EU-IC** [D15]             |
| **Export hors UE** (goods)                                       | « **Exonération de TVA, article 262 I du CGI** » (a.k.a. « TVA non applicable, article 262 I du CGI »)                                     | art. **262 I** [D17]     | **G** (free export) 0 %            | **VATEX-EU-G** [D15]              |

Other codes (UNCL5305/EN 16931): **S** = standard rate; **Z** = zero-rated; **O** = out-of-scope services (→ **VATEX-EU-O**). France out-of-scope code **VATEX-FR-CNWVAT** exists in Peppol (definition not documented — **[UNVERIFIED]**). [D15]

Mapping notes: intra-EU = **K** (rule BR-IC-10, VATEX required), not E; export = **G** (BR-G-10); reverse charge = **AE** (BR-AE-10) with human mention « Autoliquidation »; franchise = **E + VATEX-FR-FRANCHISE** (preferred for FR; some tools use O). [D13][D15]

## E. fr-FR document labels (PDF invoice)

| English / German     | French (recommended)             | Acceptable alternatives                              | Notes                                                                     |
| -------------------- | -------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| Invoice              | **Facture**                      | —                                                    | Title                                                                     |
| Invoice number       | **Facture n°**                   | Numéro de facture; N° de facture                     | Unique/chronological; repeat per page if multi-page                       |
| Invoice date         | **Date d'émission**              | Date de facturation; Date de la facture              | "Date d'émission" legally precise                                         |
| Due date             | **Date d'échéance**              | Échéance; Date limite de paiement; Date de règlement |                                                                           |
| Seller / issuer      | **Émetteur**                     | Fournisseur; Vendeur; Prestataire                    | Often unlabelled; **Fournisseur** common B2B, **Émetteur** neutral        |
| Buyer / customer     | **Client**                       | Acheteur; Destinataire; Facturé à                    | **Client** overwhelmingly standard                                        |
| Description          | **Désignation**                  | Description; Libellé                                 | Conventional column header                                                |
| Quantity             | **Quantité**                     | Qté                                                  |                                                                           |
| Unit price           | **Prix unitaire HT**             | P.U. HT; PU HT                                       | Line prices conventionally HT                                             |
| Net amount (line)    | **Montant HT**                   | Total ligne HT                                       | = PU HT × Qté                                                             |
| VAT                  | **TVA**                          | Taxe sur la Valeur Ajoutée                           |                                                                           |
| VAT rate             | **Taux de TVA**                  | Taux; Tx TVA                                         |                                                                           |
| Total net            | **Total HT**                     | Montant total HT; Sous-total HT                      | Mandatory                                                                 |
| Total VAT            | **Total TVA**                    | Montant TVA                                          | Per-rate breakdown if several rates                                       |
| Total gross          | **Total TTC**                    | Montant total TTC                                    | = Total HT + Total TVA                                                    |
| Amount due           | **Net à payer**                  | Total à payer; Montant à régler                      | Final TTC after remises/acomptes/escompte; bottom-right                   |
| Payment terms        | **Conditions de règlement**      | Conditions de paiement; Modalités de paiement        | Penalties + 40 € indemnity required here                                  |
| IBAN                 | **IBAN**                         | IBAN du bénéficiaire                                 |                                                                           |
| BIC                  | **BIC**                          | BIC/SWIFT; Code BIC                                  |                                                                           |
| Delivery period/date | **Date de livraison**            | Date de réalisation (services); Période de livraison | Legal: date de réalisation de la vente/prestation                         |
| Page X of Y          | **Page X sur Y**                 | Page X / Y                                           |                                                                           |
| Order reference      | **Bon de commande n°**           | Référence commande; N° de commande                   | Mandatory (L441-9) when PO exists                                         |
| Buyer reference      | **Référence acheteur**           | Référence client; Code client                        | Factur-X **BT-10** = buyer routing ref (≠ "Référence client" account no.) |
| VAT ID               | **N° de TVA intracommunautaire** | N° TVA intracom.                                     | Mandatory seller (+ buyer intra-EU)                                       |
| "Reverse charge"     | **Autoliquidation**              | Autoliquidation de la TVA                            | No VAT on line; often « Autoliquidation – art. 283 du CGI »               |

**Unit labels:** piece(s) → **pièce / pièces** (alt: unité(s), **u.**, pce, forfait) · hour(s) → **heure / heures** (**h**, invariable) · day(s) → **jour / jours** (**j**, invariable; j-h = jour-homme) · kg → **kg** (SI symbol, invariable, no period). Others: L, m², m³, ml / m.l. (mètre linéaire), forfait.

**Key:** **HT** = Hors Taxes; **TTC** = Toutes Taxes Comprises; **TVA** = Taxe sur la Valeur Ajoutée. Lines/unit prices conventionally HT; totals run **Total HT → Total TVA → Total TTC → Net à payer**. (Sources: economie.gouv.fr [A3], CCI Paris IDF, facture.net, l-expert-comptable, Indy, Fiducial, Sellsy, Qonto, AFNOR XP Z12-012 — see [E*] in Sources.)

## F. fr-FR number, currency & date formatting

- **Thousands separator:** a space — modern Unicode/CLDR uses **narrow no-break space U+202F (NNBSP)**; older ICU/CLDR (< 34) used regular no-break space **U+00A0**. Source: Imprimerie Nationale + AFNOR NF X 02-003. [F18][F19]
- **Decimal separator:** a **comma** (AFNOR NF X 02-003). [F18]
- **Currency:** euro symbol **after** the amount: **`1 234,56 €`**.

**`Intl.NumberFormat('fr-FR', {style:'currency', currency:'EUR'}).format(1234.56)`** → **`1 234,56 €`** (empirically tested Node v24 / ICU 77.1, 2026-06-19). [F20]

**Critical nuance (load-bearing):** the two spaces are **different code points** — thousands group separator = **U+202F**, space before **€** = **U+00A0**. So `format(1234567.89)` → `1 234 567,89 €` (groups U+202F, pre-€ U+00A0); plain `NumberFormat('fr-FR')` → `1 234 567,89` (groups U+202F, no currency space). Tests hardcoding ASCII space or U+00A0 for the group separator **will fail** — build expected strings from `Intl` output. [F20]

**`Intl.DateTimeFormat('fr-FR').format(new Date())`** → **`DD/MM/YYYY`** with `/` (e.g. `19/06/2026`). [F20]

## G. Official FR validator for CI

**Verdict: the existing Mustang + veraPDF CI gate (Factur-X EN 16931 in PDF/A-3) is SUFFICIENT for FR for the file-conformance layer. No separate CI-runnable French validator is needed or cleanly available.**

- **(a) FNFE-MPE validator** — Web-only, **login/registration-gated** ([services.fnfe-mpe.org](https://services.fnfe-mpe.org)); **no downloadable/CLI/open-source build**. Underlying checks = **veraPDF + the public CEN EN 16931 Schematron** (same components Mustang runs). → Not CI-friendly. [V21][V22][V23]
- **(b) Chorus Pro** — France's **B2G** platform (AIFE); has a **Qualification sandbox + PISTE APIs** but OAuth2/onboarding-heavy, B2G-only, integration-acceptance-oriented. For **B2B** the authority is accredited **PDPs**, not Chorus Pro. → Not a practical CI gate. [V24][V25][A8]
- **(c) Mustangproject** — Confirmed: validates **Factur-X / ZUGFeRD** (1, 2.x, XRechnung 3) for PDF + XML; **CLI `--action validate`** (return 0 = valid → CI gate); **embeds veraPDF** (PDF/A-3B); validates against **official ZUGFeRD/Factur-X Schematron + CEN EN 16931 SCRDM v16B Schematron** (industry-standard ruleset; recently v1.3.12 → v1.3.15). Knows MINIMUM / BASIC WL / BASIC / EN16931 / EXTENDED / XRECHNUNG. Apache-2.0; Maven `org.mustangproject:validator`. **Factur-X ≡ ZUGFeRD 2.x** (identical hybrid PDF/A-3 + EN 16931 CII), so one validator covers both. [V26][V27][V28][V21]
- **(d) FR-specific rules beyond EN 16931?** France has a **national CIUS** + **EXTENDED-CTC-FR** profile, but the French-specific layer (CTC routing, lifecycle/status, e-reporting, SIRET routing, PDP interconnection) is **process/transmission rules enforced at submission by Chorus Pro / a PDP, not a downloadable Schematron**. As of mid-2026 **no widely published, standalone, CI-runnable French B2B Schematron** beyond EN 16931 — **[UNVERIFIED]** that one exists. [A8][V21][V29]

**Recommendation:** (1) keep Mustang `--action validate` + veraPDF as the CI gate; pin/bump the bundled CEN Schematron version. (2) If producing EXTENDED-CTC-FR, ensure Mustang handles it and track FNFE-MPE/DGFiP releases (Factur-X 1.0.7/1.0.8/1.09) for any future CTC-FR Schematron. (3) Add a separate nightly/integration test against your PDP's (or Chorus Pro qualification) sandbox for the CTC/transmission/e-reporting layer no standalone validator covers. (4) _(Optional)_ occasionally cross-check against an independent EN 16931 validator (EU/CEF or KoSIT) for Schematron-drift detection — redundant with Mustang for routine CI **[UNVERIFIED]** as a strict requirement. [V26][V28][V24]

## Sources (mentions / rates / labels / formatting / validators) — all accessed 2026-06-19

**Legal / fiscal**

- [A1] Légifrance — CGI annexe II art. **242 nonies A** (en vigueur depuis 01/01/2025): https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000050811276
- [A2] Légifrance — Code de commerce art. **L441-9**: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000038414397
- [A3] economie.gouv.fr — "Mentions obligatoires d'une facture : tout savoir" (incl. reform mentions): https://www.economie.gouv.fr/entreprises/gerer-son-entreprise-au-quotidien/gerer-sa-comptabilite-et-ses-demarches/mentions-obligatoires-dune-facture-tout-savoir (HTTP 403 to fetcher; via search extraction)
- [A4] entreprendre.service-public.gouv.fr — "Factures : mentions obligatoires" (F31808), maj 2025-11-06: https://entreprendre.service-public.gouv.fr/vosdroits/F31808
- [A5] Assistant-juridique.fr — "Indemnité forfaitaire pour frais de recouvrement de 40 €": https://www.assistant-juridique.fr/indemnite_forfaitaire.jsp
- [A6] InteretsLegaux.fr — "Indemnité forfaitaire de 40 € … (2026)" + penalty rate ≈ 12,15 %: https://www.interetslegaux.fr/blog/indemnite-forfaitaire-40-euros-recouvrement-2026
- [A7] BOFiP — BOI-DJC-OA-20-30-20 (obligations adhérents organismes agréés; AGA wording): https://bofip.impots.gouv.fr/bofip/6098-PGP.html/identifiant=BOI-DJC-OA-20-30-20-20170705
- [A8] European Commission — "eInvoicing in France" (Chorus Pro B2G, national CIUS, PDP, CTC/e-reporting, timeline): https://ec.europa.eu/digital-building-blocks/sites/spaces/DIGITAL/pages/467108885/eInvoicing+in+France

**TVA rates**

- [C9] economie.gouv.fr — TVA rates (normal/intermédiaire/réduit/particulier; DOM): https://www.economie.gouv.fr/particuliers/impots-et-fiscalite/gerer-mes-autres-impots-et-taxes/tva-quels-sont-les-taux-de-votre-quotidien (HTTP 403; via search extraction)
- [C10] entreprendre.service-public.fr — "Taxe sur la valeur ajoutée (TVA)" (N13445; rates, DOM): https://entreprendre.service-public.fr/vosdroits/N13445
- [C11] BOFiP — BOI-TVA-GEO-10-10 (taux en **Corse**: 0,9 / 2,1 / 10 / 13 %): https://bofip.impots.gouv.fr/bofip/903-PGP.html/identifiant=BOI-TVA-GEO-10-10-20201016

**VAT exemption wording & EN 16931 / VATEX**

- [D12] BOFiP — BOI-TVA-DECLA-30-20-20-30 (mentions spécifiques: exonération, autoliquidation, 262 ter I): https://bofip.impots.gouv.fr/bofip/1531-PGP.html/identifiant=BOI-TVA-DECLA-30-20-20-30-20190925
- [D13] facture-obligatoire.fr — Glossaire "Franchise en base de TVA (art. 293 B)" + Factur-X cat. E / VATEX-FR-FRANCHISE: https://facture-obligatoire.fr/glossaire/franchise-tva/
- [D15] Peppol BIS Billing 3.0 — **VATEX** code list (VATEX-EU-IC/G/AE/O, VATEX-FR-FRANCHISE, VATEX-FR-CNWVAT): https://docs.peppol.eu/poacc/billing/3.0/codelist/vatex/
- [D16] OBAT — autoliquidation BTP, « Autoliquidation – article 283 du CGI »: https://www.obat.fr/blog/autoliquidation-sous-traitance/
- [D17] EBP — "Mention obligatoire facture export hors UE" (« TVA non applicable, art. 262 I du CGI »): https://www.ebp.com/blog/facturation/mention-obligatoire-facture-export-hors-ue/

**Labels (corroborating)**

- [E1] CCI Paris IDF — Factures : mentions obligatoires: https://www.entreprises.cci-paris-idf.fr/fiches-pratiques/factures-quelles-sont-les-mentions-obligatoires
- [E2] Facture.net — Mentions obligatoires: https://www.facture.net/blog/mentions-obligatoires-facture/
- [E3] L'Expert-Comptable — Comment faire une facture (n°, prix HT, TVA): https://www.l-expert-comptable.com/a/532686-comment-faire-une-facture-numero-de-facture-prix-ht-tva.html
- [E4] Indy — En-tête d'une facture: https://www.indy.fr/guide/facturation/modele/entete-facture/
- [E5] Sellsy — Mentions obligatoires facture électronique (IBAN/BIC, autoliquidation, références): https://go.sellsy.com/blog/mentions-obligatoires-facture-electronique
- [E6] Qonto — Factur-X (référence acheteur BT-10, n° commande BT-13): https://qonto.com/fr/blog/gestion-entreprise/facturation/factur-x
- [E7] e-invoicing-france.eu — AFNOR XP Z12-012 formats & profils: https://www.e-invoicing-france.eu/documentation/xp-z12-012/AFNOR-FE-XP-Z12-012-4-Formats-et-profils

**Formatting**

- [F18] Wikipédia (fr) — "Séparateur décimal et séparateur de milliers" (Imprimerie Nationale; AFNOR NF X 02-003): https://fr.wikipedia.org/wiki/S%C3%A9parateur_d%C3%A9cimal_et_s%C3%A9parateur_de_milliers
- [F19] Unicode — CLDR 34 release notes (group separator → U+202F migration): https://cldr.unicode.org/downloads/cldr-34
- [F20] Node.js empirical test (Node v24 / ICU 77.1, run 2026-06-19) — Intl.NumberFormat & Intl.DateTimeFormat output + code-point breakdown

**Validators**

- [V21] FNFE-MPE — "Factur-X 1.09 / ZUGFeRD 2.5 publication" (Factur-X ≡ ZUGFeRD; EXTENDED-CTC-FR; XSD/Schematron): https://fnfe-mpe.org/factur-x/factur-x_en/
- [V22] FNFE-MPE — "Implémenter Factur-X" (validator web tool; veraPDF + EN 16931 Schematron): https://fnfe-mpe.org/factur-x/implementer-factur-x/
- [V23] FNFE-MPE — Factur-X & Order-X Validator (login-gated web app): https://services.fnfe-mpe.org/
- [V24] Communauté Chorus Pro — Qualification (sandbox) environment & PISTE: https://communaute.chorus-pro.gouv.fr/documentation/qualification-environment-of-the-chorus-pro-services-portal/?lang=en
- [V25] Chorus Pro API docs — Getting Started (PISTE / qualification): https://cpro-docs.choruspay.fr/en/getting-started
- [V26] Mustang Project — Commandline (`--action validate`, return codes, embedded veraPDF): https://www.mustangproject.org/commandline/
- [V27] Mustang Project — Use (Apache 2.0, GitHub repo, validator Maven artifact): https://www.mustangproject.org/use/
- [V28] GitHub — ZUGFeRD/mustangproject (bundled ZUGFeRD + CEN EN 16931 SCRDM v16B Schematron; veraPDF; absorbed ZUV): https://github.com/ZUGFeRD/mustangproject/
- [V29] VATupdate — "Factur-X in France" (EXTENDED-CTC-FR, CTC, fiscal extensions): https://www.vatupdate.com/2026/04/15/e-invoicing-e-reporting-explained-factur-x-in-france/

### Unverified items recap (this section)

- Corsica "8 %" rate — **[UNVERIFIED]**, contradicted by BOFiP.
- Verbatim "Guyane & Mayotte excluded from TVA" official statement — **[partially verified]**.
- LF 2026 5,5 % scope extensions — secondary professional sources, not line-checked against statute.
- `VATEX-FR-CNWVAT` precise definition — **[UNVERIFIED]**.
- EI « EI » prefix requirement — **[UNVERIFIED]** in this pass.
- Standalone downloadable French B2B Schematron beyond EN 16931 for CI — **[UNVERIFIED]** (appears not to exist; CTC-FR is platform-enforced).
- FNFE-MPE validation REST API and simple Chorus Pro "file → pass/fail" endpoint — **[UNVERIFIED]**.
