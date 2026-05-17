const docs = [
  {
    slug: 'refund-policy',
    content:
      'Annual customers have a 30 day refund window. Monthly customers have a 14 day refund window.',
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
    console.log(JSON.stringify({ docs }, null, 2));
    return;
  }

  for (const doc of docs) {
    const response = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
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
  console.log(JSON.stringify({ seeded: docs.map((doc) => doc.slug) }, null, 2));
}

void main();
