# sales.gexart.com front door (Cloudflare Pages)

Hostinger holds the DNS for gexart.com, and Workers custom domains need Cloudflare DNS. A Pages project
accepts a custom *subdomain* via a plain CNAME at any DNS provider, so this tiny project is the bridge
(same setup as crm.gexart.com):
`sales.gexart.com` (CNAME -> sales-crm-front.pages.dev) -> this Pages worker -> service binding -> the `sales-crm-gexart` Worker.

Deploy / update:  `cd pages-front && npx wrangler pages deploy ./dist --project-name sales-crm-front --branch main`
Custom domain:    Cloudflare dashboard -> Workers & Pages -> sales-crm-front -> Custom domains -> sales.gexart.com
Hostinger DNS:    CNAME  sales  ->  sales-crm-front.pages.dev
