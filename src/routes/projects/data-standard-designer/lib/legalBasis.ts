// Legal-basis registry — a hierarchy that makes sense of the different legal
// bases under which government data can be shared.
//
// The organising idea: a COMPLETE basis to share personal data has three
// distinct layers that are routinely conflated —
//   A. Data-protection lawful basis  (UK GDPR Art 6, + Art 9/10 condition)
//   B. Legal power / statutory gateway (the vires that PERMITS or REQUIRES the
//      sharing — without this, a lawful basis alone is not enough for a public
//      body), organised by domain, down to specific sections.
//   C. Governance instruments you must have in place (DPIA, sharing agreement,
//      s.251/CAG approval, Appropriate Policy Document, …).
//
// The tree below is a forest of three layer-roots; each leaf carries a precise
// citation, the kind of basis, which domains it applies to, and its nature
// (permits vs requires vs sets-aside-confidentiality vs condition vs control).

import type { Sector } from './types';

export type LegalLayer = 'data-protection' | 'power' | 'governance';
export type LegalKind =
  | 'dp-article6'
  | 'dp-article9'
  | 'dp-article10'
  | 'dp-regime'
  | 'statutory-gateway'
  | 'common-law'
  | 'consent'
  | 'governance';
export type PowerNature = 'permits' | 'requires' | 'sets-aside-confidentiality' | 'condition' | 'control';

export interface LegalNode {
  id: string;
  label: string;
  citation?: string;
  layer: LegalLayer;
  kind?: LegalKind;
  nature?: PowerNature;
  domains?: Sector[]; // omit = cross-cutting / all
  description?: string;
  caveat?: string;
  url?: string;
  children?: LegalNode[];
}

export const LEGAL_BASIS: LegalNode[] = [
  // ======================================================================
  // LAYER A — Data-protection lawful basis (UK GDPR / Data Protection Act 2018)
  // ======================================================================
  {
    id: 'layer-dp',
    label: 'A · Data-protection lawful basis',
    layer: 'data-protection',
    description:
      'Under UK GDPR you must identify an Article 6 lawful basis for any processing of personal data, and — for special-category or criminal-offence data — an additional Article 9/10 condition. This is necessary but, for a public body, rarely sufficient on its own: you also need a legal power to share (Layer B).',
    children: [
      {
        id: 'gdpr-art6',
        label: 'Article 6 — lawful basis for processing',
        layer: 'data-protection',
        description: 'At least one must apply to any processing of personal data.',
        url: 'https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/a-guide-to-lawful-basis/lawful-basis-for-processing/',
        children: [
          { id: 'art6-1-a', label: 'Art 6(1)(a) — Consent', citation: 'UK GDPR Art 6(1)(a)', layer: 'data-protection', kind: 'dp-article6', description: 'The individual has given clear, freely-given, specific, informed consent.', caveat: 'A poor fit where there is an imbalance of power (most public-task processing) — consent must be genuinely refusable.' },
          { id: 'art6-1-b', label: 'Art 6(1)(b) — Contract', citation: 'UK GDPR Art 6(1)(b)', layer: 'data-protection', kind: 'dp-article6', description: 'Processing necessary for a contract with the individual.' },
          { id: 'art6-1-c', label: 'Art 6(1)(c) — Legal obligation', citation: 'UK GDPR Art 6(1)(c)', layer: 'data-protection', kind: 'dp-article6', description: 'Necessary to comply with a legal obligation (other than contractual) — pair with the specific statute in Layer B.' },
          { id: 'art6-1-d', label: 'Art 6(1)(d) — Vital interests', citation: 'UK GDPR Art 6(1)(d)', layer: 'data-protection', kind: 'dp-article6', description: 'Necessary to protect someone\'s life.' },
          { id: 'art6-1-e', label: 'Art 6(1)(e) — Public task', citation: 'UK GDPR Art 6(1)(e)', layer: 'data-protection', kind: 'dp-article6', description: 'Necessary to perform a task in the public interest or exercise official authority, laid down by law. The default basis for most government processing.', caveat: 'Must be underpinned by a clear basis in law — i.e. a Layer-B power/function.' },
          { id: 'art6-1-f', label: 'Art 6(1)(f) — Legitimate interests', citation: 'UK GDPR Art 6(1)(f)', layer: 'data-protection', kind: 'dp-article6', description: 'Necessary for legitimate interests, balanced against the individual\'s rights.', caveat: 'Not available to public authorities for processing in performance of their tasks.' },
        ],
      },
      {
        id: 'gdpr-art9',
        label: 'Article 9 — special-category data conditions',
        layer: 'data-protection',
        description: 'Required (in addition to Art 6) for health, ethnicity, religion, sexual life, biometric, genetic and similar data. Most public-sector conditions are completed by a Schedule 1 DPA 2018 condition.',
        url: 'https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/special-category-data/',
        children: [
          { id: 'art9-2-a', label: 'Art 9(2)(a) — Explicit consent', citation: 'UK GDPR Art 9(2)(a)', layer: 'data-protection', kind: 'dp-article9', nature: 'condition', description: 'Explicit consent to processing of the special-category data.' },
          { id: 'art9-2-b', label: 'Art 9(2)(b) — Employment / social security', citation: 'UK GDPR Art 9(2)(b)', layer: 'data-protection', kind: 'dp-article9', nature: 'condition', description: 'Obligations/rights in employment, social security and social protection law.' },
          { id: 'art9-2-c', label: 'Art 9(2)(c) — Vital interests', citation: 'UK GDPR Art 9(2)(c)', layer: 'data-protection', kind: 'dp-article9', nature: 'condition', description: 'Protecting vital interests where the person is incapable of consent.' },
          { id: 'art9-2-g', label: 'Art 9(2)(g) — Substantial public interest', citation: 'UK GDPR Art 9(2)(g) + DPA 2018 Sch 1 Pt 2', layer: 'data-protection', kind: 'dp-article9', nature: 'condition', description: 'Substantial public interest, on the basis of law — completed by a Schedule 1 Part 2 condition.', url: 'https://www.legislation.gov.uk/ukpga/2018/12/schedule/1',
            children: [
              { id: 'dpa-sch1-6', label: 'DPA Sch 1 para 6 — Statutory and government purposes', citation: 'DPA 2018 Sch 1 para 6', layer: 'data-protection', kind: 'dp-article9', nature: 'condition', description: 'Necessary for a function conferred by an enactment or rule of law, or a government department\'s functions.' },
              { id: 'dpa-sch1-18', label: 'DPA Sch 1 para 18 — Safeguarding of children & individuals at risk', citation: 'DPA 2018 Sch 1 para 18', layer: 'data-protection', kind: 'dp-article9', nature: 'condition', domains: ['childrens-social-care', 'child-protection', 'education', 'health'], description: 'Protecting children and individuals at risk from neglect, harm or exploitation. The key condition for safeguarding data sharing.' },
              { id: 'dpa-sch1-10', label: 'DPA Sch 1 para 10 — Preventing or detecting unlawful acts', citation: 'DPA 2018 Sch 1 para 10', layer: 'data-protection', kind: 'dp-article9', nature: 'condition', domains: ['justice', 'cross-gov'], description: 'Necessary for preventing or detecting an unlawful act, in the substantial public interest.' },
              { id: 'dpa-sch1-8', label: 'DPA Sch 1 para 8 — Equality of opportunity or treatment', citation: 'DPA 2018 Sch 1 para 8', layer: 'data-protection', kind: 'dp-article9', nature: 'condition', description: 'Identifying or reviewing the existence/absence of equality of opportunity between groups (e.g. ethnicity monitoring).' },
            ],
          },
          { id: 'art9-2-h', label: 'Art 9(2)(h) — Health or social care', citation: 'UK GDPR Art 9(2)(h) + DPA 2018 Sch 1 para 2', layer: 'data-protection', kind: 'dp-article9', nature: 'condition', domains: ['health'], description: 'Provision of health/social care or treatment, and management of health/care systems.' },
          { id: 'art9-2-i', label: 'Art 9(2)(i) — Public health', citation: 'UK GDPR Art 9(2)(i)', layer: 'data-protection', kind: 'dp-article9', nature: 'condition', domains: ['health'], description: 'Public interest in public health (e.g. protecting against serious cross-border health threats).' },
          { id: 'art9-2-j', label: 'Art 9(2)(j) — Archiving, research & statistics', citation: 'UK GDPR Art 9(2)(j) + DPA 2018 Sch 1 para 4', layer: 'data-protection', kind: 'dp-article9', nature: 'condition', description: 'Archiving in the public interest, scientific/historical research, or statistical purposes, with appropriate safeguards.' },
        ],
      },
      { id: 'gdpr-art10', label: 'Article 10 — criminal offence data', citation: 'UK GDPR Art 10 + DPA 2018 s.10 & Sch 1', layer: 'data-protection', kind: 'dp-article10', nature: 'condition', domains: ['justice'], description: 'Processing of criminal conviction/offence data needs official authority or a DPA Schedule 1 condition.', url: 'https://www.legislation.gov.uk/ukpga/2018/12/section/10' },
      { id: 'dpa-part3', label: 'DPA 2018 Part 3 — Law-enforcement processing', citation: 'DPA 2018 Part 3', layer: 'data-protection', kind: 'dp-regime', domains: ['justice'], description: 'The separate regime for competent authorities processing for law-enforcement purposes (replaces Art 6/9 for that processing).', url: 'https://www.legislation.gov.uk/ukpga/2018/12/part/3' },
      { id: 'dpa-part4', label: 'DPA 2018 Part 4 — Intelligence services processing', citation: 'DPA 2018 Part 4', layer: 'data-protection', kind: 'dp-regime', description: 'The regime for the intelligence services.', url: 'https://www.legislation.gov.uk/ukpga/2018/12/part/4' },
    ],
  },

  // ======================================================================
  // LAYER B — Legal power / statutory gateway (the vires to share)
  // ======================================================================
  {
    id: 'layer-power',
    label: 'B · Legal power / statutory gateway',
    layer: 'power',
    description:
      'The function or power in law that lets you (or requires you to) share the data. A public body can only act where it has the legal power to do so. Powers may PERMIT sharing, REQUIRE it (a duty), or SET ASIDE the common-law duty of confidentiality. Organised by domain, down to specific sections.',
    children: [
      {
        id: 'power-cross-gov',
        label: 'Cross-government & general powers',
        layer: 'power',
        children: [
          {
            id: 'dea-2017-p5',
            label: 'Digital Economy Act 2017, Part 5 — public-sector data sharing',
            citation: 'Digital Economy Act 2017, Part 5',
            layer: 'power',
            kind: 'statutory-gateway',
            nature: 'permits',
            domains: ['cross-gov'],
            description: 'The principal cross-government gateway, with distinct chapters for specific purposes and codes of practice for each.',
            url: 'https://www.legislation.gov.uk/ukpga/2017/30/part/5',
            children: [
              { id: 'dea-ch1-psd', label: 'Ch 1 — Public service delivery', citation: 'DEA 2017 s.35', layer: 'power', kind: 'statutory-gateway', nature: 'permits', domains: ['cross-gov'], description: 'Sharing to improve the wellbeing of individuals/households for specified objectives.' },
              { id: 'dea-ch2-civreg', label: 'Ch 2 — Civil registration', citation: 'DEA 2017 s.46', layer: 'power', kind: 'statutory-gateway', nature: 'permits', domains: ['cross-gov'], description: 'Sharing of civil-registration information by registration officials.' },
              { id: 'dea-ch3-debt', label: 'Ch 3 — Debt owed to the public sector', citation: 'DEA 2017 s.48', layer: 'power', kind: 'statutory-gateway', nature: 'permits', domains: ['cross-gov'], description: 'Sharing to identify, manage and recover debt owed to public authorities.' },
              { id: 'dea-ch4-fraud', label: 'Ch 4 — Fraud against the public sector', citation: 'DEA 2017 s.56', layer: 'power', kind: 'statutory-gateway', nature: 'permits', domains: ['cross-gov'], description: 'Sharing to combat fraud against public authorities.' },
              { id: 'dea-ch5-research', label: 'Ch 5 — Research', citation: 'DEA 2017 s.64', layer: 'power', kind: 'statutory-gateway', nature: 'permits', domains: ['cross-gov'], description: 'Disclosure of de-identified data for accredited research in the public interest (UKSA-accredited researchers, processors and projects).' },
              { id: 'dea-ch7-stats', label: 'Ch 7 — Statistics (ONS)', citation: 'DEA 2017 s.79 et seq.', layer: 'power', kind: 'statutory-gateway', nature: 'permits', domains: ['cross-gov'], description: 'Provision of information to the Statistics Board (ONS) for statistical purposes.' },
            ],
          },
          { id: 'localism-2011-s1', label: 'Localism Act 2011 s.1 — general power of competence', citation: 'Localism Act 2011 s.1', layer: 'power', kind: 'statutory-gateway', nature: 'permits', domains: ['local-gov'], description: 'Local authorities may do anything individuals generally may do, subject to limits — can support data sharing where not otherwise prohibited.', url: 'https://www.legislation.gov.uk/ukpga/2011/20/section/1' },
          { id: 'lga-2000-s2', label: 'Local Government Act 2000 s.2 — wellbeing power', citation: 'Local Government Act 2000 s.2', layer: 'power', kind: 'statutory-gateway', nature: 'permits', domains: ['local-gov'], description: 'Power to promote economic, social and environmental wellbeing.', url: 'https://www.legislation.gov.uk/ukpga/2000/22/section/2' },
          { id: 'common-law-powers', label: 'Common-law / implied (incidental) powers', citation: 'Common law', layer: 'power', kind: 'common-law', nature: 'permits', description: 'Powers reasonably incidental to express statutory functions; relied on where no express gateway exists. Document the reasoning carefully.' },
        ],
      },
      {
        id: 'power-children',
        label: 'Children, education & social care',
        layer: 'power',
        children: [
          { id: 'ca2004-s10', label: 'Children Act 2004 s.10 — duty to co-operate', citation: 'Children Act 2004 s.10', layer: 'power', kind: 'statutory-gateway', nature: 'requires', domains: ['childrens-social-care', 'education'], description: 'Duty on local authorities and relevant partners to co-operate to improve children\'s wellbeing.', url: 'https://www.legislation.gov.uk/ukpga/2004/31/section/10' },
          { id: 'ca2004-s11', label: 'Children Act 2004 s.11 — duty to safeguard', citation: 'Children Act 2004 s.11', layer: 'power', kind: 'statutory-gateway', nature: 'requires', domains: ['childrens-social-care', 'child-protection', 'education', 'health'], description: 'Key bodies must ensure their functions are discharged with regard to safeguarding and promoting children\'s welfare. The named s.11 partners are the scope of the new info-sharing duty.', url: 'https://www.legislation.gov.uk/ukpga/2004/31/section/11' },
          { id: 'cwsa-2025-sui', label: 'Children\'s Wellbeing and Schools Act 2025 — consistent identifier & info-sharing duty', citation: 'CWSA 2025 (inserts s.16LB et seq. into the Children Act 2004)', layer: 'power', kind: 'statutory-gateway', nature: 'requires', domains: ['childrens-social-care', 'child-protection', 'education', 'health'], description: 'Establishes a single "consistent identifier" for children (NHS number piloted) and a duty on safeguarding partners to share information that would help another partner safeguard or promote a child\'s welfare.', caveat: 'Recent — secondary legislation and statutory guidance still being made; confirm commencement and the designated identifier.', url: 'https://bills.parliament.uk/bills/3909' },
          { id: 'ca1989-s17', label: 'Children Act 1989 s.17 — children in need', citation: 'Children Act 1989 s.17', layer: 'power', kind: 'statutory-gateway', nature: 'requires', domains: ['childrens-social-care'], description: 'Duty to safeguard and promote the welfare of children in need.', url: 'https://www.legislation.gov.uk/ukpga/1989/41/section/17' },
          { id: 'ca1989-s47', label: 'Children Act 1989 s.47 — enquiries (child protection)', citation: 'Children Act 1989 s.47', layer: 'power', kind: 'statutory-gateway', nature: 'requires', domains: ['child-protection', 'childrens-social-care'], description: 'Duty to make enquiries where a child is suspected to be suffering, or likely to suffer, significant harm; others must assist with information.', url: 'https://www.legislation.gov.uk/ukpga/1989/41/section/47' },
          { id: 'ea1996-s537a', label: 'Education Act 1996 s.537A — individual pupil information', citation: 'Education Act 1996 s.537A', layer: 'power', kind: 'statutory-gateway', nature: 'requires', domains: ['education'], description: 'Power to require and provide individual pupil information — the basis for the school census / NPD.', url: 'https://www.legislation.gov.uk/ukpga/1996/56/section/537A' },
          { id: 'ascla-2009', label: 'Apprenticeships, Skills, Children and Learning Act 2009 — learner data', citation: 'ASCLA 2009', layer: 'power', kind: 'statutory-gateway', nature: 'permits', domains: ['education', 'employment'], description: 'Underpins the Unique Learner Number and learner-data provisions.', url: 'https://www.legislation.gov.uk/ukpga/2009/22/contents' },
          { id: 'wttsc', label: 'Working Together to Safeguard Children (statutory guidance)', citation: 'HM Government statutory guidance', layer: 'power', kind: 'governance', nature: 'control', domains: ['child-protection', 'childrens-social-care'], description: 'The multi-agency safeguarding framework. Not a power itself, but sets the expectation and conditions for safeguarding information sharing.', url: 'https://www.gov.uk/government/publications/working-together-to-safeguard-children--2' },
        ],
      },
      {
        id: 'power-health',
        label: 'Health & adult social care',
        layer: 'power',
        children: [
          { id: 'nhsa-2006-s251', label: 'NHS Act 2006 s.251 + COPI Regulations 2002', citation: 'NHS Act 2006 s.251; SI 2002/1438 (COPI) reg 5', layer: 'power', kind: 'statutory-gateway', nature: 'sets-aside-confidentiality', domains: ['health'], description: 'Lets the Secretary of State set aside the common-law duty of confidentiality for defined medical purposes where consent is impractical — operationalised via Confidentiality Advisory Group (CAG) support.', caveat: 'Requires CAG approval (Layer C). Sets aside confidentiality only — you still need a DP basis.', url: 'https://www.legislation.gov.uk/ukpga/2006/41/section/251' },
          { id: 'hsca-2012-s251b', label: 'Health and Social Care Act 2012 s.251B — duty to share for direct care', citation: 'HSCA 2012 s.251B (inserted by HSC(SQ)A 2015)', layer: 'power', kind: 'statutory-gateway', nature: 'requires', domains: ['health'], description: 'Duty on health/adult-care commissioners and providers to share information about an individual for their direct care, where it is in their interests.', url: 'https://www.legislation.gov.uk/ukpga/2012/7/section/251B' },
          { id: 'hca-2022-stds', label: 'Health and Care Act 2022 — information standards & sharing', citation: 'Health and Care Act 2022', layer: 'power', kind: 'statutory-gateway', nature: 'permits', domains: ['health'], description: 'Strengthens mandatory information standards across health and adult social care and supports data sharing for the system.', url: 'https://www.legislation.gov.uk/ukpga/2022/31/contents' },
          { id: 'care-act-2014-s45', label: 'Care Act 2014 s.6 & s.45 — co-operation and supply of information', citation: 'Care Act 2014 s.6, s.45', layer: 'power', kind: 'statutory-gateway', nature: 'requires', domains: ['health'], description: 'Duties to co-operate and to supply information in adult safeguarding enquiries (s.42–47).', url: 'https://www.legislation.gov.uk/ukpga/2014/23/contents' },
          { id: 'caldicott-confidentiality', label: 'Common-law duty of confidentiality & the Caldicott Principles', citation: 'Common law; Caldicott Principles', layer: 'power', kind: 'common-law', nature: 'control', domains: ['health'], description: 'Confidential patient information may only be shared with consent or where there is an overriding public interest / statutory gateway. The Caldicott Principles govern justified use.', url: 'https://www.gov.uk/government/publications/the-caldicott-principles' },
        ],
      },
      {
        id: 'power-justice',
        label: 'Crime, policing & justice',
        layer: 'power',
        children: [
          { id: 'cda-1998-s115', label: 'Crime and Disorder Act 1998 s.115 — disclosure of information', citation: 'Crime and Disorder Act 1998 s.115', layer: 'power', kind: 'statutory-gateway', nature: 'permits', domains: ['justice', 'local-gov'], description: 'Power to disclose information to relevant authorities where necessary or expedient for the Act\'s crime-and-disorder purposes.', url: 'https://www.legislation.gov.uk/ukpga/1998/37/section/115' },
          { id: 'ctsa-2015-prevent', label: 'Counter-Terrorism and Security Act 2015 — Prevent duty & Channel', citation: 'CTSA 2015 s.26 (Prevent), s.36–41 (Channel)', layer: 'power', kind: 'statutory-gateway', nature: 'requires', domains: ['justice', 'education'], description: 'Prevent duty on specified authorities, and the Channel panel information-sharing arrangements.', url: 'https://www.legislation.gov.uk/ukpga/2015/6/contents' },
        ],
      },
      {
        id: 'power-welfare-revenue',
        label: 'Welfare, revenue & employment',
        layer: 'power',
        children: [
          { id: 'ssaa-1992', label: 'Social Security Administration Act 1992 — benefit information', citation: 'Social Security Administration Act 1992', layer: 'power', kind: 'statutory-gateway', nature: 'permits', domains: ['employment', 'cross-gov'], description: 'Gateways for sharing social-security information by DWP and partners.', url: 'https://www.legislation.gov.uk/ukpga/1992/5/contents' },
          { id: 'crca-2005-s18', label: 'Commissioners for Revenue and Customs Act 2005 s.18 & s.20/21', citation: 'CRCA 2005 s.18 (confidentiality); s.20, s.21 (disclosure gateways)', layer: 'power', kind: 'statutory-gateway', nature: 'permits', domains: ['cross-gov', 'employment'], description: 'HMRC information is confidential under s.18; s.20/s.21 provide limited public-interest and statutory disclosure gateways.', url: 'https://www.legislation.gov.uk/ukpga/2005/11/contents' },
        ],
      },
      {
        id: 'power-stats-research',
        label: 'Statistics & research',
        layer: 'power',
        children: [
          { id: 'srsa-2007', label: 'Statistics and Registration Service Act 2007 — ONS', citation: 'Statistics and Registration Service Act 2007', layer: 'power', kind: 'statutory-gateway', nature: 'permits', domains: ['cross-gov'], description: 'Establishes the UK Statistics Authority and information-access powers for official statistics.', url: 'https://www.legislation.gov.uk/ukpga/2007/18/contents' },
        ],
      },
    ],
  },

  // ======================================================================
  // LAYER C — Governance instruments (the controls you must put in place)
  // ======================================================================
  {
    id: 'layer-governance',
    label: 'C · Governance instruments & controls',
    layer: 'governance',
    description:
      'Having a lawful basis and a power is not the end. These instruments evidence that the sharing is necessary, proportionate, documented and accountable — and several are legally required for the bases above.',
    children: [
      { id: 'dpia', label: 'Data Protection Impact Assessment (DPIA)', citation: 'UK GDPR Art 35; DPA 2018 s.64', layer: 'governance', kind: 'governance', nature: 'control', description: 'Mandatory for high-risk processing — which includes large-scale special-category data and most data about children.', url: 'https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/data-protection-impact-assessments-dpias/' },
      { id: 'dsa-isa', label: 'Data Sharing / Information Sharing Agreement (DSA / ISA)', citation: 'ICO Data Sharing Code', layer: 'governance', kind: 'governance', nature: 'control', description: 'A documented agreement between the parties setting out purpose, data, controls, retention and roles.' },
      { id: 'apd', label: 'Appropriate Policy Document (APD)', citation: 'DPA 2018 Sch 1 Pt 4', layer: 'governance', kind: 'governance', nature: 'control', description: 'Required when relying on most DPA 2018 Schedule 1 conditions for special-category / criminal-offence data.', url: 'https://www.legislation.gov.uk/ukpga/2018/12/schedule/1' },
      { id: 'cag-s251', label: 'Confidentiality Advisory Group (CAG) approval / s.251 support', citation: 'NHS Act 2006 s.251', layer: 'governance', kind: 'governance', nature: 'control', domains: ['health'], description: 'Required to rely on the s.251/COPI route to set aside confidentiality for confidential patient information.', url: 'https://www.hra.nhs.uk/about-us/committees-and-services/confidentiality-advisory-group/' },
      { id: 'caldicott-guardian', label: 'Caldicott Guardian sign-off', citation: 'Caldicott Principles', layer: 'governance', kind: 'governance', nature: 'control', domains: ['health'], description: 'Senior sign-off that any use of confidential health/care information is justified against the Caldicott Principles.', url: 'https://www.gov.uk/government/publications/the-caldicott-principles' },
      { id: 'ropa', label: 'Record of Processing Activities (ROPA)', citation: 'UK GDPR Art 30', layer: 'governance', kind: 'governance', nature: 'control', description: 'Maintain a record of the processing, including the lawful basis and recipients.' },
      { id: 'ico-sharing-code', label: 'ICO Data Sharing Code of Practice', citation: 'DPA 2018 s.121 (statutory code)', layer: 'governance', kind: 'governance', nature: 'control', description: 'The statutory code that data sharing must have regard to; a practical conformance benchmark.', url: 'https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-sharing/data-sharing-a-code-of-practice/' },
      { id: 'dpo', label: 'Data Protection Officer (DPO) consultation', citation: 'UK GDPR Art 37–39', layer: 'governance', kind: 'governance', nature: 'control', description: 'Public authorities must have a DPO and consult them on the design and the DPIA.' },
    ],
  },
];

// --- helpers ---------------------------------------------------------------
const FLAT = new Map<string, LegalNode>();
function walk(nodes: LegalNode[]) {
  for (const n of nodes) {
    FLAT.set(n.id, n);
    if (n.children) walk(n.children);
  }
}
walk(LEGAL_BASIS);

/** Every leaf entry (a node with a kind — i.e. a selectable basis, not a group). */
export const LEGAL_LEAVES: LegalNode[] = [...FLAT.values()].filter((n) => !!n.kind);

export function legalById(id?: string): LegalNode | undefined {
  return id ? FLAT.get(id) : undefined;
}
export function legalLayerOf(id: string): LegalLayer | undefined {
  return FLAT.get(id)?.layer;
}
export const LAYER_LABEL: Record<LegalLayer, string> = {
  'data-protection': 'Data-protection basis',
  power: 'Legal power / gateway',
  governance: 'Governance',
};

/** A one-line summary of a selection, grouped by layer (used in exports). */
export function summariseLegalBasis(ids: string[]): string {
  const picked = ids.map(legalById).filter(Boolean) as LegalNode[];
  if (!picked.length) return '';
  const by = (l: LegalLayer) => picked.filter((p) => p.layer === l).map((p) => p.citation || p.label);
  const parts: string[] = [];
  const a = by('data-protection'); if (a.length) parts.push(`DP basis: ${a.join('; ')}`);
  const b = by('power'); if (b.length) parts.push(`Power: ${b.join('; ')}`);
  const c = by('governance'); if (c.length) parts.push(`Governance: ${c.join('; ')}`);
  return parts.join(' · ');
}

/** Completeness of a selection against the A+B+C model. */
export function legalCompleteness(ids: string[], opts: { personal: boolean; special: boolean }) {
  const picked = ids.map(legalById).filter(Boolean) as LegalNode[];
  const hasA = picked.some((p) => p.layer === 'data-protection' && (p.kind === 'dp-article6' || p.kind === 'dp-regime'));
  const hasA9 = picked.some((p) => p.kind === 'dp-article9' || p.kind === 'dp-article10');
  const hasB = picked.some((p) => p.layer === 'power' && (p.kind === 'statutory-gateway' || p.kind === 'common-law'));
  const hasC = picked.some((p) => p.layer === 'governance');
  return {
    hasA: !opts.personal || hasA,
    hasA9: !opts.special || hasA9,
    hasB,
    hasC,
    complete: (!opts.personal || hasA) && (!opts.special || hasA9) && hasB,
  };
}
