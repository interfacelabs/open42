import { pathToFileURL } from 'node:url';

export const CHAT_EVAL_DOCS = [
  {
    slug: 'refund-policy',
    content:
      'Source slug: refund-policy. Annual customers have a 30 day refund window. Monthly customers have a 14 day refund window. This source does not contain an office dog policy.',
  },
  {
    slug: 'enterprise-msa',
    content:
      'Enterprise contracts may override standard refunds when the signed MSA includes a custom refund clause.',
  },
  {
    slug: 'billing-faq',
    content:
      'After the refund window closes, refund requests convert to account credit when approved.',
  },
];

async function main() {
  const mcpUrl = process.env.OPEN42_CHAT_EVAL_GBRAIN_MCP_URL?.replace(/\/+$/, '');
  const token = process.env.OPEN42_CHAT_EVAL_GBRAIN_TOKEN;
  if (!mcpUrl || !token) {
    console.log(JSON.stringify({ docs: CHAT_EVAL_DOCS }, null, 2));
    return;
  }

  const seeded = await seedBrain({ mcpUrl, token });
  console.log(JSON.stringify({ seeded }, null, 2));
}

export async function seedBrain(input: { mcpUrl: string; token: string }): Promise<string[]> {
  const mcpUrl = input.mcpUrl.replace(/\/+$/, '');
  for (const doc of CHAT_EVAL_DOCS) {
    const response = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: doc.slug,
        method: 'tools/call',
        params: { name: 'put_page', arguments: doc },
      }),
    });
    if (!response.ok) throw new Error(`seed failed for ${doc.slug}: ${response.status}`);
  }
  return CHAT_EVAL_DOCS.map((doc) => doc.slug);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
