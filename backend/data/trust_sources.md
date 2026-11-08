# Trust facts: sourcing log (checked 2026-11-08)

Rules: only the vendor's own pages; a field becomes `vendor_claimed` only with a verbatim quote (≤ 25 words)
from a page we actually read. Everything else stays `unknown`. "Unknown" ≠ "no". Applied facts live in
`trust_sourced.json` → merged by `python -m scripts.extend_trust_schema --apply-sourced data/trust_sourced.json`.

## Applied (vendor_claimed)
| Tool | Fields | Source |
|---|---|---|
| calendly | soc2, gdpr, iso27001, no_training_on_customer_data, retention, data_residency | calendly.com/security, /legal/privacy-notice, /help/your-privacy-and-security, /help/data-storage-and-international-data-transfers |
| homebase | soc2, retention | trust.joinhomebase.com (SafeBase, vendor subdomain), joinhomebase.com/privacy-policy/ |
| square-pos / square-appointments / square-marketing | hipaa (BAA, limited scope — quote says so), retention, data_residency | squareup.com/us/en/legal/general/hipaa, /legal/general/privacy |
| tidio | soc2, gdpr, retention, data_residency | tidio.com/security/, /privacy-policy/ |
| jobber | gdpr, data_residency | getjobber.com/GDPR/, /privacy-policy/ |
| housecall-pro | retention, data_residency | housecallpro.com/privacy/ |
| chatgpt-business | soc2, iso27001 | trust.openai.com |
| claude-pro | soc2, hipaa (BAA available), iso27001, data_residency | privacy.claude.com certification + server-location articles |
| mailchimp | soc2, data_residency | mailchimp.com/about/security/ |
| wix | gdpr, retention | wix.com/manage/privacy-security-hub, /about/privacy |
| canva-pro | opt_out | canva.com/policies/privacy-policy/ |

## Checked, left unknown (with reason)
- **Training on customer data — vendor says it DOES train** (so `no_training_on_customer_data` is NOT claimed):
  homebase ("We may use data submitted through the Services to train, test, and improve our AI models." — privacy policy);
  square-* (Generative AI terms §II: "...train, fine-tune, test, evaluate and develop the AI Products");
  canva-pro ("to train our algorithms, models and AI products and services using machine learning" — privacy policy);
  quickbooks / mailchimp (Intuit Global Privacy Statement mentions training Intuit AI models; scope for customer data unclear).
- claude-pro `no_training_on_customer_data`: the commercial (Team/Enterprise) default is no training, but the catalog entry also
  covers consumer Pro, whose terms differ → unknown.
- jobber: no SOC 2/ISO statement on its pages; retention section not verifiable verbatim. Narrow no-training statement covers only Google Workspace data.
- housecall-pro: /security/ 404; trust center at housecallpro.safebase.us (third-party domain) not fetched.
- 7shifts: /security and /privacy 404; homepage rendered as a JS shell.
- smith-ai: /security 404; /privacy had no policy text. goodcall, rosie: /security and /privacy 404.
- square SOC 2: trust.squareup.com rendered only a JS shell. square GDPR: rights paragraph exists but GDPR not named in text read.
- chatgpt-business: openai.com/business-data and /enterprise-privacy returned 403; trust portal details gated.
- canva-pro: /trust pages 403; GDPR/retention/residency only seen in a tool summary, not verbatim.
- quickbooks: security.intuit.com JS shell; quickbooks.intuit.com/security 404.
- meta-business-suite: facebook.com/privacy/policy body truncated; nothing verbatim.
- mailchimp ISO 27001: page describes audits but doesn't explicitly say "certified" → unknown.
- All other catalog tools: not yet checked.
