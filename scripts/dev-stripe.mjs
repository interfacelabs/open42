import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

for (const file of ['.env.local', '.env']) {
  const path = resolve(repoRoot, file);
  if (existsSync(path)) {
    config({ path, override: false });
  }
}

const defaultEvents = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'invoice.paid',
  'invoice.payment_failed',
];

const apiPublicUrl = (process.env.API_PUBLIC_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
const forwardTo = process.env.STRIPE_FORWARD_TO ?? `${apiPublicUrl}/webhooks/stripe`;
const events = (process.env.STRIPE_WEBHOOK_EVENTS ?? defaultEvents.join(','))
  .split(',')
  .map((event) => event.trim())
  .filter(Boolean);

const args = ['listen', '--forward-to', forwardTo, '--events', events.join(',')];
if (process.env.STRIPE_CLI_API_KEY) {
  args.push('--api-key', process.env.STRIPE_CLI_API_KEY);
}

console.log(`Forwarding Stripe sandbox events to ${forwardTo}`);
console.log('Copy the whsec_... value printed by Stripe into STRIPE_WEBHOOK_SECRET in .env.local.');
console.log('Keep this process running while testing Checkout locally.\n');

const child = spawn('stripe', args, {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});

child.on('error', (error) => {
  if (error.code === 'ENOENT') {
    console.error('Stripe CLI was not found. Install it from https://docs.stripe.com/stripe-cli');
    process.exit(1);
  }
  throw error;
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
